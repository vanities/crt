# CRT

**A game engine that is a broadcast monitor.** The components of an
analog/digital PVM/BVM — NTSC encoder/decoder, deflection, electron beam,
Trinitron-style aperture grille, P22 phosphor, degauss coil, front-panel
knobs — rebuilt as a WebGL2 signal chain, with a tiny console engine
(sprites, tilemaps, chip audio, fixed 60 Hz loop) feeding it.

Games are **cartridges** plugged into LINE A / LINE B. Press the SIGNAL
button to re-patch the running game between composite (dot crawl, color
bleed — the artifacts are computed, not faked), S-Video, and RGB.

```bash
pnpm install
pnpm dev        # → http://localhost:5173 — press POWER
pnpm check      # typecheck + tests
```

## Built for AI contributors

Every asset is a schema-validated JSON text grid — trivially authorable by
an LLM, hot-reloaded on save, no registration step:

```json
{
  "id": "coin",
  "palette": { ".": null, "Y": "#ffd24a" },
  "frames": [[".YY.", "Y..Y", ".YY."]]
}
```

Drop that in `assets/sprites/`, then `ctx.fb.sprite(ctx.assets.sprite('coin'), x, y)`.
Sounds are synth patches, maps are character grids, fonts are sprites, a new
game is one folder with a `cart.ts`. Start at [CLAUDE.md](CLAUDE.md), formats
in [docs/ASSETS.md](docs/ASSETS.md), engine anatomy in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## The monitor

- **Knobs (front):** VOLUME · CONTRAST · BRIGHT · CHROMA · PHASE · APERTURE
- **Buttons:** POWER · DEGAUSS (with the thunk) · LINE A/B · SIGNAL ·
  UNDERSCAN · H/V DELAY · BLUE ONLY · 16:9
- **TUBE drawer (rear):** SCANLINE · GRILLE · CURVE · GLOW · PERSIST · NOISE
- Power-off collapses the raster to a white dot. Degauss shudders the yoke
  and wobbles the demod phase. The 15.7 kHz flyback whine is real (sorry).

## Launch lineup

| Input | Cartridge | Why |
|---|---|---|
| LINE A | **BEAM PATROL** (256×224, composite) | playable shooter exercising the whole engine API |
| LINE B | **TEST CARDS** (320×240, RGB) | SMPTE bars, convergence grid, multiburst, dot-crawl torture, persistence demo |

Keys: arrows/WASD + Z/X + Enter (game) · P power, G degauss, 1/2 input,
C signal, U/H/B/Y monitor modes.

## Status / roadmap

v0.1 — working engine, two cartridges, 7-pass signal chain. Candidates next:
true 480i field rendering, slot-mask tubes, RF input (worse than composite,
on purpose), service-menu easter egg, gamepad support.
