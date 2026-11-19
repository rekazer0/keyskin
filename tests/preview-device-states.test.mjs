import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { effectivePanelSection, stateTipSection } from '../src/panel-tools.ts'
import { buildBoard } from '../src/skin-model/build.ts'
import { absoluteBoard } from '../src/skin-model/layout.ts'
import { emptyModel } from '../src/skin-model/model.ts'
import { bdaLayoutDocument } from '../src/bda.ts'
import { decodeBdaAppearance } from '../src/bda-decode.ts'
import { box } from './helpers/boxes.mjs'

const template = (name) => SkinArchive.open(new Uint8Array(readFileSync(new URL(`../public/${name}`, import.meta.url))))

/** 一块板：按键几何进布局树，样式与动作进容器。 */
function renderKey(id, rect, actions, container) {
  return { id, layoutId: id, rect, actions, container }
}

async function rendersOf(keys, size = { width: 300, height: 100 }) {
  const model = emptyModel({ theme: 'light', orientation: 'port' })
  model.boards.push({
    id: 'board',
    kind: 'main',
    geometry: { kind: 'document' },
    orientation: 'port',
    container: size,
    layout: absoluteBoard(keys.map((key) => ({ id: key.id, ...box(key.rect[0], key.rect[1], key.rect[2], key.rect[3]) }))),
    keys,
  })
  return buildBoard(model, model.boards[0])
}

test('S0 layering never activates its TIP, while voice, layout and explicit states still resolve', () => {
  for (const state of [undefined, 0, 4, 27]) assert.equal(stateTipSection('S0_1', state), undefined)
  assert.equal(stateTipSection('S0_1|S36_2', undefined), 2)
  assert.equal(stateTipSection('S0_1|S67_3', 0), 3)
  assert.equal(stateTipSection('S0_1|S27_4', 27), 4)
  assert.equal(stateTipSection('S34_7|S0_1', 34), 7)
})

test('S0 duplicate keys retain their original artwork, actions and animation bindings', async () => {
  // 同位置、同动作的段在真机上是一个键：KEY1/KEY2 合并，KEY3/KEY4 合并。
  const keys = [
    renderKey('KEY1', [0, 0, 100, 100], { press: { kind: 'text', value: 'q' } }, { fore: [{ style: '1' }] }),
    renderKey('KEY2', [0, 0, 100, 100], { press: { kind: 'text', value: 'q' } }, { back: { style: '1', anim: '8' }, fore: [{ style: '1' }] }),
    renderKey('KEY3', [100, 0, 100, 100], { press: { kind: 'text', value: 'F39' } }, { fore: [{ style: '2' }] }),
    renderKey('KEY4', [100, 0, 100, 100], { press: { kind: 'text', value: 'F39' } }, { fore: [{ style: '2' }] }),
    renderKey('KEY5', [200, 0, 100, 100], { press: { kind: 'text', value: 'w' } }, { fore: [{ style: '3' }] }),
  ]
  const renders = await rendersOf(keys)
  assert.equal(renders.length, 3, '五个段合成三个键')
  assert.deepEqual(renders.map((render) => render.sections), [['KEY1', 'KEY2'], ['KEY3', 'KEY4'], ['KEY5']])
  assert.deepEqual(renders.map((render) => render.foreStyles), [['1'], ['2'], ['3']])
  assert.equal(renders[0].container.back?.anim, '8', '后写的段决定动画')
  assert.deepEqual(renders.map((render) => render.rect), [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 100, y: 0, width: 100, height: 100 },
    { x: 200, y: 0, width: 100, height: 100 },
  ])
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
