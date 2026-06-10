// ── HALATION (2+3/3): separable gaussian blur ───────────────────────────

uniform sampler2D u_src;
uniform vec2 u_dir; // texel-scaled blur direction

void main() {
  vec3 c = texture(u_src, v_uv).rgb * 0.227;
  c += texture(u_src, v_uv + u_dir * 1.0).rgb * 0.1945;
  c += texture(u_src, v_uv - u_dir * 1.0).rgb * 0.1945;
  c += texture(u_src, v_uv + u_dir * 2.0).rgb * 0.1216;
  c += texture(u_src, v_uv - u_dir * 2.0).rgb * 0.1216;
  c += texture(u_src, v_uv + u_dir * 3.0).rgb * 0.054;
  c += texture(u_src, v_uv - u_dir * 3.0).rgb * 0.054;
  c += texture(u_src, v_uv + u_dir * 4.0).rgb * 0.0162;
  c += texture(u_src, v_uv - u_dir * 4.0).rgb * 0.0162;
  o_color = vec4(c, 1.0);
}
