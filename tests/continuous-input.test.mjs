import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { appSource, declarations, run } from './helpers/app-source.mjs'

function load(name, globals = {}) {
  const context = vm.createContext({ exports: {}, ...globals })
  const text = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
  vm.runInContext(ts.transpile(text, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
  return context.exports
}
const history = load('history')
const { createGestureHistory } = load('gesture-history', { require: () => history })
const textChange = (before, after, path = 'keys.ini') => ({ kind: 'text', path, before, after })

test('gesture retains first before and latest after across frames', () => {
  const record = createGestureHistory(), stack = [], token = {}
  for (let i = 0; i < 100; i++) record(stack, textChange(String(i), String(i + 1)), token)
  assert.equal(stack.length, 1)
  assert.equal(stack[0].changes.length, 1)
  assert.equal(stack[0].changes[0].before, '0')
  assert.equal(stack[0].changes[0].after, '100')
})
test('BDA bytes and multi-file batches collapse without keeping intermediate snapshots', () => {
  const record = createGestureHistory(), stack = [], token = {}
  const before = new Uint8Array([0]), middle = new Uint8Array([1]), after = new Uint8Array([2])
  record(stack, { kind: 'batch', changes: [textChange('a', 'b'), { kind: 'bytes', path: 'appearance', before, after: middle }] }, token)
  record(stack, { kind: 'batch', changes: [textChange('b', 'c'), { kind: 'bytes', path: 'appearance', before: middle, after }] }, token)
  assert.equal(stack.length, 1)
  assert.equal(stack[0].changes.length, 2)
  assert.equal(stack[0].changes[1].before, before)
  assert.equal(stack[0].changes[1].after, after)
})
test('other fields, idle sessions and intervening changes never merge', () => {
  const record = createGestureHistory(), stack = [], first = {}, second = {}
  record(stack, textChange('0', '1'), first)
  record(stack, textChange('1', '2'), second)
  record(stack, textChange('2', 'manual'))
  record(stack, textChange('manual', '3'), second)
  assert.equal(stack.length, 4)
})
test('undo followed by a fresh gesture cannot mutate the removed history entry', () => {
  const record = createGestureHistory(), stack = [], token = {}
  record(stack, textChange('0', '1'), token)
  const undone = stack.pop()
  record(stack, textChange('0', '2'), token)
  assert.equal(undone.changes[0].after, '1')
  assert.equal(stack[0].changes[0].after, '2')
})

class Root {
  listeners = new Map()
  addEventListener(name, callback) {
    const list = this.listeners.get(name) ?? []
    list.push(callback); this.listeners.set(name, list)
  }
  emit(name, event = {}) { for (const callback of this.listeners.get(name) ?? []) callback(event) }
}
class Input {
  type = 'number'; disabled = false; readOnly = false; isConnected = true
  min = ''; max = ''; step = '1'; value = '0'; events = []; onEvent
  stepUp(n = 1) {
    const value = Number(this.value || 0) + n * Number(this.step)
    this.value = String(Math.min(this.max === '' ? Infinity : +this.max, Math.max(this.min === '' ? -Infinity : +this.min, +value.toFixed(8))))
  }
  stepDown() { this.stepUp(-1) }
  dispatchEvent(event) { this.events.push(event.type); this.onEvent?.(event); return true }
}
function wheelSetup(options = {}) {
  const root = new Root(), win = new Root(), frames = new Map(), timers = new Map()
  let next = 0
  const api = load('number-input-wheel', {
    document: root, window: win, HTMLInputElement: Input, Event,
    requestAnimationFrame: cb => { frames.set(++next, cb); return next },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (cb, delay) => { assert.equal(delay, 350); timers.set(++next, cb); return next },
    clearTimeout: id => timers.delete(id),
  })
  api.installNumberInputWheel(root, options)
  const tick = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb()) }
  const idle = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(cb => cb()) }
  const wheel = (field, deltaY = -1, extra = {}) => {
    root.activeElement = extra.unfocused ? null : field
    const event = { target: field, deltaY, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...extra }
    root.emit('wheel', event); return event
  }
  return { api, root, win, frames, wheel, tick, idle }
}
test('wheel burst updates the value immediately and dispatches once per frame', () => {
  const s = wheelSetup(), field = new Input()
  for (let i = 0; i < 100; i++) s.wheel(field)
  assert.equal(field.value, '100')
  assert.equal(s.frames.size, 1)
  assert.equal(field.events.length, 0)
  s.tick()
  assert.deepEqual(field.events, ['input', 'change'])
})
test('continuous wheel frames form one undo operation; an idle gap starts a new one', () => {
  const s = wheelSetup(), field = new Input(), stack = [], record = createGestureHistory()
  let model = '0'
  field.onEvent = event => {
    if (event.type !== 'input') return
    record(stack, textChange(model, field.value), s.api.numberInputGesture())
    model = field.value
  }
  s.wheel(field); s.tick(); s.wheel(field); s.tick(); s.wheel(field); s.idle()
  assert.equal(stack.length, 1)
  assert.equal(stack[0].changes[0].before, '0')
  assert.equal(stack[0].changes[0].after, '3')
  s.wheel(field); s.tick()
  assert.equal(stack.length, 2)
  const undone = stack.pop()
  model = undone.changes[0].before
  assert.equal(model, '3')
  model = stack.pop().changes[0].before
  assert.equal(model, '0')
})
test('repeated Shift arrows keep the numeric field connected until the gesture ends', () => {
  const s = wheelSetup(), field = new Input(), tokens = []
  let refreshes = 0
  field.onEvent = event => {
    if (event.type !== 'change') return
    tokens.push(s.api.numberInputGesture())
    s.api.deferNumberInputRefresh('inspector', () => { refreshes++ })
  }
  for (let index = 0; index < 2; index++) {
    s.root.emit('keydown', { target: field, key: 'Shift' })
    s.root.emit('keydown', { target: field, key: 'ArrowUp', shiftKey: true, preventDefault() {} })
    s.tick()
  }
  assert.equal(field.value, '20')
  assert.equal(tokens[0], tokens[1])
  assert.equal(refreshes, 0)
  s.idle()
  assert.equal(refreshes, 1)
})
test('field switch, keydown, blur and explicit undo flush pending updates', () => {
  const s = wheelSetup(), a = new Input(), b = new Input(), tokens = []
  a.onEvent = e => { if (e.type === 'input') tokens.push(s.api.numberInputGesture()) }
  s.wheel(a); s.wheel(b)
  assert.equal(a.events.length, 2)
  s.root.emit('keydown'); assert.equal(b.events.length, 2)
  s.wheel(a); s.win.emit('blur'); assert.equal(a.events.length, 4)
  s.wheel(a); s.api.flushNumberInputWheel(); assert.equal(a.events.length, 6)
  assert.notEqual(tokens[0], tokens[1]); assert.notEqual(tokens[1], tokens[2])
  assert.equal(s.frames.size, 0)
})
test('expensive inspector refresh is deferred and deduplicated until the gesture ends', () => {
  const s = wheelSetup(), field = new Input(), refreshed = []
  const key = {}
  field.onEvent = () => {
    const value = field.value
    assert.equal(s.api.deferNumberInputRefresh(key, () => refreshed.push(value)), true)
  }
  s.wheel(field); s.tick(); s.wheel(field); s.tick()
  assert.deepEqual(refreshed, [])
  s.idle(); assert.deepEqual(refreshed, ['2'])
  assert.equal(s.api.deferNumberInputRefresh(key, () => {}), false)
})
test('min/max, decimal and step=any are respected without dispatching no-op writes', () => {
  const s = wheelSetup(), field = new Input()
  field.max = '1'; field.step = '0.5'
  s.wheel(field); s.wheel(field); s.wheel(field); s.tick()
  assert.equal(field.value, '1'); assert.equal(field.events.length, 2)
  s.wheel(field); s.tick(); assert.equal(field.events.length, 2)
  s.idle(); field.step = 'any'
  s.wheel(field, 1); s.tick(); assert.equal(field.value, '0')
})
test('disabled/readonly fields and pinch-zoom are untouched', () => {
  const s = wheelSetup(), field = new Input()
  field.disabled = true; assert.equal(s.wheel(field).defaultPrevented, false)
  field.disabled = false; field.readOnly = true; s.wheel(field)
  field.readOnly = false; assert.equal(s.wheel(field, -1, { ctrlKey: true }).defaultPrevented, false)
  assert.equal(s.wheel(field, -1, { unfocused: true }).defaultPrevented, false)
  s.tick(); assert.equal(field.value, '0'); assert.equal(field.events.length, 0)
})
test('mixed multi-selection delta is accumulated instead of converting empty input to zero', () => {
  const moves = [], s = wheelSetup({ isMixed: () => true, moveMixed: (_, n) => moves.push(n) }), field = new Input()
  field.value = ''
  s.wheel(field); s.wheel(field); s.wheel(field, 1); s.tick()
  assert.deepEqual(moves, [1]); assert.equal(field.value, '')
  assert.deepEqual(field.events, [])
})
test('Shift + arrow steps a number field by 10 as one write', () => {
  const s = wheelSetup(), field = new Input()
  const key = (k, extra = {}) => { const event = { target: field, key: k, shiftKey: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...extra }; s.root.emit('keydown', event); return event }
  assert.equal(key('ArrowUp').defaultPrevented, true)
  assert.equal(field.value, '10'); assert.deepEqual(field.events, ['input', 'change'])
  key('ArrowDown'); assert.equal(field.value, '0')
  assert.equal(key('ArrowUp', { shiftKey: false }).defaultPrevented, false, 'plain arrows stay native')
})
test('scrub handles resolve to exactly one editable number field', () => {
  const { scrubbableField } = wheelSetup().api
  const handle = (...fields) => ({ parentElement: { querySelectorAll: () => fields } })
  const field = new Input(), text = Object.assign(new Input(), { type: 'text' })
  assert.equal(scrubbableField(handle(field, text)), field)
  assert.equal(scrubbableField(handle(field, new Input())), undefined, 'X/Y 共用的行标签不能拖')
  assert.equal(scrubbableField(handle(Object.assign(new Input(), { disabled: true }))), undefined)
})
test('controls inside numeric captions keep their own pointer interaction', () => {
  const s = wheelSetup()
  let checks = 0
  s.root.emit('pointerdown', {
    button: 0,
    target: { closest(selector) {
      checks++
      assert.equal(selector, 'button, input, select, textarea, a')
      return {}
    } },
    preventDefault() { assert.fail('the add button must not start numeric scrubbing') },
  })
  assert.equal(checks, 1)
})
test('duplicate installation cannot double-step a field', () => {
  const s = wheelSetup(), field = new Input()
  s.api.installNumberInputWheel(s.root)
  s.wheel(field); s.tick(); assert.equal(field.value, '1')
})

const names = ['schedulePointerCoordinates', 'paintPreviewInteraction', 'schedulePreviewInteractionFrame', 'schedulePreviewPan', 'flushPreviewPan']
const functions = declarations(...names)
test('pan and crosshair use the latest pointer snapshot in a single frame', () => {
  const frames = new Map(), paints = []; let id = 0
  const context = run(functions, {
    requestAnimationFrame: cb => { frames.set(++id, cb); return id }, cancelAnimationFrame: id => frames.delete(id),
    updatePointerCoordinates: e => paints.push(['crosshair', e.clientX]), setPreviewPan: x => paints.push(['pan', x]),
    pointerCoordinatesFrame: 0,
  })
  vm.runInContext('for (let i=1; i<=100; i++) { schedulePointerCoordinates({clientX:i,clientY:0,pointerType:"mouse"},{},{}); schedulePreviewPan(i,0) }', context)
  assert.equal(frames.size, 1)
  const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb())
  assert.deepEqual(paints, [['crosshair',100],['pan',100]])
  vm.runInContext('schedulePreviewPan(101,0); flushPreviewPan()', context)
  assert.equal(frames.size, 0)
  assert.deepEqual(paints.at(-1), ['pan',101])
})
test('per-field undo buttons are no longer created', () => {
  const shell = readFileSync(new URL('../src/inspector-shell.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(shell, /reset\.className = "pin-reset"/)
  assert.match(shell, /inspector-reset/)
})

test('undo history keeps only the latest 200 steps', () => {
  const stack = []
  for (let i = 0; i < 250; i++) history.pushChange(stack, { kind: 'text', path: 'a', before: String(i), after: String(i + 1) })
  assert.equal(stack.length, 200)
  assert.equal(stack[0].before, '50')
  const record = createGestureHistory()
  for (let i = 0; i < 250; i++) record(stack, { kind: 'text', path: 'a', before: '', after: '' }, {})
  assert.equal(stack.length, 200)
})
