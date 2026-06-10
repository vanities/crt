export type Button = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'start' | 'select'

const KEYMAP: Record<string, Button> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyX: 'a',
  KeyK: 'a',
  Space: 'a',
  KeyZ: 'b',
  KeyJ: 'b',
  Enter: 'start',
  ShiftLeft: 'select',
  ShiftRight: 'select',
}

/**
 * Virtual gamepad. Edge detection is per fixed-update step via beginFrame().
 * Keydowns are queued until the next update consumes them, so taps shorter
 * than one 60 Hz step (synthetic key events, very fast fingers) never drop.
 */
export class Input {
  private down = new Set<Button>()
  private prev = new Set<Button>()
  private queue = new Set<Button>()
  private edges = new Set<Button>()

  attach(target: Window = window): void {
    target.addEventListener('keydown', (e) => {
      const btn = KEYMAP[e.code]
      if (!btn) return
      e.preventDefault()
      if (!e.repeat) {
        this.down.add(btn)
        this.queue.add(btn)
      }
    })
    target.addEventListener('keyup', (e) => {
      const btn = KEYMAP[e.code]
      if (!btn) return
      e.preventDefault()
      this.down.delete(btn)
    })
    target.addEventListener('blur', () => {
      this.down.clear()
      this.queue.clear()
    })
    console.debug('[input] keyboard attached', { keys: Object.keys(KEYMAP).length })
  }

  /** Call once per fixed update, before the cartridge update runs. */
  beginFrame(): void {
    this.prev = new Set(this.down)
    this.edges = this.queue
    this.queue = new Set()
  }

  held(b: Button): boolean {
    return this.down.has(b) || this.edges.has(b)
  }

  pressed(b: Button): boolean {
    return this.edges.has(b)
  }

  released(b: Button): boolean {
    return !this.down.has(b) && this.prev.has(b)
  }
}
