import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { PalmBoard } from '../src/palm/palm-board.ts'

const template = JSON.parse(strFromU8(unzipSync(readFileSync(new URL('../public/templates/palm-harmony.sxi', import.meta.url)))['skin.json']))

test('Harmony candidate bar excludes the separate input-code row in both themes and orientations', () => {
  for (const theme of ['default', 'night']) for (const orientation of ['port', 'land']) {
    const board = new PalmBoard(template, theme, orientation, 't9Pinyin')
    const cand = template[theme][`${orientation}_layout`].b.defaultGlobal.cand
    assert.equal(board.candidateSize.height, cand.rect[1][1] - cand.insets.top)
    const idle = board.candidateItems(undefined, false)
    assert.deepEqual(idle.map(({ section }) => section), ['CAND', 'BUILTIN_TOOLBAR'])
    assert.deepEqual(idle[1].rect, { x: 0, y: 0, ...board.candidateSize })
    assert.deepEqual(board.candidateItems(4, true).map(({ section }) => section), ['CAND'])
  }
})

test('candidate insets follow local overrides and cannot produce a negative bar height', () => {
  const skin = structuredClone(template)
  const cand = skin.default.port_layout.b.defaultGlobal.cand
  skin.default.port_layout.c.cand1.insets = { top: 30 } // Candidate text padding is not an input row.
  cand.rect = [[0, 0], [720, 90]]
  const board = new PalmBoard(skin, 'default', 'port', 't9Pinyin')
  cand.insets = { top: 20 }
  assert.deepEqual(board.candidateSize, { width: 720, height: 70 })
  cand.insets.top = 0
  assert.equal(board.candidateSize.height, 90)
  cand.insets.top = -10
  assert.equal(board.candidateSize.height, 90)
  cand.insets.top = 100
  assert.equal(board.candidateSize.height, 1)
})

test('custom candidate icons do not receive a built-in toolbar, even when hidden while composing', () => {
  const skin = structuredClone(template)
  skin.default.port_layout.c.cand1.icon_list = [{ s: [40, 40], p: [0, 0], keep: 1, b: {} }]
  const board = new PalmBoard(skin, 'default', 'port', 't9Pinyin')
  assert.deepEqual(board.candidateItems(undefined, false).map(({ section }) => section), ['CAND', 'ICON1'])
  assert.deepEqual(board.candidateItems(4, true).map(({ section }) => section), ['CAND'])
})
