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
  const labels = ['键盘类型', '移动光标', '表情', 'AI搜索', '皮肤壁纸', '键盘字体', '次遇', '剪贴板', '灵感语录', '快捷翻译', '超会写', '神句配图', '文字扫描', '语音输入', '音效与振动', '游戏键盘', '多语言设置', '切换繁体', '键盘手写', '调整高度', '单手模式', '夜间模式', '特技字体', 'Emoji密语', '语音速记', '滑行输入', '同步', '详细设置', '定制工具栏']
  for (const ios of [false, true]) {
    const fixture = { ...files }
    if (ios) {
      const items = Array.from({ length: 6 }, (_, index) => {
        const name = `icon${index + 1}`
        fixture[`light/res/logo/${name}.png`] = png([10, 20, 30, 255])
        const title = `<key>Name</key><string>${[17, 18, 26, 19, 20, 35][index]}</string><key>Titles</key><dict><key>Normal</key><dict><key>Normal</key><string>旧标题</string></dict></dict>`
        return `<dict><key>Position</key><string>${index < 4 ? 'toolbar' : 'menu'}</string>${title}<key>Images</key><dict><key>Normal</key><dict><key>Normal</key><string>${name}</string></dict></dict></dict>`
      })
      items.push('<dict><key>Name</key><string>14</string><key>Position</key><string>menu</string><key>Private</key><string>keep me</string><key>Images</key><dict><key>Normal</key><dict><key>Normal</key><string>missing/handwrite</string></dict></dict></dict>')
      fixture['light/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist'] = strToU8(`<plist><array>${items.join('')}</array></plist>`)
    }
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    const packaged = ios ? Object.fromEntries(Object.entries(fixture).map(([path, bytes]) => [
      path.startsWith('light/') ? path.replace('light/', 'skin/light/skin/') : `skin/${path}`, bytes,
    ])) : fixture
    await page.locator('#browser-open').setInputFiles({ name: `toolbar.${ios ? 'bdi' : 'bds'}`, mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync(packaged)) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await page.evaluate(async () => {
      const { selectFile } = await import('/src/app/navigation.ts')
      const { appState } = await import('/src/app/state.ts')
      const { populateKeyInspector } = await import('/src/app/key-inspector.ts')
      const { mode } = await import('/src/app/dom.ts')
      mode.value = 'edit'
      selectFile('light/skin/port/cand1.cnd')
      appState.selectedToolbarSections = ['ICON1']
      populateKeyInspector()
    })
    const iconIndex = ios ? 8 : 2
    const row = page.locator(`[data-document-key="TOOLBAR_ICON_${iconIndex}"]`)
    const replaceButton = page.getByRole('button', { name: `更换${ios ? labels[iconIndex - 1] : '键盘类型'}图标`, exact: true })
    await row.waitFor()
    assert.equal(await page.locator('[data-document-key^="TOOLBAR_ICON_"]').count(), ios ? 29 : 2, 'inspector lists every toolbar and menu icon')
    assert.equal(await page.locator('.ui-toolbar-icons .ui-style-ref').count(), 0, 'toolbar icons have their own component')
    assert.deepEqual(await page.locator('.ui-toolbar-icon-label').allTextContents(), ios ? labels : ['表情', '键盘类型'])
    const boxes = await page.locator('.ui-toolbar-icon-preview').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }))
    assert.ok(boxes.every(box => Math.abs(box.width - box.height) < 1), 'every icon preview is square')
    assert.ok(boxes[1].x > boxes[0].x && boxes[1].y === boxes[0].y, 'cards run horizontally')
    if (ios) assert.ok(boxes.at(-1).y > boxes[0].y, 'all icons wrap onto additional rows')
    if (ios) assert.equal(await page.evaluate(async () => {
      const { visualResolver } = await import('/src/app/bda-documents.ts')
      return (await visualResolver().resolveToolbarImages()).length
    }), 4, 'iOS canvas preview keeps its native four-icon limit')
    const path = ios ? 'light/skin/res/logo/icon6.png' : 'light/skin/res/logo/pop_menu_icons.png'
    const snapshot = () => page.evaluate(async path => {
      const { appState } = await import('/src/app/state.ts')
      return { bytes: Array.from(appState.archive.getBytes(path)), undo: appState.undoStack.length }
    }, path)
    const before = await snapshot()
    const cardPreview = () => row.locator('canvas').evaluate(canvas =>
      Array.from(canvas.getContext('2d').getImageData(Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.5), 1, 1).data)
    )
    const previewBefore = await cardPreview()
    await replaceButton.focus()
    await page.keyboard.press('Enter')
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
    assert.deepEqual(pixels[0], ios ? [240, 50, 60, 255] : [10, 20, 30, 255], 'other atlas tile is unchanged')
    assert.deepEqual(pixels[1], [240, 50, 60, 255], 'the selected icon is replaced at its original coordinates')
    await page.evaluate(async () => { const { undo } = await import('/src/app/edit-history.ts'); undo() })
    assert.deepEqual((await snapshot()).bytes, before.bytes, 'undo restores original PNG exactly')
    await page.evaluate(async () => { const { redo } = await import('/src/app/edit-history.ts'); redo() })
    assert.notDeepEqual((await snapshot()).bytes, before.bytes)
    const changed = await snapshot()
    await replaceButton.click()
    await picker.getByRole('option').filter({ hasText: 'replacement.png' }).waitFor()
    await picker.locator('#picker-close').click()
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
    await replaceButton.click()
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
    if (ios) {
      const menuPath = 'light/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist'
      for (const [label, imagePath, withoutPlist] of [
        ['键盘手写', 'light/skin/res/logo/missing/handwrite_iphone@3x.png', false],
        ['游戏键盘', 'light/skin/res/logo/1.0/toolbarMenuItem_function_panel_Normal_iphone@3x.png', false],
        ['游戏键盘', 'light/skin/res/logo/1.0/toolbarMenuItem_function_panel_Normal_iphone@3x.png', true],
      ]) {
        if (withoutPlist) await page.evaluate(async menuPath => {
          const { appState } = await import('/src/app/state.ts')
          const { populateKeyInspector } = await import('/src/app/key-inspector.ts')
          appState.archive.delete(menuPath)
          populateKeyInspector()
        }, menuPath)
        const button = page.getByRole('button', { name: `更换${label}图标`, exact: true })
        await button.locator('.ui-toolbar-icon-preview > svg').waitFor()
        const saved = await page.evaluate(async ({ menuPath, imagePath }) => {
          const { appState } = await import('/src/app/state.ts')
          return { menu: appState.archive.getBytes(menuPath) ? Array.from(appState.archive.getBytes(menuPath)) : null, image: appState.archive.getBytes(imagePath) ? Array.from(appState.archive.getBytes(imagePath)) : null, undo: appState.undoStack.length }
        }, { menuPath, imagePath })
        assert.equal(saved.image, null, 'missing artwork is not materialised while viewing the default')
        await button.click()
        await picker.getByRole('option').filter({ hasText: 'replacement.png' }).click()
        await picker.getByRole('button', { name: '应用' }).click()
        const canvas = picker.locator('#picker-canvas')
        await canvas.waitFor({ state: 'visible' })
        const bounds = await canvas.boundingBox()
        await canvas.click({ position: { x: bounds.width / 2 + 2, y: bounds.height / 2 } })
        await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
        await button.locator('canvas').waitFor()
        const applied = await page.evaluate(async ({ menuPath, imagePath }) => {
          const { appState } = await import('/src/app/state.ts')
          const { parseXmlPlist } = await import('/src/palm/palm-plist.ts')
          const entries = parseXmlPlist(appState.archive.getBytes(menuPath))
          return { hasImage: Boolean(appState.archive.getBytes(imagePath)), entries, undo: appState.undoStack.length }
        }, { menuPath, imagePath })
        assert.equal(applied.hasImage, true)
        assert.equal(applied.undo, saved.undo + 1, 'PNG and plist creation share one undo step')
        if (!withoutPlist) assert.equal(applied.entries.find(item => item.Name === '14').Private, 'keep me', 'unrelated XML fields survive adding an icon')
        if (label === '游戏键盘') {
          const entry = applied.entries.find(item => item.Name === '32')
          assert.equal(entry.Position, 'menu')
          assert.equal(entry.Images.Normal.Normal, '1.0/toolbarMenuItem_function_panel_Normal')
        }
        await page.evaluate(async () => { const { undo } = await import('/src/app/edit-history.ts'); undo() })
        await button.locator('.ui-toolbar-icon-preview > svg').waitFor()
        const restored = await page.evaluate(async ({ menuPath, imagePath }) => {
          const { appState } = await import('/src/app/state.ts')
          return { menu: appState.archive.getBytes(menuPath) ? Array.from(appState.archive.getBytes(menuPath)) : null, image: appState.archive.getBytes(imagePath) ? Array.from(appState.archive.getBytes(imagePath)) : null, undo: appState.undoStack.length }
        }, { menuPath, imagePath })
        assert.deepEqual(restored, saved, 'undo restores the exact plist and removes newly created image files')
      }
    }
    await page.locator('.inspector-filter-open').click()
    await page.locator('#inspector-filter').fill(ios ? '剪贴板' : '键盘类型')
    await page.waitForFunction(() => document.querySelectorAll('.ui-toolbar-icon:not([data-filter-miss])').length === 1)
    assert.equal(await replaceButton.isVisible(), true, 'toolbar icons can be filtered by their function')
    await page.locator('#inspector-filter').press('Escape')
    await page.locator('#inspector-filter').press('Escape')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(async () => {
      const { setMobilePane } = await import('/src/app/mobile-layout.ts')
      setMobilePane('inspector')
    })
    await replaceButton.scrollIntoViewIfNeeded()
    const mobileGrid = await page.locator('.ui-toolbar-icons').evaluate(grid => ({ width: grid.clientWidth, scroll: grid.scrollWidth }))
    assert.equal(mobileGrid.width, mobileGrid.scroll, 'wrapped icons do not overflow the mobile inspector')
    assert.equal(await page.locator('.ui-toolbar-icon:visible').count(), ios ? 29 : 2, 'mobile inspector keeps every icon')
    assert.equal(await page.locator('.ui-toolbar-icon-label').evaluateAll(nodes => nodes.every(node => node.scrollHeight === node.clientHeight)), true, 'function names are never clipped')
    await page.evaluate(async () => {
      const { mode } = await import('/src/app/dom.ts')
      const { populateKeyInspector } = await import('/src/app/key-inspector.ts')
      mode.value = 'preview'
      populateKeyInspector()
    })
    await row.waitFor()
    assert.equal(await replaceButton.isDisabled(), true, 'preview mode is read-only')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`${ios ? 'iOS plist' : 'Android atlas'} toolbar: visible picker, replacement, isolation, undo/redo passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
