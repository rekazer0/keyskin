import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { encodePng } from '../src/ssf/ssf-png.ts'
import { dismissStartupDisclaimer } from '../tests/helpers/open-editor-template.mjs'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const files = unzipSync(bdsFixture())
const path = 'light/res/btn'
files['light/res/default.css'] = strToU8(strFromU8(files['light/res/default.css']) + Array.from({ length: 200 }, (_, i) => `\n[STYLE${1000 + i}]\nNM_COLOR=FFFF0000\n`).join(''))
function fixture(count, color) {
  files[`${path}.png`] = encodePng({ width: 1, height: 1, data: new Uint8Array(color) })
  files[`${path}.til`] = strToU8(Array.from({ length: count }, (_, i) => `[IMG${3 * i}]\nSOURCE_RECT=0,0,1,1\n`).join(''))
  return Buffer.from(zipSync(files))
}
const large = fixture(256, [255, 0, 0, 255]), small = fixture(1, [0, 0, 255, 255])
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      await dismissStartupDisclaimer(page)
      const open = async (name, buffer, replacing = false) => {
        await page.locator('#browser-open').setInputFiles({ name, mimeType: 'application/octet-stream', buffer })
        if (replacing) await page.getByRole('button', { name: '不导出', exact: true }).click()
        await page.waitForFunction(name => document.querySelector('#document-name').textContent === name && !document.querySelector('#file-operation-dialog').open, name)
        await page.locator('[data-workspace-page="resources"]').click()
      }
      const search = page.locator('#resource-search')
      const styles = page.locator('#resource-gallery .ui-style-card')
      const selected = page.locator('#resource-gallery .ui-style-card[aria-selected="true"]')
      const name = page.locator('#resource-name')
      await open('large.bds', large)
      assert.equal(await styles.first().getAttribute('aria-setsize'), '206')
      await page.locator('#resource-gallery [data-style-id="1002"]').click()
      await page.keyboard.press('Control+End')
      assert.equal(await name.textContent(), 'STYLE1199')
      await search.fill('100')
      assert.equal(await name.textContent(), 'STYLE1002', 'filter keeps a surviving selection ahead of the default first result')
      await page.locator('#resource-gallery [data-style-id="1004"]').click({ modifiers: ['Shift'] })
      assert.deepEqual(await selected.allTextContents(), ['STYLE1002', 'STYLE1003', 'STYLE1004'], 'the surviving primary anchors the next range')
      await search.fill('1001')
      assert.deepEqual(await selected.allTextContents(), ['STYLE1001'])
      assert.equal(await name.textContent(), 'STYLE1001', 'inspector follows the new selection')
      await search.fill('no-such-style')
      assert.equal(await page.locator('#resource-detail').isVisible(), false, 'no matches must not leave a hidden style editable')
      await page.locator('[data-resource-page="image"]').click()
      await search.fill('')
      const image = page.locator('#resource-gallery [data-path$="/btn.png"]')
      const list = page.locator('#image-resource-slices [role="listbox"]')
      const slice = id => list.locator(`[data-slice-index="${id}"]`)
      const live = () => list.locator('canvas').evaluateAll(nodes => nodes.filter(node => node.width && node.height).length)
      const pixel = async (id, channel) => {
        await slice(id).scrollIntoViewIfNeeded()
        await page.waitForFunction(({ id, channel }) => {
          const canvas = document.querySelector(`#image-resource-slices [data-slice-index="${id}"] canvas`)
          return canvas?.width > 0 && canvas.getContext('2d').getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data[channel] === 255
        }, { id, channel })
      }
      await image.click()
      await pixel(0, 0)
      const first = await live()
      await slice(0).press('End')
      await pixel(765, 0)
      assert.equal(await slice(765).getAttribute('aria-selected'), 'true')
      assert.equal(await slice(0).locator('canvas').evaluate(canvas => canvas.width), 0, 'the first slice releases its bitmap after the jump')
      const last = await live()
      assert.ok(first < 32 && last < 32, 'offscreen slices must not retain raster buffers')
      const oldCanvas = await slice(765).locator('canvas').elementHandle()
      console.log(`${engine.name()}: 256 slices, DPR 2, live bitmaps: first=${first} last=${last}`)
      await open('other.bds', small, true)
      await page.locator('[data-resource-page="image"]').click()
      await image.click()
      await pixel(0, 2)
      assert.equal(await list.getByRole('option').count(), 1, 'same image path in a new project uses its own slices')
      await page.waitForFunction(canvas => !canvas.isConnected && !canvas.width && !canvas.height, oldCanvas)
      await oldCanvas.dispose()
    } finally { await browser.close() }
  }
} finally { await server.close() }
