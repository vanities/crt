import type { RGB } from './color'
import { hexToRgb } from './color'
import { meshSchema, errMsg } from './schemas'

export interface MeshFace {
  v: number[]
  uv: [number, number][] | null
  tex: string | null
  color: RGB
  double: boolean
}

export interface Mesh {
  id: string
  verts: [number, number, number][]
  faces: MeshFace[]
}

/**
 * Parse a low-poly mesh asset. Faces must be textured (tex + matching uv)
 * or flat-colored; indices are bounds-checked so a typo'd face fails with
 * its position instead of rendering garbage.
 */
export function parseMesh(raw: unknown): Mesh {
  let m
  try {
    m = meshSchema.parse(raw)
  } catch (e) {
    throw new Error(errMsg(e))
  }

  const faces: MeshFace[] = m.faces.map((f, fi) => {
    for (const idx of f.v) {
      if (idx >= m.verts.length) {
        throw new Error(`face ${fi}: vertex index ${idx} out of range (mesh has ${m.verts.length} verts)`)
      }
    }
    if (f.tex) {
      if (!f.uv) throw new Error(`face ${fi}: "tex" requires "uv"`)
      if (f.uv.length !== f.v.length) {
        throw new Error(`face ${fi}: ${f.v.length} verts but ${f.uv.length} uv pairs`)
      }
    } else if (!f.color) {
      throw new Error(`face ${fi}: needs either "tex"+"uv" or "color"`)
    }
    return {
      v: f.v,
      uv: f.uv ?? null,
      tex: f.tex ?? null,
      color: f.color ? hexToRgb(f.color) : ([255, 255, 255] as RGB),
      double: f.double,
    }
  })

  return { id: m.id, verts: m.verts, faces }
}
