// ── HALATION (1/3): bright-pass + half-res downsample ──────────────────
// Light scattering in the faceplate glass starts from the bright parts.

uniform sampler2D u_src;
uniform vec2 u_texel; // texel size of the SOURCE texture

void main() {
  vec3 c = vec3(0.0);
  c += texture(u_src, v_uv + u_texel * vec2(-0.5, -0.5)).rgb;
  c += texture(u_src, v_uv + u_texel * vec2(0.5, -0.5)).rgb;
  c += texture(u_src, v_uv + u_texel * vec2(-0.5, 0.5)).rgb;
  c += texture(u_src, v_uv + u_texel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  float l = dot(c, LUMA_W);
  o_color = vec4(c * smoothstep(0.25, 0.85, l), 1.0);
}
