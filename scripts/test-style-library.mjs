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
  // 文字示例在卡片进入视口后才绘制（几千个样式时不一次画完）。
  await page.locator('canvas[aria-label*="文字示例"]').nth(1).waitFor({ state: 'attached' })
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

  // 大列表只创建可见动画的播放器，同一批数据只解析一次 anim.ini。
  await page.evaluate(async () => {
    const { IniDocument } = await import('/src/ini.ts')
    const parse = IniDocument.parse
    window.animationParses = 0
    IniDocument.parse = text => { window.animationParses++; return parse(text) }
    const animationText = Array.from({ length: 500 }, (_, index) => `[ANIM${index + 1}]\nCATEGORY=0\nTYPE=1\nDURATION=240\nFROM=0\nTO=90\n`).join('\n')
    window.largeLibrary = {
      sliceBack: false, editable: true, canAdd: false, soundOnly: false, foreground: false, bda: false,
      kind: 'anim', currentID: '', imagesCompatible: true, bitmaps: {}, animationText, animationFiles: {}, particleVisuals: {}, images: [], sounds: [],
      styles: Array.from({ length: 1000 }, (_, index) => ({
        styleID: String(index + 1), label: String(index + 1), kind: 'anim', categories: ['key'], compatible: true,
        imagePaths: [], visuals: [null, null], animationSections: [`ANIM${index % 500 + 1}`],
      })),
    }
    window.postMessage({ pickerEvent: 'style-library-data', payload: window.largeLibrary }, location.origin)
  })
  await page.locator('#style-library-grid .ui-animation-player[data-playing="true"]').first().waitFor()
  assert.equal(await page.evaluate(() => window.animationParses), 1, '同一批动画配置只解析一次')
  assert.ok(await page.locator('#style-library-grid > .ui-style-card').count() < 200, '只渲染可见的几行卡片')
  assert.ok(await page.locator('#style-library-grid .ui-animation-player').count() < 50, '屏幕外不批量创建播放器')
  // 滚到中段和底部：渲染出的卡片始终盖住视口，占位高度与真实行高一致。
  for (const ratio of [0.5, 1]) {
    await page.locator('#style-library-scroll').evaluate((scroll, ratio) => { scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * ratio }, ratio)
    await page.waitForFunction(() => {
      const scroll = document.querySelector('#style-library-scroll').getBoundingClientRect()
      const cards = document.querySelectorAll('#style-library-grid > .ui-style-card')
      return cards.length && cards[0].getBoundingClientRect().top <= scroll.top && cards[cards.length - 1].getBoundingClientRect().bottom >= scroll.bottom - 24
    })
  }
  const last = page.locator('#style-library-grid > .ui-style-card[data-style-id="1000"]')
  await last.locator('.ui-animation-player[data-playing="true"]').waitFor()
  assert.equal(await page.evaluate(() => window.animationParses), 1, '滚动复用解析结果')
  await last.click()
  await page.locator('#style-library-preview .ui-animation-player[data-playing="true"]').waitFor()
  assert.equal(await page.evaluate(() => window.animationParses), 1, '选中预览复用解析结果')
  await page.evaluate(() => {
    window.largeLibrary.animationText = window.largeLibrary.animationText.replaceAll('DURATION=240', 'DURATION=480')
    window.postMessage({ pickerEvent: 'style-library-data', payload: window.largeLibrary }, location.origin)
  })
  await page.waitForFunction(() => window.animationParses === 2)
  assert.deepEqual(errors, [])
  console.log(`style library: shared cards, combined filters, looping (${frames}fps), hidden stop/resume and 1000-card windowed previews passed`)
} finally {
  await browser.close()
  await server.close()
}
