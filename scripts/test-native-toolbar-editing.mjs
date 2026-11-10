import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'
import { nativeToolbarFixture } from '../tests/helpers/native-toolbar-fixture.mjs'
import { buildSxiZip } from '../src/palm/palm-export.ts'
import { encodePng } from '../src/ssf/ssf-png.ts'

const png = color => encodePng({ width: 8, height: 4, data: Uint8Array.from({ length: 128 }, (_, index) => color[index % 4]) })
const original = png([10, 20, 30, 255])
const replacement = png([240, 50, 60, 255])
const ssf = unzipSync(ssfFixture())
ssf['1080/status1/ime_function_multimedia.png'] = original
ssf['1080/status1/ime_function_multimedia_p.png'] = original
ssf['1080/status1/replacement.png'] = replacement
const fixtures = [{ format: 'ssf', bytes: zipSync(ssf), label: '菜单', target: '1080/status1/ime_function_multimedia.png', source: '1080/status1/replacement.png', count: 9 }]
for (const format of ['bdi', 'bds']) {
  const archive = await nativeToolbarFixture(format)
  archive.setBytes('light/skin/res/replacement.png', replacement)
  if (format === 'bds') {
    archive.setBytes('light/skin/res/logo/pop_menu_icons.png', original)
    archive.setText('light/skin/res/logo/pop_menu_icons.til', '[IMG26]\nSOURCE_RECT=0,0,4,4\n[IMG27]\nSOURCE_RECT=4,0,4,4\n')
    archive.delete('light/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist')
  }
  const converted = unzipSync(buildSxiZip(archive).bytes)
  if (format === 'bds') {
    const skin = JSON.parse(new TextDecoder().decode(converted['skin.json']))
    delete skin.default.menu
    converted['skin.json'] = strToU8(JSON.stringify(skin))
  }
  fixtures.push({ format: 'sxi', bytes: zipSync(converted), label: format === 'bdi' ? '键盘类型' : '表情',
    target: format === 'bdi' ? 'light/skin/res/logo/function_iphone@3x.png' : 'light/skin/res/logo/pop_menu_icons.png',
    source: 'light/skin/res/replacement.png', count: format === 'bdi' ? 3 : 4 })
}
const palm = unzipSync(readFileSync(new URL('../public/templates/palm-harmony.sxi', import.meta.url)))
palm['light/skin/res/replacement.png'] = replacement
fixtures.push({ format: 'sxi', bytes: zipSync(palm), label: '键盘类型', target: 'light/skin/res/logo/1.0/toolbarMenuItem_KBSwitch_Normal_iphone@3x.png', source: 'light/skin/res/replacement.png', count: 5, builtIn: true })
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const fixture of fixtures) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#browser-open').setInputFiles({ name: `toolbar.${fixture.format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(fixture.bytes) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    const selectToolbar = async () => {
      const point = await page.evaluate(async () => {
        const { toolbarPreview } = await import('/src/app/canvas-interaction.ts')
        await toolbarPreview.whenDrawn()
        const key = toolbarPreview.keys.find(key => key.editable) ?? toolbarPreview.keys[0]
        const box = toolbarPreview.canvas.getBoundingClientRect()
        return { x: box.x + (key.rect.x + key.rect.width / 2) / toolbarPreview.panelWidth * box.width,
          y: box.y + (key.rect.y + key.rect.height / 2) / toolbarPreview.panelHeight * box.height }
      })
      await page.mouse.click(point.x, point.y)
      await page.waitForFunction(() => document.querySelector('#candidate-area').getAttribute('aria-selected') === 'true')
    }
    await selectToolbar()
    const card = page.getByRole('button', { name: `更换${fixture.label}图标`, exact: true })
    await card.waitFor()
    assert.equal(await page.locator('.ui-toolbar-icon').count(), fixture.count)
    assert.deepEqual(await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      return appState.selectedToolbarSections
    }), [], 'the whole toolbar is selected instead of an individual button')
    const snapshot = () => page.evaluate(async path => {
      const { appState } = await import('/src/app/state.ts')
      return { bytes: Array.from(appState.archive.getBytes(path) ?? []), undo: appState.undoStack.length, json: appState.archive.isText('skin.json') ? appState.archive.getText('skin.json') : undefined }
    }, fixture.target)
    const before = await snapshot()
    await card.click()
    await page.locator('#picker-dialog').waitFor({ state: 'visible' })
    await page.evaluate(async source => {
      const { appState } = await import('/src/app/state.ts')
      appState.pickerTarget.selectImage(source, [4, 0, 4, 4])
    }, fixture.source)
    await page.waitForFunction(async undo => {
      const { appState } = await import('/src/app/state.ts')
      return appState.undoStack.length === undo + 1
    }, before.undo)
    await page.frameLocator('#picker-frame').locator('#picker-close').click()
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
    const after = await snapshot()
    if (fixture.builtIn) assert.equal(await page.evaluate(async path => {
      const { toolbarPreview } = await import('/src/app/canvas-interaction.ts')
      const scene = await toolbarPreview.sceneForState()
      return scene.keys.some(key => key.layers(false).fore.some(layer => layer.kind === 'image' && layer.visual.imagePath === path))
    }, fixture.target), true, 'new native icon artwork appears on the canvas')
    assert.notDeepEqual(after.bytes, before.bytes)
    assert.equal(after.json, before.json, 'replacing existing artwork preserves the native JSON declarations')
    const pixels = await page.evaluate(async path => {
      const { appState } = await import('/src/app/state.ts')
      const bitmap = await createImageBitmap(new Blob([appState.archive.getBytes(path)]))
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close()
      return [Array.from(ctx.getImageData(0, 0, 1, 1).data), Array.from(ctx.getImageData(canvas.width - 1, 0, 1, 1).data)]
    }, fixture.target)
    assert.deepEqual(pixels[0], [240, 50, 60, 255])
    if (fixture.target.includes('pop_menu_icons')) assert.deepEqual(pixels[1], [10, 20, 30, 255], 'other atlas slices remain intact')
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    await card.waitFor()
    assert.deepEqual(await snapshot(), before, 'undo restores the exact native resource and toolbar scope')
    assert.equal(await page.locator('#candidate-area').getAttribute('aria-selected'), 'true')
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).redo())
    assert.deepEqual(await snapshot(), after)
    if (fixture.format === 'ssf') {
      const missing = page.getByRole('button', { name: '更换剪贴板图标', exact: true })
      await missing.click()
      await page.evaluate(async source => {
        const { appState } = await import('/src/app/state.ts')
        appState.pickerTarget.selectImage(source)
      }, fixture.source)
      await page.waitForFunction(async () => {
        const { appState } = await import('/src/app/state.ts')
        return Boolean(appState.archive.getBytes('1080/status1/ime_function_clipboard.png'))
      })
      await page.frameLocator('#picker-frame').locator('#picker-close').click()
      await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
      assert.equal(await page.evaluate(async () => Boolean((await import('/src/app/state.ts')).appState.archive.getBytes('1080/status1/ime_function_clipboard.png'))), false)
    }
    await page.getByRole('button', { name: '交互预览', exact: true }).click()
    await card.waitFor()
    assert.equal(await card.isDisabled(), true)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`${fixture.format} ${fixture.target}: toolbar selection, replacement, isolation, undo/redo and read-only passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
