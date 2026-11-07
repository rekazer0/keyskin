import assert from "node:assert/strict"
import test from "node:test"
import { animateProgress } from "../src/motion.ts"

test("operation progress follows changing targets smoothly", () => {
  const previous = new Map(["document", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  let time = 0
  let nextFrame = 0
  const frames = []
  globalThis.document = { documentElement: {} }
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "200ms" })
  globalThis.requestAnimationFrame = (callback) => {
    frames.push({ id: ++nextFrame, callback })
    return nextFrame
  }
  globalThis.cancelAnimationFrame = (id) => {
    const index = frames.findIndex((frame) => frame.id === id)
    if (index >= 0) frames.splice(index, 1)
  }

  try {
    const progress = { value: 0, max: 100 }
    const values = []
    const update = (value) => values.push(value)
    animateProgress(progress, 60, update)
    frames.shift().callback(time += 16)
    animateProgress(progress, 80, update)
    while (frames.length) {
      frames.shift().callback(time += 16)
      assert.ok(values.length < 100, "animation converges")
    }

    assert.ok(values[0] > 0 && values[0] < 60)
    assert.ok(values.every((value, index) => index === 0 || value >= values[index - 1]))
    assert.equal(progress.value, 80)
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
