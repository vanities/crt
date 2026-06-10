import type { RGB } from './color'
import type { Font } from './font'
import type { Sprite } from './sprites'

/**
 * The "console output": a CPU-side RGBA pixel buffer that cartridges draw
 * into. The monitor uploads it as a texture each frame and runs it through
 * the analog signal chain — cartridges never touch WebGL.
 */
export class Framebuffer {
  readonly w: number
  readonly h: number
  readonly data: Uint8ClampedArray
  font: Font | null = null

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.data = new Uint8ClampedArray(w * h * 4)
    this.clear([0, 0, 0])
  }

  clear(c: RGB): void {
    const d = this.data
    for (let i = 0; i < d.length; i += 4) {
      d[i] = c[0]
      d[i + 1] = c[1]
      d[i + 2] = c[2]
      d[i + 3] = 255
    }
  }

  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 4
    this.data[i] = c[0]
    this.data[i + 1] = c[1]
    this.data[i + 2] = c[2]
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, x | 0)
    const y0 = Math.max(0, y | 0)
    const x1 = Math.min(this.w, (x + w) | 0)
    const y1 = Math.min(this.h, (y + h) | 0)
    for (let py = y0; py < y1; py++) {
      let i = (py * this.w + x0) * 4
      for (let px = x0; px < x1; px++) {
        this.data[i] = c[0]
        this.data[i + 1] = c[1]
        this.data[i + 2] = c[2]
        i += 4
      }
    }
  }

  hline(x: number, y: number, w: number, c: RGB): void {
    this.fillRect(x, y, w, 1, c)
  }

  vline(x: number, y: number, h: number, c: RGB): void {
    this.fillRect(x, y, 1, h, c)
  }

  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    this.hline(x, y, w, c)
    this.hline(x, y + h - 1, w, c)
    this.vline(x, y, h, c)
    this.vline(x + w - 1, y, h, c)
  }

  circle(cx: number, cy: number, r: number, c: RGB, fill = false): void {
    const r2 = r * r
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = dx * dx + dy * dy
        const on = fill ? d <= r2 : d <= r2 && d >= (r - 1) * (r - 1)
        if (on) this.set(cx + dx, cy + dy, c)
      }
    }
  }

  sprite(spr: Sprite, x: number, y: number, opts: { frame?: number; flipX?: boolean } = {}): void {
    const frame = spr.frames[(opts.frame ?? 0) % spr.frames.length]
    const flip = opts.flipX ?? false
    x |= 0
    y |= 0
    for (let py = 0; py < spr.h; py++) {
      const ty = y + py
      if (ty < 0 || ty >= this.h) continue
      for (let px = 0; px < spr.w; px++) {
        const idx = frame[py * spr.w + (flip ? spr.w - 1 - px : px)]
        if (idx < 0) continue
        const tx = x + px
        if (tx < 0 || tx >= this.w) continue
        const i = (ty * this.w + tx) * 4
        const c = spr.colors[idx]
        this.data[i] = c[0]
        this.data[i + 1] = c[1]
        this.data[i + 2] = c[2]
      }
    }
  }

  /**
   * Draw text with the current bitmap font (set `fb.font` first; the engine
   * sets the default "micro" font automatically). Unknown chars fall back to
   * "?". Returns the advance width in pixels.
   */
  text(str: string, x: number, y: number, c: RGB, scale = 1): number {
    const font = this.font
    if (!font) throw new Error('[fb] no font set — assign fb.font (e.g. assets.font("micro"))')
    let cx = x | 0
    for (const raw of str) {
      if (raw === ' ') {
        cx += (font.spaceWidth + 1) * scale
        continue
      }
      const ch = font.glyphs.has(raw) ? raw : raw.toUpperCase()
      const g = font.glyphs.get(ch) ?? font.glyphs.get('?')
      if (!g) {
        cx += (font.spaceWidth + 1) * scale
        continue
      }
      for (let gy = 0; gy < font.height; gy++) {
        const mask = g.rows[gy]
        for (let gx = 0; gx < g.w; gx++) {
          if (mask & (1 << (g.w - 1 - gx))) {
            if (scale === 1) this.set(cx + gx, y + gy, c)
            else this.fillRect(cx + gx * scale, y + gy * scale, scale, scale, c)
          }
        }
      }
      cx += (g.w + 1) * scale
    }
    return cx - x
  }

  /** Measure text width without drawing. */
  textWidth(str: string, scale = 1): number {
    const font = this.font
    if (!font) return 0
    let w = 0
    for (const raw of str) {
      if (raw === ' ') {
        w += (font.spaceWidth + 1) * scale
        continue
      }
      const ch = font.glyphs.has(raw) ? raw : raw.toUpperCase()
      const g = font.glyphs.get(ch) ?? font.glyphs.get('?')
      w += ((g?.w ?? font.spaceWidth) + 1) * scale
    }
    return w
  }
}
