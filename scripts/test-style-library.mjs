import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41865, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/picker.html`)
  await page.waitForFunction(() => document.querySelector('#picker-title')?.textContent)
  await page.evaluate(async () => {
    const { styleKinds } = { styleKinds: { anim: ['动画', 'clapperboard'], text: ['文字', 'type'], color: ['颜色', 'palette'] } }
    const styles = ['anim', 'text', 'color'].map((kind, index) => ({
      styleID: String(index + 1), label: String(index + 1), kind, kindLabel: styleKinds[kind][0], kindIcon: styleKinds[kind][1],
      categories: [index === 1 ? 'foreground' : 'key'], compatible: true, imagePaths: [], visuals: [null, null],
      animationSections: kind === 'anim' ? ['ANIM1'] : undefined,
      summary: kind === 'anim' ? '动画 1 · 缩放' : undefined,
      textVisuals: kind === 'text' ? [{ text: '键设 Aa', fontSize: 24 }, { text: '键设 Aa', fontSize: 24 }] : undefined,
    }))
    window.postMessage({ pickerEvent: 'style-library-data', payload: {
      sliceBack: false, editable: true, canAdd: false, soundOnly: false, foreground: false, bda: false, kind: 'all', currentID: '1', currentLabel: '1', source: 'test.ini', imagesCompatible: true,
      bitmaps: {}, animationText: '[ANIM1]\nCATEGORY=0\nTYPE=3\nDURATION=240\nFROM=50,50\nTO=100,100\n', animationFiles: {}, particleVisuals: {}, styles, images: [], sounds: [],
    } }, location.origin)
  })
  await page.locator('#style-library-grid > .ui-style-card').first().waitFor()
  assert.equal(await page.locator('#style-library-grid > .ui-style-card').count(), 3)
  await page.locator('[data-library-kind="text"]').click()
  await page.locator('[data-library-filter="key"]').click()
  assert.equal(await page.locator('#style-library-grid > *').count(), 0, '类型与用途筛选取交集')
  await page.locator('[data-library-filter="foreground"]').click()
  assert.equal(await page.locator('canvas[aria-label*="文字示例"]').count(), 2)
  await page.locator('[data-library-filter="all"]').click()
  await page.locator('[data-library-kind="anim"]').click()
  const player = page.locator('#style-library-grid .ui-animation-player')
  await page.locator('#style-library-grid .ui-animation-player[data-playing="true"]').waitFor()
  const frames = await player.locator('canvas').evaluate(async canvas => {
    let count = 0
    const context = canvas.getContext('2d')
    const clear = context.clearRect.bind(context)
    context.clearRect = (...args) => { count++; clear(...args) }
    await new Promise(resolve => setTimeout(resolve, 1000))
    context.clearRect = clear
    return count
  })
  assert.ok(frames > 10 && frames <= 31, `循环跨越多个周期，且不超过 30fps：${frames} 帧/秒`)
  assert.equal(await player.getAttribute('data-playing'), 'true')
  assert.equal(await player.locator('canvas').evaluate(canvas => canvas.width), 320)
  await page.locator('#style-library-grid .ui-style-card').click()
  await page.locator('#style-library-preview .ui-animation-player[data-playing="true"]').waitFor()
  await page.locator('[data-library-mode="images"]').click()
  await page.locator('#style-library-preview .ui-animation-player[data-playing="false"]').waitFor({ state: 'attached' })
  await page.locator('[data-library-mode="styles"]').click()
  await page.locator('#style-library-grid .ui-animation-player[data-playing="true"]').waitFor()
  await page.locator('#style-library-view').evaluate(element => { element.hidden = true })
  await page.locator('#style-library-grid .ui-animation-player[data-playing="false"]').waitFor({ state: 'attached' })
  await page.locator('#style-library-view').evaluate(element => { element.hidden = false })
  await page.locator('#style-library-grid .ui-animation-player[data-playing="true"]').waitFor()
  await page.locator('#resource-search').fill('no-such-style')
  assert.equal(await page.locator('#style-library-grid > *').count(), 0)
  assert.deepEqual(errors, [])
  console.log(`style library: shared cards, combined filters, looping (${frames}fps), hidden stop and resume passed`)
} finally {
  await browser.close()
  await server.close()
}
