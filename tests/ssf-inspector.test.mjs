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
