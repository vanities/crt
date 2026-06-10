import type { Cartridge, CartCtx } from '../../engine/cartridge'
import type { RGB } from '../../engine/color'
import { drawTilemap } from '../../engine/tilemap'
import { spriteFrame } from '../../engine/sprites'

/**
 * BEAM PATROL — the pack-in game. A small horizontal shooter built to show
 * the engine API: sprites, tilemap scrolling, text, sfx, particles. Ships
 * on a composite cable so the CRT artifacts are on full display; press the
 * SIGNAL button to re-patch it through Y/C or RGB and watch it clean up.
 */

const W = 256
const H = 224

const SKY: RGB = [4, 6, 18]
const WHITE: RGB = [232, 240, 255]
const CYAN: RGB = [80, 220, 255]
const YELLOW: RGB = [255, 220, 80]
const MAGENTA: RGB = [255, 90, 200]
const RED: RGB = [255, 70, 60]

interface Bullet { x: number; y: number }
interface Enemy { x: number; y0: number; ph: number; t: number }
interface Part { x: number; y: number; vx: number; vy: number; life: number; col: RGB }
interface Star { x: number; y: number; z: number }

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

type Mode = 'title' | 'play' | 'over'

const state = {
  mode: 'title' as Mode,
  t: 0,
  px: 40,
  py: H / 2,
  cooldown: 0,
  invuln: 0,
  lives: 3,
  score: 0,
  hi: 0,
  spawnT: 0,
  speed: 1,
  scroll: 0,
  bullets: [] as Bullet[],
  enemies: [] as Enemy[],
  parts: [] as Part[],
  stars: [] as Star[],
}

function reset(full: boolean): void {
  state.bullets = []
  state.enemies = []
  state.parts = []
  state.px = 40
  state.py = H / 2
  state.cooldown = 0
  state.invuln = 0
  state.spawnT = 1
  state.speed = 1
  if (full) {
    state.lives = 3
    state.score = 0
  }
}

function boom(x: number, y: number, n: number, cols: RGB[]): void {
  const r = Math.random
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2
    const v = 0.4 + r() * 1.8
    state.parts.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: 18 + r() * 22,
      col: cols[(r() * cols.length) | 0],
    })
  }
}

const cart: Cartridge = {
  meta: {
    id: 'beam-patrol',
    title: 'BEAM PATROL',
    width: W,
    height: H,
    connection: 'composite',
    order: 0,
  },

  init() {
    const rng = mulberry32(0xc0ffee)
    state.stars = Array.from({ length: 70 }, () => ({
      x: rng() * W,
      y: rng() * (H - 28),
      z: 0.25 + rng() * 0.75,
    }))
    state.mode = 'title'
    state.t = 0
    reset(true)
  },

  update(ctx: CartCtx) {
    const { input, audio, assets } = ctx
    const s = state
    s.t += 1 / 60
    s.scroll += 0.6 * s.speed
    for (const st of s.stars) {
      st.x -= st.z * 1.4 * s.speed
      if (st.x < 0) st.x += W
    }

    if (s.mode !== 'play') {
      if (input.pressed('start')) {
        audio.play(assets.sfx('ui'))
        reset(true)
        s.mode = 'play'
      }
      return
    }

    // ship
    const v = 2.2
    if (input.held('up')) s.py -= v
    if (input.held('down')) s.py += v
    if (input.held('left')) s.px -= v
    if (input.held('right')) s.px += v
    s.px = Math.max(4, Math.min(W - 60, s.px))
    s.py = Math.max(10, Math.min(H - 30, s.py))

    if (s.cooldown > 0) s.cooldown--
    if (s.invuln > 0) s.invuln--
    if ((input.held('a') || input.held('b')) && s.cooldown === 0) {
      s.bullets.push({ x: s.px + 12, y: s.py + 3 })
      s.cooldown = 9
      audio.play(assets.sfx('laser'))
    }

    for (const b of s.bullets) b.x += 4.2
    s.bullets = s.bullets.filter((b) => b.x < W + 8)

    // waves
    s.speed = 1 + Math.min(1.2, s.t * 0.01)
    s.spawnT -= 1 / 60
    if (s.spawnT <= 0) {
      s.spawnT = Math.max(0.8, 2.2 - s.t * 0.015)
      const y0 = 24 + Math.random() * (H - 90)
      const n = 3 + ((Math.random() * 3) | 0)
      for (let i = 0; i < n; i++) {
        s.enemies.push({ x: W + 12 + i * 18, y0, ph: i * 0.7, t: 0 })
      }
    }

    for (const e of s.enemies) {
      e.t += 1 / 60
      e.x -= 1.1 * s.speed
    }
    s.enemies = s.enemies.filter((e) => e.x > -12)

    // collisions
    const eaW = 9
    const eaH = 7
    for (const e of s.enemies) {
      const ey = e.y0 + Math.sin(e.ph + e.t * 3.2) * 26
      for (const b of s.bullets) {
        if (b.x > e.x - 2 && b.x < e.x + eaW && b.y > ey - 2 && b.y < ey + eaH + 2) {
          boom(e.x + 4, ey + 3, 16, [YELLOW, MAGENTA, WHITE, RED])
          e.x = -999
          b.x = W + 999
          s.score += 100
          audio.play(assets.sfx('boom'))
        }
      }
      if (
        s.invuln === 0 &&
        s.px + 2 < e.x + eaW &&
        s.px + 10 > e.x &&
        s.py + 1 < ey + eaH &&
        s.py + 6 > ey
      ) {
        e.x = -999
        s.lives--
        s.invuln = 110
        boom(s.px + 6, s.py + 3, 22, [CYAN, WHITE, RED])
        audio.play(assets.sfx('hit'))
        if (s.lives <= 0) {
          s.hi = Math.max(s.hi, s.score)
          s.mode = 'over'
        }
      }
    }

    for (const p of s.parts) {
      p.x += p.vx
      p.y += p.vy
      p.vy += 0.02
      p.life--
    }
    s.parts = s.parts.filter((p) => p.life > 0)
  },

  draw(ctx: CartCtx) {
    const { fb, assets } = ctx
    const s = state
    fb.clear(SKY)

    // starfield (3 depth bands via brightness)
    for (const st of s.stars) {
      const b = Math.round(90 + st.z * 150)
      fb.set(st.x | 0, st.y | 0, [b, b, Math.min(255, b + 30)])
    }

    // scrolling ground
    drawTilemap(fb, assets.map('ground'), (id) => assets.sprite(id), s.scroll, H - 16)

    if (s.mode === 'title') {
      const bl = Math.floor(s.t * 2) % 2 === 0
      fb.text('BEAM', 58, 52, CYAN, 4)
      fb.text('PATROL', 34, 78, WHITE, 4)
      fb.fillRect(34, 110, 188, 1, MAGENTA)
      if (bl) fb.text('PRESS ENTER', 84, 130, YELLOW, 1)
      fb.text(`HI ${String(s.hi).padStart(6, '0')}`, 92, 152, WHITE, 1)
      fb.text('A CATHODE C-20M2 PACK-IN', 56, 200, [110, 120, 140], 1)
      return
    }

    // bullets
    for (const b of s.bullets) {
      fb.fillRect(b.x - 6, b.y, 5, 1, [120, 80, 40])
      fb.fillRect(b.x, b.y - 1, 5, 2, YELLOW)
    }

    // enemies
    const drone = assets.sprite('drone')
    for (const e of s.enemies) {
      const ey = e.y0 + Math.sin(e.ph + e.t * 3.2) * 26
      fb.sprite(drone, e.x | 0, ey | 0, { frame: spriteFrame(drone, s.t + e.ph) })
    }

    // ship (blinks while invulnerable)
    if (s.mode === 'play' && (s.invuln === 0 || s.invuln % 6 < 3)) {
      const ship = assets.sprite('ship')
      fb.sprite(ship, s.px | 0, s.py | 0, { frame: spriteFrame(ship, s.t) })
    }

    // particles
    for (const p of s.parts) {
      if (p.life < 8 && p.life % 2 === 0) continue
      fb.set(p.x | 0, p.y | 0, p.col)
    }

    // HUD
    fb.text(`SCORE ${String(s.score).padStart(6, '0')}`, 6, 5, WHITE, 1)
    fb.text(`HI ${String(s.hi).padStart(6, '0')}`, 176, 5, [150, 160, 180], 1)
    for (let i = 0; i < s.lives; i++) fb.text('♥', 6 + i * 8, 14, RED, 1)

    if (s.mode === 'over') {
      fb.fillRect(48, 92, 160, 40, [10, 10, 24])
      fb.rect(48, 92, 160, 40, MAGENTA)
      fb.text('GAME OVER', 92, 100, RED, 2)
      fb.text('ENTER TO RETRY', 76, 120, WHITE, 1)
    }
  },
}

export default cart
