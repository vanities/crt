// ── BEAM SCAN + PHOSPHOR PHYSICS ────────────────────────────────────────
// Not a scanline overlay: a temporal simulation. A field-phase clock
// advances at 60 fields/s in wall time; this refresh interval the beam
// swept phase (u_ph1 - u_span, u_ph1], so only lines whose scan time falls
// in that window receive new excitation. Each pixel integrates phosphor
// emission E·e^(-t/τ) in closed form over the interval — what a retina
// (or a camera shutter) would accumulate, not an instantaneous sample.
//
//   light_out  = S·(1 - e^(-T/τ))  +  Σ E·(1 - e^(-age/τ))   (units: E)
//   state_out  = S·e^(-T/τ)        +  Σ E·e^(-age/τ)
//
// Dual time constants per P22: fast ms-scale decay (blue dies first) plus
// a slow red-shifted tail — bright trails fade through orange, like the
// tube remembers. On a 120/144 Hz display the window covers a fraction of
// the raster and a true rolling scan emerges; at 60 Hz the math collapses
// to the correct steady image. All in linear light.
//
// MRT: o_color = integrated light, o_state1 = fast state, o_state2 = slow.

uniform sampler2D u_video;     // decoded frame (gamma space)
uniform sampler2D u_fastPrev;  // phosphor energy at end of last interval
uniform sampler2D u_slowPrev;
uniform float u_lines;
uniform float u_scan;          // beam focus knob (scanline strength)
uniform float u_underscan;
uniform float u_hvdelay;
uniform float u_vroll;
uniform float u_field;         // interlace half-line offset
uniform float u_ph1;           // field phase at end of this interval [0,1)
uniform float u_span;          // interval length in fields (≤ 1)
uniform float u_dt;            // interval length in seconds
uniform vec3 u_tauF;           // fast time constants per channel (s)
uniform float u_tauS;          // slow tail time constant (s)
uniform vec3 u_slowIn;         // energy fraction routed to the slow tail (tinted)
uniform float u_bias;          // 8-bit fallback de-sticking bias

void main() {
  // previous state always decays, image or no image (states live in tube space)
  vec3 Sf = texture(u_fastPrev, v_uv).rgb;
  vec3 Ss = texture(u_slowPrev, v_uv).rgb;
  vec3 dfF = exp(-vec3(u_dt) / u_tauF);
  float dfS = exp(-u_dt / u_tauS);

  vec3 light = Sf * (1.0 - dfF) + Ss * (1.0 - dfS);
  vec3 addF = vec3(0.0);
  vec3 addS = vec3(0.0);

  // raster geometry (underscan / H-V delay / sync-loss roll)
  vec2 uv = v_uv;
  float scale = 1.0 - u_underscan;
  uv = (uv - 0.5) / scale + 0.5;
  uv.y += u_vroll;
  vec2 suv = uv;
  if (u_hvdelay > 0.5) suv = fract(uv + 0.5);

  bool inRaster = suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0;

  if (inRaster) {
    float blank = 0.0;
    if (u_hvdelay > 0.5) {
      float bx = step(suv.x, 0.045) + step(0.955, suv.x);
      float by = step(suv.y, 0.038) + step(0.962, suv.y);
      blank = clamp(bx + by, 0.0, 1.0);
    }

    float fy = suv.y * u_lines - 0.5 + u_field;
    float j0 = floor(fy);
    float sigma = mix(0.55, 0.30, u_scan);
    float ref = 1.0 + 2.0 * exp(-1.0 / (2.0 * sigma * sigma));

    for (int o = -1; o <= 2; o++) {
      float j = j0 + float(o);
      float lineY = (j + 0.5) / u_lines;
      if (lineY < 0.0 || lineY > 1.0) continue;

      // when did the beam last cross this line, relative to interval end?
      float p = (j + 0.5) / u_lines;
      float dphase = fract(u_ph1 - p);
      if (dphase > u_span) continue; // not swept this interval — state covers it

      vec3 c = texture(u_video, vec2(suv.x, lineY)).rgb;
      c = pow(c, vec3(2.2)); // phosphor math runs in linear light

      float lum = dot(c, LUMA_W);
      float s = sigma * mix(0.82, 1.35, lum); // beam current defocuses the spot
      float d = fy - j;
      vec3 E = c * (exp(-d * d / (2.0 * s * s)) / ref) * (1.0 - blank * 0.96);

      float age = dphase / 60.0; // seconds since excitation
      vec3 eF = exp(-vec3(age) / u_tauF);
      float eS = exp(-age / u_tauS);

      light += E * (1.0 - eF) + E * u_slowIn * (1.0 - eS);
      addF += E * eF;
      addS += E * u_slowIn * eS;
    }
  }

  o_color = vec4(light, 1.0);
  o_state1 = vec4(max(Sf * dfF + addF - u_bias, 0.0), 1.0);
  o_state2 = vec4(max(Ss * dfS + addS - u_bias, 0.0), 1.0);
}
