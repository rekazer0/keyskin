import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectGridCells, detectLineCells } from "../src/layout-scan.ts"

function canvas(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  const fill = (x, y, w, h, [r, g, b]) => {
    for (let j = y; j < y + h; j += 1) for (let i = x; i < x + w; i += 1) pixels.set([r, g, b, 255], (j * width + i) * 4)
  }
  return { pixels, fill }
}

test("opaque atlas with 1px separators is cut along the lines, not as one tile", () => {
  const { pixels, fill } = canvas(96, 72)
  const line = [128, 128, 128]
  // cells drawn edge to edge, separator lines over them; a black strip breaks the right end of lines
  fill(0, 0, 96, 72, [213, 215, 224])
  fill(18, 0, 23, 14, [255, 255, 255])
  fill(89, 29, 7, 43, [0, 0, 0])
  for (const y of [0, 43, 71]) fill(0, y, y === 43 ? 93 : 96, 1, line)
  fill(18, 14, 42, 1, line)
  fill(18, 28, 78, 1, line)
  for (const x of [0, 18]) fill(x, 0, 1, 43, line)
  fill(41, 0, 1, 28, line)
  fill(60, 0, 1, 28, line)
  fill(95, 0, 1, 29, line)
  fill(53, 29, 1, 14, line)
  fill(89, 29, 1, 14, line)
  fill(50, 44, 1, 27, line)
  fill(0, 44, 1, 27, line)
  fill(92, 44, 1, 27, line)

  assert.equal(detectGridCells(new Uint8Array(96 * 72).fill(1), 96, 72).length, 1)
  const cells = detectLineCells(pixels, 96, 72)
  assert.deepEqual(cells, [
    [1, 1, 17, 42],
    [19, 1, 22, 13], [19, 15, 22, 13], [42, 1, 18, 13], [42, 15, 18, 13], [61, 1, 34, 27],
    [19, 29, 34, 14], [54, 29, 35, 14], [90, 29, 6, 14],
    [1, 44, 49, 27], [51, 44, 41, 27], [93, 44, 3, 27],
  ])
})

test("a flat image with no lines stays a single tile", () => {
  const { pixels, fill } = canvas(20, 20)
  fill(0, 0, 20, 20, [10, 20, 30])
  assert.deepEqual(detectLineCells(pixels, 20, 20), [[0, 0, 20, 20]])
})
