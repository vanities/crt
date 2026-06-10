import type { Framebuffer } from './framebuffer'
import type { Input } from './input'
import type { ChipAudio } from './audio'
import type { AssetStore } from './assets'

/** How the cartridge is wired into the monitor. Composite is the dirtiest,
 *  RGB is pixel-clean — the SIGNAL button re-patches the cable live. */
export type Connection = 'composite' | 'svideo' | 'rgb'

export interface CartMeta {
  id: string
  title: string
  /** native resolution of the console output, e.g. 256×224 or 320×240 */
  width: number
  height: number
  /** reserved: '480i' adds interlace field jitter. Default '240p'. */
  scan?: '240p' | '480i'
  /** which cable this cart ships with (user can re-patch via SIGNAL) */
  connection?: Connection
  /** sort order in the input list (LINE A, LINE B, …) */
  order?: number
}

export interface CartCtx {
  fb: Framebuffer
  input: Input
  audio: ChipAudio
  assets: AssetStore
  /** seconds since cartridge boot */
  t: number
  /** fixed-update frame counter */
  frame: number
}

/**
 * A cartridge is a signal source plugged into one of the monitor's inputs.
 * Implement update (fixed 60 Hz) and draw (writes pixels into ctx.fb).
 * Drop a folder with cart.ts in src/cartridges/ and it auto-registers.
 */
export interface Cartridge {
  meta: CartMeta
  /** called on power-on and whenever the input is selected (cold boot) */
  init?(ctx: CartCtx): void
  update(ctx: CartCtx, dt: number): void
  draw(ctx: CartCtx): void
}
