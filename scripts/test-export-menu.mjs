import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { SkinArchive } from '../src/skin.ts'
import { bdaPlatform } from '../src/bda-platform.ts'
import { decodeBdaAppearance } from '../src/bda-decode.ts'

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
    await page.waitForSelector(".template-card", { state: "attached" })
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
    const share = page.locator('#share-dialog')
    await share.waitFor({ state: 'visible' })
    assert.equal(await page.locator('.pen-file-menu, #mobile-export-dialog').count(), 0, 'removed menu and export modal are absent')
    assert.equal(await page.locator('dialog:modal').count(), 1, 'share uses one modal')
    assert.ok(await share.evaluate(node => node.contains(document.activeElement)), 'focus remains inside the modal')
    assert.equal(await share.locator('#share-document-name').textContent(), '分享页面.bds')
    assert.equal(await share.locator('#share-document-format').textContent(), 'BDS')
    assert.equal(await share.locator('#share-adb-action').isVisible(), false, 'web hides unsupported ADB')
    assert.equal(await share.locator('#share-target-label').textContent(), '分享到百度输入法')
    assert.equal(await share.locator('input:checked').inputValue(), 'bds')
    assert.deepEqual(await share.locator('label:visible input').evaluateAll(inputs => inputs.map(input => input.value)), ['bdi', 'bds', 'bda:ios', 'bda:android', 'sxi', 'ssf'])
    assert.equal(await share.locator('input:disabled').count(), 0)
    const actions = share.getByRole('region', { name: '设备分享', exact: true })
    const formatsRegion = share.getByRole('region', { name: '格式', exact: true })
    const footer = share.locator('.ui-share-export-footer')
    assert.equal(await actions.locator('#save').count(), 0)
    assert.equal(await footer.locator('button:visible').count(), 1)
    assert.equal(await footer.locator('#save').isVisible(), true)
    assert.match(await share.locator('#share-resource-check').textContent(), /资源检查/)
    const box = await share.boundingBox()
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, JSON.stringify(box))
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
    await share.evaluate(node => Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished)))
    const shareAction = await actions.locator('.ui-share-action:visible').boundingBox()
    const formats = await formatsRegion.locator('label').evaluateAll(labels => labels.map(label => label.getBoundingClientRect().toJSON()))
    assert.equal(formats[0].x, shareAction.x, 'formats and device sharing align')
    assert.ok(formats.at(-1).y < shareAction.y, 'formats come first')
    const footerBox = await footer.boundingBox()
    const saveBox = await footer.locator('#save').boundingBox()
    assert.ok(Math.abs(saveBox.x + saveBox.width - footerBox.x - footerBox.width) < 1, 'primary action aligns to the right edge')
    const body = share.locator('.ui-share-content > .ui-dialog-body')
    await body.evaluate(node => { node.scrollTop = node.scrollHeight })
    assert.deepEqual(await footer.boundingBox(), footerBox, 'footer stays visible when the dialog body scrolls')
    assert.ok(box.y + box.height - footerBox.y - footerBox.height < 32, 'footer anchors to the bottom edge')
    await body.evaluate(node => { node.scrollTop = 0 })
    for (let i = 0; i < formats.length; i += 2) {
      const [left, right] = formats.slice(i, i + 2)
      assert.ok(left.x < right.x && left.y === right.y && Math.abs(left.width - right.width) < 1 && left.height === right.height, 'every format pair aligns in two equal columns')
    }
    await page.screenshot({ path: `.ui-current/share-page-${viewport.width}-${colorScheme}.png` })
    await share.getByRole('button', { name: '关闭', exact: true }).click()
    await share.waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      return { path: appState.selectedPath, changes: [...appState.archive.changed] }
    }), original, 'return preserves document and selection')
    await open()
    const selected = share.locator('input[value="bds"]')
    await selected.focus()
    await page.keyboard.press('ArrowLeft')
    assert.equal(await share.locator('input:checked').inputValue(), 'bdi')
    assert.equal(await footer.locator('#save').isHidden(), true)
    assert.equal(await footer.locator('#share-export').isVisible(), true)
    const pending = page.waitForEvent('download')
    await page.keyboard.press('Enter')
    const downloadButton = page.locator('#file-operation-dialog[open] button', { hasText: /^下载$/ })
    if (await Promise.race([pending.then(() => false), downloadButton.waitFor().then(() => true)])) await downloadButton.click()
    const file = await pending
    assert.match(file.suggestedFilename(), /\.bdi$/)
    assert.ok(SkinArchive.open(readFileSync(await file.path()), 'bdi').names().length > 0)
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const operation = share.locator('#file-operation-dialog')
    assert.equal(await operation.getAttribute('data-inline'), 'true')
    assert.equal(await page.locator('dialog:modal').count(), 1, 'export progress stays in the same modal')
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
      assert.match((await save).suggestedFilename(), /\.bdi$/)
      await page.waitForFunction(() => !document.querySelector('#open').disabled)
      assert.match(await operation.locator('#file-operation-title').textContent(), /已保存/)
      assert.equal(await page.locator('dialog:modal').count(), 1)
      await operation.locator('#file-operation-close').click()
    }
    await page.keyboard.press('Escape')
    await share.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    await page.close()
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('onboarding-tour-v1', 'done')
    window.showSaveFilePicker = async ({ suggestedName }) => ({
      name: suggestedName,
      createWritable: async () => ({
        write: async bytes => { window.exported = Array.from(bytes) },
        close: async () => {},
      }),
    })
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  const share = page.locator('#share-dialog')
  const operation = page.locator('#file-operation-dialog')
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  const open = async (bytes, format) => {
    const replacing = await page.locator('.canvas-wrap:not(.empty)').count() > 0
    await page.locator('#browser-open').setInputFiles({ name: `转换.${format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
    if (replacing) await page.getByRole('button', { name: '不导出', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    if (await close.isVisible()) await close.click()
    await page.locator('#workspace-export').click()
  }
  const legacy = SkinArchive.open(bdsFixture(), 'bds')
  const converted = new Map()
  for (const format of ['bds', 'bdi']) {
    await open(legacy.toBytes(format), format)
    assert.equal(await share.locator('input:checked').inputValue(), format)
    for (const platform of ['ios', 'android']) {
      await page.evaluate(() => { window.exported = undefined })
      await share.locator(`input[value="bda:${platform}"]`).check()
      await share.locator('#share-export').click()
      await operation.getByRole('button', { name: '确认并继续', exact: true }).waitFor()
      assert.match(await operation.locator('#file-operation-result').textContent(), /官方面板布局/)
      assert.equal(await page.evaluate(() => window.exported), undefined, 'no write before compatibility confirmation')
      await operation.getByRole('button', { name: '确认并继续', exact: true }).click()
      const prompt = operation.getByRole('button', { name: '保存', exact: true })
      if (await Promise.race([page.waitForFunction(() => !!window.exported).then(() => false), prompt.waitFor().then(() => true)])) await prompt.click()
      await page.waitForFunction(() => !document.querySelector('#open').disabled)
      const bytes = Uint8Array.from(await page.evaluate(() => window.exported))
      const archive = SkinArchive.open(bytes, 'bda')
      assert.equal(archive.infoField('Name'), '测试皮肤')
      assert.equal(bdaPlatform(archive), platform, `${format} writes the requested BDA platform`)
      const appearance = decodeBdaAppearance(archive.getBytes('light/skin/port/appearanceConfig'))
      assert.ok(appearance.panels.has('py_26'), 'export contains a real keyboard panel')
      assert.equal(await share.locator('#file-operation-title').textContent(), '另存为完成')
      assert.equal(await share.locator('#share-document-format').textContent(), format.toUpperCase(), 'conversion does not replace the source')
      converted.set(platform, bytes)
      await close.click()
      await operation.waitFor({ state: 'hidden' })
    }
    await page.keyboard.press('Escape')
    await share.waitFor({ state: 'hidden' })
  }
  for (const [platform, bytes] of converted) {
    await open(bytes, 'bda')
    assert.equal(await share.locator('input:checked').inputValue(), `bda:${platform}`)
    assert.equal(await share.locator('#save').isVisible(), true)
    await share.locator(`input[value="bda:${platform === 'ios' ? 'android' : 'ios'}"]`).check()
    assert.equal(await share.locator('#share-export').isVisible(), true, 'switching BDA platform is Save As despite the same extension')
    await page.keyboard.press('Escape')
    await share.waitFor({ state: 'hidden' })
  }
  assert.deepEqual(errors, [])
  await page.close()
  console.log('分享弹窗：桌面/手机/横屏、浅色/深色、格式可达性、键盘、真实导出与保存、弹窗内进度、返回保留编辑状态均通过')
} finally {
  await browser.close()
  await server.close()
}
