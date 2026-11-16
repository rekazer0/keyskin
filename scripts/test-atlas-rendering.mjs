import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { encodePng } from '../src/ssf/ssf-png.ts'

const root = new URL('..', import.meta.url).pathname
const output = `${root}/artifacts/atlas-rendering`
mkdirSync(output, { recursive: true })
const width = 1008, height = 1878
const data = new Uint8Array(width * height * 4)
for (let y = 920; y < 958; y++) for (let x = 480; x < 528; x++) {
  const offset = (y * width + x) * 4
  data[offset + (x % 2 ? 2 : 0)] = 255
  data[offset + 3] = 255
}
const fixture = zipSync({
  ...unzipSync(bdsFixture()),
  'light/res/btn.png': encodePng({ width, height, data }),
  'light/res/btn.til': strToU8('[IMG1]\nSOURCE_RECT=456,874,97,131\n[IMG2]\nSOURCE_RECT=0,0,40,40\n'),
})
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 41887, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const dpr of [1, 2, 3]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#browser-open').setInputFiles({ name: 'atlas.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(fixture) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    await page.evaluate(async () => {
      const { selectFile } = await import('/src/app/navigation.ts')
      selectFile('light/skin/res/btn.png', 'overview', 'image')
      const { selectResourceImage } = await import('/src/app/resource-inspector.ts')
      selectResourceImage('light/skin/res/btn.png')
    })
    await page.waitForFunction(() => document.querySelector('#workspace-image').naturalWidth === 1008 && document.querySelector('#atlas-viewport').width > 1)
    const fittedPixels = await page.locator('#atlas-viewport').evaluate(canvas => canvas.width * canvas.height)
    await page.evaluate(() => {
      const box = document.querySelector('#atlas-canvas').getBoundingClientRect(), wrap = document.querySelector('.canvas-wrap')
      for (let i = 0; i < 30; i++) wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, cancelable: true }))
    })
    await page.waitForFunction(() => document.querySelector('#atlas-viewport').getContext('2d').getTransform().a >= 4 * devicePixelRatio - 0.01)
    const rendering = await page.evaluate(() => {
      const plane = document.querySelector('#atlas-canvas'), canvas = document.querySelector('#atlas-viewport')
      const image = plane.getBoundingClientRect(), surface = canvas.getBoundingClientRect(), context = canvas.getContext('2d')
      const samples = []
      for (let x = 495; x < 505; x++) {
        const px = Math.floor((image.left + (x + 0.5) * image.width / 1008 - surface.left) * canvas.width / surface.width)
        const py = Math.floor((image.top + 939.5 * image.height / 1878 - surface.top) * canvas.height / surface.height)
        samples.push([...context.getImageData(px, py, 1, 1).data])
      }
      return { width: canvas.width, height: canvas.height, cssWidth: surface.width, cssHeight: surface.height,
        planePixels: plane.width * plane.height, imageWidth: image.width, smoothing: context.imageSmoothingEnabled, samples }
    })
    assert.equal(rendering.imageWidth, width * 4, 'maximum zoom keeps the full logical image bounds')
    assert.equal(rendering.planePixels, 1, 'hit area does not allocate a full zoomed atlas buffer')
    assert.equal(rendering.width, Math.round(rendering.cssWidth * dpr))
    assert.equal(rendering.height, Math.round(rendering.cssHeight * dpr))
    assert.equal(rendering.width * rendering.height, fittedPixels, 'zooming does not grow the raster buffer')
    assert.equal(rendering.smoothing, false)
    assert.deepEqual(rendering.samples, Array.from({ length: 10 }, (_, i) => i % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]), 'source pixels stay exact without interpolation')

    const wrap = await page.locator('.canvas-wrap').boundingBox()
    const beforePan = await page.locator('#atlas-canvas').boundingBox()
    await page.mouse.move(wrap.x + wrap.width / 2, wrap.y + wrap.height / 2)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(wrap.x + wrap.width / 2 + 40, wrap.y + wrap.height / 2 + 24, { steps: 4 })
    await page.mouse.up({ button: 'middle' })
    const afterPan = await page.locator('#atlas-canvas').boundingBox()
    assert.equal(afterPan.x - beforePan.x, 40)
    assert.equal(afterPan.y - beforePan.y, 24)
    await page.waitForFunction(() => document.querySelector('#atlas-viewport').getContext('2d').getTransform().e ===
      (document.querySelector('#atlas-canvas').getBoundingClientRect().left - document.querySelector('#atlas-viewport').getBoundingClientRect().left) * devicePixelRatio)
    await page.mouse.click(afterPan.x + 504 * 4, afterPan.y + 939 * 4)
    assert.equal(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.selectedTileIndex), 1, 'selection uses original coordinates after pan')
    await page.screenshot({ path: `${output}/zoom-4x-dpr-${dpr}.png` })
    if (dpr === 2) {
      await page.mouse.move(afterPan.x + 553 * 4, afterPan.y + 1005 * 4)
      await page.mouse.down()
      await page.mouse.move(afterPan.x + 551 * 4, afterPan.y + 1004 * 4)
      await page.mouse.up()
      assert.deepEqual(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.slices[0].source), [456, 874, 95, 130], 'corner resizing still edits original image coordinates')
      await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
      assert.deepEqual(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.slices[0].source), [456, 874, 97, 131], 'resizing remains undoable')
    }

    const batching = await page.evaluate(async () => {
      const context = document.querySelector('#atlas-viewport').getContext('2d'), clear = context.clearRect.bind(context)
      let clears = 0
      context.clearRect = (...args) => { clears++; clear(...args) }
      const wrap = document.querySelector('.canvas-wrap'), box = wrap.getBoundingClientRect()
      for (let i = 0; i < 50; i++) wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, cancelable: true }))
      const immediate = clears
      await new Promise(requestAnimationFrame)
      context.clearRect = clear
      return { immediate, clears }
    })
    assert.deepEqual(batching, { immediate: 0, clears: 1 }, 'wheel bursts share one rendering frame')

    await page.locator('#atlas-zoom-fit').click()
    const mapping = await page.evaluate(async () => {
      const { drawAtlas, atlasPoint } = await import('/src/app/tile-editing.ts')
      drawAtlas()
      const box = document.querySelector('#atlas-canvas').getBoundingClientRect()
      return atlasPoint({ clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 })
    })
    assert.deepEqual(mapping, { x: width / 2, y: height / 2 })
    await page.setViewportSize({ width: 812, height: 1000 })
    await page.waitForFunction(() => !document.body.classList.contains('atlas-workspace') && document.querySelector('#atlas-viewport').width === 1 && document.querySelector('#atlas-canvas').width > 1)
    assert.equal(await page.locator('#atlas-viewport').isVisible(), false)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.waitForFunction(() => document.querySelector('#atlas-viewport').width > 1)
    await page.locator('#atlas-back').click()
    assert.equal(await page.locator('#atlas-viewport').evaluate(canvas => canvas.width * canvas.height), 1, 'leaving the atlas releases its raster buffer')
    assert.deepEqual(errors, [])
    console.log(`atlas rendering DPR ${dpr}: exact pixels, ${rendering.width} × ${rendering.height} buffer, pan, selection, frame batching and responsive cleanup passed`)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
