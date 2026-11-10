import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import { removeTileSlice, updateTileSlice } from '../src/tiles.ts'
import { legacyHintCandidates, legacyHintText } from "../src/preview-hints.ts"
import { dynamicToolbarRect, persistVisible } from "../src/preview-items.ts"

// 依据《百度手机输入法皮肤工具书 V6》属性表。

test('HOLDSYM is a separator-free character set', () => {
  const key = { up: '', down: '', left: '', right: '', center: 'a', hold: '', holdSymbols: ',?' }
  assert.deepEqual(legacyHintCandidates(key, 'hold'), [',', '?'])
  assert.equal(legacyHintText(key, 'hold'), ',?')
  assert.deepEqual(legacyHintCandidates({ ...key, holdSymbols: '|｜' }, 'hold'), ['|', '｜'])
})

test('CAND icon PERSIST 0/1/2/3', () => {
  assert.deepEqual([undefined, '0', '1', '2', '3'].map((value) => persistVisible(value, false)), [true, false, true, false, true])
  assert.deepEqual([undefined, '0', '1', '2', '3'].map((value) => persistVisible(value, true)), [false, false, false, true, true])
})

test('hidden F14 containers never overlay the authored toolbar icons', () => {
  for (const persist of ['0', '2']) {
    const document = IniDocument.parse(`[ICON1]\nKEY=F14\nSIZE=812,114\nANCHOR_TYPE=5\nPOS=-404,-52\nPERSIST=${persist}\n`)
    assert.equal(dynamicToolbarRect(document, 1125, 119), undefined)
  }
  for (const persist of ['', 'PERSIST=1', 'PERSIST=3']) {
    const document = IniDocument.parse(`[ICON1]\nKEY=F14\nSIZE=812,114\nANCHOR_TYPE=5\nPOS=-404,-52\n${persist}\n`)
    assert.deepEqual(dynamicToolbarRect(document, 1125, 119), { x: 158.5, y: 7.5, width: 812, height: 114 })
  }
})

test('renumberSections closes gaps and keeps IMG0 start', () => {
  const keys = IniDocument.parse('[PANEL]\nKEY_NUM=3\n[KEY1]\nA=1\n[KEY3]\nA=3\n[KEY4]\nA=4\n')
  assert.deepEqual([...keys.renumberSections('KEY')], [['KEY3', 'KEY2'], ['KEY4', 'KEY3']])
  assert.equal(keys.get('KEY3', 'A'), '4')
  const icons = IniDocument.parse('[IMG0]\nX=0\n[IMG2]\nX=2\n')
  icons.renumberSections('IMG')
  assert.deepEqual(icons.sections(), ['IMG0', 'IMG1'])
})

test('tile edits keep TILE_NUM accurate and drop SCALE without INNER_RECT', () => {
  const tiles = IniDocument.parse('[GLOBAL]\nTILE_NUM=1\n[IMG1]\nSOURCE_RECT=0,0,4,4\nINNER_RECT=1,1,2,2\nSCALE=1,1,1,1,1\n')
  updateTileSlice(tiles, { index: 2, source: [4, 0, 4, 4] })
  assert.equal(tiles.get('GLOBAL', 'TILE_NUM'), '2')
  updateTileSlice(tiles, { index: 1, source: [0, 0, 4, 4] })
  assert.equal(tiles.get('IMG1', 'SCALE'), undefined)
  removeTileSlice(tiles, 2)
  assert.equal(tiles.get('GLOBAL', 'TILE_NUM'), '1')
})
