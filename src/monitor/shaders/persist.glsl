// ── PHOSPHOR PERSISTENCE ────────────────────────────────────────────────
// P22 phosphor doesn't go dark instantly: new excitation vs. exponential
// decay of the previous field. max() keeps trails from blowing out.

uniform sampler2D u_beam;
uniform sampler2D u_prev;
uniform float u_decay; // 0 = off, ~0.95 = long ghostly trails

void main() {
  vec3 b = texture(u_beam, v_uv).rgb;
  vec3 p = texture(u_prev, v_uv).rgb * u_decay - 0.004; // bias kills 8-bit residue
  o_color = vec4(max(b, p), 1.0);
}
