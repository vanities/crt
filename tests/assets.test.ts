import { describe, it, expect } from 'vitest'
import { loadAssets } from '../src/engine/assets'
import { loadCartridges } from '../src/cartridges'

/**
 * Validates every real asset file in assets/ through the same loaders the
 * engine uses. If an AI (or a human) commits a malformed asset, this fails
 * with the path and reason. `pnpm check` runs this.
 */
describe('asset folder', () => {
  const assets = loadAssets()

  it('loads all sprites, sfx, maps, fonts and meshes without errors', () => {
    expect(assets.sprites.size).toBeGreaterThan(0)
    expect(assets.sfxs.size).toBeGreaterThan(0)
    expect(assets.maps.size).toBeGreaterThan(0)
    expect(assets.fonts.size).toBeGreaterThan(0)
    expect(assets.meshes.size).toBeGreaterThan(0)
  })

  it('contains the assets the launch cartridges depend on', () => {
    for (const id of ['ship', 'drone', 'tile-rock', 'tile-spire']) {
      expect(assets.sprite(id).frames.length).toBeGreaterThan(0)
    }
    for (const id of ['laser', 'boom', 'hit', 'ui', 'chime']) {
      expect(assets.sfx(id).duration).toBeGreaterThan(0)
    }
    expect(assets.map('ground').tileSize).toBe(8)
    expect(assets.font('micro').height).toBe(5)
    for (const id of ['crate', 'monolith', 'gem', 'pine', 'torii', 'memcard']) {
      expect(assets.mesh(id).faces.length).toBeGreaterThan(0)
    }
  })

  it('every map legend entry points at a real sprite', () => {
    for (const map of assets.maps.values()) {
      for (const id of map.grid) {
        if (id !== null) expect(assets.sprites.has(id), `map references sprite "${id}"`).toBe(true)
      }
    }
  })

  it('every mesh texture points at a real sprite', () => {
    for (const mesh of assets.meshes.values()) {
      for (const face of mesh.faces) {
        if (face.tex) expect(assets.sprites.has(face.tex), `mesh "${mesh.id}" references sprite "${face.tex}"`).toBe(true)
      }
    }
  })

  it('micro font covers the charset the cartridges print', () => {
    const font = assets.font('micro')
    const needed = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:!?-+/()=%♥▶◀·'
    for (const ch of needed) {
      expect(font.glyphs.has(ch), `glyph "${ch}"`).toBe(true)
    }
  })

  it('throws a helpful error for unknown ids', () => {
    expect(() => assets.sprite('nope')).toThrow(/unknown sprite "nope".*Available/)
  })
})

describe('cartridge registry', () => {
  it('discovers the launch cartridges in order', () => {
    const carts = loadCartridges()
    expect(carts.map((c) => c.meta.id)).toEqual(['beam-patrol', 'test-cards', 'demo-disc'])
    for (const c of carts) {
      expect(typeof c.update).toBe('function')
      expect(typeof c.draw).toBe('function')
    }
  })
})
