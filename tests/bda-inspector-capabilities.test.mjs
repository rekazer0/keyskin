import assert from 'node:assert/strict'
import test from 'node:test'
import { bdaLayoutStyleGroups, NEW_FORE_LAYER } from '../src/bda-layout-styles.ts'

test('BDA inspectors expose only the selected object without materializing source objects', () => {
  const panel = { keys: new Map(), hints: new Map(), lists: new Map() }
  const before = structuredClone(panel)
  const groups = bdaLayoutStyleGroups(panel, [])
  assert.deepEqual(groups.map((group) => group.key), ['panel'])
  const paths = groups.flatMap((group) => group.items.map((item) => item.path.join('.')))
  assert.deepEqual(paths, ['wholeBackStyle', 'backStyle'])
  const candidate = bdaLayoutStyleGroups(panel, [], 'candidate')
  assert.deepEqual(candidate.map((group) => group.key), ['candidate', 'input', 'candidateSwitch', 'candidateKeys', 'candidateMenu'])
  const items = candidate.flatMap((group) => group.items)
  for (const path of ['inputRegionBackStyle', 'input.backStyle', 'input.textStyle', 'cand.candBarStyle', 'cand.switch.selectFore', 'cand.candKeys.CAND_F31.backStyle', 'cand.menuKeys.MENU_PASTE.backStyle', 'cand.aiIcon.foreStyles.0']) assert.ok(items.some((item) => item.path.join('.') === path), path)
  assert.equal(items.find((item) => item.field === 'cellForeStyle').type, 'text')
  assert.equal(items.find((item) => item.path.join('.') === 'cand.aiIcon.foreStyles.0').field, NEW_FORE_LAYER)
  assert.deepEqual(panel, before, 'inspecting does not create candidate, hint, list, or more objects')
})

test('BDA capability rows preserve configured extension names and references', () => {
  const ref = { type: 'image', key: 7 }
  const key = { backStyle: ref, foreStyles: [], foreStyleOffsets: [] }
  const panel = { keys: new Map(), hints: new Map([['custom', { backStyle: ref }]]), lists: new Map([['custom', { backStyle: ref, foreStyles: [] }]]), cand: { candKeys: new Map([['CUSTOM_KEY', key]]), menuKeys: new Map() } }
  const groups = bdaLayoutStyleGroups(panel, [])
  assert.deepEqual(groups.map((group) => group.key), ['panel'])
  assert.equal(groups.some((group) => group.key === 'lists'), false)
  const lists = bdaLayoutStyleGroups(panel, [], 'list')
  assert.deepEqual(lists.find((group) => group.key === 'lists').items.find((item) => item.path.join('.') === 'lists.custom.backStyle').ref, ref)
  assert.ok(lists.flatMap((group) => group.items).every((item) => !item.path.includes('port')), 'no list is invented')
  const candidate = bdaLayoutStyleGroups(panel, [], 'candidate')
  assert.deepEqual(candidate.find((group) => group.key === 'candidateKeys').items.find((item) => item.path.join('.') === 'cand.candKeys.CUSTOM_KEY.backStyle').ref, ref)
  assert.equal(candidate.flatMap((group) => group.items).filter((item) => item.path.join('.') === 'cand.candKeys.CAND_F31.backStyle').length, 1)
  const selected = bdaLayoutStyleGroups(panel, [{ name: 'KEY_Q', key }])
  assert.deepEqual(selected.map((group) => group.key), ['selection'])
  assert.ok(selected[0].items.every((item) => item.path.slice(0, 2).join('.') === 'keys.KEY_Q'))
})
