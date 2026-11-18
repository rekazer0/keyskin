import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { SkinArchive } from '../src/skin.ts'
import { bdaPlatform } from '../src/bda-platform.ts'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41873, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
mkdirSync('.ui-current', { recursive: true })
try {
  for (const colorScheme of ['light', 'dark']) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport, colorScheme, acceptDownloads: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => { window.showSaveFilePicker = undefined; localStorage.setItem('onboarding-tour-v1', 'done') })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    assert.equal(await page.locator('#mobile-export-open').isDisabled(), true)
    await page.locator('#browser-open').setInputFiles({ name: '分享页面.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(bdsFixture()) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled && !document.querySelector('#file-operation-dialog').open)
    await page.evaluate(async () => (await import('/src/app/navigation.ts')).selectFile('light/port/py_26.ini'))
    const original = await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      return { path: appState.selectedPath, changes: [...appState.archive.changed] }
    })
    const open = async () => {
      if (await page.locator('#workspace-export').isVisible()) await page.locator('#workspace-export').click()
      else if (await page.locator('#mobile-share-page').isVisible()) await page.locator('#mobile-share-page').click()
      else if (await page.locator('#mobile-app-more > summary').isVisible()) {
        await page.locator('#mobile-app-more > summary').click()
        await page.locator('[data-mobile-action="mobile-export-open"]').click()
      } else await page.locator('#mobile-export-open').evaluate(button => button.click())
    }
    await open()
    const share = page.locator('#share-page')
    await share.waitFor({ state: 'visible' })
    assert.equal(await page.locator('.pen-file-menu, #mobile-export-dialog').count(), 0, 'removed menu and export modal are absent')
    assert.equal(await page.locator('dialog:modal').count(), 0, 'share is a page, not a modal')
    assert.equal(await share.locator('h1').evaluate(node => node === document.activeElement), true, JSON.stringify(await page.evaluate(() => ({ active: document.activeElement.outerHTML, viewport: innerWidth, inert: [...document.querySelectorAll('[inert]')].map(n => n.tagName + '.' + n.className) }))))
    assert.equal(await share.locator('#share-document-name').textContent(), '分享页面.bds')
    assert.equal(await share.locator('#share-document-format').textContent(), 'BDS')
    assert.equal(await share.locator('#share-adb-action').isVisible(), false, 'web hides unsupported ADB')
    assert.equal(await share.locator('#share-target-label').textContent(), '分享到百度输入法')
    assert.equal(await share.locator('input:checked').inputValue(), 'bds')
    assert.deepEqual(await share.locator('label:visible input').evaluateAll(inputs => inputs.map(input => input.value)), ['bdi', 'bds', 'bda:ios', 'bda:android', 'sxi', 'ssf'])
    for (const platform of ['ios', 'android']) {
      const bda = share.locator(`input[value="bda:${platform}"]`)
      assert.equal(await bda.isDisabled(), true, 'BDI/BDS cannot convert to BDA')
      assert.match(await bda.locator('..').textContent(), /暂不支持/)
    }
    const saveGroup = share.getByRole('region', { name: '保存与另存为', exact: true })
    const sendGroup = share.getByRole('region', { name: '分享到输入法', exact: true })
    assert.equal(await saveGroup.locator('#save, #share-export').count(), 2)
    assert.equal(await sendGroup.locator('#mobile-share, #adb-share').count(), 2)
    assert.equal(await share.locator('#share-export').textContent(), '另存为')
    assert.equal(await share.evaluate(node => getComputedStyle(node).backgroundColor), await page.locator('.titlebar').evaluate(node => getComputedStyle(node).backgroundColor))
    assert.match(await share.locator('#share-resource-check').textContent(), /资源检查/)
    const box = await share.boundingBox()
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, JSON.stringify(box))
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
    await share.locator(".ui-share-content").evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)))
    await page.screenshot({ path: `.ui-current/share-page-${viewport.width}-${colorScheme}.png` })
    await share.locator('#share-back').click()
    await share.waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      return { path: appState.selectedPath, changes: [...appState.archive.changed] }
    }), original, 'return preserves document and selection')
    await open()
    const selected = share.locator('input[value="bdi"]')
    await selected.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await share.locator('input:checked').inputValue(), 'bds')
    const pending = page.waitForEvent('download')
    await page.keyboard.press('Enter')
    const downloadButton = page.locator('#file-operation-dialog[open] button', { hasText: /^下载$/ })
    if (await Promise.race([pending.then(() => false), downloadButton.waitFor().then(() => true)])) await downloadButton.click()
    const file = await pending
    assert.match(file.suggestedFilename(), /\.bds$/)
    assert.ok(SkinArchive.open(readFileSync(await file.path()), 'bds').names().length > 0)
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const operation = share.locator('#file-operation-dialog')
    assert.equal(await operation.getAttribute('data-inline'), 'true')
    assert.equal(await page.locator('dialog:modal').count(), 0, 'export progress stays in the page')
    assert.equal(await operation.locator('#file-operation-title').textContent(), '另存为完成')
    assert.equal(await operation.locator('#file-operation-progress').getAttribute('value'), '100')
    await page.screenshot({ path: `.ui-current/share-export-${viewport.width}-${colorScheme}.png` })
    await operation.locator('#file-operation-close').click()
    await operation.waitFor({ state: 'hidden' })
    if (viewport.width === 1440) {
      const save = page.waitForEvent('download')
      await share.locator('#save').click()
      const download = page.locator('#file-operation-dialog[open] button', { hasText: /^下载$/ })
      if (await Promise.race([save.then(() => false), download.waitFor().then(() => true)])) await download.click()
      assert.match((await save).suggestedFilename(), /\.bds$/)
      await page.waitForFunction(() => !document.querySelector('#open').disabled)
      assert.match(await operation.locator('#file-operation-title').textContent(), /已保存/)
      assert.equal(await page.locator('dialog:modal').count(), 0)
      await operation.locator('#file-operation-close').click()
    }
    await page.keyboard.press('Escape')
    await share.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    await page.close()
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const bda = readFileSync(new URL('../public/default-template.bda', import.meta.url))
  const platform = bdaPlatform(SkinArchive.open(bda, 'bda'))
  assert.notEqual(platform, 'unknown')
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: '分享页面.bda', mimeType: 'application/octet-stream', buffer: bda })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.locator('#workspace-export').click()
  assert.equal(await page.locator('#share-page input:checked').inputValue(), `bda:${platform}`)
  assert.equal(await page.locator('#share-page label:visible').count(), 6)
  assert.equal(await page.locator('#share-page input[data-export-format="bda"]:disabled').count(), 0, 'BDA source supports both platforms')
  await page.close()
  console.log('分享页面：桌面/手机/横屏、浅色/深色、格式可达性、键盘、真实导出与保存、页内进度、返回保留编辑状态均通过')
} finally {
  await browser.close()
  await server.close()
}
