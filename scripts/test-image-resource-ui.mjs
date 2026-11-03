import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41875, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const width of [1440, 812]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#browser-open').setInputFiles({ name: 'resources.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(bdsFixture()) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await page.locator('.sidebar-overview [data-nav-mode="style"]').first().click()
    const controls = await page.locator('#resource-search, .ui-style-filter-bar select').evaluateAll(items => items.map(el => el.getBoundingClientRect()))
    assert.equal(controls.length, 3)
    assert.ok(Math.max(...controls.map(rect => rect.y)) - Math.min(...controls.map(rect => rect.y)) < 2, '搜索和筛选同一行')
    if (width >= 1000) await page.locator('#atlas-back').click()
    else await page.evaluate(async () => { const { showResourceList } = await import('/src/app/resource-inspector.ts'); showResourceList() })
    await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      const { selectFile } = await import('/src/app/navigation.ts')
      const path = appState.archive.names().find(path => path.endsWith('.png'))
      selectFile(path, 'overview', 'image')
    })
    if (width < 1000) await page.evaluate(async () => { const { showResourceList } = await import('/src/app/resource-inspector.ts'); showResourceList() })
    await page.locator('.ui-image-card-size:not([hidden])').first().waitFor()
    assert.equal(await page.locator('#resource-list-title').textContent(), '图片资源')
    const cards = await page.locator('.ui-image-card').evaluateAll(items => items.map(el => {
      const preview = el.querySelector('.ui-image-card-preview').getBoundingClientRect()
      const size = el.querySelector('.ui-image-card-size').getBoundingClientRect()
      const caption = el.querySelector('.ui-image-card-caption').getBoundingClientRect()
      const til = el.querySelector('.ui-image-card-til')?.getBoundingClientRect()
      return { sizeInside: size.right <= preview.right && size.bottom <= preview.bottom && size.top > preview.top,
        nearCorner: preview.right - size.right <= 8 && preview.bottom - size.bottom <= 8,
        tilInCaption: !til || til.left >= caption.left && til.right <= caption.right && til.top >= caption.top && til.bottom <= caption.bottom,
        hasTil: !!til, overflow: el.scrollWidth > el.clientWidth + 1 }
    }))
    assert.ok(cards.length > 0)
    assert.ok(cards.some(card => card.hasTil), '样例包含 TIL')
    assert.ok(cards.every(card => card.sizeInside && card.nearCorner && card.tilInCaption && !card.overflow))
    await page.close()
    console.log(`image resource UI ${width}px: title, filters, dimensions, TIL and overflow passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
