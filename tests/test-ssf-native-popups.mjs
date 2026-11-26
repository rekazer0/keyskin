// Native SSF long-press bars, fonts and composing backgrounds, through real pointer events.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'
import { ssfDocumentBytes } from '../src/ssf/ssf-convert.ts'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'
import { acceptAskDialogs } from '../tests/helpers/ask-dialogs.mjs'

const sample = process.env.SSF_SKIN_PATH
const source = SkinArchive.open(await ssfDocumentBytes(sample ? new Uint8Array(readFileSync(sample)) : ssfFixture()), 'ssf')
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41961, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await acceptAskDialogs(page)
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.evaluate(async () => {
    window.__popupPreview = (await import('/src/app/canvas-interaction.ts')).preview
    const onEvent = window.__popupPreview.onEvent
    window.__popupPreview.onEvent = event => { window.__popupEvent = event; onEvent(event) }
    const context = document.querySelector('#hint-preview').getContext('2d')
    const draw = context.fillText.bind(context)
    context.clearRect = (clear => (...args) => { window.__popupTexts = []; clear(...args) })(context.clearRect.bind(context))
    context.fillText = (text, ...args) => { window.__popupTexts.push(text); draw(text, ...args) }
    window.__popupTexts = []
  })
  let checked = 0
  const bytes = source.toBytes('ssf')
  await page.locator('#browser-open').setInputFiles({ name: '气泡.ssf', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await page.waitForFunction(() => document.querySelector('#document-name').textContent === '气泡.ssf' && !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible() && await close.isEnabled()) await close.click().catch(() => {})
  for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) for (const [board, action, expected] of [
    ['py_9', 'b', ['A', 'B', 'C', '2', 'a', 'b', 'c']],
    ['py_9', 'k', ['J', 'K', 'L', '5', 'j', 'k', 'l']],
    ['py_9', 'q', ['P', 'Q', 'R', 'S', '7', 'p', 'q', 'r', 's']],
    ['py_26', 'q', ['Q', '1', 'q']],
  ]) {
    const path = `${theme}/skin/${orientation}/${board}.ini`
    const point = await page.evaluate(async ({ path, board, action }) => {
      const dom = await import('/src/app/dom.ts')
      dom.theme.value = path.split('/')[0]
      dom.orientation.value = path.split('/')[2]
      dom.layout.value = `${board}.ini`
      ;(await import('/src/app/ssf-preview.ts')).switchSsfPreviewLayout(path)
      const preview = window.__popupPreview
      await preview.resolver?.ready?.()
      await preview.sceneForState()
      await document.fonts.ready
      await preview.whenDrawn()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const key = preview.keys.find(key => key.center === action)
      if (!key) throw new Error(`Missing key: ${path}`)
      const box = preview.canvas.getBoundingClientRect()
      return { x: box.left + (key.rect.x + key.rect.width / 2) / preview.panelWidth * box.width, y: box.top + (key.rect.y + key.rect.height / 2) / preview.surfaceHeight * box.height, scale: box.width / preview.panelWidth }
    }, { path, board, action })
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.waitForFunction(() => window.__popupPreview.active?.direction === 'center')
    assert.equal(await page.evaluate(() => window.__popupPreview.hintVisible), false, `${path}: tapping has no text bubble`)
    assert.deepEqual(await page.evaluate(() => window.__popupTexts), [], `${path}: tapping draws no popup text`)
    await page.waitForFunction(() => window.__popupPreview.active?.direction === 'hold' && window.__popupPreview.active?.hintCellWidth > 0)
    assert.deepEqual(await page.evaluate(() => window.__popupTexts), expected, `${path}: long-press characters`)
    const native = await page.evaluate(async () => {
      const preview = window.__popupPreview
      const key = preview.drawnScene.keys.find(key => key.section === preview.active.key.section)
      const popup = key.holdPopup
      const layers = popup.layers(popup.selected)
      return { width: layers[0].rect.width, height: layers[0].rect.height, y: layers[0].rect.y, keyY: key.rect.y, cell: layers[1], texts: layers.slice(2).map(layer => layer.text) }
    })
    assert.ok(native.width > native.cell.rect.width * expected.length, 'bar has space between cells and at both ends')
    assert.ok(Math.abs(native.y + native.height - native.keyY) < 1, 'bar sits directly above its own row')
    assert.ok(native.cell.radius > 0, 'selected character has a rounded background')
    if (sample) assert.ok(native.texts.every(text => text.font?.startsWith('BdiEmbeddedFont')), 'long-press uses the embedded skin font')
    if (checked === 1 && process.env.SSF_POPUP_SHOT) await page.screenshot({ path: process.env.SSF_POPUP_SHOT })
    const held = await page.evaluate(() => ({ cellWidth: window.__popupPreview.active.hintCellWidth, index: window.__popupPreview.drawnScene.keys.find(key => key.section === window.__popupPreview.active.key.section).holdPopup.selected }))
    await page.mouse.move(point.x + held.cellWidth * point.scale, point.y)
    await page.waitForFunction(index => window.__popupPreview.active?.hintIndex === index, held.index + 1)
    await page.mouse.up()
    await page.waitForFunction(() => !window.__popupPreview.active && !window.__popupPreview.hintVisible)
    assert.deepEqual(await page.evaluate(() => window.__popupTexts), [], 'release clears the bubble')
    assert.equal(await page.evaluate(() => window.__popupEvent.code), expected[held.index + 1], 'release inputs the selected character')
    const input = await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      const canvas = document.querySelector('#candidate-input-background')
      return { textLeft: document.querySelector('#candidate-input-text').getBoundingClientRect().left - document.querySelector('#candidate-input-box').getBoundingClientRect().left, pixel: [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data], visual: Boolean(appState.candidateInputBar?.visual), fullWidth: appState.candidateInputBar?.metrics.fullWidth }
    })
    assert.ok(input.visual && input.pixel[3] === 255, 'composing row preserves the skin background')
    if (input.fullWidth) assert.ok(input.textLeft >= 0 && input.textLeft < 40, 'short Sogou input starts at the left of its full-width background')
    if (checked === 1 && process.env.SSF_POPUP_SHOT) await page.screenshot({ path: process.env.SSF_POPUP_SHOT.replace('.png', '-input.png') })
    checked++
  }
  const disabled = await page.evaluate(async () => {
    const { hintPreviewEnabled } = await import('/src/app/dom.ts')
    hintPreviewEnabled.checked = false
    hintPreviewEnabled.dispatchEvent(new Event('change'))
    const preview = window.__popupPreview
    const scene = await preview.sceneForState()
    await preview.whenDrawn()
    return scene.keys.every(key => !key.holdPopup)
  })
  assert.equal(disabled, true, 'disabling bubble previews clears long-press scenes')
  assert.deepEqual(errors, [])
  console.log(`SSF native popup: ${checked} views passed tap, hold, slide and release${sample ? ` (${sample})` : ''}`)
} catch (error) {
  await page.screenshot({ path: '/tmp/bdi-ssf-native-popup-failure.png' }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await server.close()
}
