import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { encodePng } from '../src/ssf/ssf-png.ts'

const png = color => encodePng({ width: 8, height: 4, data: new Uint8Array(Array.from({ length: 32 }, () => color).flat()) })
const files = unzipSync(bdsFixture())
files['light/port/cand1.cnd'] = strToU8('[CAND]\nVIEW_RECT=0,0,1080,120\n[ICON1]\nANCHOR_TYPE=1\nPOS=0,0\nSIZE=1080,120\nKEY=F14\n')
files['light/res/logo/pop_menu_icons.png'] = png([10, 20, 30, 255])
files['light/res/logo/pop_menu_icons.til'] = strToU8('[IMG26]\nSOURCE_RECT=0,0,4,4\n[IMG27]\nSOURCE_RECT=4,0,4,4\n')
files['light/res/replacement.png'] = png([240, 50, 60, 255])
files['light/res/replacement.til'] = strToU8('[IMG1]\nSOURCE_RECT=4,0,4,4\n')
files['light/res/default.css'] = strToU8(`${new TextDecoder().decode(files['light/res/default.css'])}\n[STYLE9]\nNM_IMG=replacement,1\n`)
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const ios of [false, true]) {
    const fixture = { ...files }
    if (ios) {
      fixture['light/res/logo/icon.png'] = png([10, 20, 30, 255])
      fixture['light/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist'] = strToU8('<plist><array><dict><key>Position</key><string>toolbar</string><key>Images</key><dict><key>Normal</key><dict><key>Normal</key><string>icon</string></dict></dict></dict></array></plist>')
    }
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#browser-open').setInputFiles({ name: 'toolbar.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync(fixture)) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await page.evaluate(async () => {
      const { selectFile } = await import('/src/app/navigation.ts')
      const { appState } = await import('/src/app/state.ts')
      const { populateKeyInspector } = await import('/src/app/key-inspector.ts')
      const { mode } = await import('/src/app/dom.ts')
      mode.value = 'edit'
      selectFile('light/port/cand1.cnd')
      appState.selectedToolbarSections = ['ICON1']
      populateKeyInspector()
    })
    const row = page.locator('[data-document-key="TOOLBAR_ICON_1"]')
    await row.waitFor()
    const path = ios ? 'light/skin/res/logo/icon.png' : 'light/skin/res/logo/pop_menu_icons.png'
    const snapshot = () => page.evaluate(async path => {
      const { appState } = await import('/src/app/state.ts')
      return { bytes: Array.from(appState.archive.getBytes(path)), undo: appState.undoStack.length }
    }, path)
    const before = await snapshot()
    const cardPreview = () => row.locator('canvas').evaluate(canvas =>
      Array.from(canvas.getContext('2d').getImageData(Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.5), 1, 1).data)
    )
    const previewBefore = await cardPreview()
    await row.getByRole('button', { name: '选择图标 1' }).click()
    const picker = page.frameLocator('#picker-frame')
    await picker.getByRole('button', { name: '全部图片' }).waitFor()
    await picker.getByRole('button', { name: '全部样式' }).waitFor()
    for (const name of ['键盘背景', '按键背景', '候选栏', '前景']) await picker.getByRole('button', { name }).waitFor()
    await picker.getByRole('option').filter({ hasText: 'replacement.png' }).click()
    await picker.getByRole('button', { name: '应用' }).click()
    const canvas = picker.locator('#picker-canvas')
    await canvas.waitFor({ state: 'visible' })
    const bounds = await canvas.boundingBox()
    await canvas.click({ position: { x: bounds.width / 2 + 2, y: bounds.height / 2 } })
    for (let attempt = 0; attempt < 100 && (await snapshot()).undo === before.undo; attempt++) await page.waitForTimeout(100)
    assert.equal((await snapshot()).undo, before.undo + 1, await page.locator('body').innerText())
    for (let attempt = 0; attempt < 100 && JSON.stringify(await cardPreview()) === JSON.stringify(previewBefore); attempt++) await page.waitForTimeout(100)
    assert.notDeepEqual(await cardPreview(), previewBefore, 'inspector card preview refreshes after replacement')
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
    const pixels = await page.evaluate(async path => {
      const { appState } = await import('/src/app/state.ts')
      const image = await createImageBitmap(new Blob([appState.archive.getBytes(path)]))
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close()
      return [Array.from(ctx.getImageData(0, 0, 1, 1).data), Array.from(ctx.getImageData(7, 0, 1, 1).data)]
    }, path)
    assert.deepEqual(pixels[0], [240, 50, 60, 255])
    assert.deepEqual(pixels[1], ios ? pixels[0] : [10, 20, 30, 255], 'other atlas tile is unchanged')
    await page.evaluate(async () => { const { undo } = await import('/src/app/edit-history.ts'); undo() })
    assert.deepEqual((await snapshot()).bytes, before.bytes, 'undo restores original PNG exactly')
    await page.evaluate(async () => { const { redo } = await import('/src/app/edit-history.ts'); redo() })
    assert.notDeepEqual((await snapshot()).bytes, before.bytes)
    const changed = await snapshot()
    await row.getByRole('button', { name: '选择图标 1' }).click()
    await picker.getByRole('option').filter({ hasText: 'replacement.png' }).waitFor()
    await picker.locator('#picker-close').click()
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
    await row.getByRole('button', { name: '选择图标 1' }).click()
    const imagesMode = picker.getByRole('button', { name: '全部图片' })
    const stylesMode = picker.getByRole('button', { name: '全部样式' })
    await stylesMode.click()
    await picker.getByRole('option').filter({ hasText: 'STYLE9' }).click()
    assert.equal(await picker.getByRole('button', { name: '应用' }).isDisabled(), false)
    await picker.getByRole('button', { name: '键盘背景' }).waitFor()
    await imagesMode.click()
    assert.equal(await picker.getByRole('button', { name: '按键背景' }).isVisible(), true)
    await picker.locator('#picker-close').click()
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
    assert.deepEqual(await snapshot(), changed, 'cancelling the resource picker does not change the skin')
    await page.evaluate(async () => {
      const { mode } = await import('/src/app/dom.ts')
      const { populateKeyInspector } = await import('/src/app/key-inspector.ts')
      mode.value = 'preview'
      populateKeyInspector()
    })
    await row.waitFor()
    assert.equal(await row.locator('.ui-style-ref-name').isDisabled(), true, 'preview mode is read-only')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`${ios ? 'iOS plist' : 'Android atlas'} toolbar: visible picker, replacement, isolation, undo/redo passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
