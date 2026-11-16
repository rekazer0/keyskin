import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { strToU8 } from 'fflate'
import { declarations, run } from './helpers/app-source.mjs'

// 检查器重建时同一份 default.css 会被问几十次；缓存要命中，也要在文本变了（写回/撤销）后失效。
function setup(texts) {
  const archive = SkinArchive.fromFiles(new Map(Object.entries(texts).map(([path, text]) => [path, strToU8(text)])), 'bds')
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
  context.archive.setText('default.css', '[STYLE1]\nNM_COLOR=ff0000ff')
  const after = context.cachedIniDocument('default.css')
  assert.notEqual(after, before, '写回后重新解析')
  assert.equal(after.get('STYLE1', 'NM_COLOR'), 'ff0000ff')
})

test('cached reads avoid decoding unchanged bytes and follow archive replacement and deletion', () => {
  const context = setup({ 'default.css': '[STYLE1]\nNM_COLOR=ffffffff' })
  const first = context.cachedIniDocument('default.css')
  let reads = 0
  const getText = context.archive.getText.bind(context.archive)
  context.archive.getText = path => { reads++; return getText(path) }
  for (let i = 0; i < 6000; i++) assert.equal(context.cachedIniDocument('default.css'), first)
  assert.equal(reads, 0, 'thousands of styles must not decode the entire stylesheet again')
  context.archive.setText('default.css', '[STYLE1]\nNM_COLOR=ff0000ff')
  const changed = context.cachedIniDocument('default.css')
  assert.notEqual(changed, first)
  context.archive.setText('default.css', '[STYLE1]\nNM_COLOR=ffffffff')
  assert.equal(context.cachedIniDocument('default.css').get('STYLE1', 'NM_COLOR'), 'ffffffff', 'undo invalidates the read view')
  context.archive = SkinArchive.fromFiles(new Map([['default.css', strToU8('[STYLE2]\nNM_COLOR=ff000000')]]), 'bds')
  assert.equal(context.cachedIniDocument('default.css').get('STYLE2', 'NM_COLOR'), 'ff000000')
  context.archive.delete('default.css')
  assert.equal(context.cachedIniDocument('default.css'), undefined)
})
