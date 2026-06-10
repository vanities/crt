# Cartridges — adding a game

A cartridge is a signal source plugged into a monitor input (LINE A,
LINE B, …). Create `src/cartridges/<name>/cart.ts` with a default export and
it auto-registers — no other wiring.

```ts
import type { Cartridge, CartCtx } from '../../engine/cartridge'

const W = 256
const H = 224

const state = { x: 40, y: 100 }

const cart: Cartridge = {
  meta: {
    id: 'my-game',
    title: 'MY GAME',
    width: W,            // any console-ish resolution (64..768 × 64..576)
    height: H,
    connection: 'composite', // 'composite' | 'svideo' | 'rgb' — default cable
    order: 2,            // input slot sort
  },

  init(ctx) {
    // cold boot: runs on power-on and whenever this input is selected
    state.x = 40
  },

  update(ctx: CartCtx, dt) {
    // fixed 60 Hz. ctx.input: held/pressed/released('up'|'down'|'left'|
    // 'right'|'a'|'b'|'start'|'select')
    if (ctx.input.held('right')) state.x += 2
    if (ctx.input.pressed('a')) ctx.audio.play(ctx.assets.sfx('laser'))
  },

  draw(ctx: CartCtx) {
    const fb = ctx.fb // CPU framebuffer — the "console output"
    fb.clear([8, 8, 16])
    fb.sprite(ctx.assets.sprite('ship'), state.x, state.y)
    fb.text('HELLO TUBE', 8, 8, [255, 255, 255], 2)
  },
}

export default cart
```

## The framebuffer API (everything a cart can draw with)

| Call | Notes |
|---|---|
| `fb.clear(rgb)` | full clear |
| `fb.set(x, y, rgb)` | single pixel, clipped |
| `fb.fillRect / rect / hline / vline / circle` | primitives |
| `fb.sprite(spr, x, y, { frame, flipX })` | transparent blit |
| `fb.text(str, x, y, rgb, scale)` | bitmap font, returns width |
| `drawTilemap(fb, map, getSprite, ox, oy)` | from `engine/tilemap` |

Resolution is per-cartridge (`meta.width/height`) — the monitor re-times
itself when you switch inputs, like a real multi-format PVM.

## Conventions

- Keep all mutable state in a module-level `state` object and reset it in
  `init()` — input switches re-boot the cart.
- `connection` decides the default cable: `composite` shows full NTSC
  artifacts (dot crawl, bleed), `rgb` is pixel-clean. The user can re-patch
  live with the SIGNAL button.
- Never touch the DOM or WebGL from a cartridge. Draw pixels, play patches.
- Assets: reference by id; add new ones under `assets/` (see ASSETS.md).
