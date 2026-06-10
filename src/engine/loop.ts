/**
 * Fixed-timestep game loop: update runs at exactly 60 Hz (like a console
 * generating fields), render runs every animation frame (the tube never
 * stops scanning).
 */
export class GameLoop {
  readonly STEP = 1 / 60
  private raf = 0
  private last = -1
  private acc = 0
  running = false

  constructor(
    private update: (dt: number) => void,
    private render: (t: number) => void,
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.last = -1
    this.acc = 0
    const tick = (tms: number) => {
      if (!this.running) return
      const t = tms / 1000
      if (this.last < 0) this.last = t
      this.acc += Math.min(t - this.last, 0.25)
      this.last = t
      let steps = 0
      while (this.acc >= this.STEP && steps < 5) {
        this.update(this.STEP)
        this.acc -= this.STEP
        steps++
      }
      if (steps === 5) this.acc = 0 // dropped frames; don't spiral
      this.render(t)
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
    console.info('[loop] started (60 Hz fixed update)')
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
  }
}
