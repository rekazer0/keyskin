import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const archive = SkinArchive.open(bdsFixture())
const layout = 'light/skin/port/py_26.ini'
const pop = 'light/skin/port/hint1.pop'
archive.setText(layout, '[PANEL]\nSIZE=1125,592\n[HINT]\nLAYOUT_NAME=hint1\n[KEY1]\nVIEW_RECT=335,153,214,148\nLEFT=j\nCENTER=k\nRIGHT=l\nUP=5\nDOWN=F44\n[KEY2]\nVIEW_RECT=513,0,142,143\nCENTER=y\nUP=3\nDOWN=Z+9tool4\n')
archive.setText('light/skin/port/9tool4.ini', '[PANEL]\nSIZE=1125,592\n[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=F4\n')
archive.setText(pop, '[GLOBAL]\nICON_NUM=1\n[HINT]\n[BAR]\nBACK_ICON=1\nCELL_STYLE=24\nCELL_SIZE=90,116\n[ICON1]\nBACK_STYLE=23\nFORE_STYLE=21\nSIZE=120,180\nPOS=0,-20\nPADDING=30,32,30,32\n')
archive.setText('light/skin/res/default.css', '[STYLE21]\nFONT_SIZE=70\nNM_COLOR=3d3d3e\nHL_COLOR=ffffff\n[STYLE23]\nNM_COLOR=ffffff\n[STYLE24]\nNM_COLOR=00ffffff\nHL_COLOR=001aff\n')
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41951, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, hasTouch: true })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const select = path => page.evaluate(async path => (await import('/src/app/navigation.ts')).selectFile(path), path)
const point = (section = 'KEY1') => page.evaluate(async section => {
  const { preview } = await import('/src/app/canvas-interaction.ts')
  await preview.whenDrawn()
  const key = preview.keys.find(key => key.section === section)
  const box = preview.canvas.getBoundingClientRect()
  return { x: box.left + (key.rect.x + key.rect.width / 2) / preview.panelWidth * box.width, y: box.top + (key.rect.y + key.rect.height / 2) / preview.surfaceHeight * box.height, scale: box.width / preview.panelWidth }
}, section)
const state = () => page.evaluate(async () => {
  const { preview } = await import('/src/app/canvas-interaction.ts')
  await preview.whenDrawn()
  return { direction: preview.active?.direction, visible: preview.hintVisible, texts: window.__hintTexts, cellWidth: preview.active?.hintCellWidth }
})
const resetTexts = () => page.evaluate(() => { window.__hintTexts = [] })
const waitForBubble = () => page.waitForFunction(() => window.__hintPreview.active?.direction === 'hold' && window.__hintPreview.hintVisible && window.__hintTexts.some(item => item.text === '5'))
const group = () => page.locator('#document-fields > section').filter({ has: page.locator('.document-section-code:text-is("ICON1")') }).first()
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'bubble.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(archive.toBytes('bds')) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await select(layout)
  await page.evaluate(async () => {
    window.__hintPreview = (await import('/src/app/canvas-interaction.ts')).preview
    const context = document.querySelector('#hint-preview').getContext('2d')
    const draw = context.fillText.bind(context)
    window.__hintTexts = []
    context.clearRect = (clear => (...args) => { window.__hintTexts = []; clear(...args) })(context.clearRect.bind(context))
    context.fillText = (text, ...args) => { window.__hintTexts.push({ text, color: context.fillStyle, font: context.font }); draw(text, ...args) }
  })
  const p = await point()
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  assert.equal((await state()).visible, false, 'BAR-only skins do not show a tap bubble')
  await waitForBubble()
  const held = await state()
  assert.deepEqual(held.texts.map(item => item.text), ['J', 'K', 'L', '5', 'j', 'k', 'l'])
  assert.equal(held.texts.find(item => item.text === '5').color, '#ffffff')
  assert.equal(held.cellWidth, 90, 'CELL_SIZE is used instead of a panel-width guess')
  await page.mouse.move(p.x + 90 * p.scale, p.y)
  await page.waitForFunction(() => window.__hintPreview.active?.hintIndex === 4)
  assert.equal((await state()).texts.find(item => item.text === 'j').color, '#ffffff')
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('#event-log').textContent.includes('HOLD · j'))
  await page.waitForFunction(() => !window.__hintPreview.hintVisible)
  assert.deepEqual((await state()).texts, [], 'release clears the overlay')

  // Touch long presses use the same bubble; edit-mode touch selection remains separate.
  const client = await page.context().newCDPSession(page)
  await resetTexts()
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] })
  await waitForBubble()
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForFunction(() => !window.__hintPreview.active)

  const y = await point('KEY2')
  await page.mouse.move(y.x, y.y)
  await page.mouse.down()
  await page.waitForFunction(() => window.__hintPreview.active?.direction === 'hold' && window.__hintTexts.some(item => item.text === '3'))
  assert.deepEqual((await state()).texts.map(item => item.text), ['Y', '3', 'y'], 'page-switch actions cannot overflow into an 18-key bubble')
  assert.equal((await state()).texts.find(item => item.text === '3').color, '#ffffff')
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('#event-log').textContent.includes('HOLD · 3'))
  assert.equal(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.layoutPath), layout, 'long hold does not open the swipe target')
  await page.waitForFunction(() => !window.__hintPreview.active)
  await page.mouse.move(y.x, y.y)
  await page.mouse.down()
  await page.mouse.move(y.x, y.y + 40 * y.scale)
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('#event-log').textContent.includes('已切换预览到 9tool4.ini'))
  await select(layout)

  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await select(pop)
  assert.match(await group().locator('h3').textContent(), /气泡图案 1/)
  const sourceBefore = await page.evaluate(async pop => (await import('/src/app/state.ts')).appState.archive.getText(pop), pop)
  const posY = group().locator('[data-document-key="POS"]').getByRole('spinbutton', { name: '位置Y', exact: true })
  await posY.fill('-45')
  await posY.press('Tab')
  assert.equal(await page.evaluate(async () => (await import('/src/app/canvas-interaction.ts')).preview.longHint.icons.get('1').position[1]), -45, 'editing a bubble updates its preview model immediately')
  await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
  assert.equal(await page.evaluate(async pop => (await import('/src/app/state.ts')).appState.archive.getText(pop), pop), sourceBefore)
  await page.evaluate(async () => (await import('/src/app/edit-history.ts')).redo())
  assert.equal(await page.evaluate(async () => (await import('/src/app/canvas-interaction.ts')).preview.longHint.icons.get('1').position[1]), -45)
  assert.equal(await group().locator('[data-document-key="BACK_STYLE"] .ui-style-ref').count(), 1)
  assert.equal(await group().locator('[data-document-key="FORE_STYLE"] .ui-style-ref').count(), 1)
  const background = group().locator('[data-document-key="BACK_STYLE"]').getByRole('textbox', { name: '样式 1 编号', exact: true })
  await background.fill('24')
  await background.press('Tab')
  assert.equal(await page.evaluate(async () => (await import('/src/app/canvas-interaction.ts')).preview.longHint.icons.get('1').backStyle), '24')
  await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
  assert.equal(await page.evaluate(async () => (await import('/src/app/canvas-interaction.ts')).preview.longHint.icons.get('1').backStyle), '23')
  await page.getByRole('button', { name: '交互预览', exact: true }).click()
  assert.equal(await group().locator('[data-document-key="POS"] input').first().isDisabled(), true)
  await select(layout)
  await page.evaluate(async () => {
    const { hintPreviewEnabled } = await import('/src/app/dom.ts')
    hintPreviewEnabled.checked = false
    hintPreviewEnabled.dispatchEvent(new Event('change'))
  })
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.waitForTimeout(550)
  assert.equal((await state()).visible, false, 'the bubble preview switch still disables bubbles')
  await page.mouse.up()
  assert.deepEqual(errors, [])
  console.log('Bubble preview: implicit candidates, highlight, mouse/touch hold, sliding, release, editing, undo/redo and read-only passed')
} finally {
  await browser.close()
  await server.close()
}
