// ── FACEPLATE ───────────────────────────────────────────────────────────
// Everything between the phosphor and your eyes: the Trinitron-style
// aperture grille, tube curvature, halation glow, vignette, glass
// reflections — plus the electromechanical drama: degauss wobble and the
// power on/off raster collapse (with the little white dot).

uniform sampler2D u_phos;
uniform sampler2D u_glow;
uniform float u_mask;       // grille strength knob
uniform float u_maskPitch;  // device pixels per RGB triad
uniform float u_curve;      // curvature knob
uniform float u_glowAmt;    // halation knob
uniform float u_scaleX;     // power animation: raster width
uniform float u_scaleY;     // power animation: raster height
uniform float u_powerBright;
uniform float u_dot;        // power-off white dot
uniform float u_degauss;
uniform float u_time;
uniform float u_blue;       // BLUE ONLY button

void main() {
  vec2 cc = v_uv * 2.0 - 1.0;

  // degauss: the yoke shudders
  float a = u_degauss * 0.022 * sin(u_time * 41.0 + cc.y * 3.0);
  float ca = cos(a);
  float sa = sin(a);
  cc = mat2(ca, -sa, sa, ca) * cc;
  cc *= 1.0 + u_degauss * 0.012 * sin(u_time * 29.0);

  // power on/off: deflection collapses
  cc = vec2(cc.x / max(u_scaleX, 1e-4), cc.y / max(u_scaleY, 1e-4));

  // tube curvature
  float r2 = dot(cc, cc);
  vec2 wc = cc * (1.0 + u_curve * (0.055 * r2 + 0.009 * r2 * r2));

  // rounded-corner faceplate
  vec2 q = abs(wc) - vec2(1.0 - 0.075);
  float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - 0.075;
  float inside = 1.0 - smoothstep(-0.003, 0.003, d);

  vec2 suv = vec2(wc.x * 0.5 + 0.5, 0.5 - wc.y * 0.5); // flip: textures are top-down
  vec3 phos = texture(u_phos, suv).rgb;
  vec3 glow = texture(u_glow, suv).rgb;

  if (u_blue > 0.5) {
    phos = vec3(0.0, 0.0, phos.b);
    glow = vec3(0.0, 0.0, glow.b);
  }

  // aperture grille: vertical RGB stripes in device-pixel space
  float gx = gl_FragCoord.x / u_maskPitch;
  vec3 tri = vec3(
    cos(TAU * gx),
    cos(TAU * (gx - 0.33333)),
    cos(TAU * (gx - 0.66667)));
  vec3 grille = clamp(vec3(0.5) + 0.95 * tri, 0.0, 1.0);
  vec3 maskMul = mix(vec3(1.0), grille, u_mask);
  float gain = 1.0 + u_mask * 0.7;

  vec3 col = phos * maskMul * gain;
  col += glow * u_glowAmt * 1.2; // halation is diffuse — not masked

  col *= 1.0 - 0.16 * r2;       // vignette
  col *= u_powerBright;

  // glass reflections (the room exists)
  float g1 = pow(max(0.0, 1.0 - length(v_uv - vec2(0.32, 0.78)) * 1.35), 3.0) * 0.045;
  float g2 = pow(max(0.0, 1.0 - length(v_uv - vec2(0.78, 0.18)) * 2.2), 4.0) * 0.018;

  col = col * inside + vec3(g1 + g2);

  // power-off dot
  if (u_dot > 0.001) {
    vec2 dc = v_uv * 2.0 - 1.0;
    col += vec3(1.0, 1.0, 0.92) * u_dot * exp(-dot(dc, dc) * 900.0);
  }

  o_color = vec4(col, 1.0);
}
