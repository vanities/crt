# Architecture — a PVM, component by component

The engine is organized as the block diagram of a broadcast monitor. Each
real component has a file that plays its role:

| PVM/BVM component | What it does on the bench | Where it lives here |
|---|---|---|
| Signal sources (deck, console) | feed video into the inputs | `src/cartridges/*/cart.ts` |
| Input board (LINE A/B, RGB) | source + format selection | input buttons in `panel.ts`, `main.ts` switching |
| Encoder (in the *source*) | RGB → composite/Y-C on the wire | `shaders/encode.glsl` |
| Decoder / jungle chip (CXA-style) | comb filter, chroma demod, picture controls | `shaders/decode.glsl` |
| Deflection yoke + HV | scanning beam, geometry, blanking | `shaders/beam.glsl` |
| Electron guns | beam current → light, blooming | beam pass (gaussian beam profile) |
| Aperture grille (Trinitron) | vertical RGB stripes on the glass | `shaders/screen.glsl` (grille section) |
| Phosphor (P22) | persistence/decay | `shaders/persist.glsl` (ping-pong buffer) |
| Faceplate glass | halation, curvature, reflections | `shaders/downsample+blur.glsl`, `screen.glsl` |
| Degauss coil | THUNK + image shudder + color wobble | `monitor.degauss()` + uniforms in decode/screen |
| Front-panel controls | knobs/buttons/LEDs | `src/monitor/params.ts` + `panel.ts` (DOM) |
| Speaker | game audio + 15.7 kHz flyback whine | `src/engine/audio.ts` |

## Frame flow (every vsync)

```
cartridge.update (fixed 60 Hz)            ← console logic
cartridge.draw → Framebuffer (CPU RGBA)   ← "console output", e.g. 256×224
  └ OSD text stamped on top (rides the signal path, like a real OSD chip)
upload as texture
1. encode.glsl   RGB → NTSC signal (4 samples/px; composite, Y/C, or RGB pass)
2. decode.glsl   comb filter + demod + CHROMA/PHASE/APERTURE/CONTRAST/BRIGHT
3. beam.glsl     scanline beam profile @ output res, UNDERSCAN/H-V DELAY/roll
4. persist.glsl  phosphor decay (ping-pong with previous frame)
5. halation      bright-pass downsample + separable blur
6. screen.glsl   grille mask, curvature, vignette, glass, degauss wobble,
                 power on/off raster collapse → canvas
```

Composite vs S-Video vs RGB is just `u_mode` in passes 1–2: composite sums
luma+chroma on one wire (dot crawl, rainbowing, hanging dots emerge from the
comb filter math — they are not faked), Y/C keeps them separate (clean luma,
still bandwidth-limited color), RGB bypasses the codec entirely. That
contrast — flipping SIGNAL on the same game — is the whole point of a PVM.

## Authenticity notes / simplifications

- Subcarrier: phase advances π per line and π per frame → classic upward
  dot crawl. ~0.53 subcarrier cycles per source pixel.
- CHROMA/PHASE knobs do nothing on RGB input — same as a real PVM.
- H/V DELAY recenters the raster on the blanking cross (simplified: bars,
  no sync pulse detail). UNDERSCAN shrinks the raster 13%.
- 480i interlace exists as a meta flag (`scan: '480i'`) with field offset;
  both launch carts are 240p.
- The grille is screen-space (RetroArch-style) with brightness compensation;
  pitch auto-picks ~1 triad per 240th of output height, min 2 device px.

## Performance

Heavy passes run at signal resolution (≤1280×240); output-res passes are
trivial. Whole chain is ~2 ms on integrated GPUs. If you add a pass, follow
the pattern in `monitor.ts`: compile once, `Pass.use().tex().f().draw()`.
