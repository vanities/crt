import type { Cartridge, CartCtx } from '../../engine/cartridge'
import type { RGB } from '../../engine/color'
import type { Mesh, MeshFace } from '../../engine/mesh'
import { Renderer3D } from '../../engine/r3d'

/**
 * DEMO DISC '97 — PS1-style polygons through a broadcast monitor. A foggy
 * dusk garden: low-poly terrain, wooden crates, one monolith, an orbiting
 * camera. Affine texture swim, vertex wobble, dithered 15-bit shading —
 * all on purpose, all fed down the same composite cable as everything
 * else. This cart is also the reference for the Renderer3D API.
 */

const W = 320
const H = 240

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** rolling terrain height, flattened near the monolith */
function ground(x: number, z: number): number {
  const d = Math.hypot(x, z)
  const flat = Math.min(1, Math.max(0, (d - 3) / 4))
  return (0.4 * Math.sin(x * 0.55 + 1) + 0.35 * Math.cos(z * 0.7) + 0.25 * Math.sin((x + z) * 0.35)) * flat
}

function buildTerrain(): Mesh {
  const N = 12 // quads per side
  const S = 2 // quad size
  const verts: [number, number, number][] = []
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = -((N * S) / 2) + i * S
      const z = -((N * S) / 2) + j * S
      verts.push([x, ground(x, z), z])
    }
  }
  const faces: MeshFace[] = []
  const at = (i: number, j: number) => j * (N + 1) + i
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      faces.push({
        // wound for a +Y outward normal (see r3d culling convention)
        v: [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)],
        uv: [
          [0, 0],
          [0, 8],
          [8, 8],
          [8, 0],
        ],
        tex: 'tex-floor',
        color: [255, 255, 255] as RGB,
        double: false,
      })
    }
  }
  return { id: 'terrain', verts, faces }
}

const CRATES: [number, number, number][] = [
  [4.5, 0.7, 2.2],
  [-5.2, 0.4, 4.6],
  [3.6, 1.9, -4.8],
  [-3.2, 2.6, -3.4],
]

const state = {
  t: 0,
  ang: 0.6,
  rad: 9,
  eyeH: 3.1,
  auto: true,
  r3: null as Renderer3D | null,
  terrain: null as Mesh | null,
  stars: [] as { x: number; y: number; tw: number }[],
}

const cart: Cartridge = {
  meta: {
    id: 'demo-disc',
    title: "DEMO DISC '97",
    width: W,
    height: H,
    connection: 'composite',
    order: 2,
  },

  init(ctx: CartCtx) {
    const s = state
    s.t = 0
    s.ang = 0.6
    s.rad = 9
    s.eyeH = 3.1
    s.auto = true
    s.r3 = new Renderer3D(ctx.fb, (id) => ctx.assets.sprite(id), 62)
    s.r3.fogColor = [22, 16, 44]
    s.r3.fogNear = 7
    s.r3.fogFar = 23
    s.terrain = buildTerrain()
    const rng = mulberry32(0x1997)
    s.stars = Array.from({ length: 60 }, () => ({
      x: rng() * W,
      y: rng() * H * 0.5,
      tw: rng() * 6.28,
    }))
    console.info(`[demo-disc] scene built: ${s.terrain.faces.length} terrain quads, ${CRATES.length} crates`)
  },

  update(ctx: CartCtx, dt: number) {
    const s = state
    s.t += dt
    if (ctx.input.pressed('start')) {
      s.auto = !s.auto
      ctx.audio.play(ctx.assets.sfx('ui'))
    }
    if (ctx.input.held('left')) {
      s.ang -= dt * 1.3
      s.auto = false
    }
    if (ctx.input.held('right')) {
      s.ang += dt * 1.3
      s.auto = false
    }
    if (ctx.input.held('up')) s.eyeH = Math.min(7, s.eyeH + dt * 3)
    if (ctx.input.held('down')) s.eyeH = Math.max(1.6, s.eyeH - dt * 3)
    if (ctx.input.held('a')) s.rad = Math.max(4.5, s.rad - dt * 5)
    if (ctx.input.held('b')) s.rad = Math.min(14, s.rad + dt * 5)
    if (s.auto) s.ang += dt * 0.22
  },

  draw(ctx: CartCtx) {
    const s = state
    const fb = ctx.fb
    const r3 = s.r3!

    // dusk sky gradient + stars (painter's algorithm covers the rest)
    const top: RGB = [38, 22, 70]
    const bot: RGB = [12, 10, 22]
    const skyH = Math.round(H * 0.95)
    for (let y = 0; y < H; y += 4) {
      const k = Math.min(1, y / skyH)
      fb.fillRect(0, y, W, 4, [
        Math.round(top[0] + (bot[0] - top[0]) * k),
        Math.round(top[1] + (bot[1] - top[1]) * k),
        Math.round(top[2] + (bot[2] - top[2]) * k),
      ])
    }
    for (const st of s.stars) {
      const b = 120 + Math.round(90 * Math.sin(st.tw + s.t * 1.7))
      if (b > 130) fb.set(st.x | 0, st.y | 0, [b, b, Math.min(255, b + 25)])
    }

    // camera on its dolly
    const eye: [number, number, number] = [
      Math.sin(s.ang) * s.rad,
      s.eyeH + Math.sin(s.t * 0.4) * 0.4,
      -Math.cos(s.ang) * s.rad,
    ]
    r3.lookAt(eye, [0, 1.4, 0])

    // the set
    r3.mesh(s.terrain!, {})
    r3.mesh(ctx.assets.mesh('monolith'), { x: 0, y: 0, z: 0 })
    const crate = ctx.assets.mesh('crate')
    CRATES.forEach(([cx, rot, cz], i) => {
      r3.mesh(crate, { x: cx, y: ground(cx, cz) + 0.85, z: cz, rotY: rot, s: 0.85 - (i % 2) * 0.15 })
    })
    // memory cards in orbit
    for (let i = 0; i < 3; i++) {
      const a = s.t * 0.9 + (i * Math.PI * 2) / 3
      r3.mesh(crate, {
        x: Math.sin(a) * 2.6,
        y: 2.5 + Math.sin(s.t * 1.3 + i * 2.1) * 0.4,
        z: Math.cos(a) * 2.6,
        rotY: s.t * (1 + i * 0.3),
        rotX: s.t * 0.7,
        s: 0.4,
      })
    }

    const tris = r3.flush()

    // HUD
    fb.text("DEMO DISC '97", 6, 6, [220, 230, 255], 1)
    fb.text(`TRIS ${String(tris).padStart(4, '0')}`, W - 62, 6, [150, 160, 190], 1)
    fb.text('◀ ▶ ORBIT · A/B ZOOM · ENTER AUTO', 56, H - 12, [120, 110, 160], 1)
  },
}

export default cart
