import assert from 'node:assert/strict'
import test from 'node:test'
import { palmInspectorCollection, palmInspectorKind, palmInspectorModel } from '../src/palm/palm-inspector.ts'
import { palmStyleReference } from '../src/palm/palm-labels.ts'

const board = ['default', 'port_layout', 'b', 'full26Pinyin']
const candidate = ['default', 'port_layout', 'c', 'cand1']

test('Palm inspector describes absent board parts and candidate controls without writing defaults', () => {
  const model = palmInspectorModel(board)
  for (const part of ['comm', 'board', 'input', 'cand', 'hint', 'logo', 'emoji', 'more', 'list', 'seg', 'top_cand']) assert.equal(typeof model[part], 'object', part)
  const cand = palmInspectorModel(candidate)
  for (const field of ['rect', 'f_size', 'insets', 'gap', 'f_gap', 'i_cell', 'i_mask', 'file']) assert.ok(field in cand, field)
  assert.equal(cand.rect, undefined)
  assert.equal(cand.b.base_b, undefined)
  assert.equal(cand.switch.i_normal, undefined)
  cand.switch.i_normal = 7
  assert.equal(palmInspectorModel(candidate).switch.i_normal, undefined, 'capabilities never retain edits')
  assert.deepEqual(palmInspectorModel([...board, 'board']).bd, { b: { a: undefined, r: undefined } }, 'an absent panel exposes border animation controls')
})

test('absent Palm values keep their native types', () => {
  for (const field of ['size', 'f_size', 'c_size', 'pos', 'p', 's']) assert.equal(palmInspectorKind(candidate, field), 'point')
  assert.equal(palmInspectorKind(candidate, 'insets'), 'insets')
  assert.equal(palmInspectorKind([...candidate, 'switch'], 'insets'), 'number')
  assert.equal(palmInspectorKind(candidate, 'gap'), 'number')
  assert.equal(palmInspectorKind([...board, 'board'], 'exact'), 'switch')
  assert.equal(palmInspectorKind([...board, 'list'], 'titles'), 'strings')
  assert.equal(palmInspectorKind([...board, 'list'], 't'), 'number')
  assert.equal(palmInspectorKind([...candidate, 'icon_list', 0], 't'), 'list')
  assert.equal(palmInspectorKind(['info'], 'layoutSupport'), 'switch')
  assert.equal(palmInspectorKind(['info'], 'core_ability'), 'number')
})

test('supported empty model collections expose creation for arrays and dictionaries', () => {
  assert.equal(palmInspectorCollection(candidate, 'icon_list'), 'array')
  assert.equal(palmInspectorCollection(candidate, 'fix'), 'dictionary')
  assert.equal(palmInspectorCollection([...board, 'cand'], 'icon_list'), 'array')
  assert.equal(palmInspectorCollection(board, 'key_fix'), 'dictionary')
  assert.equal(palmInspectorCollection(board, 'offset'), 'dictionary')
  assert.equal(palmInspectorCollection(board, 'force'), 'array')
  assert.equal(palmInspectorCollection(['default', 'port_layout', 'h', 'bubble1'], 'icon_info'), 'dictionary')
  for (const path of [[...candidate, 'icon_list', 0], [...candidate, 'fix', '1'], [...board, 'offset', '1'], [...board, 'force', 0]]) assert.ok(Object.keys(palmInspectorModel(path)).length)
  assert.equal(palmInspectorCollection(['info'], 'unknown'), undefined)
})

test('Palm animation fields use shared animation reference controls', () => {
  for (const [field, reference] of Object.entries({ asi: 'ANIM_STYLE', base_ba: 'BACK_ANIM_STYLE', base_pa: 'PRESS_STYLE', base_fa: 'FORE_ANIM_STYLE', base_a: 'ANIM_STYLE', bar_a: 'ANIM_STYLE' })) assert.equal(palmStyleReference(field), reference)
})

test('new Palm styles expose every supported style kind before any values exist', () => {
  const style = ['default', 's_info', 'ss_1', '1']
  const model = palmInspectorModel(style)
  assert.deepEqual(Object.keys(model), ['s_1', 's_2', 's_3', 's_4', 's_5'])
  assert.ok('f_s' in model.s_1)
  assert.ok('normal' in model.s_2)
  assert.ok('path_1' in model.s_4)
  assert.equal(palmInspectorKind([...style, 's_3'], 'size'), 'number')
  for (const event of ['1', '2', '3', '4', '5']) assert.equal(palmInspectorKind([...style, 's_5'], event), 'number')
  assert.equal(palmInspectorModel([...style, 's_1']).f_s, undefined)
})
