import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, unzipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { declarations, run } from './helpers/app-source.mjs'
import { ssfFixture } from './helpers/ssf-fixture.mjs'

function workspaceContext(files, loadArchive) {
  return run(declarations('loadSourceWorkspace', 'themeFolderPrefix', 'decodeBase64Archive', 'sourceArchiveFromFiles'), {
    SkinArchive, Uint8Array, TextDecoder, atob,
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
