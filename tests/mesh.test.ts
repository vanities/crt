import { describe, it, expect } from 'vitest'
import { parseMesh } from '../src/engine/mesh'

const cube = {
  id: 'box',
  verts: [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
  ],
  faces: [{ v: [0, 3, 2, 1], color: '#a8b4d0' }],
}

describe('parseMesh', () => {
  it('parses flat-colored quads', () => {
    const m = parseMesh(cube)
    expect(m.faces).toHaveLength(1)
    expect(m.faces[0].color).toEqual([168, 180, 208])
    expect(m.faces[0].tex).toBeNull()
  })

  it('parses textured faces with matching uv', () => {
    const m = parseMesh({
      ...cube,
      faces: [{ v: [0, 1, 2], tex: 'tex-crate', uv: [[0, 0], [16, 0], [16, 16]] }],
    })
    expect(m.faces[0].tex).toBe('tex-crate')
    expect(m.faces[0].uv).toHaveLength(3)
  })

  it('rejects out-of-range vertex indices with the face number', () => {
    const bad = { ...cube, faces: [{ v: [0, 1, 9], color: '#fff' }] }
    expect(() => parseMesh(bad)).toThrow(/face 0.*index 9 out of range/)
  })

  it('rejects tex without uv', () => {
    const bad = { ...cube, faces: [{ v: [0, 1, 2], tex: 'x' }] }
    expect(() => parseMesh(bad)).toThrow(/requires "uv"/)
  })

  it('rejects uv count mismatch', () => {
    const bad = { ...cube, faces: [{ v: [0, 1, 2, 3], tex: 'x', uv: [[0, 0], [1, 0], [1, 1]] }] }
    expect(() => parseMesh(bad)).toThrow(/4 verts but 3 uv pairs/)
  })

  it('rejects faces with neither tex nor color', () => {
    const bad = { ...cube, faces: [{ v: [0, 1, 2] }] }
    expect(() => parseMesh(bad)).toThrow(/"tex"\+"uv" or "color"/)
  })
})
