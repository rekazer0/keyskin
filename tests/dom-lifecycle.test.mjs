import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function harness() {
  const frames = new Map(), timers = new Map(), observers = []
  let id = 0
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe() { this.active = true }
    disconnect() { this.active = false }
  }
  const context = vm.createContext({
    MutationObserver, document: { body: {} },
    requestAnimationFrame: fn => (frames.set(++id, fn), id), cancelAnimationFrame: id => frames.delete(id),
    setTimeout: fn => (timers.set(++id, fn), id), clearTimeout: id => timers.delete(id),
  })
  const source = readFileSync(new URL('../src/dom-lifecycle.ts', import.meta.url), 'utf8').replace(/^export /gm, '')
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 }), context)
  return {
    watch: context.releaseOnRemove, observers, frames, timers,
    flush() { [...frames.values()].forEach(fn => fn()) },
    background() { [...timers.values()].forEach(fn => fn()) },
    remove() { observers[0].callback([{ removedNodes: [{}] }]) },
  }
}

test('generated nodes release once after removal; synchronous moves and reuse survive', () => {
  const h = harness(), node = { isConnected: false }
  let released = 0
  h.watch(node, () => released++)
  node.isConnected = true
  h.flush()
  h.remove()
  h.watch(node, () => released++)
  h.flush()
  assert.equal(released, 0)
  node.isConnected = false
  h.remove()
  h.flush()
  h.remove()
  h.flush()
  assert.equal(released, 1)
  assert.equal(h.observers[0].active, false)
  assert.equal(h.timers.size, 0)
})

test('unused components release on the first frame and share a single observer', () => {
  const h = harness()
  let released = 0
  for (let i = 0; i < 100; i++) h.watch({ isConnected: false }, () => released++)
  h.flush()
  assert.equal(released, 100)
  assert.equal(h.observers.length, 1)
  assert.equal(h.observers[0].active, false)
  h.watch({ isConnected: false }, () => released++)
  assert.equal(h.observers[0].active, true)
  h.flush()
  assert.equal(released, 101)
})

test('background cleanup releases detached resources even when animation frames never run', () => {
  const h = harness()
  let released = 0
  for (let batch = 0; batch < 3; batch++) {
    for (let i = 0; i < 100; i++) h.watch({ isConnected: false }, () => released++)
    assert.equal(h.timers.size, 1)
    h.background()
    assert.equal(released, (batch + 1) * 100)
    assert.equal(h.frames.size, 0)
    assert.equal(h.timers.size, 0)
  }
})
