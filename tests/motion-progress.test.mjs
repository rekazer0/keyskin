import assert from "node:assert/strict"
import test from "node:test"
import { animateProgress, closeDialog, cssTimeMs } from "../src/motion.ts"

test("CSS timing tokens retain their millisecond value after production minification", () => {
  assert.equal(cssTimeMs(" 500ms "), 500)
  assert.equal(cssTimeMs(" .5s "), 500)
  assert.equal(cssTimeMs("0s"), 0)
})

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
    animateProgress(progress, 95, update)
    assert.ok(frames.length > 0)
    animateProgress(progress, 0, update)
    assert.equal(progress.value, 0, "a new operation immediately clears the preceding progress")
    assert.equal(frames.length, 0, "reset cancels the preceding animation")
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test("dialog handoffs wait for the closing animation and share repeated close requests", async () => {
  const previous = new Map(["document", "getComputedStyle", "Element"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  class FakeElement { animate() {} }
  globalThis.Element = FakeElement
  globalThis.document = { documentElement: {} }
  let duration = "200ms"
  globalThis.getComputedStyle = () => ({ getPropertyValue: key => key.startsWith("--duration") ? duration : "ease-out" })
  const animations = []
  const dialog = {
    open: true,
    animate() {
      const animation = new EventTarget()
      animation.cancel = () => {}
      animations.push(animation)
      return animation
    },
    close(value) { this.open = false; this.returnValue = value },
  }
  try {
    const first = closeDialog(dialog, "retry")
    assert.equal(closeDialog(dialog), first)
    let nextOpened = false
    const handoff = first.then(() => { assert.equal(dialog.open, false); nextOpened = true })
    await Promise.resolve()
    assert.equal(nextOpened, false)
    assert.equal(animations.length, 2)
    animations[0].dispatchEvent(new Event("finish"))
    await handoff
    assert.equal(nextOpened, true)
    assert.equal(dialog.returnValue, "retry")
    duration = "0ms"
    dialog.open = true
    await closeDialog(dialog, "reduced-motion")
    assert.equal(dialog.open, false)
    assert.equal(animations.length, 2)
    await closeDialog(dialog)
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
