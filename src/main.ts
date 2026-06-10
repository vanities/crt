import './styles.css'
import { loadAssets } from './engine/assets'
import { Framebuffer } from './engine/framebuffer'
import { Input } from './engine/input'
import { ChipAudio } from './engine/audio'
import { GameLoop } from './engine/loop'
import type { Cartridge, CartCtx, Connection } from './engine/cartridge'
import { loadCartridges } from './cartridges'
import { Params } from './monitor/params'
import { Monitor, CONNECTION_LABEL } from './monitor/monitor'
import { createPanel } from './monitor/panel'

const INPUT_NAMES = ['LINE A', 'LINE B', 'LINE C']
const BORN = Date.UTC(2026, 5, 10) // the day the tube first lit

/** Page chrome around the monitor: day counter + live field odometer. */
function initChrome(): { tickField: (powered: boolean) => void } {
  const age = document.getElementById('site-age')
  if (age) {
    const days = Math.max(0, Math.floor((Date.now() - BORN) / 86_400_000))
    age.textContent = `CRT is ${days} day${days === 1 ? '' : 's'} old.`
  }
  const odo = document.getElementById('fields-odo')
  let fields = 0
  let lastPowered = false
  return {
    tickField: (powered: boolean) => {
      if (powered) fields++
      if (powered !== lastPowered) {
        lastPowered = powered
        document.body.classList.toggle('powered', powered)
      }
      if (odo && powered && fields % 30 === 0) {
        odo.textContent = String(fields % 10_000_000).padStart(7, '0')
      }
    },
  }
}

function fatal(err: unknown): void {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error('[boot] fatal:', err)
  const div = document.createElement('div')
  div.className = 'fatal'
  div.innerHTML = `<h1>NO SIGNAL</h1><pre></pre>`
  div.querySelector('pre')!.textContent = msg
  document.body.appendChild(div)
}

function boot(): void {
  const t0 = performance.now()
  const root = document.querySelector<HTMLDivElement>('#app')!

  const assets = loadAssets()
  const carts = loadCartridges()
  if (carts.length === 0) throw new Error('no cartridges found in src/cartridges/*/cart.ts')

  const params = new Params()
  const input = new Input()
  input.attach()
  const audio = new ChipAudio()
  audio.setVolume(params.get('volume'))
  params.onChange('volume', (v) => audio.setVolume(v))

  // console side: one framebuffer per cartridge resolution, created on switch
  let cart: Cartridge = carts[0]
  let active = 0
  let ctx: CartCtx | null = null
  let frame = 0

  const panelInputs = carts.slice(0, INPUT_NAMES.length).map((c, i) => ({
    label: INPUT_NAMES[i],
    title: `${c.meta.title} (${c.meta.width}x${c.meta.height})`,
  }))

  const handlers = {
    power: () => {
      monitor.power()
      if (monitor.powered) {
        bootCart(active, true)
      }
    },
    degauss: () => monitor.degauss(),
    selectInput: (i: number) => {
      if (i >= carts.length || i === active) return
      bootCart(i, false)
      monitor.notifySwitch()
      osdInput()
    },
    cycleSignal: () => {
      monitor.cycleConnection()
      osdInput()
    },
    toggle: (which: 'underscan' | 'hvdelay' | 'blue' | 'wide') => {
      const on = monitor.toggle(which)
      monitor.showOsd(`${which.toUpperCase()} ${on ? 'ON' : 'OFF'}`)
    },
  }

  const panel = createPanel(root, params, panelInputs, handlers)
  const monitor = new Monitor(panel.canvas, params, audio)
  const chrome = initChrome()

  // first user gesture anywhere unlocks audio (browser autoplay policy)
  const unlock = () => audio.unlock()
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })

  function osdInput(): void {
    monitor.showOsd(`${INPUT_NAMES[active]} · ${CONNECTION_LABEL[monitor.connection]} · ${cart.meta.title}`)
  }

  function bootCart(i: number, silentConnection: boolean): void {
    active = i
    cart = carts[i]
    const fb = new Framebuffer(cart.meta.width, cart.meta.height)
    fb.font = assets.fonts.has('micro') ? assets.font('micro') : null
    ctx = { fb, input, audio, assets, t: 0, frame: 0 }
    frame = 0
    monitor.scan480i = cart.meta.scan === '480i'
    monitor.setConnection(cart.meta.connection ?? 'composite', silentConnection)
    cart.init?.(ctx)
    console.info(`[main] booted cartridge "${cart.meta.id}" on ${INPUT_NAMES[i]} (${cart.meta.width}x${cart.meta.height})`)
  }

  bootCart(0, true)
  osdInput()

  const loop = new GameLoop(
    (dt) => {
      // the console keeps running even with the monitor off — it's a separate box
      if (!ctx) return
      input.beginFrame()
      cart.update(ctx, dt)
      ctx.t += dt
      ctx.frame = ++frame
    },
    (t) => {
      if (!ctx) return
      cart.draw(ctx)
      if (monitor.osdVisible) {
        const fb = ctx.fb
        const tw = fb.textWidth(monitor.osdText, 1)
        fb.fillRect(6, 6, tw + 6, 11, [10, 30, 14])
        fb.text(monitor.osdText, 9, 9, [90, 255, 140], 1)
      }
      monitor.render(ctx.fb, t, frame)
      panel.sync(monitor.state(), active, CONNECTION_LABEL[monitor.connection])
      chrome.tickField(monitor.powered)
    },
  )
  loop.start()

  console.info(`[boot] ready in ${(performance.now() - t0).toFixed(1)}ms — press POWER`)
}

try {
  boot()
} catch (e) {
  fatal(e)
}
