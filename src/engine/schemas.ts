import { z } from 'zod'

/**
 * Zod schemas for every asset format. These are the contract for asset
 * authors (human or AI): all `.strict()` so a typo'd key fails loudly with
 * a readable message instead of being silently ignored.
 */

export const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'expected a hex color like "#ff00aa"')

/** assets/sprites/*.sprite.json — pixel art as text grids. */
export const spriteSchema = z
  .object({
    id: z.string().min(1),
    /** single char → hex color, or null for transparent */
    palette: z.record(z.string().length(1, 'palette keys must be single characters'), hexColor.nullable()),
    /** one or more frames; each frame is an array of equal-length row strings */
    frames: z.array(z.array(z.string().min(1)).min(1)).min(1),
    /** frames per second when animated via spriteFrame(); 0 = static */
    fps: z.number().nonnegative().optional(),
  })
  .strict()

/** assets/sfx/*.sfx.json — chiptune-style synth patches. */
export const sfxSchema = z
  .object({
    id: z.string().min(1),
    wave: z.enum(['square', 'triangle', 'sawtooth', 'sine', 'noise']),
    freq: z
      .object({
        start: z.number().positive(),
        end: z.number().positive().optional(),
        curve: z.enum(['linear', 'exp']).default('exp'),
      })
      .strict(),
    duration: z.number().positive().max(5),
    attack: z.number().min(0).max(1).default(0.005),
    release: z.number().min(0).max(2).default(0.05),
    volume: z.number().min(0).max(1).default(0.5),
  })
  .strict()

/** assets/maps/*.map.json — tile maps as text grids referencing sprite ids. */
export const mapSchema = z
  .object({
    id: z.string().min(1),
    tileSize: z.number().int().positive(),
    /** single char → sprite id, or null for empty */
    legend: z.record(z.string().length(1, 'legend keys must be single characters'), z.string().nullable()),
    rows: z.array(z.string().min(1)).min(1),
  })
  .strict()

/** assets/meshes/*.mesh.json — low-poly 3D, PS1 style. Quads encouraged.
 *  Faces are textured (tex = a SPRITE id + uv in texel coords) or flat color. */
export const meshSchema = z
  .object({
    id: z.string().min(1),
    verts: z.array(z.tuple([z.number(), z.number(), z.number()])).min(3),
    faces: z
      .array(
        z
          .object({
            /** 3 or 4 vertex indices, wound counter-clockwise seen from outside */
            v: z.array(z.number().int().nonnegative()).min(3).max(4),
            color: hexColor.optional(),
            /** sprite id used as texture (frame 0) */
            tex: z.string().optional(),
            /** texel coords per vertex, required with tex */
            uv: z.array(z.tuple([z.number(), z.number()])).min(3).max(4).optional(),
            /** skip backface culling for this face */
            double: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

/** assets/fonts/*.font.json — bitmap fonts; glyphs are text grids ('#' = on). */
export const fontSchema = z
  .object({
    id: z.string().min(1),
    height: z.number().int().positive(),
    spaceWidth: z.number().int().positive().default(3),
    glyphs: z.record(z.string().length(1), z.array(z.string())),
  })
  .strict()

export type SpriteJson = z.infer<typeof spriteSchema>
export type Sfx = z.infer<typeof sfxSchema>
export type MapJson = z.infer<typeof mapSchema>
export type FontJson = z.infer<typeof fontSchema>
export type MeshJson = z.infer<typeof meshSchema>

/** Flatten a ZodError (or anything) into one readable line. */
export function errMsg(e: unknown): string {
  if (e instanceof z.ZodError) {
    return e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
  }
  return e instanceof Error ? e.message : String(e)
}
