// Run: node --experimental-strip-types scripts/test-preview-scheduling.mjs
import assert from 'node:assert/strict'
import { Preview } from '../src/preview.ts'

const frames = new Map()
let nextFrame = 0
globalThis.requestAnimationFrame = callback => {
  frames.set(++nextFrame, callback)
  return nextFrame
}
globalThis.cancelAnimationFrame = id => frames.delete(id)
const frame = () => {
  const callbacks = [...frames.values()]
  frames.clear()
  for (const callback of callbacks) callback()
}
// Exercise the production scheduler without constructing a DOM/canvas.
const preview = Object.create(Preview.prototype)
let renders = 0
let finish
preview.render = () => {
  renders++
  return new Promise(resolve => { finish = resolve })
}
preview.draw()
await Promise.resolve()
preview.draw()
assert.equal(renders, 0, 'ordinary updates must yield until the next frame')
assert.equal(frames.size, 1, 'updates across microtasks share one frame')
frame()
assert.equal(renders, 1)
preview.draw()
preview.draw()
finish()
await Promise.resolve()
assert.equal(renders, 1, 'pending updates must not start another render in a microtask')
assert.equal(frames.size, 1)
frame()
assert.equal(renders, 2, 'the latest pending state must still render')
finish()
await Promise.resolve()
preview.draw()
preview.drawSync()
assert.equal(renders, 3, 'drag feedback remains immediate')
assert.equal(frames.size, 0, 'immediate feedback cancels the duplicate queued draw')
finish()
await Promise.resolve()
assert.equal(frames.size, 0)

// whenDrawn waits for the next render only, even while an animation keeps queueing draws every frame.
preview.drawID = 0
preview.lastDrawnID = 0
preview.render = () => {
  const drawID = ++preview.drawID
  return Promise.resolve().then(() => { preview.lastDrawnID = drawID })
}
let settled = false
const drawn = preview.whenDrawn().then(() => { settled = true })
for (let i = 0; i < 5 && !settled; i++) {
  frame()
  preview.draw()
  await new Promise(resolve => setTimeout(resolve))
}
await drawn
assert.ok(frames.size > 0, 'the animation still has a draw queued')
assert.equal(settled, true, 'continuous animation must not hold whenDrawn until its timeout')
console.log('Preview scheduling checks passed')
