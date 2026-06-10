import type { Cartridge } from '../engine/cartridge'

/**
 * Cartridge auto-registry: any src/cartridges/<name>/cart.ts with a default
 * export is discovered here and assigned to an input (LINE A, LINE B, …).
 * Adding a game = adding a folder. No registration step.
 */
const mods = import.meta.glob('./*/cart.ts', { eager: true }) as Record<
  string,
  { default?: Cartridge }
>

export function loadCartridges(): Cartridge[] {
  const carts: Cartridge[] = []
  for (const [path, mod] of Object.entries(mods)) {
    const cart = mod.default
    if (!cart || !cart.meta || typeof cart.update !== 'function' || typeof cart.draw !== 'function') {
      throw new Error(`[carts] ${path} must default-export a Cartridge ({ meta, update, draw })`)
    }
    if (cart.meta.width < 64 || cart.meta.width > 768 || cart.meta.height < 64 || cart.meta.height > 576) {
      throw new Error(`[carts] ${cart.meta.id}: resolution ${cart.meta.width}x${cart.meta.height} out of range (64..768 x 64..576)`)
    }
    carts.push(cart)
  }
  carts.sort((a, b) => (a.meta.order ?? 99) - (b.meta.order ?? 99) || a.meta.id.localeCompare(b.meta.id))
  console.info(`[carts] registered: ${carts.map((c) => `${c.meta.id} (${c.meta.width}x${c.meta.height})`).join(', ')}`)
  return carts
}
