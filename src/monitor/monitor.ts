import { GLCtx, Pass, type Target } from './gl'
import type { Params } from './params'
import type { ChipAudio } from '../engine/audio'
import type { Framebuffer } from '../engine/framebuffer'
import type { Connection } from '../engine/cartridge'
import encodeSrc from './shaders/encode.glsl?raw'
import decodeSrc from './shaders/decode.glsl?raw'
import phosphorSrc from './shaders/phosphor.glsl?raw'
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

const FIELD_RATE = 60 // fields per second the deflection runs at

// P22-ish phosphor time constants (seconds). Blue dies first; red lingers.
const TAU_FAST: [number, number, number] = [0.0034, 0.0026, 0.0019]
const TAU_SLOW = 0.045
const SLOW_TINT: [number, number, number] = [1.0, 0.5, 0.26] // the orange afterglow

/**
 * The tube. Owns the WebGL signal chain:
 *   source fb → encode → decode → beam-scan phosphor simulation → halation
 *   → faceplate — plus the electromechanical state machines (power,
 *   degauss, input switch).
 *
 * The phosphor stage is temporal: a field-phase clock advances at 60
 * fields/s in wall time and each display refresh excites only the raster
 * slice the beam swept during that interval, integrating P22 decay in
 * closed form. On high-refresh displays this produces a true rolling scan.
 */
export class Monitor {
  private glc: GLCtx
  private pEncode: Pass
  private pDecode: Pass
  private pPhos: Pass
  private pDown: Pass
  private pBlur: Pass
  private pScreen: Pass

  // source-resolution targets
  private texSrc: WebGLTexture | null = null
  private tSig: Target | null = null
  private tVideo: Target | null = null
  private srcW = 0
  private srcH = 0

  // output-resolution phosphor set: shared light target + ping-pong states
  private texLight: WebGLTexture | null = null
  private texFast: [WebGLTexture, WebGLTexture] | null = null
  private texSlow: [WebGLTexture, WebGLTexture] | null = null
  private fboPhos: [Target, Target] | null = null // writes (light, fastN, slowN)
  private flip = 0
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
  private fieldPhase = 0
  private dtEma = 1 / 60
  private frames = 0
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
    this.pPhos = this.glc.compile('phosphor', phosphorSrc, { mrt: true })
    this.pDown = this.glc.compile('downsample', downsampleSrc)
    this.pBlur = this.glc.compile('blur', blurSrc)
    this.pScreen = this.glc.compile('screen', screenSrc)
    console.info(`[monitor] signal chain compiled (6 passes) in ${(performance.now() - t0).toFixed(1)}ms`)
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
    const dt = this.lastT < 0 ? 1 / 60 : Math.min(Math.max(t - this.lastT, 1 / 480), 0.1)
    this.lastT = t
    this.powerT += dt
    this.degaussT += dt
    this.switchT += dt
    if (this.osdT > 0) this.osdT -= dt

    // measure the display so we can report beam slices per field
    this.dtEma += (dt - this.dtEma) * 0.05
    if (++this.frames === 240) {
      const hz = 1 / this.dtEma
      console.info(
        `[monitor] display ≈${hz.toFixed(1)} Hz → ${(hz / FIELD_RATE).toFixed(2)} beam slice(s) per field`,
      )
    }

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
    if (!this.texSrc || !this.tSig || !this.tVideo || !this.fboPhos) return

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

    // 3 — beam scan + phosphor integration (the temporal core)
    const span = Math.min(dt * FIELD_RATE, 1)
    this.fieldPhase = (this.fieldPhase + span) % 1
    const field = this.scan480i ? (Math.floor(this.fieldPhase * 2) % 2 === 0 ? 0.25 : -0.25) : 0
    const vroll = switchEnv > 0 ? switchEnv * switchEnv * 0.4 * Math.sin(t * 50) : 0
    const persist = P.get('persist')
    const slowFrac = Math.pow(persist, 1.6) * 0.12
    const read = this.flip
    const write = 1 - this.flip
    this.pPhos
      .use()
      .tex(0, 'u_video', this.tVideo.tex)
      .tex(1, 'u_fastPrev', this.texFast![read])
      .tex(2, 'u_slowPrev', this.texSlow![read])
      .f('u_lines', this.srcH)
      .f('u_scan', P.get('scanline'))
      .f('u_underscan', this.underscan ? 0.13 : 0)
      .f('u_hvdelay', this.hvdelay ? 1 : 0)
      .f('u_vroll', vroll)
      .f('u_field', field)
      .f('u_ph1', this.fieldPhase)
      .f('u_span', span)
      .f('u_dt', dt)
      .f3('u_tauF', TAU_FAST[0], TAU_FAST[1], TAU_FAST[2])
      .f('u_tauS', TAU_SLOW)
      .f3('u_slowIn', slowFrac * SLOW_TINT[0], slowFrac * SLOW_TINT[1], slowFrac * SLOW_TINT[2])
      .f('u_bias', this.glc.hdr ? 0 : 0.0022)
    this.pPhos.draw(this.fboPhos[write])
    this.flip = write

    // 4 — halation: bright-pass downsample + separable blur (linear light)
    this.pDown.use().tex(0, 'u_src', this.texLight!).f2('u_texel', 1 / this.outW, 1 / this.outH)
    this.pDown.draw(this.tGlowA!)
    this.pBlur.use().tex(0, 'u_src', this.tGlowA!.tex).f2('u_dir', 1.6 / this.tGlowA!.w, 0)
    this.pBlur.draw(this.tGlowB!)
    this.pBlur.use().tex(0, 'u_src', this.tGlowB!.tex).f2('u_dir', 0, 1.6 / this.tGlowB!.h)
    this.pBlur.draw(this.tGlowA!)

    // 5 — faceplate to canvas
    const pw = this.powerEnvelope()
    const pitch = Math.min(8, Math.max(2, Math.round(this.outH / 240)))
    this.pScreen
      .use()
      .tex(0, 'u_phos', this.texLight!)
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

  private destroyPhosphorSet(): void {
    const gl = this.glc.gl
    if (this.fboPhos) {
      gl.deleteFramebuffer(this.fboPhos[0].fbo)
      gl.deleteFramebuffer(this.fboPhos[1].fbo)
    }
    if (this.texLight) gl.deleteTexture(this.texLight)
    for (const t of this.texFast ?? []) gl.deleteTexture(t)
    for (const t of this.texSlow ?? []) gl.deleteTexture(t)
    this.fboPhos = null
    this.texLight = null
    this.texFast = null
    this.texSlow = null
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
    const fmt = this.glc.hdr ? 'rgba16f' : 'rgba8'

    this.destroyPhosphorSet()
    this.glc.deleteTarget(this.tGlowA)
    this.glc.deleteTarget(this.tGlowB)

    this.texLight = this.glc.texture(w, h, 'linear', fmt)
    this.texFast = [this.glc.texture(w, h, 'nearest', fmt), this.glc.texture(w, h, 'nearest', fmt)]
    this.texSlow = [this.glc.texture(w, h, 'nearest', fmt), this.glc.texture(w, h, 'nearest', fmt)]
    // each FBO writes (light, fast[i], slow[i]) while sampling the other pair
    this.fboPhos = [
      this.glc.targetFrom([this.texLight, this.texFast[0], this.texSlow[0]], w, h),
      this.glc.targetFrom([this.texLight, this.texFast[1], this.texSlow[1]], w, h),
    ]
    this.flip = 0

    const gw = Math.max(2, w >> 1)
    const gh = Math.max(2, h >> 1)
    this.tGlowA = this.glc.target(gw, gh, 'linear', fmt)
    this.tGlowB = this.glc.target(gw, gh, 'linear', fmt)
    this.outW = w
    this.outH = h
    console.info(
      `[monitor] output ${w}x${h} (dpr ${dpr}, ${fmt}) targets rebuilt in ${(performance.now() - t0).toFixed(1)}ms`,
    )
    return true
  }
}
