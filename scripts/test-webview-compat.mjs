import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { chromium } from 'playwright'
import { build, preview } from 'vite'
import { mobilePenFixture } from '../tests/helpers/mobile-pen-fixture.mjs'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

const outDir = await mkdtemp(join(tmpdir(), 'keyskin-compat-'))
let server, browser
try {
  await build({ logLevel: 'error', build: { outDir } })
  server = await preview({ logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 4193, strictPort: false } })
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`
  browser = await chromium.launch()
  for (const [format, makeFixture] of [['bds', mobilePenFixture], ['ssf', ssfFixture]]) {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 9; Mobile; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/74.0.3729.186 Mobile Safari/537.36" })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      // Emulate the missing runtime APIs; this does not emulate the old layout engine.
      for (const [owner, name] of [
        [Array.prototype, 'at'], [Object, 'hasOwn'], [globalThis, 'structuredClone'],
        [Blob.prototype, 'arrayBuffer'], [Blob.prototype, 'stream'], [Element.prototype, 'replaceChildren'],
        [HTMLElement.prototype, 'showPopover'], [HTMLFormElement.prototype, 'requestSubmit'],
        [window, 'showSaveFilePicker'],
      ]) Reflect.deleteProperty(owner, name)
      const animate = Element.prototype.animate
      Element.prototype.animate = function (frames, options) {
        if (Array.isArray(frames) && frames[0]?.offset === 1) throw new DOMException('Partial keyframes are not supported.', 'NotSupportedError')
        return animate.call(this, frames, options)
      }
      localStorage.setItem('onboarding-tour-v1', 'done')
    })
    await page.goto(url)
    await page.locator('#mobile-welcome-open').waitFor()
    assert.equal(await page.locator('.titlebar:visible, .preview-zoom-control:visible').count(), 0)
    const chooser = page.waitForEvent('filechooser')
    await page.locator('#mobile-welcome-open').tap()
    await (await chooser).setFiles({ name: `Legacy.${format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(makeFixture()) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled && !document.querySelector('#save').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await page.getByRole('button', { name: '开始编辑', exact: true }).tap()
    await page.locator('#mobile-project-toggle').tap()
    const project = page.locator('#mobile-project-dialog')
    if (format === 'bds') {
      await project.getByText('拼音 26 键', { exact: true }).tap()
      await project.waitFor({ state: 'hidden' })
      const box = await page.locator('#preview').boundingBox()
      // KEY1 in the fixture is [20,20,93,128] in a 1080×600 panel.
      await page.touchscreen.tap(box.x + box.width * 67 / 1080, box.y + box.height * 84 / 600)
      const x = page.locator('[data-key-field="x"]')
      await x.waitFor()
      assert.equal(await x.inputValue(), '20')
      await x.fill('26')
      await x.press('Tab')
      await page.locator('#mobile-app-more > summary').tap()
      await page.locator('#mobile-app-more [data-mobile-action=mobile-export-open]').tap()
      await page.locator('#share-export').tap()
      const link = page.locator('#file-operation-dialog a[download]')
      await link.waitFor()
      await page.locator('#file-operation-close').tap()
      await link.waitFor({ state: 'detached' })
      await page.locator('#share-export').tap()
      const downloaded = page.waitForEvent('download')
      await link.tap()
      const bytes = await readFile(await (await downloaded).path())
      const files = unzipSync(bytes)
      const layout = Object.keys(files).find(path => path.endsWith('/py_26.ini'))
      assert.match(strFromU8(files[layout]), /\[KEY1\]\s+VIEW_RECT=26,20,93,128/)
      await page.keyboard.press('Escape')
      await page.locator('#file-operation-dialog[open]').waitFor({ state: 'hidden' })
      await page.keyboard.press('Escape')
      await page.locator('#share-dialog').waitFor({ state: 'hidden' })
    } else await project.locator('#mobile-files-close').tap()
    await page.locator('#mobile-navigation [data-mobile-page=resources]').tap()
    await page.locator('#mobile-resource-tabs').waitFor()
    await page.locator('#mobile-navigation [data-mobile-page=edit]').tap()
    await page.locator('#mobile-app-more > summary').tap()
    await page.locator('#mobile-app-more [data-mobile-action=mobile-source-view]').tap()
    await page.locator('#source-editor .cm-content').waitFor()
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(`PASS Chromium ${browser.version()}: production mobile import, BDS edit/download, resources and source with legacy APIs`)
} finally {
  await browser?.close()
  await server?.close()
  await rm(outDir, { recursive: true, force: true })
}
