// BDA panels take new hint / list / key mappings from the decoded source editor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SkinArchive } from '../src/skin.ts'
import { applyDecodedBdaAppearancePart, decodedBdaAppearancePart } from '../src/bda-source.ts'
import { decodeBdaAppearanceUncached } from '../src/bda-decode.ts'
import { removeFields, updateStringMapValue } from '../src/bda-encode.ts'

const archive = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/default-template.bda', import.meta.url))), 'bda')
const path = 'light/skin/port/appearanceConfig'
const original = archive.getBytes(path)
const part = (name) => JSON.parse(decodedBdaAppearancePart(original, { kind: 'panel', name }))
const edit = (name, change, bytes = original) => {
  const source = JSON.parse(decodedBdaAppearancePart(bytes, { kind: 'panel', name }))
  change(source)
  return applyDecodedBdaAppearancePart(path, bytes, JSON.stringify(source), { kind: 'panel', name })
}
const panel = (bytes, name) => decodeBdaAppearanceUncached(bytes).panels.get(name)
const sparse = updateStringMapValue(original, 4, 'sel_ch', (bytes) => removeFields(bytes, new Set([4])))

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

test('a panel creates candidate maps on its first style and removes the reference again', () => {
  const name = 'sel_ch'
  assert.equal(panel(sparse, name).cand, undefined)
  const ref = part('py_26').cand.candBarStyle
  const added = edit(name, (source) => { source.cand = { candBarStyle: ref } }, sparse)
  assert.deepEqual(panel(added, name).cand.candBarStyle, ref)
  const source = JSON.parse(decodedBdaAppearancePart(added, { kind: 'panel', name }))
  delete source.cand.candBarStyle
  const removed = applyDecodedBdaAppearancePart(path, added, JSON.stringify(source), { kind: 'panel', name })
  assert.equal(panel(removed, name).cand.candBarStyle, undefined)
  assert.deepEqual(panel(removed, name).cand.candKeys, new Map())
  assert.deepEqual(panel(added, 'py_26'), panel(original, 'py_26'))
})

test('a panel creates a candidate key inside a candidate object it does not have yet', () => {
  const ref = part('py_26').keys.KEY_Q.foreStyles[0]
  const added = edit('sel_ch', (source) => { source.cand = { menuKeys: { MENU_PASTE: { foreStyles: [ref] } } } }, sparse)
  assert.deepEqual(panel(added, 'sel_ch').cand.menuKeys.get('MENU_PASTE').foreStyles, [ref])
})

test('clearing the final input, more or candidate-switch reference keeps an editable empty object', () => {
  const ref = part('py_26').cand.candBarStyle
  const name = 'sel_ch', target = { kind: 'panel', name }
  const empty = updateStringMapValue(sparse, 4, name, (bytes) => removeFields(bytes, new Set([5, 6])))
  for (const steps of [['input', 'backStyle'], ['more', 'backStyle'], ['cand', 'switch', 'normalBack']]) {
    const added = edit(name, (source) => {
      let object = source
      for (const step of steps.slice(0, -1)) object = object[step] = {}
      object[steps.at(-1)] = ref
    }, empty)
    const source = JSON.parse(decodedBdaAppearancePart(added, target))
    let object = source
    for (const step of steps.slice(0, -1)) object = object[step]
    delete object[steps.at(-1)]
    const cleared = applyDecodedBdaAppearancePart(path, added, JSON.stringify(source), target)
    let actual = JSON.parse(decodedBdaAppearancePart(cleared, target))
    for (const step of steps.slice(0, -1)) actual = actual[step]
    assert.deepEqual(actual, {}, steps.join('.'))
  }
})
