import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { appSource, declarations, run } from './helpers/app-source.mjs'
import { selectedDraftChanges } from '../src/ai-draft-selection.ts'

const reviewSource = readFileSync(new URL('../src/ai-draft-review.ts', import.meta.url), 'utf8')
const review = vm.createContext({ exports: {} })
vm.runInContext(ts.transpile(reviewSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), review)
const { changedJsonSections, draftExcerpt } = review.exports

test('compact BDA JSON reports only modified, added and removed blocks', () => {
  assert.equal(JSON.stringify(changedJsonSections('{"a":1,"b":2,"gone":true}', '{"a":1,"b":3,"new":true}')), '["b","gone","new"]')
})
test('escaped JSON keys do not throw and unchanged JSON yields no sections', () => {
  const before = JSON.stringify({ 'key"name': 'old' })
  const after = JSON.stringify({ 'key"name': 'new' })
  assert.equal(changedJsonSections(before, after)[0], 'key"name')
  assert.equal(changedJsonSections(before, before).length, 0)
})
test('review excerpt preserves final changes instead of silently showing only four lines', () => {
  const before = 'same\n' + Array.from({ length: 12 }, (_, i) => `old${i}`).join('\n') + '\nend'
  const after = before.replaceAll('old', 'new')
  const result = draftExcerpt(before, after)
  assert.match(result.text, /new11/)
  assert.equal(result.omitted, false)
})
test('large and long-line diffs explicitly disclose truncation', () => {
  assert.equal(draftExcerpt('a', 'x'.repeat(501)).omitted, true)
  const result = draftExcerpt('', Array.from({ length: 80 }, (_, i) => String(i)).join('\n'))
  assert.equal(result.omitted, true)
  assert.match(result.text, /完整内容/)
})

const draftFunctions = ['applyAiDesignDraft', 'validatedAiChanges', 'writeAiDraftChanges', 'previewAiDraft', 'revertAiDraftPreview', 'acceptAiDraftPreview', 'sameBytes']
const functions = declarations(...draftFunctions)
function setup(editing = true, stale = false) {
  const files = new Map([['keys.ini', stale ? 'manual edit' : 'old']])
  const target = { format: 'bdi', getBytes: () => undefined, getText: path => files.get(path), setText: (path, text) => files.set(path, text) }
  const draft = { target, changes: [{}], drafts: [{ path: 'keys.ini', syntax: 'ini', before: 'old', after: 'new' }], conversation: ['accepted'] }
  let commits = 0
  let applications = 0
  const context = run(functions, {
    archive: target, aiDesignDraft: undefined, aiDraftPreview: undefined, aiDesignBusy: false, aiDesignConversation: [],
    aiDesignStatus: { textContent: '' }, aiDesignPanel: { dataset: {} },
    isEditing: () => editing, source: { commit() {} },
    aiEditableProjectFiles: () => [{ path: 'keys.ini', syntax: 'ini', text: files.get('keys.ini') }],
    aiEditableProjectImages: () => [{ path: 'keys.png' }],
    commitBatch: () => { commits++ },
    aiDesignErrorMessage: error => error.message,
    selectedDraftChanges,
    recordAiApplication: () => { applications++ },
    refreshAfterAiDraft() {},
  })
  vm.runInContext('function setAiDesignDraft(value) { revertAiDraftPreview(); aiDesignDraft = value; if (value) previewAiDraft(value) }', context)
  context.setAiDesignDraft(draft)
  return { context, draft, text: () => files.get('keys.ini'), commits: () => commits, applications: () => applications }
}
test('draft is previewed on the canvas before it is applied', () => {
  const s = setup()
  assert.equal(s.text(), 'new')
  assert.equal(s.commits(), 0)
})
test('discarding a draft restores the previewed files', () => {
  const s = setup()
  s.context.setAiDesignDraft(undefined)
  assert.equal(s.text(), 'old')
  assert.equal(s.commits(), 0)
})
test('stale draft is not previewed or applied and keeps manual edits', () => {
  const s = setup(true, true)
  assert.equal(s.text(), 'manual edit')
  assert.match(s.context.aiDesignStatus.textContent, /文件已变化/)
  s.context.applyAiDesignDraft()
  assert.equal(s.commits(), 0)
  assert.equal(s.context.aiDesignDraft, s.draft)
  assert.equal(s.context.aiDesignConversation.length, 0)
})
test('read-only mode cannot apply a draft', () => {
  const s = setup(false)
  s.context.applyAiDesignDraft()
  assert.equal(s.commits(), 0)
  assert.equal(s.context.aiDesignDraft, s.draft)
})
test('accepted draft commits once and advances the conversation', () => {
  const s = setup()
  s.context.applyAiDesignDraft()
  s.context.applyAiDesignDraft()
  assert.equal(s.commits(), 1)
  assert.equal(s.applications(), 1)
  assert.equal(s.text(), 'new')
  assert.equal(s.context.aiDesignDraft, undefined)
  assert.equal(s.context.aiDesignConversation[0], 'accepted')
})
test('project switch drops old draft without writing to new project', () => {
  const s = setup()
  s.context.archive = {}
  s.context.applyAiDesignDraft()
  assert.equal(s.commits(), 0)
  assert.equal(s.text(), 'old')
  assert.equal(s.context.aiDesignDraft, undefined)
})

test('image drafts become byte changes and are rejected once the PNG changed', () => {
  const { context } = setup()
  const png = new Uint8Array([1, 2, 3])
  const target = { format: 'bdi', getBytes: () => png }
  const draft = { path: 'keys.png', syntax: 'png', before: new Uint8Array([1, 2, 3]), after: new Uint8Array([9]) }
  assert.deepEqual([...context.validatedAiChanges(target, [draft])[0].after], [9])
  assert.throws(() => context.validatedAiChanges(target, [{ ...draft, before: new Uint8Array([1]) }]), /图片已变化/)
  assert.throws(() => context.validatedAiChanges(target, [{ ...draft, path: 'other.png' }]), /未授权图片/)
})
