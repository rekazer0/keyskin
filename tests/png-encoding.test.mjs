import assert from 'node:assert/strict'
import { test } from 'node:test'
import { zlibSync } from 'fflate'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'

for (const count of [1, 256, 257]) test(`PNG 无损编码保留 ${count} 种颜色及透明像素的 RGB`, () => {
  const data = new Uint8Array(count * 4)
  for (let i = 0; i < count; i++) data.set([i & 255, i >> 8, 29, i & 255], i * 4)
  const image = { width: count, height: 1, data }
  const png = encodePng(image)
  assert.equal(png[25], count <= 256 ? 3 : 6)
  assert.deepEqual(decodePng(png), image)
})

test('PNG 自适应滤波压缩重复行，保持超过 256 色的渐变和半透明像素', () => {
  const width = 10000, height = 16
  const data = new Uint8Array(width * height * 4)
  const sub = new Uint8Array((width * 4 + 1) * height)
  let seed = 42
  for (let i = 0; i < width * 4; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    data[i] = seed >>> 24
  }
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1)
    sub[start] = 1
    if (y) data.set(data.subarray(0, width * 4), y * width * 4)
    for (let x = 0; x < width * 4; x++) sub[start + 1 + x] = (data[y * width * 4 + x] - (x >= 4 ? data[y * width * 4 + x - 4] : 0)) & 255
  }
  const image = { width, height, data }
  const png = encodePng(image)
  assert.equal(png[25], 6)
  assert.deepEqual(decodePng(png), image)
  assert.ok(png.length < zlibSync(sub, { level: 6 }).length / 2)
})
