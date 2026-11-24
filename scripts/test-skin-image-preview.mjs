import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'
import { openEditorTemplate } from '../tests/helpers/open-editor-template.mjs'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41893, hmr: false } })
await server.listen()
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1472, height: 911 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      await openEditorTemplate(page, 'xiaomi-unified-rounded-blur')
      await page.getByRole('button', { name: '效果预览', exact: true }).click()
      const figure = page.locator('.canvas-wrap > #workspace-image-figure')
      await figure.waitFor()
      await page.waitForFunction(() => {
        const image = document.querySelector('#workspace-image')
        return image.naturalWidth > 0 && document.querySelector('#atlas-canvas').width === image.naturalWidth
      })
      for (const viewport of [{ width: 1472, height: 911 }, { width: 1440, height: 540 }, { width: 960, height: 800 }]) {
        await page.setViewportSize(viewport)
        const { drawn, expected, centerX, centerY, scrollX, scrollY, sourceHidden } = await figure.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const wrap = element.parentElement
          const canvas = element.querySelector('canvas')
          const image = element.querySelector('img')
          const drawn = canvas.getBoundingClientRect().toJSON()
          const scale = Math.min(1, bounds.width / image.naturalWidth, bounds.height / image.naturalHeight)
          return {
            drawn, expected: { width: image.naturalWidth * scale, height: image.naturalHeight * scale },
            centerX: bounds.left + bounds.width / 2, centerY: bounds.top + bounds.height / 2,
            scrollX: wrap.scrollWidth - wrap.clientWidth, scrollY: wrap.scrollHeight - wrap.clientHeight,
            sourceHidden: getComputedStyle(image).display === 'none',
          }
        })
        assert.ok(sourceHidden, '原图只作为绘图来源，不占预览布局')
        assert.ok(scrollX <= 1 && scrollY <= 1, `预览不会撑出滚动条 (${scrollX}, ${scrollY})`)
        assert.ok(Math.abs(drawn.width - expected.width) < 1 && Math.abs(drawn.height - expected.height) < 1, '预览按可用宽高等比适配')
        assert.ok(Math.abs(drawn.x + drawn.width / 2 - centerX) < 1 && Math.abs(drawn.y + drawn.height / 2 - centerY) < 1, '预览居中')
      }
      await page.locator('.sidebar-overview button[data-path$="/py_26.ini"]').click()
      await figure.waitFor({ state: 'hidden' })
      await page.locator('#preview').waitFor()
      console.log(`${engine.name()}: 皮肤效果预览在三种窗口尺寸下完整显示，返回布局正常`)
    } finally {
      await browser.close()
    }
  }
} finally {
  await server.close()
}
