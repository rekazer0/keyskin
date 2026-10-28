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
  await page.waitForSelector('.template-card')
  const result = await page.evaluate(async (files) => {
    const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js')
    const { loadSourceWorkspace } = await import('/src/app/archive-io.ts')
    const { appState } = await import('/src/app/state.ts')
    const { SkinArchive } = await import('/src/skin.ts')
    const { encodeBase64 } = await import('/src/app/source-workspace.ts')
    mockIPC((command) => {
      if (command === 'open_source_workspace') return files
      if (command === 'skin_file_size') return 1
      if (command === 'plugin:fs|watch') return 1
      if (command === 'plugin:window|get_all_windows') return []
    })
    try {
      await loadSourceWorkspace('/test/source', '/test/皮肤.ssf')
      const archive = appState.archive
      const saved = SkinArchive.open(archive.toBytes('ssf'), 'ssf')
      return {
        workspace: appState.sourceWorkspacePath,
        path: appState.currentPath,
        format: archive.format,
        dirty: archive.changed.size,
        hasPreview: appState.ssfSkeleton !== undefined,
        names: archive.names(),
        files: saved.sourceFiles().map((file) => ({ path: file.path, data: encodeBase64(file.data) })),
      }
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
  assert.deepEqual(errors, [])
  console.log('Source workspace: native Base64 payload opens with SSF preview, preserves edits and saves every original resource')
} finally {
  await browser.close()
  await server.close()
}
