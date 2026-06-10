// ── DEFLECTION & BEAM ───────────────────────────────────────────────────
// The electron gun scanning the decoded video onto the faceplate. Each
// output pixel sums gaussian contributions from nearby scanlines; bright
// lines defocus into a fatter beam (blooming). Also home to the raster
// geometry features: UNDERSCAN, H/V DELAY (shows the blanking interval),
// interlace field offset, and the vertical roll when sync is lost.

uniform sampler2D u_video;
uniform float u_lines;      // scanline count of the source
uniform float u_scan;       // scanline strength knob
uniform float u_underscan;  // 0 or ~0.13
uniform float u_hvdelay;    // 0/1 — center the blanking interval
uniform float u_field;      // interlace half-line offset
uniform float u_vroll;      // sync-loss vertical roll

void main() {
  vec2 uv = v_uv;

  // UNDERSCAN: shrink the raster so the edges become visible
  float scale = 1.0 - u_underscan;
  uv = (uv - 0.5) / scale + 0.5;

  uv.y += u_vroll;

  vec2 suv = uv;
  if (u_hvdelay > 0.5) suv = fract(uv + 0.5);

  if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
    o_color = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // H/V DELAY: the regions near the original frame edges are blanking
  float blank = 0.0;
  if (u_hvdelay > 0.5) {
    float bx = step(suv.x, 0.045) + step(0.955, suv.x);
    float by = step(suv.y, 0.038) + step(0.962, suv.y);
    blank = clamp(bx + by, 0.0, 1.0);
  }

  float fy = suv.y * u_lines - 0.5 + u_field;
  float j0 = floor(fy);
  float sigma = mix(0.55, 0.30, u_scan);

  vec3 acc = vec3(0.0);
  for (int o = -1; o <= 2; o++) {
    float j = j0 + float(o);
    float lineY = (j + 0.5) / u_lines;
    if (lineY < 0.0 || lineY > 1.0) continue;
    vec3 c = texture(u_video, vec2(suv.x, lineY)).rgb;
    float lum = dot(c, LUMA_W);
    float s = sigma * mix(0.82, 1.35, lum); // bright beam blooms wider
    float d = fy - j;
    acc += c * exp(-d * d / (2.0 * s * s));
  }

  // normalize so a beam-centered pixel of a full-bright line ≈ 1.0
  float ref = 1.0 + 2.0 * exp(-1.0 / (2.0 * sigma * sigma));
  vec3 col = acc / ref;

  col *= 1.0 - blank * 0.96;
  o_color = vec4(col, 1.0);
}
