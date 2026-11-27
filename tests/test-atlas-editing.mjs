import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resizeTileSlice, updateTileSlice, tileSlices, duplicateTileSlice } from '../src/tiles.ts'
import { IniDocument } from '../src/ini.ts'

test('corner resizing can exceed image bounds and still clips nine-slice bounds', () => {
  const slice = { index: 1, source: [10, 20, 100, 80], inner: [30, 40, 60, 40] }
  assert.deepEqual(resizeTileSlice(slice, 0, { x: -10, y: -20 }).source, [-10, -20, 120, 120])
  const shrunk = resizeTileSlice(slice, 3, { x: 50, y: 60 })
  assert.deepEqual(shrunk, { index: 1, source: [10, 20, 40, 40], inner: [30, 40, 20, 20] })
  assert.deepEqual(resizeTileSlice(slice, 3, { x: 500, y: 500 }).source, [10, 20, 490, 480])
  assert.deepEqual(resizeTileSlice(slice, 0, { x: 500, y: 500 }).source, [109, 99, 1, 1])
  assert.deepEqual(slice.inner, [30, 40, 60, 40])
})

test('nine-slice toggle, duplicate, and resize survive TIL serialization', () => {
  const doc = IniDocument.parse('[IMG1]\nSOURCE_RECT=10,20,100,80\n')
  const slice = { index: 1, source: [10, 20, 100, 80], inner: [30, 40, 60, 40] }
  updateTileSlice(doc, slice)
  assert.equal(doc.get('IMG1', 'SCALE'), '1,1,1,1,1')
  const copied = duplicateTileSlice(slice, 2)
  updateTileSlice(doc, copied)
  updateTileSlice(doc, { index: 1, source: slice.source })
  const restored = IniDocument.parse(doc.toString())
  assert.equal(restored.get('IMG1', 'SCALE'), undefined)
  assert.equal(restored.get('IMG2', 'SCALE'), '1,1,1,1,1')
  assert.deepEqual(tileSlices(restored), [{ index: 1, source: slice.source }, copied])
})

test('editing a nine-slice preserves its existing SCALE', () => {
  const doc = IniDocument.parse('[IMG1]\nSOURCE_RECT=10,20,100,80\nSCALE=1,2,3,4,5\nINNER_RECT=30,40,60,40\n')
  updateTileSlice(doc, { index: 1, source: [10, 20, 100, 80], inner: [31, 40, 59, 40] })
  assert.equal(doc.get('IMG1', 'SCALE'), '1,2,3,4,5')
})
