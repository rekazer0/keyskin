import { openEditorTemplate } from "../tests/helpers/open-editor-template.mjs"
// OS picker filtering still needs a device; verify the options and browser import flow here.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { SkinArchive } from '../src/skin.ts'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { hmr: false, host: '127.0.0.1', port: 41932, strictPort: false } })
await server.listen()
let browser
try {
  browser = await chromium.launch()
  for (const platform of ['Android', 'iPhone', 'desktop']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, bypassCSP: true,
      userAgent: platform === 'desktop' ? undefined : `Mozilla/5.0 (${platform}) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36`,
    })
    try {
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      if (platform === 'Android') await page.addInitScript(() => {
        // Reproduce older WebViews rejecting :has() in DOM queries during startup.
        const query = Element.prototype.querySelectorAll
        Element.prototype.querySelectorAll = function (selector) {
          if (selector.includes(':has(')) throw new DOMException('Invalid selector', 'SyntaxError')
          return query.call(this, selector)
        }
      })
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      await page.waitForSelector('.template-card', { state: 'attached' })
      const input = page.locator('#browser-open')
      assert.equal(await input.getAttribute('accept'), platform === 'desktop' ? '.bdi,.bds,.bda,.ssf,.mssf,.sxi' : null)
      if (platform === 'Android') {
        const picker = page.waitForEvent('filechooser')
        await page.locator('#mobile-welcome-open').click()
        await (await picker).setFiles({ name: '安卓搜狗.ssf', mimeType: 'application/octet-stream', buffer: Buffer.from(ssfFixture()) })
        await page.waitForFunction(() => document.querySelector('#document-name').textContent === '安卓搜狗.ssf' && !document.querySelector('#open').disabled)
        assert.ok(await page.locator('#preview').evaluate((canvas) => canvas.getBoundingClientRect().height > 20))
        assert.equal(await page.locator('#mode').inputValue(), 'preview')
        await page.getByRole('button', { name: '开始编辑', exact: true }).click()
        assert.equal(await page.locator('#mode').inputValue(), 'edit')
        await input.setInputFiles({ name: '无效.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') })
        await page.waitForFunction(() => document.querySelector('#event-log').dataset.kind === 'error')
        assert.match(await page.locator('#event-log').textContent(), /仅支持/)
        assert.equal(await page.locator('#document-name').textContent(), '安卓搜狗.ssf')

        // Even when the phone exposes a save picker, its provider can abort without showing UI.
        await input.setInputFiles({ name: '安卓百度.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(bdsFixture()) })
        await page.getByRole('button', { name: '不导出', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('#document-name').textContent === '安卓百度.bds' && !document.querySelector('#open').disabled)
        await page.evaluate(() => {
          window.picks = 0
          window.showSaveFilePicker = async () => {
            window.picks++
            throw new DOMException('Aborted', 'AbortError')
          }
          window.downloadClicks = []
          document.addEventListener('click', event => {
            if (event.target.closest('a[download]')) window.downloadClicks.push(event.isTrusted)
          }, true)
        })
        await page.locator('#mobile-app-more > summary').click()
        await page.getByRole('menuitem', { name: '分享与导出…', exact: true }).click()
        const operation = page.locator('#file-operation-dialog')
        const saveAs = page.getByRole('button', { name: '另存为', exact: true })
        const download = operation.getByRole('link', { name: '下载', exact: true })
        await saveAs.click()
        await download.waitFor()
        await operation.getByRole('button', { name: '取消', exact: true }).click()
        await operation.waitFor({ state: 'hidden' })
        assert.deepEqual(await page.evaluate(() => [window.picks, window.downloadClicks]), [0, []])
        await saveAs.click()
        await download.waitFor()
        const pending = page.waitForEvent('download')
        await download.click()
        const file = await pending
        assert.equal(file.suggestedFilename(), '安卓百度.bds')
        assert.equal(SkinArchive.open(readFileSync(await file.path()), 'bds').infoField('Name'), '测试皮肤')
        assert.deepEqual(await page.evaluate(() => [window.picks, window.downloadClicks]), [0, [true]])
        await page.waitForFunction(() => document.querySelector('#file-operation-progress').value === 100)
        assert.equal(await operation.locator('#file-operation-title').textContent(), '已发起下载')
        assert.match(await operation.locator('#file-operation-result').textContent(), /下载列表确认/)
      }
      if (platform === 'iPhone') {
        // iOS 只在点击里同步调用 click() 时弹选择框：先选文件，再询问是否导出当前皮肤。
        await openEditorTemplate(page, 'official-android-bds')
        await page.waitForFunction(() => !document.querySelector('#dirty').hidden)
        await page.waitForFunction(() => !document.querySelector('#file-operation-dialog').open && !document.querySelector('#open').disabled)
        assert.equal(await page.locator('#recent-files').isHidden(), true, '网页端不显示最近打开')
        const currentSkin = await page.locator('#document-name').textContent()
        await page.locator('#mobile-navigation [data-mobile-page="home"]').click()
        await page.locator('#mobile-welcome-open').waitFor()
        assert.equal(await page.locator('#document-name').textContent(), currentSkin, 'returning home keeps the current skin')
        assert.equal(await page.locator('#dirty').evaluate(node => node.hidden), false, 'returning home keeps unsaved changes')
        const pickReplacement = async () => {
          const picker = page.waitForEvent('filechooser')
          await page.locator('#mobile-welcome-open').click()
          return picker
        }
        const chooser = await pickReplacement()
        assert.equal(await page.getByRole('dialog', { name: '是否导出当前皮肤？' }).count(), 0)
        await chooser.setFiles({ name: '苹果搜狗.ssf', mimeType: 'application/octet-stream', buffer: Buffer.from(ssfFixture()) })
        const prompt = page.getByRole('dialog', { name: '是否导出当前皮肤？' })
        await prompt.getByRole('button', { name: '取消', exact: true }).click()
        await prompt.waitFor({ state: 'hidden' })
        assert.equal(await page.locator('#document-name').textContent(), currentSkin)
        assert.equal(await page.locator('#dirty').evaluate(node => node.hidden), false)
        await (await pickReplacement()).setFiles({ name: '苹果搜狗.ssf', mimeType: 'application/octet-stream', buffer: Buffer.from(ssfFixture()) })
        await prompt.getByRole('button', { name: '不导出', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('#document-name').textContent === '苹果搜狗.ssf' && !document.querySelector('#open').disabled)
        assert.equal(await page.locator('#mode').inputValue(), 'preview')
        assert.equal(await page.getByRole('button', { name: '开始编辑', exact: true }).isVisible(), true)
      }
      if (platform === 'desktop') {
        await input.setInputFiles({ name: '桌面搜狗.ssf', mimeType: 'application/octet-stream', buffer: Buffer.from(ssfFixture()) })
        await page.waitForFunction(() => document.querySelector('#document-name').textContent === '桌面搜狗.ssf' && !document.querySelector('#open').disabled)
        // Keep coverage of the desktop native-picker fallback and the exact packaged bytes.
        await page.evaluate(() => {
          window.showSaveFilePicker = async () => ({
            name: '桌面搜狗.ssf',
            createWritable: async () => ({
              write: async (bytes) => { window.attemptedWrite = [...bytes] },
              close: async () => { throw new DOMException('File state changed', 'InvalidStateError') },
              abort: async () => { window.abortedWrite = true },
            }),
          })
        })
        await page.locator('#mobile-app-more > summary').click()
        await page.getByRole('menuitem', { name: '分享与导出…', exact: true }).click()
        const operation = page.locator('#file-operation-dialog')
        await page.getByRole('button', { name: '另存为', exact: true }).click()
        const save = operation.getByRole('button', { name: '保存', exact: true })
        const download = operation.getByRole('button', { name: '下载', exact: true })
        if (await Promise.race([save.waitFor().then(() => true), download.waitFor().then(() => false)])) await save.click()
        await download.waitFor()
        assert.ok(await page.evaluate(() => window.abortedWrite))
        assert.match(await operation.locator('#file-operation-detail').textContent(), /无法写入所选位置/)
        const pending = page.waitForEvent('download')
        await download.click()
        const exported = await pending
        assert.equal(exported.suggestedFilename(), '桌面搜狗.ssf')
        assert.deepEqual(readFileSync(await exported.path()), Buffer.from(await page.evaluate(() => window.attemptedWrite)))
        await page.waitForFunction(() => document.querySelector('#file-operation-progress').value === 100)
        assert.match(await operation.locator('#file-operation-result').textContent(), /浏览器下载目录/)
      }
      assert.deepEqual(errors, [])
      console.log(`PASS: ${platform} file picker${platform === 'Android' ? ', SSF import, invalid-file rejection, BDS download and cancel' : platform === 'iPhone' ? ', picker before export prompt' : ''}`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser?.close()
  await server.close()
}
