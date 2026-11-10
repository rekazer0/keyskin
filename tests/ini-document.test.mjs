import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'

const SOURCE = '[PANEL]\nKEY_NUM=2\n[KEY1]\nVIEW_RECT=0,0,1,1\n[KEY1]\nVIEW_RECT=9,9,9,9\n[KEY3]\nX=1'

test('indexed lookup keeps first-match semantics across mutations', () => {
  const document = IniDocument.parse(SOURCE)
  assert.equal(document.get('KEY1', 'VIEW_RECT'), '0,0,1,1')
  assert.equal(document.set('KEY3', 'Y', '2'), true)
  assert.equal(document.get('KEY3', 'Y'), '2')
  assert.equal(document.remove('KEY1', 'VIEW_RECT'), true)
  assert.equal(document.get('KEY1', 'VIEW_RECT'), '9,9,9,9')
  document.appendSection('KEY4', [{ key: 'X', value: '4' }])
  assert.equal(document.get('KEY4', 'X'), '4')
  assert.deepEqual(document.renumberSections('KEY').get('KEY3'), 'KEY2')
  assert.equal(document.get('KEY2', 'Y'), '2')
  assert.equal(document.get('KEY3', 'X'), '4')
  assert.deepEqual(document.sections(), ['PANEL', 'KEY1', 'KEY2', 'KEY3'])
  assert.equal(document.removeSections(['KEY3']), true)
  assert.equal(document.get('KEY3', 'X'), undefined)
})

test('cached parses are isolated from each other', () => {
  const first = IniDocument.parse(SOURCE)
  first.set('PANEL', 'KEY_NUM', '7')
  first.sections().push('MUTATED')
  const second = IniDocument.parse(SOURCE)
  assert.equal(second.get('PANEL', 'KEY_NUM'), '2')
  assert.equal(second.toString(), SOURCE)
  assert.ok(!first.sections().includes('MUTATED'))
})

test('section set stays valid across appends and structural edits', () => {
  const document = IniDocument.parse(SOURCE)
  assert.equal(document.hasSection('KEY3'), true)
  assert.equal(document.hasSection('KEY9'), false)
  document.appendSection('KEY9', [{ key: 'X', value: '9' }])
  assert.equal(document.hasSection('KEY9'), true, 'appended sections join the cached set')
  assert.equal(document.sectionSet().has('KEY1'), true)
  document.removeSections(['KEY9'])
  assert.equal(document.hasSection('KEY9'), false, 'removed sections leave the cached set')
  assert.equal(document.hasSection('KEY3'), true)
})

test('a new entry joins its section above the blank lines that separate sections', () => {
  const document = IniDocument.parse('[A]\nX=1\n\n[B]\nY=2\n\n')
  document.set('A', 'Z', '3')
  document.set('B', 'W', '4')
  assert.equal(document.toString(), '[A]\nX=1\nZ=3\n\n[B]\nY=2\nW=4\n\n')
  const empty = IniDocument.parse('[A]\n\n[B]')
  empty.set('A', 'X', '1')
  empty.set('B', 'Y', '2')
  assert.equal(empty.toString(), '[A]\nX=1\n\n[B]\nY=2\n')
})
