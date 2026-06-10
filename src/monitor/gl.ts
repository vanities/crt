/**
 * Minimal WebGL2 plumbing: fullscreen-triangle passes, render targets,
 * cached uniform locations. Every stage of the signal chain is one Pass
 * with one fragment shader.
 */

const VERT = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

const FRAG_HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
layout(location = 0) out vec4 o_color;
`

/** Extra MRT outputs appended for passes that write state buffers. */
const MRT_OUTPUTS = `layout(location = 1) out vec4 o_state1;
layout(location = 2) out vec4 o_state2;
`

/** Shared constants/helpers prepended to every fragment shader. */
const COMMON = `
const float PI  = 3.141592653589793;
const float TAU = 6.283185307179586;
// composite signal is stored in a unorm texture: e = s * SIG_A + SIG_B
const float SIG_A = 0.4;
const float SIG_B = 0.26;
const vec3 LUMA_W = vec3(0.299, 0.587, 0.114);

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 toYIQ(vec3 c) {
  return vec3(
    dot(c, LUMA_W),
    dot(c, vec3(0.596, -0.274, -0.322)),
    dot(c, vec3(0.211, -0.523, 0.312)));
}

vec3 toRGB(vec3 y) {
  return vec3(
    y.x + 0.956 * y.y + 0.621 * y.z,
    y.x - 0.272 * y.y - 0.647 * y.z,
    y.x - 1.106 * y.y + 1.703 * y.z);
}
`

export interface Target {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
}

export type TexFormat = 'rgba8' | 'rgba16f'

export class GLCtx {
  readonly gl: WebGL2RenderingContext
  /** float render targets available — linear-light phosphor state wants this */
  readonly hdr: boolean

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('WebGL2 is required (every browser since ~2021 has it)')
    this.gl = gl
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      console.error('[gl] context lost')
    })
    this.hdr = gl.getExtension('EXT_color_buffer_float') !== null
    console.info(
      '[gl] WebGL2 ready:',
      gl.getParameter(gl.RENDERER) ?? 'unknown renderer',
      this.hdr ? '· float targets (16F phosphor state)' : '· 8-bit fallback (no EXT_color_buffer_float)',
    )
  }

  compile(name: string, fragBody: string, opts: { mrt?: boolean } = {}): Pass {
    const t0 = performance.now()
    const gl = this.gl
    const header = FRAG_HEADER + (opts.mrt ? MRT_OUTPUTS : '')
    const vs = this.shader(gl.VERTEX_SHADER, VERT, `${name}.vert`)
    const fs = this.shader(gl.FRAGMENT_SHADER, header + COMMON + fragBody, `${name}.frag`)
    const prog = gl.createProgram()
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`[gl] link failed for ${name}: ${gl.getProgramInfoLog(prog)}`)
    }
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    console.debug(`[gl] compiled pass "${name}" in ${(performance.now() - t0).toFixed(1)}ms`)
    return new Pass(gl, prog, name)
  }

  private shader(type: number, src: string, label: string): WebGLShader {
    const gl = this.gl
    const sh = gl.createShader(type)
    if (!sh) throw new Error('[gl] createShader failed')
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh)
      const numbered = src
        .split('\n')
        .map((l, i) => `${String(i + 1).padStart(3)} | ${l}`)
        .join('\n')
      throw new Error(`[gl] compile failed for ${label}:\n${log}\n${numbered}`)
    }
    return sh
  }

  texture(w: number, h: number, filter: 'nearest' | 'linear', fmt: TexFormat = 'rgba8'): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (fmt === 'rgba16f') {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
    const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  target(w: number, h: number, filter: 'nearest' | 'linear', fmt: TexFormat = 'rgba8'): Target {
    const tex = this.texture(w, h, filter, fmt)
    return this.targetFrom([tex], w, h)
  }

  /** Build an FBO over existing textures; >1 texture = MRT (drawBuffers set). */
  targetFrom(texs: WebGLTexture[], w: number, h: number): Target {
    const gl = this.gl
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    texs.forEach((tex, i) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0)
    })
    if (texs.length > 1) {
      gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i))
    }
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`[gl] framebuffer incomplete (0x${status.toString(16)}) at ${w}x${h} (${texs.length} attachment(s))`)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex: texs[0], fbo, w, h }
  }

  deleteTarget(t: Target | null): void {
    if (!t) return
    this.gl.deleteTexture(t.tex)
    this.gl.deleteFramebuffer(t.fbo)
  }
}

export class Pass {
  private locs = new Map<string, WebGLUniformLocation | null>()

  constructor(
    private gl: WebGL2RenderingContext,
    readonly prog: WebGLProgram,
    readonly name: string,
  ) {}

  use(): this {
    this.gl.useProgram(this.prog)
    return this
  }

  private loc(name: string): WebGLUniformLocation | null {
    if (!this.locs.has(name)) {
      const l = this.gl.getUniformLocation(this.prog, name)
      if (l === null) console.debug(`[gl] pass "${this.name}": uniform "${name}" unused/missing`)
      this.locs.set(name, l)
    }
    return this.locs.get(name) ?? null
  }

  f(name: string, v: number): this {
    this.gl.uniform1f(this.loc(name), v)
    return this
  }

  f2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.loc(name), x, y)
    return this
  }

  f3(name: string, x: number, y: number, z: number): this {
    this.gl.uniform3f(this.loc(name), x, y, z)
    return this
  }

  i(name: string, v: number): this {
    this.gl.uniform1i(this.loc(name), v)
    return this
  }

  tex(unit: number, name: string, tex: WebGLTexture): this {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(this.loc(name), unit)
    return this
  }

  /** Draw the fullscreen triangle into a target (or the canvas when null). */
  draw(target: Target | null, canvasW = 0, canvasH = 0): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null)
    gl.viewport(0, 0, target ? target.w : canvasW, target ? target.h : canvasH)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
