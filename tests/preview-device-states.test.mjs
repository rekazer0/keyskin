import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { effectivePanelSection, stateTipSection } from '../src/panel-tools.ts'
import { effectivePreviewHitItem, effectivePreviewItem, previewItems, previewStateImpact, visiblePreviewItems } from '../src/preview-items.ts'
import { bdaLayoutDocument } from '../src/bda.ts'
import { decodeBdaAppearance } from '../src/bda-decode.ts'

const template = (name) => SkinArchive.open(new Uint8Array(readFileSync(new URL(`../public/${name}`, import.meta.url))))

test('S0 layering never activates its TIP, while voice, layout and explicit states still resolve', () => {
  for (const state of [undefined, 0, 4, 27]) assert.equal(stateTipSection('S0_1', state), undefined)
  assert.equal(stateTipSection('S0_1|S36_2', undefined), 2)
  assert.equal(stateTipSection('S0_1|S67_3', 0), 3)
  assert.equal(stateTipSection('S0_1|S27_4', 27), 4)
  assert.equal(stateTipSection('S34_7|S0_1', 34), 7)
})

test('S0 duplicate keys retain their original artwork, actions and animation bindings', () => {
  const document = IniDocument.parse('[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=q\nFORE_STYLE=1\nSTAT_STYLE=S0_1\n[KEY2]\nVIEW_RECT=0,0,100,100\nCENTER=q\nFORE_STYLE=1\nBACK_ANIM_STYLE=8\n[KEY3]\nVIEW_RECT=100,0,100,100\nCENTER=F39\nFORE_STYLE=2\nSTAT_STYLE=S27_2|S0_1\n[KEY4]\nVIEW_RECT=100,0,100,100\nCENTER=F39\nFORE_STYLE=2\n[KEY5]\nVIEW_RECT=200,0,100,100\nCENTER=w\nFORE_STYLE=3\nSTAT_STYLE=S0_1\n[TIP1]\nFORE_STYLE=99\nCENTER=F39\nBACK_ANIM_STYLE=99\n[TIP2]\nFORE_STYLE=4\nSHOW=发送\n')
  const before = document.toString()
  const items = previewItems(document)
  for (const state of [undefined, 0]) {
    const visible = visiblePreviewItems(items, state).map(item => effectivePreviewItem(document, item, state))
    assert.deepEqual(visible.map(item => item.section), ['KEY2', 'KEY4', 'KEY5'])
    assert.deepEqual(visible.map(item => item.center), ['q', 'F39', 'w'])
    assert.deepEqual(visible.map(item => item.foreStyle), ['1', '2', '3'])
    assert.equal(visible[0].backAnimStyle, '8')
    assert.deepEqual(visible[0].sections, ['KEY1', 'KEY2'])
    assert.equal(effectivePanelSection(document, 'KEY1', state), 'KEY1')
    const hit = effectivePreviewHitItem(document, items, { x: 50, y: 50 }, 'preview', 300, 100, state)
    assert.equal(hit.center, 'q')
    assert.equal(hit.foreStyle, '1')
  }
  const sending = visiblePreviewItems(items, 27).map(item => effectivePreviewItem(document, item, 27))
  assert.deepEqual(sending.map(item => item.foreStyle), ['1', '4', '3'])
  assert.equal(sending[1].show, '发送')
  assert.equal(effectivePanelSection(document, 'KEY3', 27), 'TIP2')
  assert.deepEqual(previewStateImpact(document, 0), { mapped: false, resolved: false })
  assert.deepEqual(previewStateImpact(document, 27), { mapped: true, resolved: true })
  assert.equal(document.toString(), before)
})

test('the space key shows its S36 variant (Baidu default: long-press voice on) unless a voice state is chosen', () => {
  const statStyle = 'S34_7|S36_8|S37_9'
  assert.equal(stateTipSection(statStyle, undefined), 8)
  assert.equal(stateTipSection(statStyle, 27), 8)
  assert.equal(stateTipSection(statStyle, 34), 7)
  assert.equal(stateTipSection('S34_7|S37_9', 34), 7)
  assert.equal(stateTipSection('S34_7|S37_9', undefined), undefined)
})

test('the first written state that holds picks the TIP, and a TIP does not switch again (KeyParam.J)', () => {
  const layout = IniDocument.parse(template('templates/xiaomi-unified-rounded-blur.bds').getText('light/skin/port/py_9.ini'))
  const enter = layout.get('KEY12', 'STAT_STYLE')
  // 官方 APK 未找到 S99 的启用来源；显式选中 S99 时仍可预览厂商变体。
  assert.equal(stateTipSection(enter, undefined), undefined)
  assert.equal(stateTipSection(enter, 99), 18)
  // S27 写在 S99 之前，先命中 TIP3；TIP3 自己的 STAT_STYLE=S99_21 不再生效。
  assert.equal(stateTipSection(enter, 27), 3)
  assert.equal(stateTipSection(layout.get('KEY10', 'STAT_STYLE'), undefined), 8)
  assert.equal(stateTipSection('S36_8|S4_9', 4), 8)
})

test('BDA state keys place foregrounds relative to the key they belong to', () => {
  const archive = template('default-template.bda')
  const base = IniDocument.parse(template('bda-base.bds').getText('light/skin/port/py_9.ini'))
  const appearance = decodeBdaAppearance(archive.getBytes('light/skin/port/appearanceConfig'))
  const layout = bdaLayoutDocument(base, appearance, 'py_9.ini')
  const space = layout.sections().find((section) => /^KEY\d+$/.test(section) && layout.get(section, 'CENTER') === 'F38')
  const tip = stateTipSection(layout.get(space, 'STAT_STYLE'), undefined)
  // The "0" label of KEY_F38_S36 sits above the microphone, not on top of it.
  const offsets = layout.get(`TIP${tip}`, 'FORE_OFFSET').split(';').map((pair) => pair.split(',').map(Number))
  assert.ok(offsets.some(([, y]) => y < -20), layout.get(`TIP${tip}`, 'FORE_OFFSET'))
})

test('official phone defaults enable fusion layout S67, but not Cangjie mode S35 or OEM S99', () => {
  assert.equal(stateTipSection('S35_1|S99_2|S67_3', undefined), 3)
  assert.equal(stateTipSection('S35_1|S99_2', undefined), undefined)
  assert.equal(stateTipSection('S35_1|S67_3', 35), 1)
  assert.equal(stateTipSection('S99_2|S67_3', 99), 2)
})
