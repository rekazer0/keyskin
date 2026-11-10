import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import { declarations, run } from './helpers/app-source.mjs'

// 检查器重建时同一份 default.css 会被问几十次；缓存要命中，也要在文本变了（写回/撤销）后失效。
function setup(texts) {
  const archive = { texts, isText: (path) => path in archive.texts, getText: (path) => archive.texts[path] }
  return run(declarations('cachedIniDocument', 'documents'), { IniDocument, archive })
}

test('cached read documents are reused while the text is unchanged', () => {
  const context = setup({ 'default.css': '[STYLE1]\nNM_COLOR=ffffffff' })
  const first = context.cachedIniDocument('default.css')
  assert.equal(first.get('STYLE1', 'NM_COLOR'), 'ffffffff')
  assert.equal(context.cachedIniDocument('default.css'), first, '同一份文本只解析一次')
  assert.equal(context.cachedIniDocument('missing.css'), undefined)
})

test('cached read documents are replaced when the archive text changes', () => {
  const context = setup({ 'default.css': '[STYLE1]\nNM_COLOR=ffffffff' })
  const before = context.cachedIniDocument('default.css')
  context.archive.texts['default.css'] = '[STYLE1]\nNM_COLOR=ff0000ff'
  const after = context.cachedIniDocument('default.css')
  assert.notEqual(after, before, '写回后重新解析')
  assert.equal(after.get('STYLE1', 'NM_COLOR'), 'ff0000ff')
})
