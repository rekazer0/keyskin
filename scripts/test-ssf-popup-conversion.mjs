// Convert an SSF, reopen the package and exercise its actual tap/hold/slide/release path.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'
import { convertSsfDocument, ssfDocumentBytes } from '../src/ssf/ssf-convert.ts'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'
import { acceptAskDialogs } from '../tests/helpers/ask-dialogs.mjs'

const read = path => new Uint8Array(readFileSync(new URL(path, import.meta.url)))
const templates = { sogou: SkinArchive.open(read('../public/sogou-template.bds')), bda: SkinArchive.open(read('../public/default-template.bda'), 'bda') }
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
    const context = document.querySelector('#hint-preview').getContext('2d')
    const draw = context.fillText.bind(context)
    context.clearRect = (clear => (...args) => { window.__popupTexts = []; clear(...args) })(context.clearRect.bind(context))
    context.fillText = (text, ...args) => { window.__popupTexts.push(text); draw(text, ...args) }
    window.__popupTexts = []
  })
  let checked = 0
  for (const format of ['bds', 'bdi']) {
    const { bytes } = await convertSsfDocument(source, format, templates)
    await page.locator('#browser-open').setInputFiles({ name: `气泡.${format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) for (const board of ['py_9', 'py_26']) {
      const path = `${theme}/skin/${orientation}/${board}.ini`
      const point = await page.evaluate(async ({ path, board }) => {
        await (await import('/src/app/navigation.ts')).selectFile(path)
        const preview = window.__popupPreview
        await preview.resolver?.ready?.()
        await preview.whenDrawn()
        const key = preview.keys.find(key => key.center === (board === 'py_9' ? 'b' : 'q'))
        if (!key) throw new Error(`Missing key: ${path}`)
        const box = preview.canvas.getBoundingClientRect()
        return { x: box.left + (key.rect.x + key.rect.width / 2) / preview.panelWidth * box.width, y: box.top + (key.rect.y + key.rect.height / 2) / preview.surfaceHeight * box.height, scale: box.width / preview.panelWidth }
      }, { path, board })
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.waitForFunction(() => window.__popupPreview.hintVisible && window.__popupTexts.length > 0)
      const expected = board === 'py_9' ? ['A', 'B', 'C', '2', 'a', 'b', 'c'] : ['Q', '1', 'q']
      await page.waitForFunction(() => window.__popupPreview.active?.direction === 'hold' && window.__popupPreview.active?.hintCellWidth > 0)
      assert.deepEqual(await page.evaluate(() => window.__popupTexts), expected, `${format} ${path}: long-press characters`)
      if (checked === 0 && process.env.SSF_POPUP_SHOT) await page.screenshot({ path: process.env.SSF_POPUP_SHOT })
      const held = await page.evaluate(() => ({ cellWidth: window.__popupPreview.active.hintCellWidth, index: window.__popupPreview.active.hintIndex ?? (window.__popupTexts.length === 7 ? 3 : 1) }))
      await page.mouse.move(point.x + held.cellWidth * point.scale, point.y)
      await page.waitForFunction(index => window.__popupPreview.active?.hintIndex === index, held.index + 1)
      await page.mouse.up()
      await page.waitForFunction(() => !window.__popupPreview.active && !window.__popupPreview.hintVisible)
      assert.deepEqual(await page.evaluate(() => window.__popupTexts), [], 'release clears the bubble')
      checked++
    }
  }
  assert.deepEqual(errors, [])
  console.log(`SSF popup conversion: ${checked} BDS/BDI views passed tap, hold, slide and release${sample ? ` (${sample})` : ''}`)
} catch (error) {
  await page.screenshot({ path: '/tmp/bdi-ssf-popup-failure.png' }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await server.close()
}
