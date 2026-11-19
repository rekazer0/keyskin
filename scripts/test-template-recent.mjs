import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const url = `http://127.0.0.1:${server.httpServer.address().port}/`
const template = 'official-android-bds'
const savedPath = '/tmp/自定义皮肤.bds'

try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage(mobile ? {
      viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36',
    } : { viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.stack))
    await page.addInitScript(({ template, savedPath }) => {
      localStorage.setItem('onboarding-tour-v1', 'done')
      localStorage.setItem('source-directory-enabled', 'false')
      window.nativeReadPaths = []
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1,
        invoke: async (command, args) => {
          if (['take_opened_files', 'model_oauth_accounts', 'plugin:window|get_all_windows'].includes(command)) return []
          if (command === 'plugin:window|scale_factor') return 1
          if (command === 'choose_project_template') return template
          if (command === 'plugin:dialog|save') return savedPath
          if (command === 'write_binary_file') window.savedSkinSize = args.byteLength
          if (['skin_file_stamp', 'skin_file_size', 'read_file'].includes(command)) {
            window.nativeReadPaths.push(args.path)
            throw new Error('No local preview fixture')
          }
          return null
        },
      }
    }, { template, savedPath })
    await page.goto(url)
    const home = page.locator(mobile ? '#mobile-navigation [data-mobile-page=home]' : '[data-workspace-page=files]')
    const create = page.locator(mobile ? '#mobile-welcome-new' : `#new-project-form [data-template="${template}"]`)
    const recent = page.locator('#welcome-recent-grid .recent-card')
    const editor = page.locator('.canvas-wrap:not(.empty)')
    const ready = () => page.waitForFunction(() => !document.querySelector('#open').disabled)
    const records = () => page.evaluate(() => JSON.parse(localStorage.getItem('recent-files') || '[]'))
    await create.click()
    await editor.waitFor()
    await ready()
    await page.evaluate(async () => { window.originalArchive = (await import('/src/app/state.ts')).appState.archive })
    await home.click()
    await recent.waitFor()
    assert.equal(await recent.locator('.template-name').textContent(), '百度 BDS 旧版')
    await recent.locator('.template-preview[data-preview=rendered] img').waitFor()
    assert.equal((await records()).length, 1)
    assert.deepEqual(await page.evaluate(() => window.nativeReadPaths), [], 'template previews never read native paths')
    await recent.click()
    await editor.waitFor()
    assert.equal(await page.evaluate(async () => window.originalArchive === (await import('/src/app/state.ts')).appState.archive), true)

    await page.reload()
    await recent.waitFor()
    await recent.click()
    await editor.waitFor()
    await ready()
    assert.equal(await page.locator('#document-name').textContent(), '未命名.bds')
    assert.equal((await records()).length, 1, 'reopening a template record does not duplicate it')
    if (!mobile) {
      await page.evaluate(async () => {
        const { runFileOperation } = await import('/src/app/file-operations.ts')
        const { saveArchive } = await import('/src/app/archive-io.ts')
        await runFileOperation('保存', () => saveArchive(false, 'bds'))
      })
      await page.locator('#file-operation-dialog[data-outcome=success]').getByRole('button', { name: '继续编辑' }).click()
      assert.ok(await page.evaluate(() => window.savedSkinSize > 0))
      assert.deepEqual((await records()).map(({ path }) => path), [savedPath])
      await home.click()
      assert.equal(await recent.locator('.template-name').textContent(), '自定义皮肤.bds')
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Template recents passed: desktop and Android home, preview, resume, reopen, first save')
} finally {
  await browser.close()
  await server.close()
}
