// 渲染投影：面板高度、内边距、动画样式都从 IR 的按键容器与布局树得出。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBoard } from '../src/skin-model/build.ts'
import { absoluteBoard } from '../src/skin-model/layout.ts'
import { emptyModel } from '../src/skin-model/model.ts'
import { keyAnimationStyles, paddedRect } from '../src/preview-items.ts'
import { box, rectOf } from './helpers/boxes.mjs'

/** 一块板，按键几何都落在布局树里。 */
async function boardOf(keys) {
  const model = emptyModel({ appearance: 'light', orientation: 'port' })
  const size = { width: 1080, height: 585 }
  model.boards.push({
    id: 'board',
    kind: 'main',
    geometry: 'document',
    orientation: 'port',
    size,
    layout: absoluteBoard(keys.map((key) => ({ id: key.id, ...box(key.rect[0], key.rect[1], key.rect[2], key.rect[3]) }))),
    keys: keys.map((key) => ({
      id: key.id,
      actions: {},
      ...(key.padding ? { padding: { left: key.padding[0], top: key.padding[1], right: key.padding[2], bottom: key.padding[3] } } : {}),
      container: {
        back: { style: '1', ...(key.backAnim ? { anim: key.backAnim } : {}) },
        fore: (key.fore ?? []).map((style, index) => ({
          style,
          ...(key.foreAnim?.[index] ? { anim: key.foreAnim[index] } : {}),
        })),
        ...(key.press ? { press: key.press } : {}),
      },
    })),
  })
  return { model, size, renders: await buildBoard(model, model.boards[0]) }
}

test('按键的矩形来自布局树，落在板外就把面板撑高', async () => {
  const { renders, size } = await boardOf([
    { id: 'KEY1', rect: [187, 1, 230, 135] },
    { id: 'KEY50', rect: [101, 580, 120, 120] },
    { id: 'KEY51', rect: [857, 579, 120, 120] },
  ])
  assert.equal(renders.length, 3)
  const surface = Math.max(size.height, ...renders.map((render) => render.rect.y + render.rect.height))
  assert.equal(surface, 700)
})

test('板内的布局保持面板高度', async () => {
  const { renders, size } = await boardOf([{ id: 'KEY1', rect: [0, 0, 100, 100] }])
  const surface = Math.max(size.height, ...renders.map((render) => render.rect.y + render.rect.height))
  assert.equal(surface, 585)
})

test('PADDING 只缩绘制区域，不缩按键矩形，也不低于零', async () => {
  const { renders } = await boardOf([
    { id: 'KEY1', rect: [688, 155, 250, 143], padding: [10, 20, 30, 40] },
    { id: 'KEY2', rect: [0, 0, 250, 143], padding: [0, 230, 0, 0] },
  ])
  const [first, second] = renders
  assert.deepEqual(first.rect, { x: 688, y: 155, width: 250, height: 143 })
  assert.deepEqual(paddedRect(first), { x: 698, y: 175, width: 210, height: 83 })
  assert.equal(paddedRect(second).height, 0)
})

// PRESS_STYLE（如 STYLE1822 → PRESS_ANIM 粒子）在真机上按下即播放，和 ANIM_STYLE 系列一起算。
test('按键的按压效果与各层动画一起参与播放', async () => {
  const { renders } = await boardOf([
    { id: 'KEY1', rect: [0, 0, 100, 100], backAnim: '820', fore: ['1', '2'], press: '1822' },
  ])
  assert.deepEqual(keyAnimationStyles(renders[0]), ['820', '1822'])
})

test('前景动画的空位保留层索引', async () => {
  const { renders } = await boardOf([
    { id: 'KEY1', rect: [0, 0, 100, 100], fore: ['1', '2', '3'], foreAnim: ['', '821', ''] },
  ])
  assert.deepEqual(renders[0].container.fore.map((layer) => layer.anim), [undefined, '821', undefined])
  assert.deepEqual(renders[0].animStyles, ['821'])
})
