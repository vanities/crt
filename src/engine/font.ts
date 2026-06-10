import { fontSchema, errMsg } from './schemas'

export interface Glyph {
  w: number
  /** one bitmask per row, bit (w-1-x) set = pixel on */
  rows: number[]
}

export interface Font {
  id: string
  height: number
  spaceWidth: number
  glyphs: Map<string, Glyph>
}

/** Parse a bitmap-font asset. Glyph grids use '#' for on, '.' or ' ' for off. */
export function parseFont(raw: unknown): Font {
  let f
  try {
    f = fontSchema.parse(raw)
  } catch (e) {
    throw new Error(errMsg(e))
  }

  const glyphs = new Map<string, Glyph>()
  for (const [ch, grid] of Object.entries(f.glyphs)) {
    if (grid.length !== f.height) {
      throw new Error(`glyph "${ch}": expected ${f.height} rows, got ${grid.length}`)
    }
    const w = grid[0].length
    const rows = grid.map((row, y) => {
      if (row.length !== w) {
        throw new Error(`glyph "${ch}" row ${y}: expected width ${w}, got ${row.length}`)
      }
      let mask = 0
      for (let x = 0; x < w; x++) {
        const c = row[x]
        if (c === '#') mask |= 1 << (w - 1 - x)
        else if (c !== '.' && c !== ' ') {
          throw new Error(`glyph "${ch}" row ${y}: use "#" for on and "." for off, found "${c}"`)
        }
      }
      return mask
    })
    glyphs.set(ch, { w, rows })
  }

  return { id: f.id, height: f.height, spaceWidth: f.spaceWidth, glyphs }
}
