import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { encodePng } from '../src/ssf/ssf-png.ts'

const files = {
  'skin/res/default.css': '[STYLE1]\nNM_IMG=picture,1\n[STYLE2]\nNM_IMG=picture,2\n[STYLE3]\nNM_COLOR=808080\n[STYLE4]\nFONT_SIZE=18\nNM_COLOR=63B8FF\n[STYLE5]\nNM_COLOR=FFFF00\n',
  'skin/res/picture.til': '[GLOBAL]\nTILE_NUM=2\n[IMG1]\nSOURCE_RECT=0,0,360,50\n[IMG2]\nSOURCE_RECT=0,50,360,200\n',
  'skin/port/gen.ini': '[PANEL]\nSIZE=360,200\nBACK_STYLE=2\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,360,50\n[INPUT]\nBACK_STYLE=3\nFORE_STYLE=4\n',
  'skin/port/py_26.ini': '[PANEL]\nKEY_NUM=1\n[KEY1]\nVIEW_RECT=0,0,360,200\nCENTER=i\n',
  'skin/port/cand1.cnd': '[CAND]\nBACK_STYLE=1\nFORE_STYLE=4\n',
}
const png = encodePng({ width: 360, height: 250, data: Uint8Array.from({ length: 360 * 250 * 4 }, (_, i) => [Math.floor(i / 1440), 50, 100, 255][i % 4]) })
const fixture = (scand = '') => zipSync({
  ...Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text + (path.endsWith('/gen.ini') ? scand : ''))])),
  'skin/res/picture.png': png,
})
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => new MutationObserver(() => {
    document.querySelector('dialog[open]:not([id]):has(button[value="restore"]) button[value="cancel"]')?.click()
    document.querySelector('dialog[open]:not([id]):has(button[value="export"]) button[value="discard"]')?.click()
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] }))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  const openSkin = async (name, bytes) => {
    await page.locator('#browser-open').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled && !document.querySelector('.canvas-wrap').classList.contains('empty'))
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await page.evaluate(async () => {
      const { selectFile } = await import('/src/app/navigation.ts')
      selectFile('light/skin/port/py_26.ini')
    })
  }
  const compose = (value) => page.evaluate(async (value) => {
    const { setSimulatedComposition } = await import('/src/app/canvas-interaction.ts')
    const { refreshSimulationPreview } = await import('/src/app/preview-render.ts')
    setSimulatedComposition(value)
    refreshSimulationPreview()
  }, value)
  const inspect = () => page.evaluate(async () => {
    const { preview, candidateBackgroundPreview } = await import('/src/app/canvas-interaction.ts')
    await Promise.all([preview.whenDrawn(), candidateBackgroundPreview.whenDrawn()])
    const background = candidateBackgroundPreview.canvas
    const input = document.querySelector('#candidate-input')
    const pixel = canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 1).data)
    return { inset: preview.panelTopInset, panelTop: pixel(preview.canvas), barTop: pixel(background),
      shared: background.hasAttribute('data-shared-input-background'),
      offset: background.getBoundingClientRect().top - input.getBoundingClientRect().top,
      inputHidden: document.querySelector('#candidate-input-background').hidden }
  })
  await openSkin('sliced-background.bdi', fixture())
  for (const device of ['canvas-checkerboard', 'iphone-17-pro-max', 'pixel-10-pro']) {
    await page.locator('#device').selectOption(device)
    await compose('ni')
    const rows = await inspect()
    assert.equal(rows.inset, 0, `${device}: the panel uses its entire authored slice`)
    assert.deepEqual(rows.panelTop, [50, 50, 100, 255])
    const ios = device !== 'pixel-10-pro'
    assert.equal(rows.shared, ios, `${device}: only iOS shares the background`)
    assert.equal(rows.inputHidden, ios, `${device}: only Android paints the gray fill`)
    if (ios) {
      assert.ok(Math.abs(rows.offset) < 1.5, `${device}: the artwork starts at the input row (${rows.offset})`)
      assert.deepEqual(rows.barTop, [0, 50, 100, 255])
      await compose('')
      assert.equal((await inspect()).shared, false, 'clearing composition restores the single candidate row')
    }
  }
  await page.locator('#device').selectOption('canvas-checkerboard')
  await openSkin('explicit-input-background.bdi', fixture('[SCAND]\nBACK_STYLE=5\n'))
  await compose('ni')
  const explicit = await inspect()
  assert.equal(explicit.shared, false)
  assert.equal(explicit.inputHidden, false, 'an explicit iOS SCAND background still takes priority')
  if (process.env.BDI_INPUT_SAMPLE) {
    await openSkin('input-sample.bdi', readFileSync(process.env.BDI_INPUT_SAMPLE))
    await compose('j')
    const sample = await inspect()
    assert.equal(sample.inset, 0)
    assert.equal(sample.shared, true)
    const input = await page.locator('#candidate-input').boundingBox()
    const panel = await page.locator('#panel-viewport').boundingBox()
    await page.screenshot({ path: '/tmp/keyskin-ios-input.png', clip: { x: input.x, y: input.y, width: panel.width, height: panel.y + panel.height - input.y } })
  }
  assert.deepEqual(errors, [])
  console.log('iOS input background and adjacent slices: ok')
} finally {
  await browser.close()
  await server.close()
}
