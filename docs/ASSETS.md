# Asset formats

Every asset is a single JSON file in `assets/<kind>/`. Discovery is
automatic (folder glob), validation is strict (unknown keys are errors), and
the dev server hot-reloads on save. The `id` field is the lookup key.

Scaffold any of these with `pnpm new <kind> <name>`.

## Sprites — `assets/sprites/*.sprite.json`

Pixel art as text grids. One character per pixel, palette maps characters to
hex colors, `null` means transparent. All rows in a frame must be the same
width; all frames must share dimensions.

```json
{
  "id": "coin",
  "palette": { ".": null, "Y": "#ffd24a", "O": "#c87f1e" },
  "frames": [
    [".YY.", "YOOY", "YOOY", ".YY."],
    [".YY.", "YYYY", "YYYY", ".YY."]
  ],
  "fps": 8
}
```

- `fps` (optional, default 0): with `spriteFrame(spr, t)` the engine picks
  the frame; 0 = static.
- Draw it: `ctx.fb.sprite(ctx.assets.sprite('coin'), x, y, { frame, flipX })`

## Sound effects — `assets/sfx/*.sfx.json`

Chiptune synth patches — no audio files anywhere.

```json
{
  "id": "jump",
  "wave": "square",
  "freq": { "start": 220, "end": 880, "curve": "exp" },
  "duration": 0.2,
  "attack": 0.005,
  "release": 0.08,
  "volume": 0.5
}
```

- `wave`: `square` | `triangle` | `sawtooth` | `sine` | `noise`
  (`noise` runs white noise through a swept bandpass — use for explosions)
- `freq.end` optional (defaults to `start`); `curve`: `exp` | `linear`
- Play it: `ctx.audio.play(ctx.assets.sfx('jump'))`

## Tile maps — `assets/maps/*.map.json`

Text-grid levels. Legend maps characters to **sprite ids** (`null` = empty).

```json
{
  "id": "level-1",
  "tileSize": 8,
  "legend": { ".": null, "#": "tile-rock", "s": "tile-spire" },
  "rows": [
    ".....s..",
    "########"
  ]
}
```

- Draw it: `drawTilemap(ctx.fb, ctx.assets.map('level-1'), (id) => ctx.assets.sprite(id), scrollX, y)`
- Wraps horizontally by default (scrolling backgrounds).

## Meshes — `assets/meshes/*.mesh.json`

Low-poly 3D, PS1 style. Quads encouraged (they were quad machines). Faces
are either flat-colored or textured — **textures are sprites** (frame 0,
uv in texel coords; transparent texels punch holes). Wind faces
counter-clockwise as seen from outside.

```json
{
  "id": "pyramid",
  "verts": [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [0, 1.6, 0]],
  "faces": [
    { "v": [0, 4, 1], "color": "#b09060" },
    { "v": [1, 4, 2], "color": "#907040" },
    { "v": [2, 4, 3], "color": "#b09060" },
    { "v": [3, 4, 0], "color": "#907040" },
    { "v": [0, 1, 2, 3], "tex": "tex-floor", "uv": [[0, 0], [8, 0], [8, 8], [0, 8]], "double": true }
  ]
}
```

Draw it with the software rasterizer (`src/engine/r3d.ts` — affine
texturing, vertex snap, painter's sort, Bayer-dithered 15-bit shading,
fog; the jank is the point):

```ts
import { Renderer3D } from '../../engine/r3d'
const r3 = new Renderer3D(ctx.fb, (id) => ctx.assets.sprite(id), 60 /* fov */)
r3.lookAt([0, 2, -8], [0, 1, 0])
r3.mesh(ctx.assets.mesh('pyramid'), { x: 0, rotY: t, s: 1.5 })
const tris = r3.flush()
```

See `src/cartridges/demo-disc/cart.ts` for a full scene (terrain,
instances, fog, camera dolly).

## Fonts — `assets/fonts/*.font.json`

Bitmap fonts are assets too — glyphs are text grids (`#` on, `.` off),
variable width allowed. The engine auto-assigns the `micro` font to every
cartridge framebuffer; replace or extend it freely.

```json
{
  "id": "micro",
  "height": 5,
  "spaceWidth": 3,
  "glyphs": { "A": [".#.", "#.#", "###", "#.#", "#.#"] }
}
```

- Draw text: `ctx.fb.text('SCORE 0042', x, y, [r, g, b], scale)`

## Validation

- Page load: a malformed asset shows the NO SIGNAL screen with file + reason.
- `pnpm check`: `tests/assets.test.ts` parses every real asset file.
- Errors carry coordinates: `frame 1 row 2 col 7: char "Q" is not in the palette`.
