import type { RGB } from './color'
import { hexToRgb } from './color'
import { spriteSchema, errMsg } from './schemas'

export interface Sprite {
  id: string
  w: number
  h: number
  fps: number
  /** per frame: palette index per pixel, -1 = transparent */
  frames: Int16Array[]
  colors: RGB[]
}

/**
 * Parse a sprite asset (text-grid pixel art) into a blittable form.
 * Throws with a precise location (frame/row/col) on any malformed input so
 * asset authors get actionable errors.
 */
export function parseSprite(raw: unknown): Sprite {
  let s
  try {
    s = spriteSchema.parse(raw)
  } catch (e) {
    throw new Error(errMsg(e))
  }

  const colors: RGB[] = []
  const index = new Map<string, number>()
  for (const [ch, hex] of Object.entries(s.palette)) {
    if (hex === null) {
      index.set(ch, -1)
    } else {
      index.set(ch, colors.length)
      colors.push(hexToRgb(hex))
    }
  }

  const h = s.frames[0].length
  const w = s.frames[0][0].length
  const chars = [...index.keys()].join(' ')

  const frames = s.frames.map((rows, fi) => {
    if (rows.length !== h) {
      throw new Error(`frame ${fi}: expected ${h} rows (same as frame 0), got ${rows.length}`)
    }
    const data = new Int16Array(w * h)
    rows.forEach((row, y) => {
      if (row.length !== w) {
        throw new Error(`frame ${fi} row ${y}: expected width ${w}, got ${row.length} ("${row}")`)
      }
      for (let x = 0; x < w; x++) {
        const idx = index.get(row[x])
        if (idx === undefined) {
          throw new Error(
            `frame ${fi} row ${y} col ${x}: char "${row[x]}" is not in the palette (have: ${chars})`,
          )
        }
        data[y * w + x] = idx
      }
    })
    return data
  })

  return { id: s.id, w, h, fps: s.fps ?? 0, frames, colors }
}

/** Which frame an fps-animated sprite shows at time t (seconds). */
export function spriteFrame(spr: Sprite, t: number): number {
  if (spr.fps <= 0 || spr.frames.length <= 1) return 0
  return Math.floor(t * spr.fps) % spr.frames.length
}
