// BDA keys take new foreground layers (an image-only key can get text) and lose them again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SkinArchive } from '../src/skin.ts'
import { decodeBdaAppearanceUncached } from '../src/bda-decode.ts'
import { addBdaStyle, updateBdaStyle } from '../src/bda-encode.ts'
import { applyDecodedBdaAppearancePart, decodedBdaAppearancePart, replaceBdaStyleReferences } from '../src/bda-source.ts'

const archive = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/default-template.bda', import.meta.url))), 'bda')
const path = 'light/skin/port/appearanceConfig'
const original = archive.getBytes(path)
const part = { kind: 'panel', name: 'py_26' }
const edit = (bytes, change) => {
  const source = JSON.parse(decodedBdaAppearancePart(bytes, part))
  change(source)
  return applyDecodedBdaAppearancePart(path, bytes, JSON.stringify(source), part)
}
const key = (bytes, name) => decodeBdaAppearanceUncached(bytes).panels.get('py_26').keys.get(name)

test('an image-only BDA key gets a text layer with its own text, and the layer can be removed', () => {
  assert.deepEqual(key(original, 'KEY_F36').foreStyles.map((ref) => ref.type), ['image'])
  const added = addBdaStyle(original, 'text', key(original, 'KEY_Q').foreStyles[0].key)
  const styled = updateBdaStyle(updateBdaStyle(added.bytes, added.ref, 'CONTENT_TEXT', '删'), added.ref, 'FONT_SIZE', '40')
  const withText = edit(styled, (source) => { source.keys.KEY_F36.foreStyles.push(added.ref) })
  const layers = key(withText, 'KEY_F36').foreStyles
  assert.deepEqual(layers.map((ref) => ref.type), ['image', 'text'])
  const text = decodeBdaAppearanceUncached(withText).textStyles.get(layers[1].key)
  assert.equal(text.contentText, '删')
  assert.equal(text.fontSize, 40)
  assert.deepEqual(key(withText, 'KEY_Q'), key(original, 'KEY_Q'), 'other keys are untouched')
  const removed = edit(withText, (source) => { source.keys.KEY_F36.foreStyles.pop() })
  assert.deepEqual(key(removed, 'KEY_F36').foreStyles, key(original, 'KEY_F36').foreStyles)
})

test('emptying a BDA text style’s content removes the field', () => {
  const ref = key(original, 'KEY_Q').foreStyles[0]
  const bytes = updateBdaStyle(original, ref, 'CONTENT_TEXT', '')
  assert.equal(decodeBdaAppearanceUncached(bytes).textStyles.get(ref.key).contentText, undefined)
})


test('BDA bulk replacement changes only matching style references, including across panels', () => {
  const before = decodeBdaAppearanceUncached(original)
  const from = key(original, 'KEY_Q').backStyle
  const to = addBdaStyle(original, from.type, from.key)
  const after = decodeBdaAppearanceUncached(replaceBdaStyleReferences(to.bytes, from, to.ref))
  let count = 0
  for (const [panelName, panel] of before.panels) {
    for (const [name, beforeKey] of panel.keys) {
      const expected = [beforeKey.backStyle, ...beforeKey.foreStyles, beforeKey.backStyleState].map(ref => {
        if (ref?.type !== from.type || ref.key !== from.key) return ref
        count++
        return to.ref
      })
      const updated = after.panels.get(panelName).keys.get(name)
      assert.deepEqual([updated.backStyle, ...updated.foreStyles, updated.backStyleState], expected)
    }
  }
  assert.ok(count > 1, 'fixture has shared key styles')
  assert.deepEqual(after.imageStyles.get(from.key), before.imageStyles.get(from.key))
})
