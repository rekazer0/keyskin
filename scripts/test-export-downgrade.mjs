import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'
import { buildSxiZip } from '../src/palm/palm-export.ts'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const archive = SkinArchive.open(bdsFixture(), 'bds')
archive.setText('light/res/anim.ini', Array.from({ length: 40 }, (_, i) => `[EXTRA${i + 1}]\nVALUE=1\n`).join(''))
archive.setText('dark/res/anim.ini', archive.getText('light/res/anim.ini'))
archive.setText('dark/res/default.css', archive.getText('light/res/default.css'))
const warnings = buildSxiZip(archive).warnings
const expected = [...new Set(warnings)].join('\n')
assert.ok(warnings.length > new Set(warnings).size, 'fixture includes warnings repeated between themes')
assert.ok(expected.split('\n').length > 8)
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41867, strictPort: false } })
await server.listen()
let browser
try {
  browser = await chromium.launch()
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      const activation = navigator.userActivation
      Object.defineProperty(navigator, 'userActivation', { value: { isActive: false } })
      window.exportEvents = []
      const showModal = HTMLDialogElement.prototype.showModal
      HTMLDialogElement.prototype.showModal = function () {
        window.exportEvents.push(this.id || 'confirmation')
        return showModal.call(this)
      }
      window.showSaveFilePicker = async () => {
        window.exportEvents.push('picker')
        assertPickerActivation()
        return { name: '测试.sxi', createWritable: async () => ({
          write: async bytes => { window.exportEvents.push('write'); window.exportSize = bytes.byteLength },
          close: async () => {},
        }) }
      }
      function assertPickerActivation() {
        if (!activation.isActive) throw new Error('save picker requires a fresh tap')
      }
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#browser-open').setInputFiles({ name: '降级.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(archive.toBytes()) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    await page.waitForFunction(() => !document.querySelector('#file-operation-dialog').open)
    const startExport = async () => {
      await page.evaluate(() => { window.exportEvents = [] })
      await page.locator('.pen-file-menu > summary').click()
      await page.locator('.pen-file-menu [data-export-format="sxi"]').click()
    }
    await startExport()
    const confirmation = page.locator('#file-operation-dialog')
    const continueExport = confirmation.getByRole('button', { name: '继续导出', exact: true })
    await continueExport.waitFor()
    await confirmation.evaluate(dialog => Promise.all(dialog.getAnimations().map(animation => animation.finished)))
    assert.deepEqual(await page.evaluate(() => window.exportEvents), ['file-operation-dialog'])
    assert.equal(await page.locator('dialog[open]').count(), 1)
    assert.equal(await confirmation.locator('#file-operation-result').textContent(), expected)
    assert.equal(await confirmation.locator('.ui-dialog-meter').isVisible(), true)
    const body = confirmation.locator('.ui-dialog-body')
    const scroll = await body.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, total: element.scrollHeight }))
    assert.equal(scroll.top, 0, 'long warnings start at the first item')
    assert.ok(scroll.total > scroll.height, 'only the complete warning list scrolls')
    const shell = await confirmation.evaluate(dialog => ({ height: dialog.getBoundingClientRect().height, total: dialog.scrollHeight, client: dialog.clientHeight }))
    assert.ok(shell.height <= Math.min(482, viewport.height - 30), 'dialog height stays bounded on desktop and mobile')
    assert.equal(shell.total, shell.client, 'dialog shell never scrolls')
    const header = await confirmation.locator('.ui-dialog-header').boundingBox()
    const footer = await confirmation.locator('.ui-dialog-footer').boundingBox()
    assert.ok(header.y >= 0 && footer.y + footer.height <= viewport.height, 'title and actions are visible before scrolling')
    await confirmation.screenshot({ path: `.ui-current/export-downgrade-${viewport.width}x${viewport.height}.png` })
    await body.hover()
    await page.mouse.wheel(0, 500)
    await page.waitForFunction(() => document.querySelector('#file-operation-result').scrollTop > 0)
    assert.deepEqual(await confirmation.locator('.ui-dialog-header').boundingBox(), header)
    assert.deepEqual(await confirmation.locator('.ui-dialog-footer').boundingBox(), footer)
    await body.focus()
    await page.keyboard.press('End')
    await page.waitForFunction(() => {
      const body = document.querySelector('#file-operation-result')
      return body.scrollTop + body.clientHeight >= body.scrollHeight - 1
    })
    await confirmation.locator('#file-operation-close').click()
    await confirmation.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    assert.deepEqual(await page.evaluate(() => window.exportEvents), ['file-operation-dialog'], 'cancel never opens a save picker or writes a file')
    await startExport()
    await continueExport.waitFor()
    await page.keyboard.press('Escape')
    await confirmation.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    assert.deepEqual(await page.evaluate(() => window.exportEvents), ['file-operation-dialog'], 'Escape cancels confirmation without writing')
    await startExport()
    await continueExport.waitFor()
    await continueExport.click()
    await page.waitForFunction(() => window.exportEvents.includes('write') || document.querySelector('#file-operation-detail').textContent.includes('轻点“保存”'))
    const save = page.locator('#file-operation-dialog[open] button', { hasText: /^保存$/ })
    if (await save.isVisible()) await save.click()
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    assert.deepEqual(await page.evaluate(() => window.exportEvents), ['file-operation-dialog', 'picker', 'write'])
    assert.ok(await page.evaluate(() => window.exportSize > 0))
    assert.equal(await page.locator('#file-operation-dialog').isVisible(), true)
    assert.equal(await page.locator('#file-operation-title').textContent(), '导出完成')
    assert.equal(await page.locator('#file-operation-progress').evaluate(meter => meter.value), 100)
    assert.match(await page.locator('#file-operation-result').textContent(), /测试.sxi\n保存位置：浏览器中选择的文件夹/)
    await page.locator('#file-operation-close').click()
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('PASS: one window shows progress, unique scrollable warnings, safe cancellation and the final result on desktop/mobile')
} finally {
  await browser?.close()
  await server.close()
}
