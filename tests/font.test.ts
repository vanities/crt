import { describe, it, expect } from 'vitest'
import { parseFont } from '../src/engine/font'

describe('parseFont', () => {
  it('parses glyph grids into row bitmasks', () => {
    const f = parseFont({ id: 'x', height: 2, glyphs: { A: ['#.', '.#'] } })
    const g = f.glyphs.get('A')!
    expect(g.w).toBe(2)
    expect(g.rows).toEqual([0b10, 0b01])
  })

  it('supports variable-width glyphs', () => {
    const f = parseFont({ id: 'x', height: 1, glyphs: { I: ['#'], W: ['###'] } })
    expect(f.glyphs.get('I')!.w).toBe(1)
    expect(f.glyphs.get('W')!.w).toBe(3)
  })

  it('rejects wrong row counts with the glyph name', () => {
    expect(() => parseFont({ id: 'x', height: 3, glyphs: { A: ['#', '#'] } })).toThrow(/glyph "A".*3 rows/)
  })

  it('rejects characters that are not # or .', () => {
    expect(() => parseFont({ id: 'x', height: 1, glyphs: { A: ['#X'] } })).toThrow(/found "X"/)
  })
})
