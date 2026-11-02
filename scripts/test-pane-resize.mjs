import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
  await page.addInitScript(() => localStorage.setItem('onboarding-tour-v1', 'done'))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('.template-grid .template-card').first().click()
  await page.waitForSelector('.canvas-wrap:not(.empty)')

  const widthOf = (selector) => page.locator(selector).evaluate(el => el.getBoundingClientRect().width)
  const near = (actual, expected) => assert(Math.abs(actual - expected) < 1, `${actual} should equal ${expected}`)
  async function drag(handle, delta) {
    const box = await page.locator(handle).boundingBox()
    assert(box, `${handle} is visible`)
    // 从手柄中心按下：左栏会裁掉溢出内容，中心必须落在可见的拖动条上。
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + delta, y, { steps: 8 })
    await page.mouse.up()
    await page.evaluate(() => new Promise(requestAnimationFrame))
  }
  for (const viewportWidth of [1440, 1000]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 })
    for (const atlas of [false, true]) {
      await page.evaluate(value => document.body.classList.toggle('atlas-workspace', value), atlas)
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--sidebar-width', '248px')
        document.documentElement.style.setProperty('--inspector-width', '360px')
      })
      await drag('#sidebar-resize-handle', viewportWidth)
      near(await widthOf('.sidebar'), viewportWidth * 0.7)
      await drag('#sidebar-resize-handle', -viewportWidth)
      near(await widthOf('.sidebar'), 180)
      await drag('#inspector-resize-handle', -viewportWidth)
      near(await widthOf('section.source'), viewportWidth * 0.7)
      await drag('#inspector-resize-handle', viewportWidth)
      near(await widthOf('section.source'), 220)
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => document.body.classList.remove('atlas-workspace'))
  await drag('#inspector-resize-handle', -1440)
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.waitForFunction(() => parseFloat(document.documentElement.style.getPropertyValue('--inspector-width')) <= 700)
  near(await widthOf('section.source'), 700)

  await page.evaluate(() => {
    localStorage.setItem('sidebarWidthV2', '5000')
    localStorage.setItem('inspectorWidthV5', '5000')
  })
  await page.reload()
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--sidebar-width') === '700px')
  for (const name of ['--sidebar-width', '--inspector-width']) {
    near(await page.evaluate(key => parseFloat(document.documentElement.style.getPropertyValue(key)), name), 700)
  }
  console.log('PASS: both panes clamp to 70%, preserve minimums, and update on resize/restore at desktop widths and in the atlas workspace')
} finally {
  await browser.close()
  await server.close()
}
