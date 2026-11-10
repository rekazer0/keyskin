import assert from 'node:assert/strict'
import { test } from 'node:test'
import { declarations, run } from './helpers/app-source.mjs'
import { decodePng, encodePng, MAX_PIXELS } from '../src/ssf/ssf-png.ts'

const { composeAtlasPng } = run(declarations('composeAtlasPng'), { decodePng, encodePng, MAX_PIXELS, Uint8Array })

test('BDS 合图逐字节保留切片，包括半透明和完全透明像素中的 RGB', async () => {
  const image = { width: 2, height: 2, data: new Uint8Array([123, 87, 41, 0, 234, 111, 77, 1, 23, 144, 87, 128, 222, 33, 44, 255]) }
  const png = encodePng(image)
  const atlas = decodePng(await composeAtlasPng(6, 4, [{ png, x: 0, y: 0 }, { png, x: 3, y: 2 }]))
  for (const [x, y] of [[0, 0], [3, 2]]) for (let row = 0; row < 2; row++) {
    assert.deepEqual(atlas.data.slice(((y + row) * 6 + x) * 4, ((y + row) * 6 + x + 2) * 4), image.data.slice(row * 8, row * 8 + 8))
  }
  assert.deepEqual(atlas.data.slice(8, 12), new Uint8Array(4))
})

test('BDS 合图拒绝错误尺寸、越界切片和无效图片', async () => {
  const png = encodePng({ width: 1, height: 1, data: new Uint8Array(4) })
  await assert.rejects(composeAtlasPng(MAX_PIXELS, 2, []), /尺寸无效/)
  await assert.rejects(composeAtlasPng(2, 2, [{ png, x: -1, y: 0 }]), /超出图集范围/)
  await assert.rejects(composeAtlasPng(2, 2, [{ png: new Uint8Array(), x: 0, y: 0 }]), /PNG/)
})
