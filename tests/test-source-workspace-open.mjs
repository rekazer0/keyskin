import { dismissStartupDisclaimer } from "../tests/helpers/open-editor-template.mjs"
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strToU8, unzipSync } from 'fflate'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

const files = unzipSync(ssfFixture())
files['phoneTheme.ini'] = strToU8('[General]\nskin_name=源码中修改的名称\n')
files['default/二进制.wav'] = Uint8Array.from({ length: 256 }, (_, i) => i)
const payload = Object.entries(files).map(([path, bytes]) => ({ path, data: Buffer.from(bytes).toString('base64') }))
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41877, strictPort: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ bypassCSP: true })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await dismissStartupDisclaimer(page)
  await page.waitForSelector('.template-card')
  const group = page.locator('#settings-panel-files .settings-group')
  assert.equal(await group.count(), 1, 'File settings uses a single group')
  assert.equal(await group.locator('#recent-history-limit').count(), 1)
  const storage = group.locator('#settings-storage-section')
  assert.equal(await storage.getAttribute('hidden'), '', 'browser still hides native source storage')
  const result = await page.evaluate(async (files) => {
    const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js')
    const { loadSourceWorkspace } = await import('/src/app/archive-io.ts')
    const { appState } = await import('/src/app/state.ts')
    const { SkinArchive } = await import('/src/skin.ts')
    const { encodeBase64 } = await import('/src/app/source-workspace.ts')
    const { commitText, prepareDocumentReplacement } = await import('/src/app/edit-history.ts')
    const writeStarted = Promise.withResolvers()
    const writeFinished = Promise.withResolvers()
    mockIPC((command, args) => {
      if (command === 'open_source_workspace') return files
      if (command === 'skin_file_size') return 1
      if (command === 'plugin:fs|watch') return 1
      if (command === 'plugin:window|get_all_windows') return []
      if (command === 'apply_source_changes') {
        writeStarted.resolve(args)
        return writeFinished.promise
      }
    })
    try {
      await loadSourceWorkspace('/test/source', '/test/皮肤.ssf')
      const archive = appState.archive
      const saved = SkinArchive.open(archive.toBytes('ssf'), 'ssf')
      const opened = {
        workspace: appState.sourceWorkspacePath,
        path: appState.currentPath,
        format: archive.format,
        dirty: archive.changed.size,
        hasPreview: appState.ssfSkeleton !== undefined,
        names: archive.names(),
        files: saved.sourceFiles().map((file) => ({ path: file.path, data: encodeBase64(file.data) })),
      }
      const badge = document.querySelector('#dirty')
      const shareStatus = document.querySelector('#share-document-status')
      const path = 'phoneTheme.ini'
      const edited = archive.getText(path).replace('源码中修改的名称', '编辑器自动保存')
      commitText(path, archive.getText(path), edited)
      const queuedDirty = !badge.hidden
      const write = await Promise.race([writeStarted.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('源码未自动写入')), 3000))])
      const writingDirty = !badge.hidden
      writeFinished.resolve()
      await appState.sourceSyncQueue
      return { ...opened, autosave: {
        queuedDirty, writingDirty, savedDirty: !badge.hidden, status: shareStatus.textContent,
        write, packageDirty: archive.changed.size, canLeave: await prepareDocumentReplacement(),
      } }
    } finally {
      appState.stopSourceWatch?.()
      clearMocks()
    }
  }, payload)
  assert.equal(result.workspace, '/test/source')
  assert.equal(result.path, '/test/皮肤.ssf')
  assert.equal(result.format, 'ssf')
  assert.equal(result.dirty, 0)
  assert.equal(result.hasPreview, true)
  // The skeleton the canvas draws is a separate package; the skin holds only its own files.
  assert.deepEqual(result.names, payload.map((file) => file.path).sort())
  assert.deepEqual(result.files.sort((a, b) => a.path.localeCompare(b.path)), payload.sort((a, b) => a.path.localeCompare(b.path)))
  assert.deepEqual(result.autosave, {
    queuedDirty: true, writingDirty: true, savedDirty: false, status: '已写入本地源码文件夹',
    write: { path: '/test/source', changes: [{ path: 'phoneTheme.ini', data: [...strToU8('[General]\nskin_name=编辑器自动保存\n')], directory: false }] },
    packageDirty: 1, canLeave: true,
  })
  const retention = await page.evaluate(async bytes => {
    const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js')
    const { appState } = await import('/src/app/state.ts')
    const { loadNativePath, openSkinBytes } = await import('/src/app/archive-io.ts')
    const { applySourceDirectory } = await import('/src/app/source-workspace.ts')
    const calls = []
    mockIPC((command, args) => {
      if (command === 'prepare_source_directory') return args.path
      if (command === 'open_source_workspace') return calls.find(call => call.workspace === args.path)?.files
      if (command === 'skin_file_size') return 1
      if (command === 'create_source_workspace') {
        const workspace = `${args.directory}/${args.name.replace(/\.ssf$/, '')}`
        calls.push({ ...args, workspace })
        return workspace
      }
      if (command === 'plugin:fs|watch') return 1
      if (command === 'plugin:window|get_all_windows') return []
    })
    try {
      await applySourceDirectory('/test/custom')
      const setting = document.querySelector('#recent-history-limit')
      const initialLimit = setting.valueAsNumber
      const historySizes = []
      for (const [limit, action] of [[5, 'cancel'], [2, 'save'], [0, 'save']]) {
        document.querySelector('#workspace-navigation [data-settings-entry="settings"]').click()
        document.querySelector('#settings-tab-files').click()
        setting.valueAsNumber = limit
        setting.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector(`#settings-${action}`).click()
        await openSkinBytes(Uint8Array.from(bytes), `/test/custom-${limit}.ssf`)
        while (appState.sourceWorkspacePendingArchive) await new Promise(resolve => setTimeout(resolve, 10))
        historySizes.push(JSON.parse(localStorage.getItem('recent-files')).length)
      }
      await loadNativePath('/test/custom-0.ssf')
      await appState.sourceWorkspaceCreation
      return {
        initialLimit,
        calls: calls.map(({ directory, sourceLimit, name }) => ({ directory, sourceLimit, name })),
        historySizes: historySizes.slice(1),
        reopenedWorkspace: appState.sourceWorkspacePath,
      }
    } finally {
      appState.stopSourceWatch?.()
      clearMocks()
    }
  }, [...ssfFixture()])
  assert.deepEqual(retention, {
    initialLimit: 27,
    calls: [27, 2, 0].map((sourceLimit, index) => ({ directory: '/test/custom', sourceLimit, name: `custom-${[5, 2, 0][index]}.ssf` })),
    reopenedWorkspace: '/test/custom/custom-0',
    historySizes: [2, 3],
  })
  await page.evaluate(() => {
    localStorage.setItem('source-auto-delete', 'false')
    localStorage.setItem('recent-history-limit', '5')
  })
  await page.reload()
  await page.waitForFunction(() => localStorage.getItem('source-auto-delete') === null)
  assert.equal(await page.locator('#recent-history-limit').inputValue(), '0', 'upgrading must not re-enable cleanup')
  assert.deepEqual(errors, [])
  console.log('Source workspace: native Base64 payload opens with SSF preview, preserves edits and saves every original resource; recent history and custom source directories share the saved retention limit')
} finally {
  await browser.close()
  await server.close()
}
