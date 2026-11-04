// Exercise the real mobile menu and packaging flow with a gesture-gated Web Share stub.
// The operating-system share sheet and receiving Baidu app still require an iPhone.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'

const root = new URL('..', import.meta.url).pathname
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
let browser
try {
  browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch()
  const source = SkinArchive.open(readFileSync(`${root}/public/default-template.bds`), 'bds').toBytes('bdi')
  for (const activation of ['missing', 'active']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, bypassCSP: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Version/16.0 Mobile Safari/604.1',
    })
    try {
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.addInitScript((activation) => {
        Object.defineProperty(navigator, 'userActivation', { value: activation === 'missing' ? undefined : { isActive: true } })
        globalThis.shareCalls = []
        globalThis.shareOutcome = 'success'
        let inClick = false
        document.addEventListener('click', () => {
          inClick = true
          setTimeout(() => { inClick = false }, 0)
        }, true)
        Object.defineProperty(navigator, 'canShare', { value: () => true })
        Object.defineProperty(navigator, 'share', { configurable: true, value: (data) => {
          if (!inClick) return Promise.reject(new DOMException('A fresh tap is required', 'NotAllowedError'))
          globalThis.shareCalls.push(data.files[0])
          return globalThis.shareOutcome === 'success' ? Promise.resolve()
            : Promise.reject(new DOMException('Share failed', globalThis.shareOutcome))
        } })
      }, activation)
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      await page.evaluate(async () => {
        const { SkinArchive } = await import('/src/skin.ts')
        const exportBytes = SkinArchive.prototype.toBytesAsync
        SkinArchive.prototype.toBytesAsync = async function (...args) {
          await new Promise((resolve) => setTimeout(resolve, 30))
          return exportBytes.apply(this, args)
        }
      })
      await page.locator('#browser-open').setInputFiles({ name: '分享回归.bdi', mimeType: 'application/octet-stream', buffer: Buffer.from(source) })
      await page.waitForFunction(() => document.querySelector('#document-name').textContent === '分享回归.bdi' && !document.querySelector('#open').disabled)
      const close = page.locator('#file-operation-dialog[open] #file-operation-close')
      if (await close.isVisible()) await close.click()
      const share = async () => {
        await page.locator('.pen-file-menu summary').click()
        await page.locator('#mobile-share').click()
      }
      await share()
      const tap = page.locator('#file-operation-dialog[open] button', { hasText: /^分享$/ })
      await tap.waitFor({ state: 'visible' })
      assert.equal(await page.evaluate(() => shareCalls.length), 0, 'do not share automatically after asynchronous export')
      await tap.click()
      // 成功不弹模态框：进度框随之关闭，结果只写状态栏。
      await page.locator('#file-operation-dialog').waitFor({ state: 'hidden' })
      const shared = await page.evaluate(async () => ({ name: shareCalls[0].name, bytes: [...new Uint8Array(await shareCalls[0].arrayBuffer())] }))
      assert.equal(shared.name, '分享回归.bdi')
      assert.equal(SkinArchive.open(Uint8Array.from(shared.bytes), 'bdi').format, 'bdi', 'share a real BDI archive')
      for (const outcome of ['AbortError', 'NotAllowedError']) {
        await page.evaluate((outcome) => { globalThis.shareOutcome = outcome }, outcome)
        await share()
        await tap.waitFor({ state: 'visible' })
        await tap.click()
        if (outcome === 'AbortError') {
          await page.locator('#file-operation-dialog').waitFor({ state: 'hidden' })
          continue
        }
        await page.waitForSelector('#file-operation-dialog[data-outcome="error"]')
        assert.equal(await tap.count(), 0, 'remove the completed action button')
        await close.click()
      }
      await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined }))
      await share()
      await page.waitForSelector('#file-operation-dialog[data-outcome="error"]')
      assert.match(await page.locator('#file-operation-result').textContent(), /不支持系统文件分享/)
      await close.click()
      assert.deepEqual(errors, [])
      console.log(`PASS: iOS activation=${activation}: fresh tap, valid BDI, cancellation, rejection, unsupported-browser feedback`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser?.close()
  await server.close()
}
