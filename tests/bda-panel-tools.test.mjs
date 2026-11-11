import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { adaptBdaForIos26 } from '../src/bda-ios26.ts'
import { applyBdaLayoutImage } from '../src/bda-layout-image.ts'
import { decodeBdaAppearance } from '../src/bda-decode.ts'
import { planLayoutImage } from '../src/layout-image.ts'
import { applyDecodedBdaAppearancePart, decodedBdaAppearancePart } from '../src/bda-source.ts'
import { addBdaStyle, updateBdaStyle, rawFields, encodedField, encodeVarint, join, removeFields, updateStringMapValue } from '../src/bda-encode.ts'
import { decodePng } from '../src/ssf/ssf-png.ts'

const archive = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/default-template.bda', import.meta.url))), 'bda')
const path = 'light/skin/port/appearanceConfig'
const original = archive.getBytes(path)
const panelName = 'py_26'
const appearance = decodeBdaAppearance(original)
const part = { kind: 'panel', name: panelName }
const editPanel = (bytes, change) => {
  const value = JSON.parse(decodedBdaAppearancePart(bytes, part))
  change(value)
  return applyDecodedBdaAppearancePart(path, bytes, JSON.stringify(value), part)
}
const unknown = encodedField(1000, 0, encodeVarint(178))
const getUnknown = (bytes) => rawFields(bytes).filter((field) => field.number === 1000).map((field) => [...bytes.slice(field.start, field.end)])
const keys = [{ section: 'KEY1', rect: [0, 0, 100, 100] }]
const names = new Map([['KEY1', 'KEY_Q']])
const plan = (target) => planLayoutImage(target, keys, IniDocument.parse(''), 1080, 600)
const replace = (target, bytes = original, keyMap = names) => applyBdaLayoutImage(path, bytes, panelName, plan(target), keyMap, 'replacement')
const key = (decoded, name = 'KEY_Q') => decoded.panels.get(panelName).keys.get(name)

test('BDA iOS 26 adapts keyboard, whole, input and candidate backgrounds without changing keys; it is idempotent', () => {
  for (const config of archive.names().filter((name) => /appearanceConfig$/.test(name))) {
    const before = archive.getBytes(config)
    const input = join([before, unknown])
    const adapted = adaptBdaForIos26(input)
    const decoded = decodeBdaAppearance(adapted)
    for (const [name, panel] of decoded.panels) {
      const old = decodeBdaAppearance(before).panels.get(name)
      if (/^(?:(?:py|def|en|num|tool)_.+|bh|hw_(?:full|grid)|symbol|email|url|net|sym_26_cn|sym_26_en)$/.test(name)) {
        assert.equal(decoded.colorStyles.get(panel.backStyle.key).normalColor, 0x01d0d4db, name)
        if (old.wholeBackStyle) assert.equal(decoded.colorStyles.get(panel.wholeBackStyle.key).normalColor, 0x01d0d4db)
        if (old.inputRegionBackStyle) assert.equal(decoded.colorStyles.get(panel.inputRegionBackStyle.key).normalColor, 0x00d0d4db)
      } else {
        assert.deepEqual(panel.backStyle, old.backStyle, `${name} keeps its panel background`)
        assert.deepEqual(panel.wholeBackStyle, old.wholeBackStyle)
      }
      assert.deepEqual(panel.keys, old.keys)
      if (panel.cand) assert.equal(decoded.colorStyles.get(panel.cand.candBarStyle.key).normalColor, 0x00d0d4db)
    }
    assert.deepEqual(getUnknown(adapted), [[...unknown]])
    assert.strictEqual(adaptBdaForIos26(adapted), adapted)
  }
})

test('BDA iOS 26 keeps unknown fields inside panel and candidate messages', () => {
  const input = updateStringMapValue(original, 4, panelName, (panel) => {
    const cand = rawFields(panel).find((field) => field.number === 4)
    return join([removeFields(panel, new Set([4])), encodedField(4, 2, join([cand.bytes, unknown])), unknown])
  })
  const adapted = adaptBdaForIos26(input)
  const entry = rawFields(adapted).find((field) => field.number === 4 &&
    new TextDecoder().decode(rawFields(field.bytes).find((item) => item.number === 1).bytes) === panelName)
  const panel = rawFields(entry.bytes).find((field) => field.number === 2).bytes
  assert.deepEqual(getUnknown(panel), [[...unknown]])
  assert.deepEqual(getUnknown(rawFields(panel).find((field) => field.number === 4).bytes), [[...unknown]])
})

test('BDA image replacement isolates shared styles, keeps the opposite state and uses standalone PNGs', () => {
  const beforeKey = key(appearance)
  for (const target of ['key-normal', 'key-highlight']) {
    const result = replace(target, join([original, unknown]))
    const after = decodeBdaAppearance(result.bytes)
    const owner = key(after)
    assert.notDeepEqual(owner.backStyle, beforeKey.backStyle)
    assert.deepEqual(after.imageStyles.get(beforeKey.backStyle.key), appearance.imageStyles.get(beforeKey.backStyle.key))
    const image = after.imageStyles.get(owner.backStyle.key)
    const state = target === 'key-normal' ? 'normalImage' : 'highlightImage'
    const other = target === 'key-normal' ? 'highlightImage' : 'normalImage'
    assert.equal(image[state].resource.type, 0)
    assert.equal(image[state].resource.resourceID, 'replacement_1')
    assert.equal(image[state].innerRect, undefined, 'innerRect must not encode atlas cropping')
    assert.equal(image[state].contentInset, undefined)
    assert.equal(image[state].filterColor, undefined)
    const old = appearance.imageStyles.get(beforeKey.backStyle.key)
    assert.deepEqual(image[other], old[other] ?? old.normalImage)
    assert.deepEqual(after.panels.get('py_9'), appearance.panels.get('py_9'))
    assert.deepEqual(getUnknown(result.bytes), [[...unknown]])
  }
})

test('BDA key highlight replacement respects a separate state background', () => {
  const before = editPanel(original, (source) => { source.keys.KEY_Q.backStyleState = source.keys.KEY_Q.backStyle })
  const old = decodeBdaAppearance(before)
  const after = decodeBdaAppearance(replace('key-highlight', before).bytes)
  assert.deepEqual(key(after).backStyle, key(old).backStyle)
  assert.notDeepEqual(key(after).backStyleState, key(old).backStyleState)
  assert.equal(after.imageStyles.get(key(after).backStyleState.key).highlightImage.resource.resourceID, 'replacement_1')
})

test('BDA color key replacement preserves the other state as a solid PNG', () => {
  const added = addBdaStyle(original, 'color')
  const colored = updateBdaStyle(updateBdaStyle(added.bytes, added.ref, 'NM_COLOR', '80776655'), added.ref, 'HL_COLOR', 'ff332211')
  const before = editPanel(colored, (source) => { source.keys.KEY_Q.backStyle = added.ref })
  for (const target of ['key-normal', 'key-highlight']) {
    const result = replace(target, before)
    const after = decodeBdaAppearance(result.bytes)
    const image = after.imageStyles.get(key(after).backStyle.key)
    const other = target === 'key-normal' ? image.highlightImage : image.normalImage
    assert.deepEqual([...decodePng(result.resources.get(other.resource.resourceID)).data], target === 'key-normal' ? [0x33, 0x22, 0x11, 255] : [0x77, 0x66, 0x55, 128])
  }
})

test('BDA foreground replacement appends a layer with zero offset and a transparent normal for pressed-only', () => {
  for (const target of ['fore-normal', 'fore-highlight']) {
    const result = replace(target)
    const decoded = decodeBdaAppearance(result.bytes)
    const owner = key(decoded)
    assert.deepEqual(owner.foreStyles.slice(0, -1), key(appearance).foreStyles)
    assert.deepEqual(owner.foreStyleOffsets.slice(0, -1), key(appearance).foreStyleOffsets)
    assert.deepEqual(owner.foreStyleOffsets.at(-1), { x: 0, y: 0 })
    const image = decoded.imageStyles.get(owner.foreStyles.at(-1).key)
    if (target === 'fore-highlight') {
      assert.equal(image.highlightImage.resource.resourceID, 'replacement_1')
      assert.equal(decodePng(result.resources.get(image.normalImage.resource.resourceID)).data[3], 0)
    } else assert.equal(image.normalImage.resource.resourceID, 'replacement_1')
  }
})

test('BDA panel background replaces both platform background slots, candidate applies across this appearance', () => {
  const before = editPanel(original, (source) => { source.wholeBackStyle = source.backStyle })
  const panel = decodeBdaAppearance(replace('panel', before).bytes).panels.get(panelName)
  assert.deepEqual(panel.backStyle, panel.wholeBackStyle)
  const after = decodeBdaAppearance(replace('candidate').bytes)
  const refs = [...after.panels.values()].map((panel) => panel.cand.candBarStyle)
  assert.ok(refs.every((ref) => ref.key === refs[0].key && ref.type === 'image'))
  assert.deepEqual(after.imageStyles.get(refs[0].key).normalImage.resource.resourceID, 'replacement_1')
})

test('BDA replacement creates a missing native key and targets an explicit state key only', () => {
  const sparse = editPanel(original, (source) => { source.keys.KEY_Q.backStyle = undefined })
  const added = decodeBdaAppearance(replace('key-normal', sparse, new Map([['KEY1', 'KEY_NEW']])).bytes)
  assert.equal(added.imageStyles.get(key(added, 'KEY_NEW').backStyle.key).normalImage.resource.resourceID, 'replacement_1')
  const state = [...appearance.panels.get(panelName).keys.keys()].find((name) => /_S\d+$/.test(name))
  const after = decodeBdaAppearance(replace('key-normal', original, new Map([['KEY1', state]])).bytes)
  assert.notDeepEqual(key(after, state).backStyle, key(appearance, state).backStyle)
  assert.deepEqual(key(after), key(appearance))
})


test('BDA iOS 26 creates missing input and candidate backgrounds on a sparse keyboard', () => {
  const sparse = updateStringMapValue(original, 4, panelName, (panel) => removeFields(panel, new Set([4, 5, 7, 10])))
  const result = adaptBdaForIos26(sparse)
  const decoded = decodeBdaAppearance(result)
  const panel = decoded.panels.get(panelName)
  assert.equal(decoded.colorStyles.get(panel.backStyle.key).normalColor, 0x01d0d4db)
  assert.equal(decoded.colorStyles.get(panel.cand.candBarStyle.key).normalColor, 0x00d0d4db)
  assert.equal(decoded.colorStyles.get(panel.input.backStyle.key).normalColor, 0x00d0d4db)
  assert.strictEqual(adaptBdaForIos26(result), result)
})
