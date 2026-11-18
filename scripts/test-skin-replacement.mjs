import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { SkinArchive } from '../src/skin.ts'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41938, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, acceptDownloads: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => { window.showSaveFilePicker = undefined; localStorage.setItem('onboarding-tour-v1', 'done') })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    const input = page.locator('#browser-open')
    const nextSkin = { name: '其他皮肤.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(bdsFixture()) }
    await input.setInputFiles({ ...nextSkin, name: '当前皮肤.bds' })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const confirmation = page.getByRole('dialog', { name: '是否导出当前皮肤？', exact: true })
    assert.equal(await confirmation.count(), 0, 'first open needs no confirmation')
    const share = page.locator('#share-page')
    const idle = () => page.waitForFunction(() => !document.querySelector('#open').disabled)
    const sameArchive = () => page.evaluate(async () => window.originalArchive === (await import('/src/app/state.ts')).appState.archive)
    await page.evaluate(async () => { window.originalArchive = (await import('/src/app/state.ts')).appState.archive })

    for (const changed of [false, true]) {
      if (changed) await page.evaluate(async () => {
        const { appState } = await import('/src/app/state.ts')
        const { commitText, updateDirty } = await import('/src/app/edit-history.ts')
        const before = appState.archive.getText('Info.txt')
        commitText('Info.txt', before, before + '\nExportBeforeOpen=kept\n')
        updateDirty()
      })
      if (viewport.width === 1440) {
        await page.locator('[data-workspace-page="files"]').click()
        const pendingChooser = page.waitForEvent('filechooser')
        pendingChooser.catch(() => {})
        await page.locator('#welcome-recent-open').click()
        const chooser = await pendingChooser
        assert.equal(await confirmation.count(), 0, 'file selection precedes the export prompt')
        await chooser.setFiles(nextSkin)
      } else await input.setInputFiles(nextSkin)
      await confirmation.waitFor()
      assert.equal(await confirmation.getByRole('button', { name: '取消', exact: true }).evaluate(node => node === document.activeElement), true)
      await page.keyboard.press('Escape')
      await confirmation.waitFor({ state: 'hidden' })
      await idle()
      assert.equal(await sameArchive(), true, 'cancel keeps the current skin')

      await input.setInputFiles(nextSkin)
      await confirmation.getByRole('button', { name: '去分享导出', exact: true }).click()
      await idle()
      await share.waitFor({ state: 'visible' })
      assert.equal(await sameArchive(), true, 'export keeps the current skin')
      assert.equal(await share.locator('#share-document-name').textContent(), '当前皮肤.bds')
      assert.equal(await page.locator('.canvas-wrap.empty').count(), 0, 'share leaves the file page')
      assert.equal(await share.locator('#share-export').isEnabled(), true, 'export is usable after the open operation ends')
      assert.equal(await page.locator('#browser-open').inputValue(), '', 'the same file can be chosen again')
      if (changed) {
        const pending = page.waitForEvent('download')
        await share.locator('#share-export').click()
        const download = page.locator('#file-operation-dialog[open] button', { hasText: /^下载$/ })
        if (await Promise.race([pending.then(() => false), download.waitFor().then(() => true)])) await download.click()
        const file = await pending
        const exported = SkinArchive.open(readFileSync(await file.path()), 'bds')
        assert.match(exported.getText('Info.txt'), /ExportBeforeOpen=kept/, 'the export contains the current edits')
        await idle()
        await page.locator('#file-operation-close').click()
      }
      await share.locator('#share-back').click()
      await share.waitFor({ state: 'hidden' })
    }

    // 新建模板同样先保护当前皮肤。
    if (viewport.width === 1440) {
      await page.evaluate(async () => {
        const { recordRecentFile } = await import('/src/app/recent-files.ts')
        document.querySelector('.welcome-recent').removeAttribute('data-platform-hidden')
        recordRecentFile('/tmp/其他皮肤.bds', '其他皮肤.bds')
      })
      await page.locator('[data-workspace-page="files"]').click()
      await page.locator('#welcome-recent-grid [data-recent="/tmp/其他皮肤.bds"]').click()
      await confirmation.getByRole('button', { name: '去分享导出', exact: true }).click()
      await idle()
      await share.waitFor({ state: 'visible' })
      assert.equal(await sameArchive(), true, 'recent-file replacement also preserves the current skin for export')
      await share.locator('#share-back').click()
      await page.locator('[data-workspace-page="files"]').click()
      const template = page.locator('#file-project-chooser [data-template="default-android"]')
      await template.click()
      await confirmation.getByRole('button', { name: '去分享导出', exact: true }).click()
      await idle()
      await share.waitFor({ state: 'visible' })
      assert.equal(await sameArchive(), true)
      await share.locator('#share-back').click()
    }
    await input.setInputFiles(nextSkin)
    await confirmation.getByRole('button', { name: '不导出', exact: true }).click()
    await idle()
    assert.equal(await page.locator('#document-name').textContent(), '其他皮肤.bds')
    assert.equal(await sameArchive(), false, 'declining export opens the selected skin')
    assert.equal(await confirmation.count(), 0, 'no second save prompt')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`skin replacement ${viewport.width}px: saved/unsaved, cancel, share navigation, actual export and continue opening passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
