import assert from 'node:assert/strict'
import test from 'node:test'
import { bdaLayoutStyleGroups, NEW_FORE_LAYER } from '../src/bda-layout-styles.ts'

test('an empty BDA panel exposes every supported group without materializing source objects', () => {
  const panel = { keys: new Map(), hints: new Map(), lists: new Map() }
  const before = structuredClone(panel)
  const groups = bdaLayoutStyleGroups(panel, [])
  assert.deepEqual(groups.map((group) => group.key), ['panel', 'input', 'more', 'hints', 'lists'])
  const paths = groups.flatMap((group) => group.items.map((item) => item.path.join('.')))
  for (const path of ['more.backStyle', 'hints.short.backStyle', 'hints.long.cellStyle', 'lists.port.cellForeStyle', 'lists.port.foreStyles.0']) assert.ok(paths.includes(path), path)
  const candidate = bdaLayoutStyleGroups(panel, [], 'candidate')
  assert.deepEqual(candidate.map((group) => group.key), ['candidate', 'candidateSwitch', 'candidateKeys', 'candidateMenu'])
  const items = candidate.flatMap((group) => group.items)
  for (const path of ['cand.candBarStyle', 'cand.switch.selectFore', 'cand.candKeys.CAND_F31.backStyle', 'cand.menuKeys.MENU_PASTE.backStyle', 'cand.aiIcon.foreStyles.0']) assert.ok(items.some((item) => item.path.join('.') === path), path)
  assert.equal(items.find((item) => item.field === 'cellForeStyle').type, 'text')
  assert.equal(items.find((item) => item.path.join('.') === 'cand.aiIcon.foreStyles.0').field, NEW_FORE_LAYER)
  assert.deepEqual(panel, before, 'inspecting does not create candidate, hint, list, or more objects')
})

test('BDA capability rows preserve configured extension names and references', () => {
  const ref = { type: 'image', key: 7 }
  const key = { backStyle: ref, foreStyles: [], foreStyleOffsets: [] }
  const panel = { keys: new Map(), hints: new Map([['custom', { backStyle: ref }]]), lists: new Map(), cand: { candKeys: new Map([['CUSTOM_KEY', key]]), menuKeys: new Map() } }
  assert.deepEqual(bdaLayoutStyleGroups(panel, []).find((group) => group.key === 'hints').items.find((item) => item.path.join('.') === 'hints.custom.backStyle').ref, ref)
  const candidate = bdaLayoutStyleGroups(panel, [], 'candidate')
  assert.deepEqual(candidate.find((group) => group.key === 'candidateKeys').items.find((item) => item.path.join('.') === 'cand.candKeys.CUSTOM_KEY.backStyle').ref, ref)
  assert.equal(candidate.flatMap((group) => group.items).filter((item) => item.path.join('.') === 'cand.candKeys.CAND_F31.backStyle').length, 1)
})
