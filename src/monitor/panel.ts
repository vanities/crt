import { KNOBS, type Params, type KnobDef } from './params'
import type { MonitorState } from './monitor'

/**
 * The physical front panel: chassis, bezel, knobs, buttons, LEDs — plain
 * DOM so it stays hackable. Every control has a stable id (#btn-power,
 * #knob-contrast, …) so agents can drive the monitor with agent-browser.
 */

export interface PanelHandlers {
  power(): void
  degauss(): void
  selectInput(i: number): void
  cycleSignal(): void
  toggle(which: 'underscan' | 'hvdelay' | 'blue' | 'wide'): void
}

export interface PanelRefs {
  canvas: HTMLCanvasElement
  screenWrap: HTMLElement
  sync(state: MonitorState, activeInput: number, signalLabel: string): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  parent?.appendChild(e)
  return e
}

function knobWidget(def: KnobDef, params: Params, parent: HTMLElement): void {
  const wrap = el('div', 'knob-wrap', parent)
  const knob = el('div', 'knob', wrap)
  knob.id = `knob-${def.id}`
  knob.tabIndex = 0
  knob.setAttribute('role', 'slider')
  knob.setAttribute('aria-label', def.label)
  const cap = el('div', 'knob-cap', knob)
  el('div', 'knob-ind', cap)
  const label = el('div', 'knob-label', wrap)
  label.textContent = def.label

  const fmt = def.fmt ?? ((v: number) => v.toFixed(2))
  const render = () => {
    const v = params.get(def.id)
    const t = (v - def.min) / (def.max - def.min)
    cap.style.transform = `rotate(${-135 + 270 * t}deg)`
    knob.title = `${def.label}: ${fmt(v)} (drag ↕ / scroll, double-click resets)`
    knob.setAttribute('aria-valuenow', v.toFixed(3))
  }
  params.onChange(def.id, render)
  render()

  let startY = 0
  let startV = 0
  knob.addEventListener('pointerdown', (e) => {
    startY = e.clientY
    startV = params.get(def.id)
    knob.setPointerCapture(e.pointerId)
    knob.classList.add('grab')
  })
  knob.addEventListener('pointermove', (e) => {
    if (!knob.hasPointerCapture(e.pointerId)) return
    const range = def.max - def.min
    params.set(def.id, startV + ((startY - e.clientY) / 160) * range)
  })
  knob.addEventListener('pointerup', (e) => {
    knob.releasePointerCapture(e.pointerId)
    knob.classList.remove('grab')
  })
  knob.addEventListener('dblclick', () => params.reset(def.id))
  knob.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const range = def.max - def.min
      params.set(def.id, params.get(def.id) - (e.deltaY / 900) * range)
    },
    { passive: false },
  )
}

function button(
  parent: HTMLElement,
  id: string,
  label: string,
  onClick: () => void,
  opts: { led?: boolean; cls?: string } = {},
): HTMLButtonElement {
  const b = el('button', `pbtn ${opts.cls ?? ''}`.trim(), parent)
  b.id = id
  b.type = 'button'
  b.setAttribute('aria-label', label)
  if (opts.led !== false) el('span', 'led', b)
  const t = el('span', 'pbtn-label', b)
  t.textContent = label
  b.addEventListener('click', onClick)
  return b
}

export function createPanel(
  root: HTMLElement,
  params: Params,
  inputs: { label: string; title: string }[],
  on: PanelHandlers,
): PanelRefs {
  const chassis = el('div', 'chassis', root)

  // top: vents + badge + tally
  const top = el('div', 'crt-top', chassis)
  el('div', 'vents', top)
  const badge = el('div', 'badge', top)
  badge.innerHTML = `<span class="brand">CATHODE</span><span class="model">C-20M2 · AI MONITOR</span>`
  const tally = el('div', 'tally', top)
  tally.title = 'tally'

  // screen
  const screenWrap = el('div', 'crt-screen', chassis)
  const canvas = el('canvas', 'tube', screenWrap)
  canvas.id = 'tube'

  // control panel
  const panel = el('div', 'crt-panel', chassis)
  const row1 = el('div', 'prow', panel)

  const grpPower = el('div', 'pgroup', row1)
  const bPower = button(grpPower, 'btn-power', 'POWER', on.power, { cls: 'power' })
  button(grpPower, 'btn-degauss', 'DEGAUSS', on.degauss, { led: false })

  const grpInputs = el('div', 'pgroup', row1)
  const inputBtns = inputs.map((inp, i) =>
    button(grpInputs, `btn-input-${i}`, inp.label, () => on.selectInput(i)),
  )
  inputBtns.forEach((b, i) => (b.title = inputs[i].title))
  const bSignal = button(grpInputs, 'btn-signal', 'CVBS', on.cycleSignal, { led: false })
  bSignal.title = 'SIGNAL: re-patch the active input through composite / s-video / RGB'
  bSignal.classList.add('signal')

  const grpModes = el('div', 'pgroup', row1)
  const bUnder = button(grpModes, 'btn-underscan', 'UNDERSCAN', () => on.toggle('underscan'))
  const bHv = button(grpModes, 'btn-hvdelay', 'H/V DELAY', () => on.toggle('hvdelay'))
  const bBlue = button(grpModes, 'btn-blue', 'BLUE ONLY', () => on.toggle('blue'))
  const bWide = button(grpModes, 'btn-wide', '16:9', () => on.toggle('wide'))

  const grpRear = el('div', 'pgroup', row1)
  const bRear = button(grpRear, 'btn-rear', 'TUBE ▾', () => {
    rear.classList.toggle('open')
    bRear.classList.toggle('lit', rear.classList.contains('open'))
  }, { led: false })

  const row2 = el('div', 'prow knobs', panel)
  for (const def of KNOBS.filter((k) => k.panel === 'front')) knobWidget(def, params, row2)

  // rear drawer (tube/simulation controls)
  const rear = el('div', 'rear', panel)
  const rearKnobs = el('div', 'prow knobs', rear)
  for (const def of KNOBS.filter((k) => k.panel === 'rear')) knobWidget(def, params, rearKnobs)
  const rearActions = el('div', 'rear-actions', rear)
  button(rearActions, 'btn-reset', 'FACTORY RESET', () => params.resetAll(), { led: false })

  // footer hints
  const foot = el('div', 'foot', root)
  foot.innerHTML =
    `<b>game</b> ←↑→↓ / WASD · <kbd>Z</kbd>/<kbd>X</kbd> buttons · <kbd>Enter</kbd> start` +
    ` &nbsp;|&nbsp; <b>monitor</b> <kbd>P</kbd>ower · <kbd>G</kbd> degauss · <kbd>1</kbd>/<kbd>2</kbd> input · <kbd>C</kbd> signal · ` +
    `<kbd>U</kbd>nderscan · <kbd>H</kbd>/V delay · <kbd>B</kbd>lue only · <kbd>Y</kbd> 16:9`

  // monitor shortcuts (game keys are handled by Input and never collide)
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    switch (e.code) {
      case 'KeyP': on.power(); break
      case 'KeyG': on.degauss(); break
      case 'KeyC': on.cycleSignal(); break
      case 'KeyU': on.toggle('underscan'); break
      case 'KeyH': on.toggle('hvdelay'); break
      case 'KeyB': on.toggle('blue'); break
      case 'KeyY': on.toggle('wide'); break
      case 'Digit1': on.selectInput(0); break
      case 'Digit2': on.selectInput(1); break
      case 'Digit3': on.selectInput(2); break
    }
  })

  let lastSync = ''
  const sync = (state: MonitorState, activeInput: number, signalLabel: string): void => {
    const key = JSON.stringify([state, activeInput, signalLabel])
    if (key === lastSync) return
    lastSync = key
    tally.classList.toggle('on', state.powered)
    bPower.classList.toggle('lit', state.powered)
    inputBtns.forEach((b, i) => b.classList.toggle('lit', i === activeInput && state.powered))
    bSignal.querySelector('.pbtn-label')!.textContent = signalLabel
    bUnder.classList.toggle('lit', state.underscan)
    bHv.classList.toggle('lit', state.hvdelay)
    bBlue.classList.toggle('lit', state.blue)
    bWide.classList.toggle('lit', state.wide)
    screenWrap.classList.toggle('wide', state.wide)
  }

  console.info(`[panel] built: ${inputs.length} input(s), ${KNOBS.length} knobs`)
  return { canvas, screenWrap, sync }
}
