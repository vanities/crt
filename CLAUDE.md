# CRT — a game engine that is a broadcast monitor

A PVM/BVM (Sony-style broadcast CRT) rebuilt as a game engine. Games are
**cartridges** plugged into the monitor's inputs; the renderer is a simulated
analog signal chain (NTSC encode → decode → electron beam → aperture grille →
phosphor). Everything an agent usually needs to touch is **JSON text grids**
or one small TypeScript file.

## Commands

```bash
pnpm dev          # vite dev server (hot reload on asset/code change)
pnpm check        # tsc + vitest — run before declaring any task done
pnpm test         # vitest only
pnpm build        # production build
pnpm new sprite <name> | sfx <name> | map <name> | font <name> | mesh <name> | cart <name>
```

## Add things (the 90% cases)

| I want to… | Do this | Format spec |
|---|---|---|
| Add a sprite | create `assets/sprites/<name>.sprite.json` | `docs/ASSETS.md` |
| Add a sound | create `assets/sfx/<name>.sfx.json` | `docs/ASSETS.md` |
| Add a tilemap | create `assets/maps/<name>.map.json` | `docs/ASSETS.md` |
| Add a 3D mesh (PS1-style) | create `assets/meshes/<name>.mesh.json`, draw via `Renderer3D` | `docs/ASSETS.md` |
| Add a game | create `src/cartridges/<name>/cart.ts` with a default export | `docs/CARTRIDGES.md` |
| Tweak the CRT look | edit `src/monitor/shaders/*.glsl` or knob defaults in `src/monitor/params.ts` | `docs/ARCHITECTURE.md` |

There is **no registration step**: assets and cartridges are discovered by
folder glob. Drop the file, the page hot-reloads. Use the asset in code via
`ctx.assets.sprite('<id>')` / `.sfx()` / `.map()` / `.font()` — the `id`
field inside the file is the lookup key, not the filename.

Minimal sprite (this is the whole format — chars map to colors, `null` = transparent):

```json
{
  "id": "coin",
  "palette": { ".": null, "Y": "#ffd24a", "O": "#c87f1e" },
  "frames": [[".YY.", "YOOY", "YOOY", ".YY."]],
  "fps": 0
}
```

## Rules

- All assets are zod-validated (`src/engine/schemas.ts`, `.strict()`); a bad
  asset fails the page load AND `pnpm check` with file + row/col context.
  `tests/assets.test.ts` validates every real file in `assets/`.
- Cartridges draw to a CPU framebuffer (`ctx.fb`) — never touch WebGL from a
  cartridge. The monitor owns all GL.
- The engine (`src/engine/`) has zero runtime deps except zod. Don't add
  dependencies without a strong reason.
- Run `pnpm check` before finishing. If you changed visuals, verify with
  agent-browser: every panel control has a stable id (`#btn-power`,
  `#btn-input-0`, `#btn-signal`, `#knob-contrast`, canvas is `#tube`).
  The monitor boots POWERED OFF — click `#btn-power` first.

## Map of the machine

```
assets/                 ← sprites/sfx/maps/fonts (JSON, schema-validated)
src/engine/             ← console side: framebuffer, sprites, font, input,
                          chip audio, loop, asset loader, cartridge types
src/cartridges/<id>/    ← one folder per game (auto-registered)
src/monitor/            ← tube side: params (knobs), gl, panel (DOM),
                          monitor.ts (pass chain), shaders/*.glsl
docs/                   ← ASSETS.md · CARTRIDGES.md · ARCHITECTURE.md
```
