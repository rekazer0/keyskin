import test from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import { previewItems } from '../src/preview-items.ts'
import { PalmBoard } from '../src/palm/palm-board.ts'
import { palmHint } from '../src/palm/palm-scene.ts'
import { isLegacyHintInputKey, legacyHintCandidates, legacyHintHasHold, legacyHintIconID, legacyHintSelectedIndex, legacyHintText, parseLegacyHint } from '../src/preview-hints.ts'

const key = previewItems(IniDocument.parse('[KEY1]\nVIEW_RECT=0,0,214,148\nLEFT=j\nCENTER=k\nRIGHT=l\nUP=5\nDOWN=F44\n'))[0]
const hint = parseLegacyHint(IniDocument.parse('[BAR]\nBACK_ICON=1\nCELL_STYLE=24\nCELL_SIZE=90,115\n[ICON1]\nSIZE=120,180\nPOS=0,-20\nPADDING=30,32,30,32\n'))

test('Baidu keys without HOLD or HOLDSYM expose their implicit long-press characters', () => {
  const candidates = legacyHintCandidates(key, 'hold', true)
  assert.deepEqual(candidates, ['J', 'K', 'L', '5', 'j', 'k', 'l'])
  assert.equal(legacyHintSelectedIndex(key, candidates), 3)
  assert.equal(legacyHintHasHold(key, hint, true), true)
  assert.equal(legacyHintHasHold(key, hint, false), false, 'default generation remains opt-in')
  assert.equal(legacyHintHasHold(key, undefined, true), false, 'missing bubbles do not swallow normal key presses')
  assert.equal(legacyHintHasHold({ ...key, center: 'F1' }, hint, true), false)
})

test('explicit hold actions override defaults and preserve symbol order', () => {
  const symbols = { ...key, holdSymbols: ',|？' }
  assert.deepEqual(legacyHintCandidates(symbols, 'hold', true), [',', '|', '？'])
  assert.equal(legacyHintSelectedIndex(symbols, [',', '|', '？']), 0)
  assert.deepEqual(legacyHintCandidates({ ...key, hold: 'F1' }, 'hold', true), [])
  assert.equal(legacyHintHasHold({ ...key, hold: 'F1' }, hint, true), true)
  assert.deepEqual(legacyHintCandidates({ ...key, left: '', right: '', center: 'a', up: '1', down: 'a' }, 'hold', true), ['A', '1', 'a'])
})

test('bar-only skins keep tap bubbles hidden and retain authored cell dimensions', () => {
  assert.equal(legacyHintIconID(hint, 'center'), undefined)
  assert.deepEqual(hint.cellSize, [90, 115])
  assert.deepEqual(hint.icons.get('1').padding, [30, 32, 30, 32])
  assert.equal(legacyHintIconID({ ...hint, upIcon: '1' }, 'center'), undefined, 'a swipe bubble is not a tap bubble')
})

test('18-key page actions and state codes never become bubble characters', () => {
  const y = { ...key, left: '', right: '', center: 'y', up: '3', down: 'Z+9tool4' }
  assert.deepEqual(legacyHintCandidates(y, 'hold', true), ['Y', '3', 'y'])
  assert.equal(legacyHintSelectedIndex(y, ['Y', '3', 'y']), 1)
  assert.equal(legacyHintText(y, 'down'), '')
  for (const code of ['Z+9tool4', 'Z+26tool', 'F44', 'F999', 'S4', 'S11_2']) {
    const actionKey = { ...y, down: code, hold: code }
    assert.deepEqual(legacyHintCandidates(actionKey, 'up'), ['3', 'y'])
    assert.deepEqual(legacyHintCandidates(actionKey, 'hold', true), [])
    assert.equal(legacyHintText(actionKey, 'hold'), '')
    assert.equal(isLegacyHintInputKey({ ...actionKey, center: code }), false)
  }
  assert.deepEqual(legacyHintCandidates({ ...y, holdSymbols: 'Z+🙂' }, 'hold', true), ['Z', '+', '🙂'], 'HOLDSYM remains literal text')
})

test('Palm bubbles retain per-icon cell styles and dimensions alongside the shared defaults', () => {
  const model = palmHint({ info: [0, 1, 1, 2], i_cell: 24, icon_info: {
    1: { size: [100, 120], b: { base_b: 23, base_f: [21] } },
    2: { size: [120, 160], c_size: [60, 32], i_cell: 25, pos: [0, -30], insets: { left: 4, top: 6, right: 8, bottom: 10 } },
    3: { size: [-1, 10] },
  } })
  assert.equal(model.defaultCandidates, true)
  assert.equal(model.holdIcon, '1')
  assert.equal(model.barIcon, '2')
  assert.equal(model.cellStyle, '24')
  assert.equal(model.icons.get('2').cellStyle, '25')
  assert.deepEqual(model.icons.get('2').cellSize, [60, 32])
  assert.deepEqual(model.icons.get('2').padding, [4, 6, 8, 10])
  assert.equal(model.icons.has('3'), false)
  assert.equal(legacyHintHasHold(key, model, model.defaultCandidates), true)
})

test('Palm reads global referenced bubbles and board-local inline bubbles without modifying the skin', () => {
  const referenced = { info: [0, 1], icon_info: { 1: { size: [100, 120] } } }
  const skin = { default: { port_layout: {
    b: { defaultGlobal: { hint: { file: 'hint1' } }, t9Pinyin: {}, full26Pinyin: { hint: { ...referenced, i_cell: 25 } } },
    h: { hint1: referenced },
  } } }
  const before = JSON.stringify(skin)
  const global = new PalmBoard(skin, 'default', 'port', 't9Pinyin').hint
  assert.deepEqual(global.icon_info, referenced.icon_info)
  assert.equal(palmHint(global).holdIcon, '1')
  const inline = new PalmBoard(skin, 'default', 'port', 'full26Pinyin').hint
  assert.equal(palmHint(inline).cellStyle, '25')
  assert.equal(JSON.stringify(skin), before)
})

test('four-letter nine-key groups keep all upper and lower case long-press characters', () => {
  const key = { center: 'q', left: 'p', right: 'r', down: 's', up: '7', hold: '', holdSymbols: '' }
  assert.deepEqual(legacyHintCandidates(key, 'hold', true), ['P', 'Q', 'R', 'S', '7', 'p', 'q', 'r', 's'])
})
