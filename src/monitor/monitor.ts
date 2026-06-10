import { GLCtx, Pass, type Target } from './gl'
import type { Params } from './params'
import type { ChipAudio } from '../engine/audio'
import type { Framebuffer } from '../engine/framebuffer'
import type { Connection } from '../engine/cartridge'
import encodeSrc from './shaders/encode.glsl?raw'
import decodeSrc from './shaders/decode.glsl?raw'
import beamSrc from './shaders/beam.glsl?raw'
import persistSrc from './shaders/persist.glsl?raw'
import downsampleSrc from './shaders/downsample.glsl?raw'
import blurSrc from './shaders/blur.glsl?raw'
import screenSrc from './shaders/screen.glsl?raw'

export interface MonitorState {
  powered: boolean
  connection: Connection
  underscan: boolean
  hvdelay: boolean
  blue: boolean
  wide: boolean
}

const CONNECTIONS: Connection[] = ['composite', 'svideo', 'rgb']
export const CONNECTION_LABEL: Record<Connection, string> = {
  composite: 'CVBS',
  svideo: 'Y/C',
  rgb: 'RGB',
}

/**
 * The tube. Owns the WebGL signal chain:
 *   source fb → encode → decode → beam → persistence → halation → faceplate
 * plus the electromechanical state machines (power, degauss, input switch).
 */
export class Monitor {
  private glc: GLCtx
  private pEncode: Pass
  private pDecode: Pass
  private pBeam: Pass
  private pPersist: Pass
  private pDown: Pass
  private pBlur: Pass
  private pScreen: Pass

  // source-resolution targets
  private texSrc: WebGLTexture | null = null
  private tSig: Target | null = null
  private tVideo: Target | null = null
  private srcW = 0
  private srcH = 0

  // output-resolution targets
  private tBeam: Target | null = null
  private tPhosA: Target | null = null
  private tPhosB: Target | null = null
  private tGlowA: Target | null = null
  private tGlowB: Target | null = null
  private outW = 0
  private outH = 0

  // state machines
  powered = false
  private powerT = 99
  private degaussT = 99
  private switchT = 99
  private lastT = -1
  connection: Connection = 'composite'
  scan480i = false
  underscan = false
  hvdelay = false
  blue = false
  wide = false

  // OSD (stamped into the source fb by main, so it rides the signal path)
  osdText = ''
  private osdT = 0

  onState: (() => void) | null = null

  constructor(
    private canvas: HTMLCanvasElement,
    private params: Params,
    private audio: ChipAudio,
  ) {
    const t0 = performance.now()
    this.glc = new GLCtx(canvas)
    this.pEncode = this.glc.compile('encode', encodeSrc)
    this.pDecode = this.glc.compile('decode', decodeSrc)
    this.pBeam = this.glc.compile('beam', beamSrc)
    this.pPersist = this.glc.compile('persist', persistSrc)
    this.pDown = this.glc.compile('downsample', downsampleSrc)
    this.pBlur = this.glc.compile('blur', blurSrc)
    this.pScreen = this.glc.compile('screen', screenSrc)
    console.info(`[monitor] signal chain compiled (7 passes) in ${(performance.now() - t0).toFixed(1)}ms`)
  }

  // ── controls ──────────────────────────────────────────────────────────

  power(): void {
    this.powered = !this.powered
    this.powerT = 0
    this.audio.unlock()
    this.audio.click()
    this.audio.setEnabled(this.powered)
    this.audio.setHum(this.powered)
    console.info(`[monitor] power ${this.powered ? 'ON' : 'OFF'}`)
    this.onState?.()
  }

  degauss(): void {
    if (!this.powered) return
    this.degaussT = 0
    this.audio.degaussThunk()
    console.info('[monitor] DEGAUSS')
  }

  setConnection(c: Connection, silent = false): void {
    this.connection = c
    if (!silent) {
      this.switchT = 0
      this.audio.click()
    }
    this.onState?.()
  }

  cycleConnection(): Connection {
    const i = CONNECTIONS.indexOf(this.connection)
    const next = CONNECTIONS[(i + 1) % CONNECTIONS.length]
    this.setConnection(next)
    return next
  }

  /** Called when the input selector changes source. */
  notifySwitch(): void {
    this.switchT = 0
    this.audio.click()
  }

  toggle(which: 'underscan' | 'hvdelay' | 'blue' | 'wide'): boolean {
    this[which] = !this[which]
    this.audio.click()
    console.debug(`[monitor] ${which} = ${this[which]}`)
    this.onState?.()
    return this[which]
  }

  showOsd(text: string): void {
    this.osdText = text
    this.osdT = 2.2
  }

  get osdVisible(): boolean {
    return this.osdT > 0 && this.powered
  }

  state(): MonitorState {
    return {
      powered: this.powered,
      connection: this.connection,
      underscan: this.underscan,
      hvdelay: this.hvdelay,
      blue: this.blue,
      wide: this.wide,
    }
  }

  // ── render ────────────────────────────────────────────────────────────

  render(fb: Framebuffer | null, t: number, frame: number): void {
    const gl = this.glc.gl
    const dt = this.lastT < 0 ? 0 : Math.min(t - this.lastT, 0.1)
    this.lastT = t
    this.powerT += dt
    this.degaussT += dt
    this.switchT += dt
    if (this.osdT > 0) this.osdT -= dt

    if (!this.resize()) return

    // fully off and the collapse animation finished → just black
    if (!this.powered && this.powerT > 2.0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, this.outW, this.outH)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      return
    }

    if (fb) {
      this.ensureSourceTargets(fb.w, fb.h)
      gl.bindTexture(gl.TEXTURE_2D, this.texSrc)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, fb.w, fb.h, gl.RGBA, gl.UNSIGNED_BYTE, fb.data)
    }
    if (!this.texSrc || !this.tSig || !this.tVideo) return

    const P = this.params
    const mode = this.connection === 'rgb' ? 2 : this.connection === 'svideo' ? 1 : 0
    const cycles = this.srcW * 0.5333
    const framePhase = (frame % 2) * Math.PI
    const degaussEnv = this.degaussT < 6 ? Math.exp(-this.degaussT * 0.9) : 0
    const switchEnv = this.switchT < 0.45 ? 1 - this.switchT / 0.45 : 0

    // 1 — encoder (console side of the cable)
    this.pEncode
      .use()
      .tex(0, 'u_src', this.texSrc)
      .i('u_mode', mode)
      .f('u_cycles', cycles)
      .f('u_lines', this.srcH)
      .f('u_framePhase', framePhase)
    this.pEncode.draw(this.tSig)

    // 2 — decoder (jungle chip + picture knobs)
    this.pDecode
      .use()
      .tex(0, 'u_sig', this.tSig.tex)
      .i('u_mode', mode)
      .f('u_cycles', cycles)
      .f('u_lines', this.srcH)
      .f('u_framePhase', framePhase)
      .f2('u_sigSize', this.tSig.w, this.tSig.h)
      .f('u_chroma', P.get('chroma'))
      .f('u_phaseKnob', P.get('phase'))
      .f('u_aperture', P.get('aperture'))
      .f('u_contrast', P.get('contrast'))
      .f('u_bright', P.get('bright'))
      .f('u_noise', P.get('noise') * (mode === 2 ? 0.25 : 1))
      .f('u_snow', switchEnv)
      .f('u_degauss', degaussEnv)
      .f('u_time', t)
      .f('u_frame', frame % 1024)
    this.pDecode.draw(this.tVideo)

    // 3 — beam scanout at output resolution
    const field = this.scan480i ? (frame % 2 === 0 ? 0.25 : -0.25) : 0
    const vroll = switchEnv > 0 ? switchEnv * switchEnv * 0.4 * Math.sin(t * 50) : 0
    this.pBeam
      .use()
      .tex(0, 'u_video', this.tVideo.tex)
      .f('u_lines', this.srcH)
      .f('u_scan', P.get('scanline'))
      .f('u_underscan', this.underscan ? 0.13 : 0)
      .f('u_hvdelay', this.hvdelay ? 1 : 0)
      .f('u_field', field)
      .f('u_vroll', vroll)
    this.pBeam.draw(this.tBeam!)

    // 4 — phosphor persistence (ping-pong)
    const persist = P.get('persist')
    const decay = persist <= 0.001 ? 0 : 0.5 + persist * 0.45
    this.pPersist
      .use()
      .tex(0, 'u_beam', this.tBeam!.tex)
      .tex(1, 'u_prev', this.tPhosB!.tex)
      .f('u_decay', decay)
    this.pPersist.draw(this.tPhosA!)
    ;[this.tPhosA, this.tPhosB] = [this.tPhosB, this.tPhosA]
    const phos = this.tPhosB! // most recent

    // 5 — halation: bright-pass downsample + separable blur
    this.pDown.use().tex(0, 'u_src', phos.tex).f2('u_texel', 1 / phos.w, 1 / phos.h)
    this.pDown.draw(this.tGlowA!)
    this.pBlur.use().tex(0, 'u_src', this.tGlowA!.tex).f2('u_dir', 1.6 / this.tGlowA!.w, 0)
    this.pBlur.draw(this.tGlowB!)
    this.pBlur.use().tex(0, 'u_src', this.tGlowB!.tex).f2('u_dir', 0, 1.6 / this.tGlowB!.h)
    this.pBlur.draw(this.tGlowA!)

    // 6 — faceplate to canvas
    const pw = this.powerEnvelope()
    const pitch = Math.min(8, Math.max(2, Math.round(this.outH / 240)))
    this.pScreen
      .use()
      .tex(0, 'u_phos', phos.tex)
      .tex(1, 'u_glow', this.tGlowA!.tex)
      .f('u_mask', P.get('mask'))
      .f('u_maskPitch', pitch)
      .f('u_curve', P.get('curvature'))
      .f('u_glowAmt', P.get('glow'))
      .f('u_scaleX', pw.sx)
      .f('u_scaleY', pw.sy)
      .f('u_powerBright', pw.bright)
      .f('u_dot', pw.dot)
      .f('u_degauss', degaussEnv)
      .f('u_time', t)
      .f('u_blue', this.blue ? 1 : 0)
    this.pScreen.draw(null, this.outW, this.outH)
  }

  /** Raster collapse curves for power on/off. */
  private powerEnvelope(): { sx: number; sy: number; bright: number; dot: number } {
    const t = this.powerT
    const easeOut = (k: number) => 1 - Math.pow(1 - k, 3)
    if (this.powered) {
      const k = Math.min(t / 0.45, 1)
      const kx = Math.min(t / 0.25, 1)
      return {
        sx: 0.65 + 0.35 * easeOut(kx),
        sy: Math.max(0.004, easeOut(k)),
        bright: (1 + (1 - k) * 2.2) * (1 + 0.05 * Math.sin(t * 120) * (1 - k)),
        dot: 0,
      }
    }
    const k = Math.min(t / 0.3, 1)
    const dotT = Math.max(0, t - 0.3)
    return {
      sx: 1,
      sy: Math.max(0.004, 1 - easeOut(k)),
      bright: Math.max(0, 1.6 * (1 - k)),
      dot: t < 0.3 ? 0 : Math.max(0, 1 - dotT / 1.1) * 0.9,
    }
  }

  private ensureSourceTargets(w: number, h: number): void {
    if (w === this.srcW && h === this.srcH) return
    const gl = this.glc.gl
    if (this.texSrc) gl.deleteTexture(this.texSrc)
    this.glc.deleteTarget(this.tSig)
    this.glc.deleteTarget(this.tVideo)
    this.srcW = w
    this.srcH = h
    this.texSrc = this.glc.texture(w, h, 'nearest')
    gl.bindTexture(gl.TEXTURE_2D, this.texSrc)
    const sigW = Math.min(4096, w * 4)
    this.tSig = this.glc.target(sigW, h, 'nearest')
    this.tVideo = this.glc.target(sigW, h, 'linear')
    console.info(`[monitor] source targets ${w}x${h} → signal ${sigW}x${h}`)
  }

  private resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cssW = this.canvas.clientWidth
    const cssH = this.canvas.clientHeight
    if (cssW < 8 || cssH < 8) return false
    const w = Math.min(1920, Math.round(cssW * dpr))
    const h = Math.min(1440, Math.round(cssH * dpr))
    if (w === this.outW && h === this.outH) return true

    const t0 = performance.now()
    this.canvas.width = w
    this.canvas.height = h
    this.glc.deleteTarget(this.tBeam)
    this.glc.deleteTarget(this.tPhosA)
    this.glc.deleteTarget(this.tPhosB)
    this.glc.deleteTarget(this.tGlowA)
    this.glc.deleteTarget(this.tGlowB)
    this.tBeam = this.glc.target(w, h, 'linear')
    this.tPhosA = this.glc.target(w, h, 'linear')
    this.tPhosB = this.glc.target(w, h, 'linear')
    const gw = Math.max(2, w >> 1)
    const gh = Math.max(2, h >> 1)
    this.tGlowA = this.glc.target(gw, gh, 'linear')
    this.tGlowB = this.glc.target(gw, gh, 'linear')
    this.outW = w
    this.outH = h
    console.info(`[monitor] output ${w}x${h} (dpr ${dpr}) targets rebuilt in ${(performance.now() - t0).toFixed(1)}ms`)
    return true
  }
}
