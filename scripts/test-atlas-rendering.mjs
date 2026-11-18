import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'

const root = new URL('..', import.meta.url).pathname
const output = `${root}/artifacts/atlas-rendering`
mkdirSync(output, { recursive: true })
const width = 2215, height = 2561
const cx = Math.floor(width / 2), cy = Math.floor(height / 2)
const region = [cx - 48, cy - 65, 97, 131]
const data = new Uint8Array(width * height * 4)
for (let y = cy - 19; y < cy + 19; y++) for (let x = cx - 24; x < cx + 24; x++) {
  const offset = (y * width + x) * 4
  data[offset + (x % 2 ? 2 : 0)] = 255
  data[offset + 3] = 255
}
const fixture = zipSync({
  ...unzipSync(bdsFixture()),
  'light/res/btn.png': encodePng({ width, height, data }),
  'light/res/btn.til': strToU8(`[IMG1]\nSOURCE_RECT=${region.join(',')}\n` + Array.from({ length: 32 }, (_, i) =>
    `[IMG${i + 2}]\nSOURCE_RECT=${cx + (i % 8 - 4) * 20},${cy + 70 + Math.floor(i / 8) * 16},18,14\n`).join('')),
})
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 41887, strictPort: false, hmr: false } })
await server.listen()
try {
  for (const [engine, dpr] of [[chromium, 1], [chromium, 2], [chromium, 3], [webkit, 2]]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr, reducedMotion: 'reduce' })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      await page.locator('#browser-open').setInputFiles({ name: 'atlas.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(fixture) })
      await page.waitForSelector('.canvas-wrap:not(.empty)')
      await page.waitForFunction(() => !document.querySelector('#open').disabled && (!document.querySelector('#file-operation-dialog').open || !document.querySelector('#file-operation-close').disabled))
      const close = page.locator('#file-operation-dialog[open] #file-operation-close')
      if (await close.isVisible()) await close.click()
      await page.getByRole('button', { name: '编辑模式', exact: true }).click()
      await page.locator('[data-workspace-page="resources"]').click()
      await page.locator('[data-resource-page="image"]').click()
      const card = page.locator('#resource-gallery .ui-image-card[data-path$="/btn.png"]')
      await card.dblclick()
      const dialog = page.locator('#atlas-editor-dialog')
      const surface = dialog.locator('.atlas-surface')
      await page.waitForFunction(width => document.querySelector('#workspace-image').naturalWidth === width && document.querySelector('#atlas-viewport').width > 1, width)
      const fittedPixels = await page.locator('#atlas-viewport').evaluate(canvas => canvas.width * canvas.height)
      await page.evaluate(() => {
        const box = document.querySelector('#atlas-canvas').getBoundingClientRect(), wrap = document.querySelector('.atlas-surface')
        for (let i = 0; i < 30; i++) wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, cancelable: true }))
      })
      await page.waitForFunction(() => document.querySelector('#atlas-viewport').getContext('2d').getTransform().a >= 4 * devicePixelRatio - 0.01)
      const rendering = await page.evaluate(() => {
        const plane = document.querySelector('#atlas-canvas'), canvas = document.querySelector('#atlas-viewport')
        const image = document.querySelector('#workspace-image'), bounds = canvas.getBoundingClientRect()
        return { width: canvas.width, height: canvas.height, cssWidth: bounds.width, cssHeight: bounds.height,
          planePixels: plane.width * plane.height, imageWidth: image.getBoundingClientRect().width }
      })
      assert.equal(rendering.imageWidth, width * 4, 'maximum zoom keeps the full logical image bounds')
      assert.equal(rendering.planePixels, 1, 'hit area does not allocate a full zoomed atlas buffer')
      assert.equal(rendering.width, Math.round(rendering.cssWidth * dpr))
      assert.equal(rendering.height, Math.round(rendering.cssHeight * dpr))
      assert.equal(rendering.width * rendering.height, fittedPixels, 'zooming does not grow the raster buffer')
      const wrap = await surface.boundingBox()
      const beforePan = await page.locator('#atlas-canvas').boundingBox()
      await page.mouse.move(wrap.x + wrap.width / 2, wrap.y + wrap.height / 2)
      await page.mouse.down({ button: 'middle' })
      await page.mouse.move(wrap.x + wrap.width / 2 + 40, wrap.y + wrap.height / 2 + 24, { steps: 4 })
      await page.mouse.up({ button: 'middle' })
      const afterPan = await page.locator('#atlas-canvas').boundingBox()
      assert.equal(afterPan.x - beforePan.x, 40)
      assert.equal(afterPan.y - beforePan.y, 24)
      assert.deepEqual(await dialog.locator('#workspace-image').boundingBox(), afterPan, 'image and hit area stay aligned during pan')
      const screenshot = decodePng(await page.screenshot({ path: `${output}/zoom-4x-${engine.name()}-dpr-${dpr}.png` }))
      for (let x = cx - 5; x < cx + 5; x++) {
        const px = Math.floor((afterPan.x + (x + 0.5) * 4) * dpr), py = Math.floor((afterPan.y + (cy + 0.5) * 4) * dpr)
        const offset = (py * screenshot.width + px) * 4
        assert.deepEqual([...screenshot.data.subarray(offset, offset + 4)], x % 2 ? [0, 0, 255, 255] : [255, 0, 0, 255], 'source pixels stay exact without interpolation')
      }
      await page.mouse.click(afterPan.x + cx * 4, afterPan.y + cy * 4)
      assert.equal(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.selectedTileIndex), 1, 'selection uses original coordinates after pan')
      if (dpr === 2) {
        const [x, y, w, h] = region
        await page.mouse.move(afterPan.x + (x + w) * 4, afterPan.y + (y + h) * 4)
        await page.mouse.down()
        await page.mouse.move(afterPan.x + (x + w - 2) * 4, afterPan.y + (y + h - 1) * 4)
        await page.mouse.up()
        assert.deepEqual(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.slices[0].source), [x, y, w - 2, h - 1], 'corner resizing still edits original image coordinates')
      }

      const start = { x: Math.round(wrap.x + wrap.width / 2), y: Math.round(wrap.y + wrap.height / 2) }
      await page.mouse.move(start.x, start.y)
      await page.mouse.down({ button: 'middle' })
      const beforeBurst = await dialog.locator('#atlas-canvas').boundingBox()
      const batching = await page.evaluate(async start => {
        const canvas = document.querySelector('#atlas-viewport'), context = canvas.getContext('2d'), clear = context.clearRect.bind(context)
        const preview = document.querySelector('#tile-preview').getContext('2d'), previewClear = preview.clearRect.bind(preview)
        const mutations = new MutationObserver(() => panelUpdates++)
        let clears = 0, imageDraws = 0, previewClears = 0, panelUpdates = 0
        context.clearRect = (...args) => { clears++; clear(...args) }
        const draw = context.drawImage.bind(context)
        context.drawImage = (...args) => { imageDraws++; draw(...args) }
        preview.clearRect = (...args) => { previewClears++; previewClear(...args) }
        mutations.observe(document.querySelector('#atlas-editor-dialog .ui-dialog-header'), { subtree: true, childList: true, attributes: true })
        const wrap = document.querySelector('.atlas-surface')
        for (let i = 1; i <= 50; i++) wrap.dispatchEvent(new PointerEvent('pointermove', { clientX: start.x + i, clientY: start.y + i }))
        const immediate = clears
        await new Promise(requestAnimationFrame)
        mutations.disconnect()
        delete context.clearRect
        delete context.drawImage
        delete preview.clearRect
        return { immediate, clears, imageDraws, previewClears, panelUpdates }
      }, start)
      await page.mouse.up({ button: 'middle' })
      const afterBurst = await dialog.locator('#atlas-canvas').boundingBox()
      assert.equal(afterBurst.x - beforeBurst.x, 50, 'frame batching keeps the latest drag position')
      assert.deepEqual(batching, { immediate: 0, clears: 1, imageDraws: 0, previewClears: 0, panelUpdates: 0 }, 'pan repaints only the guides, at most once per frame')

      await page.mouse.move(wrap.x + 16, wrap.y + 16)
      await page.mouse.down()
      await page.mouse.move(wrap.x + 40, wrap.y + 32, { steps: 4 })
      await page.mouse.up()
      const afterLeftDrag = await dialog.locator('#atlas-canvas').boundingBox()
      assert.deepEqual([afterLeftDrag.x - afterBurst.x, afterLeftDrag.y - afterBurst.y], [24, 16], 'dragging blank space with the left button also pans')

      await page.locator('#atlas-zoom-fit').click()
      const mapping = await page.evaluate(async () => {
        const { drawAtlas, atlasPoint } = await import('/src/app/tile-editing.ts')
        drawAtlas()
        const box = document.querySelector('#atlas-canvas').getBoundingClientRect()
        return atlasPoint({ clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 })
      })
      assert.deepEqual(mapping, { x: width / 2, y: height / 2 })
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await card.click()
      await page.waitForFunction(() => document.querySelector('#atlas-viewport').width === 1 && document.querySelector('#atlas-viewport').height === 1)
      assert.equal(await page.locator('#workspace-image').isVisible(), false, 'the base image only renders in the atlas dialog')
      assert.deepEqual(errors, [])
      console.log(`${engine.name()} DPR ${dpr}: exact pixels, ${rendering.width} × ${rendering.height} overlay, 50 pan events → 1 guide redraw, 0 PNG/preview/panel redraws`)
    } finally {
      await browser.close()
    }
  }
} finally {
  await server.close()
}
