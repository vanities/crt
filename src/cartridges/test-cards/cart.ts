import type { Cartridge, CartCtx } from '../../engine/cartridge'
import type { RGB } from '../../engine/color'
import type { Framebuffer } from '../../engine/framebuffer'

/**
 * TEST CARDS — the signal generator every broadcast bench had. SMPTE bars,
 * convergence grid, multiburst, dot-crawl torture patterns. Built for
 * eyeballing the simulation: flip the SIGNAL button between CVBS/Y-C/RGB
 * while staring at multiburst and the NTSC decoder shows its work.
 * ◀/▶ switch patterns.
 */

const W = 320
const H = 240

const BLACK: RGB = [19, 19, 19] // 7.5 IRE setup
const WHITE: RGB = [235, 235, 235]

interface Page {
  name: string
  draw(fb: Framebuffer, t: number, frame: number): void
}

function columns(fb: Framebuffer, y: number, h: number, cols: RGB[], x0 = 0, x1 = W): void {
  const n = cols.length
  const w = (x1 - x0) / n
  cols.forEach((c, i) => {
    const a = Math.round(x0 + i * w)
    const b = Math.round(x0 + (i + 1) * w)
    fb.fillRect(a, y, b - a, h, c)
  })
}

const BARS75: RGB[] = [
  [191, 191, 191],
  [191, 191, 0],
  [0, 191, 191],
  [0, 191, 0],
  [191, 0, 191],
  [191, 0, 0],
  [0, 0, 191],
]

const smpte: Page = {
  name: 'SMPTE BARS',
  draw(fb) {
    const topH = Math.round(H * 0.67)
    const midH = Math.round(H * 0.08)
    columns(fb, 0, topH, BARS75)
    // castellations: reverse-order chips under the main bars
    columns(fb, topH, midH, [
      [0, 0, 191],
      BLACK,
      [191, 0, 191],
      BLACK,
      [0, 191, 191],
      BLACK,
      [191, 191, 191],
    ])
    // bottom: -I, white, +Q, black, PLUGE, black
    const y = topH + midH
    const h = H - y
    const u = W / 28
    fb.fillRect(0, y, Math.round(u * 5), h, [0, 70, 106])
    fb.fillRect(Math.round(u * 5), y, Math.round(u * 5), h, [255, 255, 255])
    fb.fillRect(Math.round(u * 10), y, Math.round(u * 5), h, [72, 16, 116])
    fb.fillRect(Math.round(u * 15), y, W - Math.round(u * 15), h, BLACK)
    const px = Math.round(u * 17)
    const pw = Math.round(u * 1.6)
    fb.fillRect(px, y, pw, h, [9, 9, 9])
    fb.fillRect(px + pw, y, pw, h, BLACK)
    fb.fillRect(px + pw * 2, y, pw, h, [30, 30, 30])
  },
}

const bars100: Page = {
  name: 'FULL FIELD BARS',
  draw(fb) {
    columns(fb, 0, H, [
      [255, 255, 255],
      [255, 255, 0],
      [0, 255, 255],
      [0, 255, 0],
      [255, 0, 255],
      [255, 0, 0],
      [0, 0, 255],
      [0, 0, 0],
    ])
  },
}

const grid: Page = {
  name: 'CONVERGENCE GRID',
  draw(fb) {
    fb.clear(BLACK)
    for (let x = 0; x <= W; x += 16) fb.vline(x === W ? W - 1 : x, 0, H, WHITE)
    for (let y = 0; y <= H; y += 16) fb.hline(0, y === H ? H - 1 : y, W, WHITE)
    fb.circle(W / 2, H / 2, 60, WHITE)
    fb.circle(W / 2, H / 2, 2, WHITE, true)
    for (const [cx, cy] of [
      [24, 24],
      [W - 25, 24],
      [24, H - 25],
      [W - 25, H - 25],
    ] as const) {
      fb.circle(cx, cy, 12, WHITE)
    }
  },
}

const multiburst: Page = {
  name: 'MULTIBURST',
  draw(fb) {
    fb.clear(BLACK)
    fb.fillRect(0, 0, 40, H, [128, 128, 128])
    fb.text('MB', 10, 8, WHITE, 1)
    const bands: [number, string][] = [
      [8, '0.5'],
      [6, '1.0'],
      [4, '2.0'],
      [3, '3.0'],
      [2, '3.6'],
      [1, '4.2'],
    ]
    const bh = Math.floor(H / bands.length)
    bands.forEach(([period, label], bi) => {
      const y = bi * bh
      for (let x = 40; x < W; x++) {
        const on = Math.floor(x / period) % 2 === 0
        if (on) fb.fillRect(x, y, 1, bh - 10, WHITE)
      }
      fb.fillRect(40, y + bh - 10, W - 40, 10, BLACK)
      fb.text(`${label} MHZ`, 44, y + bh - 9, [170, 170, 170], 1)
    })
  },
}

const dotcrawl: Page = {
  name: 'DOT CRAWL',
  draw(fb) {
    // vertical color boundaries — composite's worst nightmare
    columns(fb, 0, H, [
      [255, 0, 255],
      [0, 255, 0],
      [255, 128, 0],
      [0, 128, 255],
      [255, 0, 0],
      [0, 255, 255],
    ])
    // 1px checker band
    for (let y = 96; y < 144; y++) {
      for (let x = 0; x < W; x++) {
        if ((x + y) % 2 === 0) fb.set(x, y, [0, 0, 0])
      }
    }
    fb.fillRect(40, 160, 240, 30, [0, 0, 128])
    fb.text('THE QUICK BROWN FOX 0123456789', 48, 171, [255, 255, 255], 1)
    fb.text('WATCH THE EDGES CRAWL ON CVBS', 60, 200, [255, 255, 255], 1)
  },
}

const SOLIDS: [string, RGB][] = [
  ['WHITE', [255, 255, 255]],
  ['RED', [255, 0, 0]],
  ['GREEN', [0, 255, 0]],
  ['BLUE', [0, 0, 255]],
  ['BLACK', [5, 5, 5]],
]

const solid: Page = {
  name: 'PURITY',
  draw(fb, t) {
    const [name, col] = SOLIDS[Math.floor(t / 2) % SOLIDS.length]
    fb.clear(col)
    const dark = col[0] + col[1] + col[2] < 200
    fb.text(name, 8, H - 12, dark ? [120, 120, 120] : [0, 0, 0], 1)
  },
}

const overscan: Page = {
  name: 'OVERSCAN',
  draw(fb) {
    fb.clear([40, 40, 48])
    fb.rect(0, 0, W, H, WHITE)
    fb.rect(Math.round(W * 0.035), Math.round(H * 0.035), Math.round(W * 0.93), Math.round(H * 0.93), [255, 220, 80])
    fb.rect(Math.round(W * 0.1), Math.round(H * 0.1), Math.round(W * 0.8), Math.round(H * 0.8), [80, 220, 255])
    fb.text('ACTION SAFE', W / 2 - 32, Math.round(H * 0.045) + 3, [255, 220, 80], 1)
    fb.text('TITLE SAFE', W / 2 - 28, Math.round(H * 0.11) + 3, [80, 220, 255], 1)
    fb.text('TOGGLE UNDERSCAN (U)', W / 2 - 56, H / 2 - 3, WHITE, 1)
    fb.text('◀', 4, H / 2 - 3, WHITE, 1)
    fb.text('▶', W - 9, H / 2 - 3, WHITE, 1)
  },
}

const motion: Page = {
  name: 'MOTION / PERSISTENCE',
  draw(fb, t, frame) {
    fb.clear([8, 8, 12])
    // sweeping bar — phosphor trails live here
    const bx = (t * 140) % (W + 40) - 20
    fb.fillRect(bx, 0, 6, H, WHITE)
    // bouncing ball
    const px = W / 2 + Math.sin(t * 1.7) * 120
    const py = H / 2 + Math.abs(Math.sin(t * 2.3)) * -70 + 40
    fb.circle(px | 0, py | 0, 7, [80, 220, 255], true)
    fb.text(`FRAME ${String(frame % 1000).padStart(3, '0')}`, 8, 8, [150, 160, 180], 1)
    fb.text('CRANK PERSIST ON THE TUBE PANEL', 8, H - 12, [150, 160, 180], 1)
  },
}

const PAGES: Page[] = [smpte, bars100, grid, multiburst, dotcrawl, solid, overscan, motion]

const state = { page: 0, t: 0 }

const cart: Cartridge = {
  meta: {
    id: 'test-cards',
    title: 'TEST CARDS',
    width: W,
    height: H,
    connection: 'rgb',
    order: 1,
  },

  init() {
    state.page = 0
    state.t = 0
  },

  update(ctx: CartCtx) {
    state.t += 1 / 60
    const n = PAGES.length
    if (ctx.input.pressed('right') || ctx.input.pressed('a')) {
      state.page = (state.page + 1) % n
      ctx.audio.play(ctx.assets.sfx('ui'))
    }
    if (ctx.input.pressed('left') || ctx.input.pressed('b')) {
      state.page = (state.page + n - 1) % n
      ctx.audio.play(ctx.assets.sfx('ui'))
    }
  },

  draw(ctx: CartCtx) {
    const page = PAGES[state.page]
    page.draw(ctx.fb, state.t, ctx.frame)
    const label = ` ${state.page + 1}/${PAGES.length} ${page.name} `
    const tw = ctx.fb.textWidth(label, 1)
    ctx.fb.fillRect(W - tw - 6, H - 13, tw + 4, 11, [0, 0, 0])
    ctx.fb.text(label, W - tw - 4, H - 11, [0, 230, 120], 1)
  },
}

export default cart
