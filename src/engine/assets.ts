import { parseSprite, type Sprite } from './sprites'
import { parseFont, type Font } from './font'
import { parseMap, type TileMap } from './tilemap'
import { sfxSchema, errMsg, type Sfx } from './schemas'

/**
 * Asset discovery is folder-driven: drop a JSON file in assets/<kind>/ and
 * it is picked up automatically (no manifest, no registration step). Vite
 * hot-reloads the page on change. Every file is schema-validated at load;
 * a malformed asset fails fast with its path and a precise reason.
 */

const spriteFiles = import.meta.glob('/assets/sprites/*.json', { eager: true, import: 'default' }) as Record<string, unknown>
const sfxFiles = import.meta.glob('/assets/sfx/*.json', { eager: true, import: 'default' }) as Record<string, unknown>
const mapFiles = import.meta.glob('/assets/maps/*.json', { eager: true, import: 'default' }) as Record<string, unknown>
const fontFiles = import.meta.glob('/assets/fonts/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

function build<T extends { id: string }>(
  kind: string,
  files: Record<string, unknown>,
  parse: (raw: unknown) => T,
): Map<string, T> {
  const out = new Map<string, T>()
  for (const [path, raw] of Object.entries(files)) {
    let v: T
    try {
      v = parse(raw)
    } catch (e) {
      throw new Error(`[assets] ${kind} ${path}: ${errMsg(e)}`)
    }
    if (out.has(v.id)) {
      throw new Error(`[assets] duplicate ${kind} id "${v.id}" (${path})`)
    }
    out.set(v.id, v)
  }
  return out
}

export class AssetStore {
  constructor(
    readonly sprites: Map<string, Sprite>,
    readonly sfxs: Map<string, Sfx>,
    readonly maps: Map<string, TileMap>,
    readonly fonts: Map<string, Font>,
  ) {}

  private pick<T>(map: Map<string, T>, kind: string, id: string): T {
    const v = map.get(id)
    if (!v) {
      throw new Error(`[assets] unknown ${kind} "${id}". Available: ${[...map.keys()].join(', ') || '(none)'}`)
    }
    return v
  }

  sprite(id: string): Sprite {
    return this.pick(this.sprites, 'sprite', id)
  }
  sfx(id: string): Sfx {
    return this.pick(this.sfxs, 'sfx', id)
  }
  map(id: string): TileMap {
    return this.pick(this.maps, 'map', id)
  }
  font(id: string): Font {
    return this.pick(this.fonts, 'font', id)
  }
}

export function loadAssets(): AssetStore {
  const t0 = performance.now()
  const sprites = build('sprite', spriteFiles, parseSprite)
  const sfxs = build('sfx', sfxFiles, (raw) => sfxSchema.parse(raw))
  const maps = build('map', mapFiles, parseMap)
  const fonts = build('font', fontFiles, parseFont)
  console.info(
    `[assets] loaded sprites=${sprites.size} sfx=${sfxs.size} maps=${maps.size} fonts=${fonts.size} in ${(performance.now() - t0).toFixed(1)}ms`,
  )
  return new AssetStore(sprites, sfxs, maps, fonts)
}
