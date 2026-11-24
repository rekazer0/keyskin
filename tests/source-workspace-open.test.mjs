import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, unzipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { declarations, run } from './helpers/app-source.mjs'
import { consumeSourceWriteSnapshot, prefixedSourcePath, sourcePathLookup, writePendingSourcePaths } from '../src/source-tree.ts'
import { ssfFixture } from './helpers/ssf-fixture.mjs'

function workspaceContext(files, loadArchive) {
  return run(declarations('loadSourceWorkspace', 'themeFolderPrefix', 'decodeBase64Archive', 'sourceArchiveFromFiles'), {
    SkinArchive, Uint8Array, TextDecoder, atob, prefixedSourcePath,
    isAndroidTauri: () => false,
    showSkinLoadProgress: () => false,
    invoke: async (command) => command === 'skin_file_size' ? 1 : files,
    loadArchive,
  })
}

const encoded = (files) => Object.entries(files).map(([path, data]) => ({ path, data: Buffer.from(data).toString('base64') }))

test('reopening SSF source keeps workspace edits and binary resources through saving', async () => {
  const files = unzipSync(ssfFixture())
  files['phoneTheme.ini'] = strToU8('[General]\nskin_name=源码里修改的名称\n')
  files['default/二进制.wav'] = Uint8Array.from({ length: 256 }, (_, i) => i)
  const context = workspaceContext(encoded({ ...files, '.DS_Store': new Uint8Array(), 'old.bds': new Uint8Array() }), async (archive, skinPath, isNew, workspace) => {
    assert.ok(archive instanceof SkinArchive)
    assert.equal(archive.format, 'ssf')
    assert.equal(skinPath, '/皮肤.ssf')
    assert.equal(isNew, false)
    assert.equal(workspace, '/source')
    assert.equal(archive.changed.size, 0)
    const saved = unzipSync(archive.toBytes('ssf'))
    assert.deepEqual(Object.keys(saved).sort(), Object.keys(files).sort())
    for (const [path, bytes] of Object.entries(files)) assert.deepEqual(saved[path], bytes, path)
  })
  assert.equal(await context.loadSourceWorkspace('/source', '/皮肤.ssf'), true)
})

test('theme source folders retain their prefix and empty folders still fail', async () => {
  const context = workspaceContext(encoded({ 'Info.txt': strToU8('Name=test'), 'port/main.ini': strToU8('[PANEL]') }), async (archive, path, isNew, workspace, name, prefix) => {
    assert.equal(prefix, 'dark/')
    assert.equal(name, 'dark')
    assert.ok(archive.names().includes('dark/skin/port/main.ini'))
  })
  await context.loadSourceWorkspace('/source/dark')
  const empty = workspaceContext(encoded({ '.DS_Store': new Uint8Array() }), () => assert.fail('Empty folders must not replace the document'))
  await assert.rejects(empty.loadSourceWorkspace('/empty'), /源码文件夹为空/)
})

test('a full skin workspace named dark does not become a single-theme folder', async () => {
  const context = workspaceContext(encoded({ 'light/skin/port/main.ini': strToU8('[PANEL]') }), async (archive, path, isNew, workspace, name, prefix) => {
    assert.equal(prefix, '')
    assert.ok(archive.names().includes('light/skin/port/main.ini'))
  })
  await context.loadSourceWorkspace('/source/dark', '/dark.bds')
})

test('Android document provider names, not opaque URIs, determine theme paths for opening and writing back', async () => {
  const workspace = 'content://provider/tree/opaque%3A123'
  for (const [paths, prefix] of [[['port/main.ini'], 'dark/'], [['light/port/main.ini', 'dark/port/main.ini'], '']]) {
    const bytes = SkinArchive.fromSourceFiles([...paths, 'INFO.TXT'].map(path => ({ path, data: strToU8('test') }))).toBytes()
    const context = workspaceContext([], async (archive, _, __, source, name, sourcePrefix) => {
      assert.equal(source, workspace)
      assert.equal(name, 'Dark')
      assert.equal(sourcePrefix, prefix)
      assert.deepEqual(archive.sourcePaths().sort(), [...paths.map(path => prefix + path), 'INFO.TXT'].sort())
      let written
      const sync = run(declarations('sourcePathForWorkspace', 'scheduleSourceAutosave', 'flushSourceAutosave'), {
        archive, sourceWorkspacePath: source, sourceWorkspacePrefix: sourcePrefix,
        window: { setTimeout: () => 1 }, clearTimeout() {}, pendingSourcePaths: new Set(),
        writePendingSourcePaths, sourcePathLookup, rememberSourceWrite() {}, updateDirty() {}, sourceSyncQueue: Promise.resolve(),
        invoke: async (command, payload) => { assert.equal(command, 'apply_source_changes'); written = payload },
      })
      const canonical = archive.canonicalSourcePath(prefix + paths[0])
      archive.setText(canonical, 'edited')
      sync.scheduleSourceAutosave([canonical])
      await sync.flushSourceAutosave()
      assert.equal(written.path, workspace)
      assert.equal(written.changes[0].path, paths[0])
      assert.equal(Buffer.from(written.changes[0].data).toString(), 'edited')
    })
    context.isAndroidTauri = () => true
    context.invoke = async command => {
      assert.equal(command, 'open_source_workspace_archive')
      return { name: 'Dark', archive: Buffer.from(bytes).toString('base64') }
    }
    assert.equal(await context.loadSourceWorkspace(workspace), true)
  }
})

test('failed source writes stay unsaved even when the skin package is clean', async () => {
  const archive = SkinArchive.fromFiles(new Map([['Info.txt', strToU8('Name=test')]]))
  const pendingSourcePaths = new Set()
  const context = run(declarations('sourcePathForWorkspace', 'scheduleSourceAutosave', 'flushSourceAutosave', 'hasUnsavedChanges', 'updateDirty'), {
    archive, sourceWorkspacePath: '/source', sourceWorkspacePrefix: '', pendingSourcePaths,
    dirty: {}, mobileDocumentStatus: {}, shareDocumentStatus: {},
    window: { setTimeout: () => 1 }, clearTimeout() {},
    writePendingSourcePaths, sourcePathLookup, rememberSourceWrite() {}, sourceSyncQueue: Promise.resolve(),
    invoke: async () => { throw new Error('write failed') },
  })
  // Undoing back to the package baseline still needs to update the source folder.
  context.scheduleSourceAutosave(['Info.txt'])
  assert.equal(archive.changed.size, 0)
  assert.equal(context.dirty.hidden, false)
  await assert.rejects(context.flushSourceAutosave(), /write failed/)
  assert.deepEqual([...pendingSourcePaths], ['Info.txt'])
  assert.equal(context.dirty.hidden, false)
  context.invoke = async () => {}
  await context.flushSourceAutosave()
  assert.equal(context.dirty.hidden, true)
})

test('full directory notifications keep pending local edits, additions and deletions while applying external changes', async () => {
  const archive = SkinArchive.fromFiles(new Map(['modified', 'added', 'remote', 'removed'].map(key => [`dark/port/${key}.ini`, strToU8(key)])))
  const paths = archive.sourcePaths.bind(archive)
  let enumerations = 0
  archive.sourcePaths = () => { enumerations++; return paths() }
  const noop = () => {}
  const pending = new Set(['port/modified.ini', 'port/added.ini', 'port/deleted.ini'])
  const context = run(declarations('refreshExternalSourceFiles', 'sourcePathForWorkspace', 'sourceWriteKey'), {
    sourcePathLookup, consumeSourceWriteSnapshot, archive, sourceWorkspacePath: '/dark', sourceWorkspacePrefix: 'dark/',
    sourceWriteSnapshots: new Map(), pendingSourcePaths: pending, navigator: { userAgent: '' },
    invoke: async () => [
      { path: '', data: null, directory: true },
      ...['modified', 'deleted', 'remote'].map(key => ({ path: `port/${key}.ini`, data: [...strToU8('on disk')], directory: false })),
    ],
    updateHistoryButtons: noop, renderFiles: noop, selectFile: noop, refreshBdaLayout: noop,
    refreshPreview: noop, populateKeyInspector: noop, updateDirty: noop, showStatus: noop,
  })
  await context.refreshExternalSourceFiles('/dark', [''])
  assert.equal(archive.getText('dark/skin/port/modified.ini'), 'modified')
  assert.equal(archive.getText('dark/skin/port/added.ini'), 'added')
  assert.equal(archive.getBytes('dark/skin/port/deleted.ini'), undefined)
  assert.equal(archive.getText('dark/skin/port/remote.ini'), 'on disk')
  assert.equal(archive.getBytes('dark/skin/port/removed.ini'), undefined)
  assert.deepEqual([...pending], ['port/modified.ini', 'port/added.ini', 'port/deleted.ini'])
  assert.equal(enumerations, 1, 'enumerate archive paths once per batch, not once per changed file')
})

test('a delayed source notification runs after writes and cannot refresh a replaced document', async () => {
  let release, fire
  const refreshed = []
  const context = run(declarations('queueSourceWatch'), {
    sourceWorkspacePath: '/source', archive: {}, sourceSyncQueue: new Promise(resolve => { release = resolve }),
    pendingSourceWatchPaths: new Set(), window: { setTimeout: fn => { fire = fn; return 1 } },
    refreshExternalSourceFiles: async (_, paths) => refreshed.push(...paths), showError: assert.fail,
  })
  context.queueSourceWatch(['first'], '/source')
  fire()
  const first = context.sourceSyncQueue
  assert.deepEqual(refreshed, [])
  release()
  await first
  assert.deepEqual(refreshed, ['first'])
  context.queueSourceWatch(['stale'], '/source')
  fire()
  context.archive = {}
  await context.sourceSyncQueue
  assert.deepEqual(refreshed, ['first'])
})
