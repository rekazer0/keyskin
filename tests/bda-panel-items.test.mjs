// BDA panels take new hint / list / key mappings from the decoded source editor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SkinArchive } from '../src/skin.ts'
import { applyDecodedBdaAppearancePart, decodedBdaAppearancePart } from '../src/bda-source.ts'
import { decodeBdaAppearanceUncached } from '../src/bda-decode.ts'

const archive = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/default-template.bda', import.meta.url))), 'bda')
const path = 'light/skin/port/appearanceConfig'
const original = archive.getBytes(path)
const part = (name) => JSON.parse(decodedBdaAppearancePart(original, { kind: 'panel', name }))
const edit = (name, change) => {
  const source = part(name)
  change(source)
  return applyDecodedBdaAppearancePart(path, original, JSON.stringify(source), { kind: 'panel', name })
}
const panel = (bytes, name) => decodeBdaAppearanceUncached(bytes).panels.get(name)

test('a panel without a hint bar takes a new hint mapping', () => {
  const hint = part('py_26').hints.long
  assert.equal(panel(original, 'sel_ch').hints.size, 0)
  const added = edit('sel_ch', (source) => { source.hints.long = structuredClone(hint) })
  assert.deepEqual(panel(added, 'sel_ch').hints.get('long'), panel(original, 'py_26').hints.get('long'))
  assert.deepEqual(panel(added, 'py_26'), panel(original, 'py_26'), 'other panels are untouched')
})

test('a panel takes a new list mapping with foreground layers and offsets', () => {
  const list = part('sel_ch').lists.port
  const offsets = [{ x: 0.25, y: -0.125 }]
  const added = edit('py_26', (source) => { source.lists.port = { ...structuredClone(list), foreStyleOffsets: offsets } })
  const decoded = panel(added, 'py_26').lists.get('port')
  assert.deepEqual(decoded.foreStyles, panel(original, 'sel_ch').lists.get('port').foreStyles)
  assert.deepEqual(decoded.foreStyleOffsets, offsets)
})

test('a panel takes a new key mapping with foreground layers and offsets', () => {
  const key = part('py_26').keys.KEY_Q
  assert.ok(key.foreStyleOffsets.length)
  const added = edit('py_26', (source) => { source.keys.KEY_TEST = structuredClone(key) })
  assert.deepEqual(panel(added, 'py_26').keys.get('KEY_TEST'), panel(original, 'py_26').keys.get('KEY_Q'))
})

test('removing a panel item still reports that it is unsupported', () => {
  assert.throws(() => edit('py_26', (source) => { delete source.hints.long }), /暂不支持删除 BDA 面板项：long/)
})
