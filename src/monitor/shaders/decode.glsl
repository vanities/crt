// ── DECODER ─────────────────────────────────────────────────────────────
// The monitor's jungle chip. For composite: a 1-line comb filter separates
// luma from chroma (imperfectly — hence dot crawl and hanging dots), then
// the chroma is demodulated against the subcarrier and low-passed (I wider
// than Q, hence color bleed). The CHROMA / PHASE / APERTURE / CONTRAST /
// BRIGHT knobs all live in this stage, exactly like the real control board.

uniform sampler2D u_sig;
uniform int u_mode;          // 0 composite, 1 svideo, 2 rgb
uniform float u_cycles;
uniform float u_lines;
uniform float u_framePhase;
uniform vec2 u_sigSize;      // signal texture size in texels
uniform float u_chroma;      // chroma gain knob
uniform float u_phaseKnob;   // tint knob (radians)
uniform float u_aperture;    // horizontal peaking knob
uniform float u_contrast;
uniform float u_bright;
uniform float u_noise;       // analog floor noise
uniform float u_snow;        // input-switch snow burst (0..1)
uniform float u_degauss;     // degauss envelope — wobbles the demod phase
uniform float u_time;
uniform float u_frame;

float compAt(vec2 uv) { return (texture(u_sig, uv).r - SIG_B) / SIG_A; }
float svLumaAt(vec2 uv) { return texture(u_sig, uv).r; }
float svChromaAt(vec2 uv) { return texture(u_sig, uv).g * 2.0 - 1.0; }

float phaseAt(vec2 uv) {
  float line = floor(uv.y * u_lines);
  return TAU * u_cycles * uv.x + line * PI + u_framePhase;
}

// comb filter: chroma inverts line-to-line, luma doesn't
float combLuma(vec2 uv, float dy)   { return 0.5 * (compAt(uv) + compAt(uv - vec2(0.0, dy))); }
float combChroma(vec2 uv, float dy) { return 0.5 * (compAt(uv) - compAt(uv - vec2(0.0, dy))); }

vec3 applyPicture(vec3 rgb) {
  return clamp(rgb * u_contrast + u_bright, 0.0, 1.0);
}

void main() {
  if (u_mode == 2) {
    vec3 rgb = texture(u_sig, v_uv).rgb;
    o_color = vec4(applyPicture(rgb), 1.0);
    return;
  }

  vec2 px = 1.0 / u_sigSize;
  float dy = px.y;

  float Y = (u_mode == 0) ? combLuma(v_uv, dy) : svLumaAt(v_uv);

  // demodulate chroma with gaussian low-pass; Q gets less bandwidth than I
  float iAcc = 0.0;
  float qAcc = 0.0;
  float iW = 0.0;
  float qW = 0.0;
  for (int k = -10; k <= 10; k++) {
    float fk = float(k);
    vec2 uv = v_uv + vec2(px.x * fk, 0.0);
    float c = (u_mode == 0) ? combChroma(uv, dy) : svChromaAt(uv);
    float ph = phaseAt(uv);
    float wI = exp(-fk * fk / 40.5);  // sigma ≈ 4.5 samples
    float wQ = exp(-fk * fk / 98.0);  // sigma ≈ 7.0 samples → blurrier
    iAcc += 2.0 * c * sin(ph) * wI;
    iW += wI;
    qAcc += 2.0 * c * cos(ph) * wQ;
    qW += wQ;
  }
  float I = iAcc / iW;
  float Q = qAcc / qW;

  // APERTURE: horizontal peaking (unsharp) on luma, the PVM sharpness knob
  float yl = (u_mode == 0) ? combLuma(v_uv - vec2(px.x * 3.0, 0.0), dy) : svLumaAt(v_uv - vec2(px.x * 3.0, 0.0));
  float yr = (u_mode == 0) ? combLuma(v_uv + vec2(px.x * 3.0, 0.0), dy) : svLumaAt(v_uv + vec2(px.x * 3.0, 0.0));
  Y += u_aperture * 1.5 * (Y - 0.5 * (yl + yr));

  // PHASE knob rotates the demod axis; degauss makes it seasick briefly
  float ang = u_phaseKnob + u_degauss * 0.5 * sin(u_time * 37.0);
  float cs = cos(ang);
  float sn = sin(ang);
  float gain = u_chroma * (1.0 + u_degauss * 0.4 * sin(u_time * 23.0));
  vec2 iq = vec2(I * cs - Q * sn, I * sn + Q * cs) * gain;

  vec3 rgb = toRGB(vec3(Y, iq.x, iq.y));

  // analog noise floor + switching snow
  float n = hash13(vec3(gl_FragCoord.xy, u_frame));
  rgb += (n - 0.5) * u_noise * 0.35;
  if (u_snow > 0.001) {
    float s = hash13(vec3(gl_FragCoord.yx * 1.7, u_frame * 3.1 + 11.0));
    rgb = mix(rgb, vec3(s), clamp(u_snow, 0.0, 1.0) * 0.85);
  }

  o_color = vec4(applyPicture(rgb), 1.0);
}
