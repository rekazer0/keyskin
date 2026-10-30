import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import { keyAnimationStyles, paddedRect, previewItems, previewSurfaceHeight } from "../src/preview-items.ts"

test('keys below PANEL.SIZE extend the preview surface (Xiaomi bottom bar)', () => {
  const document = IniDocument.parse([
    '[KEY1]', 'VIEW_RECT=187,1,230,135', 'CENTER=a',
    '[KEY50]', 'FORE_STYLE=695', 'VIEW_RECT=101,580,120,120', 'CENTER=F16',
    '[KEY51]', 'FORE_STYLE=696', 'VIEW_RECT=857,579,120,120', 'CENTER=F76',
  ].join('\n'))
  const items = previewItems(document, 1080, 585)
  assert.ok(items.some((item) => item.section === 'KEY50'))
  assert.equal(previewSurfaceHeight(items, 585), 700)
})

test('a layout inside the panel keeps the panel height', () => {
  const document = IniDocument.parse('[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=a\n')
  assert.equal(previewSurfaceHeight(previewItems(document, 1080, 585), 585), 585)
})

test('iOS FIX_SIZE uses points while its touch rectangle uses skin pixels', () => {
  const document = IniDocument.parse('[CAND]\n[ICON1]\nFORE_STYLE=151\nSIZE=130,130\nFIX_SIZE=33,33\nANCHOR_TYPE=1\nPOS=30,0\nKEY=F31\n')
  const icon = previewItems(document, 1125, 115).find(({ section }) => section === 'ICON1')
  assert.deepEqual(icon.rect, { x: 30, y: 0, width: 130, height: 130 })
  assert.deepEqual(icon.foreRect, { x: 45.5, y: 15.5, width: 99, height: 99 })
})

test('key PADDING (left,top,right,bottom) insets where the key is painted, never below zero', () => {
  const document = IniDocument.parse('[KEY1]\nVIEW_RECT=688,155,250,143\nPADDING=10,20,30,40\nCENTER=a\n[KEY2]\nVIEW_RECT=0,0,250,143\nPADDING=0,230,0,0\nCENTER=b\n')
  const [first, second] = previewItems(document, 1125, 595)
  assert.deepEqual(first.rect, { x: 688, y: 155, width: 250, height: 143 })
  assert.deepEqual(paddedRect(first), { x: 698, y: 175, width: 210, height: 83 })
  assert.equal(paddedRect(second).height, 0)
})

// 按键的 PRESS_STYLE（如 STYLE1822 → PRESS_ANIM 粒子）在真机上按下即播放，和 ANIM_STYLE 系列一起算。
test('a key plays its PRESS_STYLE along with its animation styles', () => {
  const document = IniDocument.parse(['[KEY1]', 'VIEW_RECT=0,0,100,100', 'CENTER=a', 'BACK_ANIM_STYLE=820', 'FORE_ANIM_STYLE=821,822', 'PRESS_STYLE=1822'].join('\n'))
  assert.deepEqual(keyAnimationStyles(previewItems(document, 1080, 585)[0]), ['820', '821', '822', '1822'])
})
