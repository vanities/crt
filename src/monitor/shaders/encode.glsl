// ── ENCODER ─────────────────────────────────────────────────────────────
// Models the console's video encoder chip: RGB → YIQ, chroma modulated
// onto an NTSC-style subcarrier. Output is the wire:
//   composite : everything summed on one line (r channel)
//   s-video   : luma and chroma on separate wires (r = Y, g = C)
//   rgb       : straight passthrough — the clean PVM experience
// Runs at 4 samples per source pixel so the subcarrier is fully sampled.

uniform sampler2D u_src;
uniform int u_mode;         // 0 composite, 1 svideo, 2 rgb
uniform float u_cycles;     // subcarrier cycles across the active line
uniform float u_lines;      // active scanline count
uniform float u_framePhase; // frame-alternating phase (creates dot crawl)

void main() {
  vec3 rgb = texture(u_src, v_uv).rgb;

  if (u_mode == 2) {
    o_color = vec4(rgb, 1.0);
    return;
  }

  vec3 yiq = toYIQ(rgb);
  float line = floor(v_uv.y * u_lines);
  // phase advances ~227.5 cycles/line → alternates PI per line, PI per frame
  float phase = TAU * u_cycles * v_uv.x + line * PI + u_framePhase;
  float chroma = yiq.y * sin(phase) + yiq.z * cos(phase);

  if (u_mode == 1) {
    o_color = vec4(yiq.x, chroma * 0.5 + 0.5, 0.0, 1.0);
  } else {
    float composite = yiq.x + chroma;
    o_color = vec4(composite * SIG_A + SIG_B, 0.0, 0.0, 1.0);
  }
}
