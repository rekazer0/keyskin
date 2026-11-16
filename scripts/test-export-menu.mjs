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
    await page.addInitScript(() => { window.showSaveFilePicker = undefined })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    assert.equal(await page.locator('#mobile-export-open').isDisabled(), true)
    await page.locator('#browser-open').setInputFiles({ name: '菜单.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(bdsFixture()) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled && !document.querySelector('#file-operation-dialog').open)
    await page.evaluate(async () => (await import('/src/app/navigation.ts')).selectFile('light/port/py_26.ini'))
    const open = async () => {
      assert.equal(await page.locator('.pen-file-menu [data-export-format], .pen-file-menu #undo, .pen-file-menu #redo').count(), 0)
      assert.equal(await page.locator('.pen-file-menu [role="menuitem"]').filter({ hasText: /导出/ }).count(), 1)
      if (await page.locator('.pen-file-menu > summary').isVisible()) {
        await page.locator('.pen-file-menu > summary').click()
        await page.locator('#mobile-export-open').click()
      } else {
        await page.locator('#mobile-app-more > summary').click()
        await page.locator('#mobile-app-more [data-mobile-action="mobile-export-open"]').click()
      }
    }
    const dialog = page.locator('#mobile-export-dialog')
    await open()
    assert.equal(await dialog.locator('button[value="cancel"]').evaluate(button => button === document.activeElement), true)
    assert.equal(await dialog.locator('input:checked').inputValue(), 'bds')
    assert.deepEqual(await dialog.locator('label:visible input').evaluateAll(inputs => inputs.map(input => input.value)), ['bdi', 'bds', 'sxi', 'ssf'])
    const rows = await dialog.locator('label:visible').evaluateAll(labels => labels.map(label => {
      const { top, bottom } = label.getBoundingClientRect()
      return { top, bottom }
    }))
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].top - rows[i - 1].bottom <= 8.1, '隐藏格式不留下空行')
    const bounds = await dialog.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height)
    const footer = await dialog.locator('.ui-dialog-footer').boundingBox()
    assert.ok(footer.y >= 0 && footer.y + footer.height <= viewport.height, '操作按钮始终可见')
    await dialog.evaluate(dialog => Promise.all(dialog.getAnimations().map(animation => animation.finished)))
    await page.screenshot({ path: `.ui-current/export-menu-${viewport.width}-${colorScheme}.png` })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('#file-operation-dialog').isVisible(), false)
    await open()
    await dialog.locator('button[value="cancel"]').click()
    await dialog.waitFor({ state: 'hidden' })
    await open()
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    if (viewport.width === 1440) {
      await open()
      await page.mouse.click(0, 0)
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await page.locator('#file-operation-dialog').isVisible(), false)
    }
    await open()
    const selected = dialog.locator('input[value="bdi"]')
    await selected.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await dialog.locator('input:checked').inputValue(), 'bds')
    const pending = page.waitForEvent('download')
    await page.keyboard.press('Enter')
    const downloadButton = page.locator('#file-operation-dialog[open] button', { hasText: /^下载$/ })
    if (await Promise.race([pending.then(() => false), downloadButton.waitFor().then(() => true)])) await downloadButton.click()
    const file = await pending
    assert.match(file.suggestedFilename(), /\.bds$/)
    assert.ok(SkinArchive.open(readFileSync(await file.path()), 'bds').names().length > 0)
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    await page.locator('#file-operation-close').click()
    await page.locator('#file-operation-dialog').waitFor({ state: 'hidden' })
    if (viewport.width === 1440) {
      await page.evaluate(async () => {
        const { appState } = await import('/src/app/state.ts')
        const { commitText } = await import('/src/app/edit-history.ts')
        const { selectChoice } = await import('/src/app/mobile-layout.ts')
        selectChoice(document.querySelector('#mode'), 'edit')
        window.menuOriginalInfo = appState.archive.getText('Info.txt')
        commitText('Info.txt', window.menuOriginalInfo, window.menuOriginalInfo + '\n; menu history check')
      })
      await page.locator('#desktop-undo').click()
      assert.equal(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.archive.getText('Info.txt') === window.menuOriginalInfo), true)
      await page.locator('#desktop-redo').click()
      assert.match(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.archive.getText('Info.txt')), /menu history check/)
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const bda = readFileSync(new URL('../public/default-template.bda', import.meta.url))
  const platform = bdaPlatform(SkinArchive.open(bda, 'bda'))
  assert.notEqual(platform, 'unknown')
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: '菜单.bda', mimeType: 'application/octet-stream', buffer: bda })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.locator('.pen-file-menu > summary').click()
  await page.locator('#mobile-export-open').click()
  assert.equal(await page.locator('#mobile-export-dialog input:checked').inputValue(), `bda:${platform}`)
  assert.equal(await page.locator('#mobile-export-dialog label:visible').count(), 6)
  await page.close()
  console.log('导出菜单：桌面/手机/横屏、浅色/深色、格式可达性、焦点、取消、方向键、Enter 真实导出与顶部撤销重做均通过')
} finally {
  await browser.close()
  await server.close()
}
