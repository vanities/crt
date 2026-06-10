/**
 * Every adjustable parameter on the monitor, front and rear. This is the
 * single source of truth: the panel renders knobs from it, the shaders read
 * values from it, and localStorage persists it.
 */

export interface KnobDef {
  id: string
  label: string
  min: number
  max: number
  def: number
  panel: 'front' | 'rear'
  fmt?: (v: number) => string
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export const KNOBS: KnobDef[] = [
  // front panel — the classic PVM picture controls
  { id: 'volume', label: 'VOLUME', min: 0, max: 1, def: 0.5, panel: 'front', fmt: pct },
  { id: 'contrast', label: 'CONTRAST', min: 0.4, max: 1.7, def: 1.0, panel: 'front' },
  { id: 'bright', label: 'BRIGHT', min: -0.2, max: 0.2, def: 0.0, panel: 'front' },
  { id: 'chroma', label: 'CHROMA', min: 0, max: 1.8, def: 1.0, panel: 'front' },
  { id: 'phase', label: 'PHASE', min: -0.5, max: 0.5, def: 0.0, panel: 'front', fmt: (v) => `${Math.round((v * 180) / Math.PI)}°` },
  { id: 'aperture', label: 'APERTURE', min: 0, max: 1, def: 0.3, panel: 'front', fmt: pct },
  // rear panel — tube/simulation characteristics
  { id: 'scanline', label: 'SCANLINE', min: 0, max: 1, def: 0.55, panel: 'rear', fmt: pct },
  { id: 'mask', label: 'GRILLE', min: 0, max: 1, def: 0.45, panel: 'rear', fmt: pct },
  { id: 'curvature', label: 'CURVE', min: 0, max: 1, def: 0.3, panel: 'rear', fmt: pct },
  { id: 'glow', label: 'GLOW', min: 0, max: 1, def: 0.4, panel: 'rear', fmt: pct },
  { id: 'persist', label: 'PERSIST', min: 0, max: 1, def: 0.3, panel: 'rear', fmt: pct },
  { id: 'noise', label: 'NOISE', min: 0, max: 1, def: 0.04, panel: 'rear', fmt: pct },
]

// v2: calmer NOISE default + phase-locked beam — old stored values would
// keep the shimmer people complained about
const STORE_KEY = 'crt.params.v2'

export class Params {
  private values = new Map<string, number>()
  private listeners = new Map<string, ((v: number) => void)[]>()

  constructor() {
    for (const k of KNOBS) this.values.set(k.id, k.def)
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, number>
      let n = 0
      for (const k of KNOBS) {
        if (typeof saved[k.id] === 'number') {
          this.values.set(k.id, Math.min(k.max, Math.max(k.min, saved[k.id])))
          n++
        }
      }
      if (n > 0) console.debug(`[params] restored ${n} knob(s) from localStorage`)
    } catch {
      /* corrupted storage — defaults win */
    }
  }

  def(id: string): KnobDef {
    const d = KNOBS.find((k) => k.id === id)
    if (!d) throw new Error(`[params] unknown knob "${id}"`)
    return d
  }

  get(id: string): number {
    const v = this.values.get(id)
    if (v === undefined) throw new Error(`[params] unknown knob "${id}"`)
    return v
  }

  set(id: string, v: number): void {
    const d = this.def(id)
    const clamped = Math.min(d.max, Math.max(d.min, v))
    this.values.set(id, clamped)
    for (const fn of this.listeners.get(id) ?? []) fn(clamped)
    this.persist()
  }

  reset(id: string): void {
    this.set(id, this.def(id).def)
  }

  resetAll(): void {
    for (const k of KNOBS) this.set(k.id, k.def)
  }

  onChange(id: string, fn: (v: number) => void): void {
    const arr = this.listeners.get(id) ?? []
    arr.push(fn)
    this.listeners.set(id, arr)
  }

  private persist(): void {
    const obj: Record<string, number> = {}
    for (const [k, v] of this.values) obj[k] = v
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(obj))
    } catch {
      /* private mode etc. — non-fatal */
    }
  }
}
