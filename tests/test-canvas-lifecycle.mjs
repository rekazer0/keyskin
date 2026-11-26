import { openEditorTemplate } from "../tests/helpers/open-editor-template.mjs"
// Repeated canvas selection must not retain detached inspector bitmaps or observed SSF thumbnails.
// BROWSER=webkit node scripts/test-canvas-lifecycle.mjs also checks the macOS WebView engine.
import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

const server = await createServer({ logLevel: 'error', server: { port: 41746, strictPort: false, hmr: false, watch: null } })
await server.listen()
const engine = process.env.BROWSER === 'webkit' ? webkit : chromium
const browser = await engine.launch(engine === chromium && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  for (const format of ['bds', 'bda', 'ssf']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
    try {
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(() => {
        window.inspectedCanvases = new Set()
        window.observedThumbnails = new Map()
        const Observer = window.IntersectionObserver
        window.IntersectionObserver = class extends Observer {
          constructor(...args) { super(...args); window.observedThumbnails.set(this, new Set()) }
          observe(target) { window.observedThumbnails.get(this).add(target); super.observe(target) }
          unobserve(target) { window.observedThumbnails.get(this).delete(target); super.unobserve(target) }
          disconnect() { window.observedThumbnails.get(this).clear(); super.disconnect() }
        }
      })
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      if (format === 'ssf') {
        await page.locator('#browser-open').setInputFiles({ name: 'canvas-lifecycle.ssf', mimeType: 'application/octet-stream', buffer: Buffer.from(ssfFixture()) })
      } else {
        await openEditorTemplate(page, format === 'bds' ? 'official-android-bds' : 'default-android')
      }
      await page.locator('.canvas-wrap:not(.empty)').waitFor()
      await page.waitForFunction(() => !document.querySelector('#open').disabled)
      await page.getByRole('button', { name: '编辑模式', exact: true }).click()
      const points = await page.evaluate(async () => {
        const { preview } = await import('/src/app/canvas-interaction.ts')
        window.canvasLifecycleState = (await import('/src/app/state.ts')).appState
        return preview.keys.filter(key => key.editable && key.rect.width > 0).slice(0, 2).map(key => ({
          x: (key.rect.x + key.rect.width / 2) / preview.panelWidth,
          y: (key.rect.y + key.rect.height / 2) / preview.surfaceHeight,
          section: key.section,
        }))
      })
      assert.equal(points.length, 2, `${format}: keys are loaded`)
      for (let index = 0; index < 80; index++) {
        await page.evaluate(() => {
          for (const canvas of document.querySelectorAll('#quick-inspector canvas, #resource-inspector canvas')) window.inspectedCanvases.add(canvas)
        })
        const point = points[index % 2]
        const bounds = await page.locator('#preview').boundingBox()
        await page.mouse.click(bounds.x + bounds.width * point.x, bounds.y + bounds.height * point.y)
        await page.waitForFunction(section => !window.canvasLifecycleState.selectionInspectorSyncPending && document.querySelector('#quick-inspector').dataset.selectionNames === JSON.stringify([section]), point.section)
      }
      const metrics = await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const old = [...window.inspectedCanvases].filter(canvas => !canvas.isConnected)
        const current = [...document.querySelectorAll('#quick-inspector canvas')].filter(canvas => canvas.getBoundingClientRect().width > 0 && canvas.width > 0 && canvas.height > 0)
        return {
          removed: old.length,
          retainedPixels: old.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
          detachedObserved: [...window.observedThumbnails.values()].flatMap(targets => [...targets]).filter(target => !target.isConnected).length,
          visiblePreviews: current.length,
          paintedPreviews: current.filter(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0)).length,
        }
      })
      assert.equal(metrics.retainedPixels, 0, `${format}: removed bitmaps are released without waiting for GC`)
      assert.equal(metrics.detachedObserved, 0, `${format}: observers release removed thumbnails`)
      assert.ok(metrics.visiblePreviews > 0, `${format}: current previews remain drawn`)
      assert.ok(metrics.paintedPreviews > 0, `${format}: current previews retain visible pixels`)
      assert.deepEqual(errors, [], `${format}: page errors`)
      console.log(`${process.env.BROWSER ?? 'chromium'} ${format}: 80 key selections, ${metrics.removed} old canvases released, ${metrics.visiblePreviews} current previews`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}
