// [CAND] TYPE=3：百度安卓真机把候选栏盖在面板顶部，没有候选字时整条不显示。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = new URL('..', import.meta.url).pathname
const files = unzipSync(readFileSync(`${root}/public/templates/xiaomi-unified-rounded-blur.bds`))
for (const path of Object.keys(files).filter((name) => name.endsWith('/gen.ini'))) {
  files[path] = strToU8(strFromU8(files[path]).replace(/^TYPE=4/m, 'TYPE=3'))
}
const skin = Buffer.from(zipSync(files))

const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 41927, strictPort: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, bypassCSP: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'overlay.bds', mimeType: 'application/octet-stream', buffer: skin })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  const compose = (value) => page.evaluate(async (value) => {
    const { setSimulatedComposition } = await import('/src/app/canvas-interaction.ts')
    const { refreshSimulationPreview } = await import('/src/app/preview-render.ts')
    setSimulatedComposition(value)
    refreshSimulationPreview()
  }, value)
  const measure = () => page.evaluate(() => {
    const rect = (id) => document.getElementById(id).getBoundingClientRect()
    const area = rect('candidate-area')
    const panel = rect('panel-viewport')
    return { hidden: document.getElementById('candidate-area').hidden, area: { y: area.y, height: area.height }, panel: { y: panel.y, height: panel.height }, shell: document.getElementById('device-shell').getBoundingClientRect().height }
  })

  for (const device of ['canvas-checkerboard', 'pixel-10-pro']) {
    await page.locator('#device').selectOption(device)
    await compose('')
    const idle = await measure()
    assert.equal(idle.hidden, true, `${device}: idle bar is hidden`)
    await compose('ni')
    await page.waitForTimeout(100)
    const typing = await measure()
    assert.equal(typing.hidden, false, `${device}: composing shows the bar`)
    assert.ok(Math.abs(typing.area.y - typing.panel.y) < 2, `${device}: bar starts at the panel top`)
    assert.ok(typing.area.height > 0 && typing.area.height < typing.panel.height / 3, `${device}: bar covers only the panel's top row (${typing.area.height} of ${typing.panel.height})`)
    assert.ok(Math.abs(typing.panel.height - idle.panel.height) < 2, `${device}: composing keeps the panel size`)
    assert.ok(Math.abs(typing.shell - idle.shell) < 2, `${device}: composing adds no keyboard height`)
    await page.screenshot({ path: `/tmp/bdi-candidate-overlay-${device}.png` })
  }
  assert.deepEqual(errors, [])
  console.log('candidate overlay: ok')
} finally {
  await browser.close()
  await server.close()
}
