import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constrainedCanvasSize, drawNineSliceImage } from "../src/preview-draw.ts"

// Model the shared scratch canvas: resizing or clearing wipes it and drawing replaces pixels.
function setup() {
  let width = 0
  let height = 0
  let slices = []
  const clears = []
  const buffer = {
    get width() { return width },
    set width(value) { width = value; slices = [] },
    get height() { return height },
    set height(value) { height = value; slices = [] },
    getContext: () => ({ drawImage: (...args) => slices.push(args), clearRect: (...args) => { clears.push(args); slices = [] } }),
  }
  const frames = []
  const context = {
    drawImage(canvas, ...args) {
      frames.push({ slices: [...slices], args })
    },
  }
  return {
    frames,
    clears,
    draw(image, width, height, nineSlicePixelScale = 1) {
      drawNineSliceImage(context, {
        image, source: [10, 20, 106, 151], inner: [52, 64, 2, 17], nineSlicePixelScale,
      }, { x: 13, y: 12, width, height }, () => buffer)
    },
  }
}

test('nine-slice backgrounds remain complete after alternating sizes', () => {
  const { draw, frames, clears } = setup()
  const image = {}
  draw(image, 110, 143)
  draw(image, 160, 400)
  draw(image, 110, 143)
  assert.deepEqual(frames[2], frames[0])
  assert.equal(frames[0].slices.length, 9)
  assert.deepEqual(frames[0].args, [0, 0, 110, 143, 13, 12, 110, 143])
  assert.deepEqual(clears[0], [0, 0, 112, 145], 'the first draw also has a transparent filtering margin')
  assert.deepEqual(clears[2], [0, 0, 162, 402], 'filtering must not sample dirty pixels outside the smaller source crop')
})

test('different bitmap objects and repeated frames keep their own background', () => {
  const { draw, frames } = setup()
  const first = {}
  const second = {}
  draw(first, 110, 143)
  draw(second, 110, 143)
  draw(first, 110, 143)
  for (const [index, image] of [first, second, first].entries()) {
    assert.equal(frames[index].slices.length, 9)
    for (const slice of frames[index].slices) assert.equal(slice[0], image)
  }
})

test('device pixels stretch a narrow band even when source and layout sizes match', () => {
  const { draw, frames } = setup()
  draw({}, 106, 151)
  draw({}, 106, 151, 2)
  const centre = (frame) => frame.slices[4].slice(1)
  assert.deepEqual(centre(frames[0]), [62, 84, 2, 17, 52, 64, 2, 17])
  assert.deepEqual(centre(frames[1]), [62, 84, 2, 17, 52, 64, 108, 168])
  assert.deepEqual(frames[1].args, [0, 0, 212, 302, 13, 12, 106, 151])
})

test('thumbnail backing size stays within its pixel budget', () => {
  assert.deepEqual(constrainedCanvasSize(1206, 2622, 560, 320), { width: 147, height: 320 })
  assert.deepEqual(constrainedCanvasSize(280, 160, 560, 320), { width: 280, height: 160 })
})
