import assert from 'node:assert/strict'
import test from 'node:test'
import { IniDocument } from '../src/ini.ts'
import { declarations, run } from './helpers/app-source.mjs'

test('SSF multi-selection intersects properties and omits single-key actions', () => {
  const docs = { one: IniDocument.parse('[A]\nNORMAL=a.png\nPRESSED=b.png\nTYPE=1\n'), two: IniDocument.parse('[B]\nNORMAL=c.png\nTYPE=2\n') }
  const context = run(declarations('commonKeyGroups'), { ssfEntries: (path, section) => docs[path].entries(section) })
  const result = context.commonKeyGroups([
    [{ label: '背景', blocks: [{ path: 'one', section: 'A', omit: ['TYPE'], actions: ['copy'] }] }],
    [{ label: '背景', blocks: [{ path: 'two', section: 'B' }] }],
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{ label: '背景', blocks: [{ path: 'one', section: 'A', only: ['NORMAL'], note: '作用于所有选中按键', peers: [{ path: 'two', section: 'B' }] }] }])
  assert.equal(context.commonKeyGroups([[{ label: '前景', blocks: [{ path: 'one', section: 'A' }] }], []]).length, 0)
})

test('SSF numeric controls keep names, versions and unknown values as text', () => {
  const context = run(declarations('NUMERIC_FIELDS', 'textField'), {
    element: () => ({ append(kind) { this.kind = kind } }), caption() {}, isEditing: () => true,
    ssfFieldLabel: (key) => key, fieldControl: (spec) => spec.kind,
  })
  const targets = [{ path: 'phoneTheme.ini', section: 'General' }]
  for (const key of ['skin_name', 'skin_version', 'sound', 'CUSTOM']) assert.equal(context.textField(key, '001', targets).kind, 'text')
  assert.equal(context.textField('TEXT_SIZE', '18', targets).kind, 'number')
  assert.equal(context.textField('TEXT_SIZE', 'default', targets).kind, 'text')
})

test('SSF edits to multiple files commit together and preview only after committing', () => {
  const files = new Map([['one', '[A]\nTYPE=1\n'], ['two', '[B]\nTYPE=2\n']])
  const events = []
  const context = run(declarations('editTargets', 'setSsfValue'), {
    IniDocument, archive: { format: 'ssf', isText: (path) => files.has(path), getText: (path) => files.get(path) }, isEditing: () => true,
    commitBatch: (changes) => { for (const change of changes) files.set(change.path, change.after); events.push('batch') },
    commitText: () => assert.fail('Expected one batch'), selectedPath: '', sourceEditPath: () => '',
    refreshPreview: () => events.push('preview'), populateKeyInspector() {}, updateDirty() {}, resolutionTwins: () => [],
  })
  context.editTargets([{ path: 'one', section: 'A' }, { path: 'two', section: 'B' }], (document, target) => context.setSsfValue(document, target.section, 'TYPE', '3'))
  assert.equal(IniDocument.parse(files.get('one')).get('A', 'TYPE'), '3')
  assert.equal(IniDocument.parse(files.get('two')).get('B', 'TYPE'), '3')
  assert.deepEqual(events, ['batch', 'preview'])
})

test('SSF first edit fills required defaults in existing sparse sections without replacing values', () => {
  const context = run(declarations('setSsfValue'))
  const document = IniDocument.parse('[CandidateView]\nBG_COLOR=0x12345678\n')
  context.setSsfValue(document, 'CandidateView', 'MARGINS', '1,2,3,4', [
    { key: 'BG_STYLE', value: '1' }, { key: 'BG_COLOR', value: '0xffffffff' },
  ])
  assert.equal(document.get('CandidateView', 'BG_STYLE'), '1')
  assert.equal(document.get('CandidateView', 'BG_COLOR'), '0x12345678')
  assert.equal(document.get('CandidateView', 'MARGINS'), '1,2,3,4')
})

test('SSF choosing an image creates the required view defaults', () => {
  const document = IniDocument.parse('[RootView]\n')
  const context = run(declarations('replaceImage', 'stateImage', 'withFile', 'setSsfValue'), {
    LINKED_STATES: { NORMAL: ['DISABLED', 'NORMAL_ON'] },
    editTargets: (targets, change) => targets.forEach((target) => change(document, target)),
  })
  context.replaceImage([{ section: 'RootView', create: [{ key: 'BG_STYLE', value: '1' }] }], 'BG_IMAGE', 'background.png')
  assert.equal(document.get('RootView', 'BG_STYLE'), '1')
  assert.equal(document.get('RootView', 'BG_IMAGE'), 'background.png')
})

test('SSF first foreground layout edit creates and binds a usable style in one commit', () => {
  let text = '[Key_Q]\nCUSTOM=keep\n'
  let commits = 0
  const context = run(declarations('editTargets', 'setSsfValue', 'withFile'), {
    IniDocument, archive: { format: 'ssf', isText: () => true, getText: () => text }, isEditing: () => true,
    commitText: (_path, _before, after) => { text = after; commits += 1 },
    selectedPath: '', sourceEditPath: () => '', resolutionTwins: () => [],
    refreshPreview() {}, populateKeyInspector() {}, updateDirty() {},
  })
  const target = { path: 'phoneSkin.ini', section: 'FGStyle_Key_Q', bind: { section: 'Key_Q', key: 'FG_STYLE' }, create: [{ key: 'LABEL_STYLE', value: 'TextStyle_Qwerty' }] }
  context.editTargets([target], () => {})
  assert.equal(commits, 0, 'a no-op does not create a reference')
  context.editTargets([target], (document, location) => context.setSsfValue(document, location.section, 'LABEL_POSITION', '0.2,0,1,1', location.create))
  const document = IniDocument.parse(text)
  assert.equal(commits, 1)
  assert.equal(document.get('Key_Q', 'FG_STYLE'), 'FGStyle_Key_Q')
  assert.equal(document.get('FGStyle_Key_Q', 'LABEL_STYLE'), 'TextStyle_Qwerty')
  assert.equal(document.get('FGStyle_Key_Q', 'LABEL_POSITION'), '0.2,0,1,1')
  assert.equal(document.get('Key_Q', 'CUSTOM'), 'keep')
})

test('SSF source file groups render image section references as cards with their image controls', () => {
  const document = IniDocument.parse('[RootView]\nBG_IMAGE=keyboard.png\n[CandidateView]\nBG_IMAGE=BgCandidate,stretch\n[BgCandidate]\nNORMAL=bar.png\n')
  const groups = []
  const context = run(declarations('fileGroups'), {
    IMAGE_KEYS: ['NORMAL', 'PRESSED'],
    ssfDocument: () => document,
    firstValue: (value) => value?.split(',')[0],
    ssfSectionLabel: (section) => section,
    renderGroup: (label, blocks, code) => { const group = { label, blocks, code }; groups.push(group); return group },
  })
  context.fileGroups('phoneSkin.ini')
  const candidate = JSON.parse(JSON.stringify(groups.find(({ label }) => label === 'CandidateView')))
  assert.deepEqual(candidate.blocks[0].omit, ['BG_IMAGE'])
  assert.deepEqual(candidate.blocks[1], {
    path: 'phoneSkin.ini', section: 'BgCandidate', title: 'BgCandidate', expect: ['NORMAL', 'PRESSED'],
    reference: { path: 'phoneSkin.ini', section: 'CandidateView', key: 'BG_IMAGE' },
  })
  assert.equal(groups.some(({ label }) => label === 'BgCandidate'), false)
  assert.equal(groups.find(({ label }) => label === 'RootView').blocks[0].omit.length, 0, 'file paths remain image fields')
  assert.equal(groups.find(({ label }) => label === 'RootView').blocks[0].create[0].value, '1', 'raw INI view edits create the required background mode')
})
