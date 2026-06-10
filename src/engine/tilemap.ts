import { mapSchema, errMsg } from './schemas'
import type { Framebuffer } from './framebuffer'
import type { Sprite } from './sprites'

export interface TileMap {
  id: string
  tileSize: number
  /** width/height in tiles */
  w: number
  h: number
  /** sprite id per cell, null = empty */
  grid: (string | null)[]
}

export function parseMap(raw: unknown): TileMap {
  let m
  try {
    m = mapSchema.parse(raw)
  } catch (e) {
    throw new Error(errMsg(e))
  }

  const w = m.rows[0].length
  const legendChars = Object.keys(m.legend).join(' ')
  const grid: (string | null)[] = []
  m.rows.forEach((row, y) => {
    if (row.length !== w) {
      throw new Error(`row ${y}: expected width ${w} (same as row 0), got ${row.length}`)
    }
    for (let x = 0; x < w; x++) {
      const ch = row[x]
      if (!(ch in m.legend)) {
        throw new Error(`row ${y} col ${x}: char "${ch}" is not in the legend (have: ${legendChars})`)
      }
      grid.push(m.legend[ch])
    }
  })

  return { id: m.id, tileSize: m.tileSize, w, h: m.rows.length, grid }
}

/**
 * Draw a tilemap with horizontal wrap (for scrolling backgrounds).
 * `getSprite` resolves sprite ids — pass `(id) => assets.sprite(id)`.
 */
export function drawTilemap(
  fb: Framebuffer,
  map: TileMap,
  getSprite: (id: string) => Sprite,
  offsetX: number,
  offsetY: number,
  opts: { wrapX?: boolean } = {},
): void {
  const ts = map.tileSize
  const wrapX = opts.wrapX ?? true
  const firstCol = Math.floor(offsetX / ts)
  const cols = Math.ceil(fb.w / ts) + 1
  for (let ty = 0; ty < map.h; ty++) {
    for (let i = 0; i < cols; i++) {
      let tx = firstCol + i
      if (wrapX) tx = ((tx % map.w) + map.w) % map.w
      else if (tx < 0 || tx >= map.w) continue
      const id = map.grid[ty * map.w + tx]
      if (!id) continue
      const sx = (firstCol + i) * ts - Math.floor(offsetX)
      fb.sprite(getSprite(id), sx, offsetY + ty * ts)
    }
  }
}
