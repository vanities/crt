import type { Sfx } from './schemas'

/**
 * Chiptune-style synth on WebAudio: square/triangle/saw/sine voices plus
 * filtered noise, driven entirely by JSON patches (assets/sfx). Also models
 * the monitor itself: 15.7 kHz flyback whine while powered and the degauss
 * thunk. The AudioContext is created lazily on the first user gesture.
 */
export class ChipAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private hum: { osc: OscillatorNode; gain: GainNode } | null = null
  private noiseBuf: AudioBuffer | null = null
  private volume = 0.5
  private enabled = true

  /** Safe to call repeatedly; only does work on the first user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const t0 = performance.now()
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.enabled ? this.volume : 0
      this.master.connect(this.ctx.destination)
      console.info(`[audio] context created (${this.ctx.state}) in ${(performance.now() - t0).toFixed(1)}ms`)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setVolume(v: number): void {
    this.volume = v
    this.apply()
  }

  /** Monitor speaker mute — power off silences everything. */
  setEnabled(on: boolean): void {
    this.enabled = on
    this.apply()
  }

  private apply(): void {
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.03)
    }
  }

  play(sfx: Sfx): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master || ctx.state !== 'running') return

    const t0 = ctx.currentTime
    const dur = sfx.duration
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(sfx.volume, t0 + sfx.attack)
    gain.gain.setValueAtTime(sfx.volume, t0 + Math.max(sfx.attack, dur - sfx.release))
    gain.gain.linearRampToValueAtTime(0, t0 + dur + 0.001)
    gain.connect(master)

    const end = sfx.freq.end ?? sfx.freq.start
    if (sfx.wave === 'noise') {
      const src = ctx.createBufferSource()
      src.buffer = this.noise(ctx)
      src.loop = true
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.Q.value = 0.9
      filter.frequency.setValueAtTime(sfx.freq.start, t0)
      this.ramp(filter.frequency, end, t0, dur, sfx.freq.curve)
      src.connect(filter)
      filter.connect(gain)
      src.start(t0)
      src.stop(t0 + dur + 0.05)
    } else {
      const osc = ctx.createOscillator()
      osc.type = sfx.wave
      osc.frequency.setValueAtTime(sfx.freq.start, t0)
      this.ramp(osc.frequency, end, t0, dur, sfx.freq.curve)
      osc.connect(gain)
      osc.start(t0)
      osc.stop(t0 + dur + 0.05)
    }
  }

  private ramp(param: AudioParam, end: number, t0: number, dur: number, curve: 'linear' | 'exp'): void {
    if (curve === 'exp') param.exponentialRampToValueAtTime(Math.max(1, end), t0 + dur)
    else param.linearRampToValueAtTime(end, t0 + dur)
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const len = Math.floor(ctx.sampleRate * 0.5)
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    }
    return this.noiseBuf
  }

  /** 15734 Hz horizontal-scan whine. Subtle. Some adults can't hear it — authentic. */
  setHum(on: boolean): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    if (on && !this.hum) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = 15734
      const gain = ctx.createGain()
      gain.gain.value = 0
      gain.gain.setTargetAtTime(0.012, ctx.currentTime, 0.4)
      osc.connect(gain)
      gain.connect(ctx.destination) // bypasses master so the game volume knob doesn't affect the tube
      osc.start()
      this.hum = { osc, gain }
      console.debug('[audio] flyback hum on (15734 Hz)')
    } else if (!on && this.hum) {
      const { osc, gain } = this.hum
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05)
      osc.stop(ctx.currentTime + 0.4)
      this.hum = null
      console.debug('[audio] flyback hum off')
    }
  }

  /** The degauss button THUNK: low magnetic slam + decaying rumble. */
  degaussThunk(): void {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t0 = ctx.currentTime

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(70, t0)
    osc.frequency.exponentialRampToValueAtTime(28, t0 + 0.7)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.9, t0)
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9)
    osc.connect(og)
    og.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + 1)

    const src = ctx.createBufferSource()
    src.buffer = this.noise(ctx)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(900, t0)
    filter.frequency.exponentialRampToValueAtTime(60, t0 + 0.5)
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.5, t0)
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6)
    src.connect(filter)
    filter.connect(ng)
    ng.connect(ctx.destination)
    src.start(t0)
    src.stop(t0 + 0.7)
  }

  /** Relay click for power/input switching. */
  click(): void {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t0 = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noise(ctx)
    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 2400
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.25, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05)
    src.connect(filter)
    filter.connect(g)
    g.connect(ctx.destination)
    src.start(t0)
    src.stop(t0 + 0.06)
  }
}
