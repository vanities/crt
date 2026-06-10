import { describe, it, expect } from 'vitest'
import { Framebuffer } from '../src/engine/framebuffer'
import { parseSprite } from '../src/engine/sprites'
import { parseFont } from '../src/engine/font'

const px = (fb: Framebuffer, x: number, y: number) => {
  const i = (y * fb.w + x) * 4
  return [fb.data[i], fb.data[i + 1], fb.data[i + 2]]
}

describe('Framebuffer', () => {
  it('clears to a color with full alpha', () => {
    const fb = new Framebuffer(4, 4)
    fb.clear([10, 20, 30])
    expect(px(fb, 3, 3)).toEqual([10, 20, 30])
    expect(fb.data[3]).toBe(255)
  })

  it('clips set() out of bounds instead of wrapping', () => {
    const fb = new Framebuffer(4, 4)
    fb.clear([0, 0, 0])
    fb.set(-1, 0, [255, 0, 0])
    fb.set(4, 0, [255, 0, 0])
    fb.set(0, 4, [255, 0, 0])
    expect(fb.data.every((v, i) => (i % 4 === 3 ? v === 255 : v === 0))).toBe(true)
  })

  it('clips fillRect at the edges', () => {
    const fb = new Framebuffer(4, 4)
    fb.clear([0, 0, 0])
    fb.fillRect(2, 2, 10, 10, [9, 9, 9])
    expect(px(fb, 3, 3)).toEqual([9, 9, 9])
    expect(px(fb, 1, 1)).toEqual([0, 0, 0])
  })

  it('blits sprites with transparency and flipX', () => {
    const spr = parseSprite({
      id: 't',
      palette: { '.': null, A: '#ffffff', B: '#000080' },
      frames: [['AB.', '...']],
    })
    const fb = new Framebuffer(4, 2)
    fb.clear([1, 1, 1])
    fb.sprite(spr, 0, 0)
    expect(px(fb, 0, 0)).toEqual([255, 255, 255])
    expect(px(fb, 1, 0)).toEqual([0, 0, 128])
    expect(px(fb, 2, 0)).toEqual([1, 1, 1]) // transparent left bg alone
    fb.clear([1, 1, 1])
    fb.sprite(spr, 0, 0, { flipX: true })
    expect(px(fb, 2, 0)).toEqual([255, 255, 255])
  })

  it('renders text and reports advance width', () => {
    const font = parseFont({
      id: 'f',
      height: 2,
      spaceWidth: 2,
      glyphs: { A: ['##', '..'], '?': ['#.', '.#'] },
    })
    const fb = new Framebuffer(16, 4)
    fb.font = font
    fb.clear([0, 0, 0])
    const w = fb.text('AA', 0, 0, [255, 255, 255])
    expect(w).toBe(6) // (2+1) * 2
    expect(px(fb, 0, 0)).toEqual([255, 255, 255])
    expect(px(fb, 3, 0)).toEqual([255, 255, 255])
  })

  it('falls back to "?" for unknown glyphs', () => {
    const font = parseFont({ id: 'f', height: 1, glyphs: { '?': ['#'] } })
    const fb = new Framebuffer(8, 2)
    fb.font = font
    fb.clear([0, 0, 0])
    fb.text('~', 0, 0, [200, 200, 200])
    expect(px(fb, 0, 0)).toEqual([200, 200, 200])
  })

  it('throws a helpful error when no font is set', () => {
    const fb = new Framebuffer(8, 8)
    expect(() => fb.text('HI', 0, 0, [1, 1, 1])).toThrow(/no font set/)
  })
})
