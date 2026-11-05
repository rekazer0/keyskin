// 字体烘焙（src/font-bake.ts）：百度安卓按系统字体画按键文字，BDS 把按键上的 SHOW 文字烘焙成图片。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import {
  BAKED_IMAGE,
  bakeableStyles,
  bakedImageBase,
  bakedTileText,
  keyForegroundStyleIDs,
  layoutsUsingStyle,
  packTiles,
  withBakedStyles,
  withoutBakedStyles,
} from '../src/font-bake.ts'

const css = [
  '[GLOBAL]',
  'FONT_PATH=W5.ttf',
  '[STYLE1]',
  'SHOW=ABC',
  'FONT_SIZE=28',
  'NM_COLOR=63666c',
  'HL_COLOR=FFFFFF',
  'PRESS_ANIM=3',
  '[STYLE2]',
  'SHOW=DEF',
  'NM_IMG=fore1,2',
  '[STYLE3]',
  'SHOW=unused',
  '[STYLE4]',
  'FONT_SIZE=20',
  '[STYLE5]',
  'SHOW=GHI',
  '',
].join('\r\n')

const layout = [
  '[PANEL]',
  '[CAND]',
  'FORE_STYLE=4',
  '[KEY1]',
  'FORE_STYLE=1,5',
  '[KEY2]',
  'FORE_STYLE=2',
  '',
].join('\n')

test('only key foreground styles are collected, not candidate styles', () => {
  assert.deepEqual([...keyForegroundStyleIDs([layout])].sort(), ['1', '2', '5'])
})

test('bakeable styles are referenced text styles without images', () => {
  const styles = bakeableStyles(css, keyForegroundStyleIDs([layout]))
  assert.deepEqual(styles.map(({ id }) => id), ['1', '5'])
  assert.deepEqual(styles[0].fields, { SHOW: 'ABC', FONT_SIZE: '28', NM_COLOR: '63666c', HL_COLOR: 'FFFFFF' })
})

test('baking swaps text fields for images and keeps the original as BAKED_*', () => {
  const baked = IniDocument.parse(withBakedStyles(css, [{ id: '1', normal: 1, highlight: 2 }]))
  assert.equal(baked.get('STYLE1', 'SHOW'), undefined)
  assert.equal(baked.get('STYLE1', 'NM_COLOR'), undefined)
  assert.equal(baked.get('STYLE1', 'BAKED_SHOW'), 'ABC')
  assert.equal(baked.get('STYLE1', 'BAKED_HL_COLOR'), 'FFFFFF')
  assert.equal(baked.get('STYLE1', 'NM_IMG'), `${BAKED_IMAGE},1`)
  assert.equal(baked.get('STYLE1', 'HL_IMG'), `${BAKED_IMAGE},2`)
  assert.equal(baked.get('STYLE1', 'PRESS_ANIM'), '3')
  assert.equal(baked.get('GLOBAL', 'FONT_PATH'), 'W5.ttf')
})

test('baked styles are baked again with a new font, even when no longer referenced', () => {
  const baked = withBakedStyles(css, [{ id: '1', normal: 1, highlight: 2 }])
  const styles = bakeableStyles(baked, new Set(['5']))
  assert.deepEqual(styles.map(({ id }) => id), ['1', '5'])
  assert.equal(styles[0].fields.SHOW, 'ABC')
  const rebaked = IniDocument.parse(withBakedStyles(baked, [{ id: '1', normal: 3, highlight: 3 }]))
  assert.equal(rebaked.get('STYLE1', 'BAKED_SHOW'), 'ABC')
  assert.equal(rebaked.get('STYLE1', 'NM_IMG'), `${BAKED_IMAGE},3`)
})

test('removing the bake restores the original style', () => {
  const baked = withBakedStyles(css, [{ id: '1', normal: 1, highlight: 2 }, { id: '5', normal: 3, highlight: 3 }])
  const restored = IniDocument.parse(withoutBakedStyles(baked))
  for (const [key, value] of [['SHOW', 'ABC'], ['FONT_SIZE', '28'], ['NM_COLOR', '63666c'], ['HL_COLOR', 'FFFFFF'], ['PRESS_ANIM', '3']]) {
    assert.equal(restored.get('STYLE1', key), value)
  }
  assert.equal(restored.get('STYLE1', 'NM_IMG'), undefined)
  assert.equal(restored.get('STYLE1', 'BAKED_SHOW'), undefined)
  assert.equal(restored.get('STYLE2', 'NM_IMG'), 'fore1,2')
  assert.equal(withoutBakedStyles(css), undefined)
})

test('tiles are packed in rows and listed in the .til', () => {
  const { rects, width, height } = packTiles([{ width: 600, height: 40 }, { width: 600, height: 30 }, { width: 100, height: 20 }])
  assert.deepEqual(rects, [[0, 0, 600, 40], [0, 42, 600, 30], [602, 42, 100, 20]])
  assert.equal(width, 702)
  assert.equal(height, 72)
  const tiles = IniDocument.parse(bakedTileText(rects))
  assert.equal(tiles.get('GLOBAL', 'TILE_NUM'), '3')
  assert.equal(tiles.get('IMG2', 'SOURCE_RECT'), '0,42,600,30')
})

test('layouts resolve to their orientation CSS, falling back to the skin res CSS', () => {
  const names = [
    'light/skin/port/res/default.css',
    'light/skin/res/default.css',
    'light/skin/port/py_9.ini',
    'light/skin/land/py_9.ini',
    'dark/skin/port/py_9.ini',
  ]
  assert.deepEqual(layoutsUsingStyle(names, 'light/skin/port/res/default.css'), ['light/skin/port/py_9.ini'])
  assert.deepEqual(layoutsUsingStyle(names, 'light/skin/res/default.css'), ['light/skin/land/py_9.ini'])
  assert.equal(bakedImageBase('light/skin/port/res/default.css'), `light/skin/port/res/${BAKED_IMAGE}`)
})
