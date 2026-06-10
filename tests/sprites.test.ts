import { describe, it, expect } from 'vitest'
import { parseSprite, spriteFrame } from '../src/engine/sprites'

const valid = {
  id: 'dot',
  palette: { '.': null, R: '#ff0000', G: '#0f0' },
  frames: [
    ['.R.', 'RGR', '.R.'],
    ['.G.', 'GRG', '.G.'],
  ],
  fps: 4,
}

describe('parseSprite', () => {
  it('parses a valid sprite with dimensions and palette indices', () => {
    const s = parseSprite(valid)
    expect(s.w).toBe(3)
    expect(s.h).toBe(3)
    expect(s.frames).toHaveLength(2)
    expect(s.colors).toHaveLength(2) // null entries don't allocate a color
    expect(s.frames[0][0]).toBe(-1) // '.' transparent
    expect(s.frames[0][1]).toBe(0) // 'R'
    expect(s.frames[0][4]).toBe(1) // 'G' center
  })

  it('expands #rgb shorthand colors', () => {
    const s = parseSprite(valid)
    expect(s.colors[1]).toEqual([0, 255, 0])
  })

  it('rejects rows of uneven width with row context', () => {
    const bad = { ...valid, frames: [['.R.', 'RGRX', '.R.']] }
    expect(() => parseSprite(bad)).toThrow(/row 1.*expected width 3/)
  })

  it('rejects chars missing from the palette with coordinates', () => {
    const bad = { ...valid, frames: [['.R.', 'RZR', '.R.']] }
    expect(() => parseSprite(bad)).toThrow(/row 1 col 1.*"Z"/)
  })

  it('rejects frames with mismatched dimensions', () => {
    const bad = { ...valid, frames: [['.R.', 'RGR', '.R.'], ['.R.', 'RGR']] }
    expect(() => parseSprite(bad)).toThrow(/frame 1.*expected 3 rows/)
  })

  it('rejects unknown top-level keys (strict schema)', () => {
    const bad = { ...valid, palete: {} }
    expect(() => parseSprite(bad)).toThrow(/palete/i)
  })

  it('rejects bad hex colors', () => {
    const bad = { ...valid, palette: { '.': null, R: 'red' } }
    expect(() => parseSprite(bad)).toThrow(/hex color/)
  })
})

describe('spriteFrame', () => {
  it('cycles frames at the declared fps', () => {
    const s = parseSprite(valid)
    expect(spriteFrame(s, 0)).toBe(0)
    expect(spriteFrame(s, 0.26)).toBe(1)
    expect(spriteFrame(s, 0.51)).toBe(0)
  })

  it('stays on frame 0 when fps is 0', () => {
    const s = parseSprite({ ...valid, fps: 0 })
    expect(spriteFrame(s, 123.4)).toBe(0)
  })
})
