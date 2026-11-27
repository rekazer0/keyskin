import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { skinFileName } from '../src/export.ts'
import { isSsfPath, looksLikeSsf } from '../src/ssf/ssf-package.ts'
import { ssfDocumentBytes } from '../src/ssf/ssf-convert.ts'
import { skinContainer, ssfFixture } from './helpers/ssf-fixture.mjs'
import { declarations, run } from './helpers/app-source.mjs'

for (const android of [true, false]) {
  test(`native skin picker uses ${android ? 'the read-write Android document picker' : 'desktop extension filters'}`, async () => {
    const loaded = []
    const context = run(declarations('openNative'), {
      isAndroidTauri: () => android,
      prepareDocumentReplacement: async (intent) => { assert.equal(intent, 'open'); return true },
      pickAndroidSkinFile: async () => android ? 'content://provider/document/42' : assert.fail('desktop must not use the Android picker'),
      open: async (options) => {
        assert.ok(!android, 'Android must not use the read-only dialog picker')
        assert.equal(options.multiple, false)
        assert.deepEqual(Array.from(options.filters[0].extensions), ['bdi', 'bds', 'bda', 'ssf', 'mssf', 'sxi', 'it', 'itx'])
        return '/皮肤.ssf'
      },
      loadNativePath: async (path) => loaded.push(path),
    })
    assert.equal(await context.openNative(), true)
    assert.deepEqual(loaded, [android ? 'content://provider/document/42' : '/皮肤.ssf'])
    context.prepareDocumentReplacement = async () => false
    assert.equal(await context.openNative(), false)
    assert.equal(loaded.length, 1)
  })
}

test('cancelling the native picker keeps the current skin without asking about export', async () => {
  const context = run(declarations('openNative'), {
    isAndroidTauri: () => false,
    open: async () => null,
    prepareDocumentReplacement: () => assert.fail('no replacement was chosen'),
    loadNativePath: () => assert.fail('cancel must not load a skin'),
  })
  assert.equal(await context.openNative(), false)
})

test('opening another skin offers export for saved and unsaved skins and preserves it when exporting or cancelling', async () => {
  for (const changed of [false, true]) for (const decision of ['cancel', 'discard', 'export']) {
    const calls = []
    const archive = { changed: new Set(changed ? ['Info.txt'] : []) }
    const context = run(declarations('prepareDocumentReplacement', 'hasUnsavedChanges'), {
      archive, unsavedNew: false,
      documentName: { textContent: '当前皮肤.bds' },
      flushNumberInputWheel: () => calls.push('flush-input'),
      flushSourceAutosave: async () => calls.push('flush-source'),
      ask: async (options) => { assert.match(options.title, /导出当前皮肤/); calls.push('ask'); return decision },
      canvasWrap: { classList: { remove: (value) => { assert.equal(value, 'empty'); calls.push('reveal-current') } } },
      openShareDialog: (focusExport) => { assert.equal(focusExport, true); calls.push('share') },
      saveArchive: () => assert.fail('the user exports from the share page'),
    })
    assert.equal(await context.prepareDocumentReplacement('open'), decision === 'discard')
    assert.equal(context.archive, archive)
    assert.deepEqual(calls, ['flush-input', 'flush-source', 'ask', ...(decision === 'export' ? ['reveal-current', 'share'] : [])])
  }
  const context = run(declarations('prepareDocumentReplacement', 'hasUnsavedChanges'), {
    flushNumberInputWheel: () => {}, flushSourceAutosave: async () => {},
    unsavedNew: false,
    ask: () => assert.fail('the first skin opens without a prompt'),
  })
  assert.equal(await context.prepareDocumentReplacement('open'), true)
})

test('saving a read-only Android skin asks for write access and writes back to the granted file', async () => {
  const original = 'content://provider/document/42'
  const authorized = 'content://provider/tree/42'
  const writes = []
  const picks = []
  const workspaceUpdates = []
  let marked = false
  const archive = { markSaved: () => { marked = true } }
  const context = run(declarations('saveNative'), {
    archive, currentPath: original, unsavedNew: false,
    isAndroidTauri: () => true,
    exportForSave: async () => ({ bytes: new Uint8Array([1]), converted: false, archive, revision: 1 }),
    exportFormatFromPath: () => 'bdi',
    exportTargetLabel: () => 'BDI 皮肤',
    writeToChosenFile: async () => assert.fail('must not fall back to save-as'),
    writeNativePath: async (path) => {
      writes.push(path)
      if (path === original) throw 'Permission Denial: writing ExternalStorageProvider uri'
    },
    ask: async () => 'grant',
    pickAndroidSkinFile: async (initialUri) => { picks.push(initialUri); return authorized },
    documentName: {},
    documentNameForPath: () => '皮肤.bdi',
    activateSourceWorkspace: async (path) => workspaceUpdates.push(['reset', path]),
    recordRecentFile: (path) => workspaceUpdates.push(['recent', path]),
    startSourceWorkspace: (_archive, path) => workspaceUpdates.push(['start', path]),
    updateDirty: () => {},
    logShareExport: () => {},
    operationErrorLog: () => 'Error',
  })
  assert.equal(await context.saveNative(false, 'bdi', '皮肤.bdi'), true)
  assert.deepEqual(picks, [original])
  assert.deepEqual(writes, [original, authorized])
  assert.equal(context.currentPath, authorized)
  assert.deepEqual(workspaceUpdates, [['reset', ''], ['recent', authorized], ['start', authorized]])
  assert.ok(marked)
})

test('Android content URIs open ZIP SSF, encrypted SSF and Baidu skins by their contents', async () => {
  const zip = ssfFixture()
  for (const [bytes, format] of [
    [zip, 'ssf'],
    [await skinContainer(unzipSync(zip)), 'ssf'],
    [new Uint8Array(readFileSync(new URL('../public/default-template.bds', import.meta.url))), 'bds'],
  ]) {
    const path = 'content://provider/document/42'
    let loaded = false
    const context = run(declarations('loadNativePath', 'openSkinBytes', 'isSupportedSkinPath', 'UNSUPPORTED_SKIN_MESSAGE'), {
      isSsfPath, looksLikeSsf, ssfDocumentBytes,
      sourceDirectoryEnabledBySettings: () => false,
      readFile: async (uri) => { assert.equal(uri, path); return bytes },
      readNativeSkinFile: () => assert.fail('content URIs must use the filesystem plugin'),
      loadArchive: async (data, uri) => {
        assert.equal(uri, path)
        assert.equal(SkinArchive.open(data).format, format)
        loaded = true
      },
    })
    assert.equal(await context.loadNativePath(path), true)
    assert.equal(loaded, true)
    await assert.rejects(context.loadNativePath('/invalid.txt'), /仅支持/)
  }
})

test('Android content URIs take the skin\'s declared name, not the encoded document id', async () => {
  const sogou = SkinArchive.open(await ssfDocumentBytes(ssfFixture()))
  const baidu = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/default-template.bds', import.meta.url))))
  baidu.setText('Info.txt', baidu.getText('Info.txt').replace(/^Name=.*$/m, 'Name=森 · 故梦 v1.2'))
  const nameless = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/default-template.bds', import.meta.url))))
  nameless.setText('Info.txt', 'Style=default\nName=a/b:c\n')
  const context = run(declarations('documentNameForPath'), { skinFileName })
  const uri = 'content://com.android.providers.downloads.documents/document/raw%3A%2Fstorage%2F%E6%A3%AE.sxi'
  assert.equal(context.documentNameForPath(uri, sogou), '测试皮肤.ssf')
  assert.equal(context.documentNameForPath(uri, baidu), '森 · 故梦 v1.2.bds')
  assert.equal(context.documentNameForPath(uri, nameless), 'a_b_c.bds')
  assert.equal(context.documentNameForPath('/skins/原文件名.bds', baidu), '原文件名.bds')
  assert.equal(skinFileName(undefined, 'bdi'), '未命名皮肤.bdi')
})
