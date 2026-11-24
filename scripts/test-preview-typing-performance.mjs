import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ logLevel: 'error', server: { port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({
      viewport: mobile ? { width: 393, height: 852 } : { width: 1598, height: 858 },
      isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1, reducedMotion: 'reduce',
    })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      localStorage.setItem('onboarding-tour-v1', 'done')
      localStorage.setItem('keyskin-disclaimer-shown', '1')
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#browser-open').setInputFiles('public/templates/xiaomi-unified-rounded-blur.bds')
    await page.waitForFunction(() => !document.querySelector('.canvas-wrap').classList.contains('empty'))
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    if (!mobile) await page.locator('[data-mode-choice="preview"]:visible').first().click()
    const points = await page.evaluate(async () => {
      const { preview, toolbarPreview } = await import('/src/app/canvas-interaction.ts')
      const { IniDocument } = await import('/src/ini.ts')
      await preview.whenDrawn()
      const keys = preview.keys.filter(key => /^[a-z]$/i.test(key.center)).slice(0, 4)
      const points = keys.map(key => {
        const box = preview.canvas.getBoundingClientRect(), size = preview.logicalSize()
        return { x: Math.round(box.left + (key.rect.x + key.rect.width / 2) / size.width * box.width), y: Math.round(box.top + (key.rect.y + key.rect.height / 2) / size.height * box.height) }
      })
      const counts = window.counts = { toolbarRebuilds: 0, frames: 0, scratchDraws: 0, iniParses: 0 }
      const setDocument = toolbarPreview.setDocument
      toolbarPreview.setDocument = function (...args) { counts.toolbarRebuilds++; return setDocument.apply(this, args) }
      const render = preview.render
      preview.render = async function () { counts.frames++; return render.call(this) }
      const drawImage = CanvasRenderingContext2D.prototype.drawImage
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        if (!this.canvas.isConnected && args[0] instanceof ImageBitmap) counts.scratchDraws++
        return drawImage.apply(this, args)
      }
      const parse = IniDocument.parse
      IniDocument.parse = function (...args) { counts.iniParses++; return parse.apply(this, args) }
      return points
    })
    assert.equal(points.length, 4)
    const tap = ({ x, y }) => mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y)
    await tap(points[0])
    const candidate = page.locator('#candidate-input-text')
    await candidate.waitFor()
    const first = await candidate.textContent()
    assert.equal(first.length, 1)
    await page.evaluate(() => {
      window.word = document.querySelector('#candidate-words').firstElementChild
      for (const key of Object.keys(window.counts)) window.counts[key] = 0
    })
    const started = performance.now()
    for (let i = 0; i < 20; i++) await tap(points[i % points.length])
    await page.evaluate(async () => (await import('/src/app/canvas-interaction.ts')).preview.whenDrawn())
    const output = await candidate.textContent()
    assert.equal(output.length, 21)
    const counts = await page.evaluate(() => ({ ...window.counts, sameCandidate: window.word === document.querySelector('#candidate-words').firstElementChild }))
    console.log(JSON.stringify({ mobile, ms: Math.round(performance.now() - started), ...counts }))
    assert.equal(counts.toolbarRebuilds, 0, 'typing must not rebuild the toolbar document')
    assert.ok(counts.iniParses <= 4, 'typing must not reparse configuration on each key')
    assert.ok(counts.frames > 0 && counts.scratchDraws <= 100, 'reuse nine-slice rasters instead of recomposing each key every frame')
    assert.equal(counts.sameCandidate, true, 'stable candidates retain their DOM nodes')
    const idle = await page.evaluate(async () => {
      const { clearSimulatedOutput } = await import('/src/app/canvas-interaction.ts')
      clearSimulatedOutput()
      return { input: document.querySelector('#candidate-input-text').textContent, rebuilds: window.counts.toolbarRebuilds }
    })
    assert.deepEqual(idle, { input: '', rebuilds: 1 }, 'leaving composition still updates the toolbar')
    assert.deepEqual(errors, [])
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
