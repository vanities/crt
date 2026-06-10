import type { Framebuffer } from './framebuffer'
import type { Sprite } from './sprites'
import type { Mesh } from './mesh'
import type { RGB } from './color'

/**
 * A PS1-grade software rasterizer that draws into the cartridge
 * framebuffer — the console-side "GPU", the way a gray 1997 console fed
 * its video DAC. The jank is load-bearing and deliberate:
 *
 *   - AFFINE texture mapping (no perspective correction → textures swim)
 *   - vertex snapping to whole pixels (no subpixel precision → edge wobble)
 *   - painter's algorithm, no Z-buffer (→ occasional polygon pop-through)
 *   - flat shading quantized to 15-bit color through a 4×4 Bayer dither
 *   - per-face fog
 *
 * Sprites double as textures (frame 0, palette colors; transparent texels
 * actually punch holes, like black-masked PS1 texels).
 */

type V3 = [number, number, number]

interface ClipVert {
  x: number
  y: number
  z: number
  u: number
  v: number
}

interface ScreenVert {
  sx: number
  sy: number
  u: number
  v: number
}

interface DrawFace {
  z: number
  pts: ScreenVert[]
  tex: Sprite | null
  color: RGB
  shade: number
  fog: number
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const NEAR = 0.4
const MAX_FACES = 4000

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

export class Renderer3D {
  /** camera basis, rebuilt by lookAt() */
  private eye: V3 = [0, 2, -8]
  private right: V3 = [1, 0, 0]
  private up: V3 = [0, 1, 0]
  private fwd: V3 = [0, 0, 1]
  private flen: number

  lightDir: V3 = norm([0.45, -1, 0.3])
  ambient = 0.5
  diffuse = 0.65
  fogColor: RGB = [22, 16, 44]
  fogNear = 8
  fogFar = 24

  private faces: DrawFace[] = []
  /** triangles rasterized by the last flush() — put it on the HUD */
  tris = 0

  constructor(
    private fb: Framebuffer,
    private getSprite: (id: string) => Sprite,
    fovDeg = 60,
  ) {
    this.flen = (fb.h * 0.5) / Math.tan(((fovDeg / 2) * Math.PI) / 180)
  }

  lookAt(eye: V3, target: V3): void {
    this.eye = eye
    this.fwd = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]])
    const f = this.fwd
    this.right = norm([f[2], 0, -f[0]]) // cross(up0, fwd), y-up world
    const r = this.right
    this.up = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]]
  }

  /** Queue a mesh instance. Call flush() once per frame to draw everything. */
  mesh(
    m: Mesh,
    o: { x?: number; y?: number; z?: number; rotY?: number; rotX?: number; s?: number } = {},
  ): void {
    const { x = 0, y = 0, z = 0, rotY = 0, rotX = 0, s = 1 } = o
    const cy = Math.cos(rotY)
    const sy = Math.sin(rotY)
    const cx = Math.cos(rotX)
    const sx = Math.sin(rotX)

    // model → world for every vertex of this instance
    const world: V3[] = m.verts.map(([vx, vy, vz]) => {
      let px = vx * s
      let py = vy * s
      let pz = vz * s
      const ry = py * cx - pz * sx
      const rz = py * sx + pz * cx
      py = ry
      pz = rz
      const wx = px * cy + pz * sy
      const wz = -px * sy + pz * cy
      return [wx + x, py + y, wz + z]
    })

    for (const face of m.faces) {
      if (this.faces.length >= MAX_FACES) return
      const w = face.v.map((i) => world[i])

      // flat lighting from the world-space face normal (CCW winding = outward)
      const e1: V3 = [w[1][0] - w[0][0], w[1][1] - w[0][1], w[1][2] - w[0][2]]
      const e2: V3 = [w[2][0] - w[0][0], w[2][1] - w[0][1], w[2][2] - w[0][2]]
      const n = norm([
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ])
      const l = this.lightDir
      const shade = this.ambient + this.diffuse * Math.max(0, -(n[0] * l[0] + n[1] * l[1] + n[2] * l[2]))

      // world → view
      let poly: ClipVert[] = w.map((p, i) => {
        const dx = p[0] - this.eye[0]
        const dy = p[1] - this.eye[1]
        const dz = p[2] - this.eye[2]
        return {
          x: dx * this.right[0] + dy * this.right[1] + dz * this.right[2],
          y: dx * this.up[0] + dy * this.up[1] + dz * this.up[2],
          z: dx * this.fwd[0] + dy * this.fwd[1] + dz * this.fwd[2],
          u: face.uv ? face.uv[i][0] : 0,
          v: face.uv ? face.uv[i][1] : 0,
        }
      })

      poly = clipNear(poly)
      if (poly.length < 3) continue

      let zSum = 0
      const pts: ScreenVert[] = poly.map((p) => {
        zSum += p.z
        return {
          // THE SNAP: integer screen coords, like a GTE with no subpixel bits
          sx: Math.round(this.fb.w * 0.5 + (p.x * this.flen) / p.z),
          sy: Math.round(this.fb.h * 0.5 - (p.y * this.flen) / p.z),
          u: p.u,
          v: p.v,
        }
      })

      // screen-space backface cull (shoelace; CCW-outward faces are positive)
      let area = 0
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        area += a.sx * b.sy - b.sx * a.sy
      }
      if (area <= 0 && !face.double) continue

      const zAvg = zSum / poly.length
      const fog = Math.min(1, Math.max(0, (zAvg - this.fogNear) / (this.fogFar - this.fogNear)))
      if (fog >= 0.999) continue // fully fogged — the PS1 draw distance

      this.faces.push({
        z: zAvg,
        pts,
        tex: face.tex ? this.getSprite(face.tex) : null,
        color: face.color,
        shade,
        fog,
      })
    }
  }

  /** Sort far→near and rasterize. Returns the triangle count. */
  flush(): number {
    this.faces.sort((a, b) => b.z - a.z)
    let tris = 0
    for (const f of this.faces) {
      for (let i = 2; i < f.pts.length; i++) {
        this.rasterTri(f.pts[0], f.pts[i - 1], f.pts[i], f)
        tris++
      }
    }
    this.faces.length = 0
    this.tris = tris
    return tris
  }

  private rasterTri(p0: ScreenVert, p1: ScreenVert, p2: ScreenVert, f: DrawFace): void {
    // sort by screen y
    let a = p0
    let b = p1
    let c = p2
    if (b.sy < a.sy) [a, b] = [b, a]
    if (c.sy < a.sy) [a, c] = [c, a]
    if (c.sy < b.sy) [b, c] = [c, b]
    if (c.sy === a.sy) return

    const fb = this.fb
    const data = fb.data
    const W = fb.w
    const H = fb.h
    const tex = f.tex
    const tw = tex?.w ?? 1
    const th = tex?.h ?? 1
    const tdata = tex?.frames[0] ?? null
    const tcols = tex?.colors ?? null
    const shade = f.shade
    const fog = f.fog
    const fr = this.fogColor[0]
    const fg = this.fogColor[1]
    const fbl = this.fogColor[2]
    const baseR = f.color[0]
    const baseG = f.color[1]
    const baseB = f.color[2]

    const y0 = Math.max(0, a.sy)
    const y1 = Math.min(H - 1, c.sy)

    for (let y = y0; y <= y1; y++) {
      // long edge a→c
      const tAC = (y - a.sy) / (c.sy - a.sy)
      let xL = a.sx + (c.sx - a.sx) * tAC
      let uL = a.u + (c.u - a.u) * tAC
      let vL = a.v + (c.v - a.v) * tAC

      // split edges a→b then b→c
      let xR: number
      let uR: number
      let vR: number
      if (y < b.sy || b.sy === c.sy) {
        const den = b.sy - a.sy || 1
        const t = (y - a.sy) / den
        xR = a.sx + (b.sx - a.sx) * t
        uR = a.u + (b.u - a.u) * t
        vR = a.v + (b.v - a.v) * t
      } else {
        const den = c.sy - b.sy || 1
        const t = (y - b.sy) / den
        xR = b.sx + (c.sx - b.sx) * t
        uR = b.u + (c.u - b.u) * t
        vR = b.v + (c.v - b.v) * t
      }

      if (xR < xL) {
        let tmp = xL
        xL = xR
        xR = tmp
        tmp = uL
        uL = uR
        uR = tmp
        tmp = vL
        vL = vR
        vR = tmp
      }

      const span = xR - xL || 1
      const xStart = Math.max(0, Math.ceil(xL))
      const xEnd = Math.min(W - 1, Math.floor(xR))

      for (let x = xStart; x <= xEnd; x++) {
        const t = (x - xL) / span
        let r = baseR
        let g = baseG
        let bl = baseB
        if (tdata && tcols) {
          const u = uL + (uR - uL) * t
          const v = vL + (vR - vL) * t
          const ti = ((((v | 0) % th) + th) % th) * tw + ((((u | 0) % tw) + tw) % tw)
          const ci = tdata[ti]
          if (ci < 0) continue // transparent texel punches through
          const cc = tcols[ci]
          r = cc[0]
          g = cc[1]
          bl = cc[2]
        }
        // shade → fog → 15-bit quantize through the Bayer matrix
        const d = BAYER4[(x & 3) + ((y & 3) << 2)] - 7.5
        r = r * shade
        g = g * shade
        bl = bl * shade
        r = r + (fr - r) * fog + d
        g = g + (fg - g) * fog + d
        bl = bl + (fbl - bl) * fog + d
        r = r < 0 ? 0 : r > 255 ? 248 : (r | 0) & 0xf8
        g = g < 0 ? 0 : g > 255 ? 248 : (g | 0) & 0xf8
        bl = bl < 0 ? 0 : bl > 255 ? 248 : (bl | 0) & 0xf8
        const i = (y * W + x) * 4
        data[i] = r
        data[i + 1] = g
        data[i + 2] = bl
      }
    }
  }
}

/** Clip a view-space polygon against the near plane, lerping uv. */
function clipNear(poly: ClipVert[]): ClipVert[] {
  const out: ClipVert[] = []
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]
    const nxt = poly[(i + 1) % poly.length]
    const cIn = cur.z >= NEAR
    const nIn = nxt.z >= NEAR
    if (cIn) out.push(cur)
    if (cIn !== nIn) {
      const t = (NEAR - cur.z) / (nxt.z - cur.z)
      out.push({
        x: cur.x + (nxt.x - cur.x) * t,
        y: cur.y + (nxt.y - cur.y) * t,
        z: NEAR,
        u: cur.u + (nxt.u - cur.u) * t,
        v: cur.v + (nxt.v - cur.v) * t,
      })
    }
  }
  return out
}
