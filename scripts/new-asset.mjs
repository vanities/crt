#!/usr/bin/env node
/**
 * Asset/cartridge scaffolder: `pnpm new <sprite|sfx|map|font|cart> <name>`
 * Writes a valid starter file and prints the next step. Refuses to overwrite.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [kind, name] = process.argv.slice(2)

const usage = 'usage: pnpm new <sprite|sfx|map|font|cart> <kebab-name>'
if (!kind || !name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(usage)
  process.exit(1)
}

const templates = {
  sprite: {
    path: `assets/sprites/${name}.sprite.json`,
    body: JSON.stringify(
      {
        id: name,
        palette: { '.': null, W: '#e8f0ff', A: '#46d8ff' },
        frames: [['.WW.', 'WAAW', 'WAAW', '.WW.']],
        fps: 0,
      },
      null,
      2,
    ),
    next: `use it: ctx.fb.sprite(ctx.assets.sprite('${name}'), x, y)`,
  },
  sfx: {
    path: `assets/sfx/${name}.sfx.json`,
    body: JSON.stringify(
      {
        id: name,
        wave: 'square',
        freq: { start: 440, end: 880, curve: 'exp' },
        duration: 0.15,
        attack: 0.005,
        release: 0.05,
        volume: 0.5,
      },
      null,
      2,
    ),
    next: `use it: ctx.audio.play(ctx.assets.sfx('${name}'))`,
  },
  map: {
    path: `assets/maps/${name}.map.json`,
    body: JSON.stringify(
      {
        id: name,
        tileSize: 8,
        legend: { '.': null, r: 'tile-rock' },
        rows: ['........', 'rrrrrrrr'],
      },
      null,
      2,
    ),
    next: `use it: drawTilemap(ctx.fb, ctx.assets.map('${name}'), (id) => ctx.assets.sprite(id), ox, oy)`,
  },
  font: {
    path: `assets/fonts/${name}.font.json`,
    body: JSON.stringify(
      {
        id: name,
        height: 5,
        spaceWidth: 3,
        glyphs: { A: ['.#.', '#.#', '###', '#.#', '#.#'], '?': ['###', '..#', '.##', '...', '.#.'] },
      },
      null,
      2,
    ),
    next: `use it: ctx.fb.font = ctx.assets.font('${name}')`,
  },
  cart: {
    path: `src/cartridges/${name}/cart.ts`,
    body: `import type { Cartridge, CartCtx } from '../../engine/cartridge'

const W = 256
const H = 224

const state = { t: 0 }

const cart: Cartridge = {
  meta: {
    id: '${name}',
    title: '${name.toUpperCase().replace(/-/g, ' ')}',
    width: W,
    height: H,
    connection: 'composite',
    order: 10,
  },

  init() {
    state.t = 0
  },

  update(_ctx: CartCtx, dt: number) {
    state.t += dt
  },

  draw(ctx: CartCtx) {
    const fb = ctx.fb
    fb.clear([6, 8, 20])
    fb.text('${name.toUpperCase().replace(/-/g, ' ')}', 20, 40, [80, 220, 255], 2)
    fb.text(\`T=\${state.t.toFixed(1)}\`, 20, 60, [232, 240, 255], 1)
  },
}

export default cart
`,
    next: 'it auto-registers on the next input slot — pnpm dev and press 3',
  },
}

const tpl = templates[kind]
if (!tpl) {
  console.error(`unknown kind "${kind}". ${usage}`)
  process.exit(1)
}

const target = join(root, tpl.path)
if (existsSync(target)) {
  console.error(`refusing to overwrite ${tpl.path}`)
  process.exit(1)
}
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, tpl.body.endsWith('\n') ? tpl.body : tpl.body + '\n')
console.log(`created ${tpl.path}`)
console.log(`→ ${tpl.next}`)
console.log('→ formats: docs/ASSETS.md · validate: pnpm check')
