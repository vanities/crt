# Architecture — a PVM, component by component

The engine is organized as the block diagram of a broadcast monitor. Each
real component has a file that plays its role:

| PVM/BVM component | What it does on the bench | Where it lives here |
|---|---|---|
| Signal sources (deck, console) | feed video into the inputs | `src/cartridges/*/cart.ts` |
| Input board (LINE A/B, RGB) | source + format selection | input buttons in `panel.ts`, `main.ts` switching |
| Encoder (in the *source*) | RGB → composite/Y-C on the wire | `shaders/encode.glsl` |
| Decoder / jungle chip (CXA-style) | comb filter, chroma demod, picture controls | `shaders/decode.glsl` |
| Deflection yoke + HV | the beam *clock*: scan timing, geometry, blanking | `shaders/phosphor.glsl` (field-phase window) |
| Electron guns | beam current → excitation, spot blooming | `shaders/phosphor.glsl` (gaussian spot profile) |
| Aperture grille (Trinitron) | vertical RGB stripes on the glass | `shaders/screen.glsl` (grille section) |
| Phosphor (P22) | excitation + dual-time-constant decay | `shaders/phosphor.glsl` (MRT state buffers) |
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
1. encode.glsl    RGB → NTSC signal (4 samples/px; composite, Y/C, or RGB pass)
2. decode.glsl    comb filter + demod + CHROMA/PHASE/APERTURE/CONTRAST/BRIGHT
3. phosphor.glsl  BEAM-SCAN TEMPORAL SIMULATION (see below) — MRT writes
                  integrated light + fast/slow phosphor state (linear, 16F)
4. halation       bright-pass downsample + separable blur (linear light)
5. screen.glsl    grille mask, curvature, tone map + gamma, vignette, glass,
                  degauss wobble, power on/off raster collapse → canvas
```

## The phosphor stage is a simulation, not a filter

A field-phase clock advances at 60 fields/s in *wall time*. Each display
refresh, only the raster slice the beam swept during that interval receives
new excitation; everything else just decays. Per pixel and per channel the
pass evaluates the closed-form integral of phosphor emission over the
refresh interval — what your retina accumulates, not an instantaneous sample:

```
light = S·(1 − e^(−T/τ)) + Σ E·(1 − e^(−age/τ))   (presented)
S'    = S·e^(−T/τ)       + Σ E·e^(−age/τ)          (state carried forward)
```

with P22-ish per-channel fast constants (B 1.9 ms < G 2.6 ms < R 3.4 ms) and
a slow red-shifted tail (τ 45 ms) fed by the PERSIST knob — bright trails
fade through orange because blue dies first and red lingers. Consequences:

- On a 120/144 Hz display the interval covers a fraction of the raster and a
  true rolling scan emerges (CRT-grade motion clarity, Blur Busters-style).
- At 60 Hz the integral collapses to the correct steady image — no fake
  banding, brightness identical at any refresh rate (the τ's cancel).
- Everything runs in linear light in float buffers; `screen.glsl` applies a
  soft shoulder + gamma at the faceplate. Watch the console for
  `display ≈X Hz → N beam slice(s) per field`.

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
