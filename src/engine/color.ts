export type RGB = readonly [number, number, number]

/** Parse "#rgb" or "#rrggbb" into an [r, g, b] tuple (0-255). */
export function hexToRgb(hex: string): RGB {
  let h = hex.startsWith('#') ? hex.slice(1) : hex
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`bad hex color "${hex}" — expected #rgb or #rrggbb`)
  }
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
