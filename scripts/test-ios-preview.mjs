import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strToU8, zipSync } from 'fflate'
import { encodePng } from '../src/ssf/ssf-png.ts'

const files = {
  'skin/res/default.css': strToU8('[STYLE1]\nNM_IMG=picture,1\n[STYLE2]\nNM_COLOR=00000000\n[STYLE3]\nNM_COLOR=808080\n[STYLE4]\nFONT_SIZE=18\nNM_COLOR=63B8FF\n[STYLE5]\nSHOW=百度\nNM_COLOR=000000\n[STYLE6]\nSHOW=收回\nNM_COLOR=000000\n'),
  'skin/res/picture.png': encodePng({ width: 360, height: 250, data: Uint8Array.from({ length: 360 * 250 * 4 }, (_, i) => [Math.floor(i / 1440), 50, 100, 255][i % 4]) }),
  'skin/res/picture.til': strToU8('[IMG1]\nSOURCE_RECT=0,0,360,250\n'),
  'skin/port/gen.ini': strToU8('[PANEL]\nSIZE=360,200\nBACK_STYLE=1\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,360,50\n[INPUT]\nBACK_STYLE=3\nFORE_STYLE=4\n'),
  'skin/port/py_26.ini': strToU8('[PANEL]\nKEY_NUM=1\n[KEY1]\nVIEW_RECT=0,0,360,200\n'),
  'skin/port/cand1.cnd': strToU8('[CAND]\nBACK_STYLE=2\nFORE_STYLE=4\n[ICON1]\nSIZE=45,50\nPOS=0,0\nANCHOR_TYPE=1\nFORE_STYLE=5\nKEY=F31\n[ICON2]\nSIZE=270,50\nPOS=45,0\nANCHOR_TYPE=1\nKEY=F14\n[ICON3]\nSIZE=45,50\nPOS=315,0\nANCHOR_TYPE=1\nFORE_STYLE=6\nKEY=F8\t\n[ICON4]\nSIZE=1,1\nPOS=359,49\nANCHOR_TYPE=1\nBACK_STYLE=3\nKEY=F7\n'),
}
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'ios-preview.bdi', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync(files)) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled && !document.querySelector('.canvas-wrap').classList.contains('empty'))
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  const inspect = () => page.evaluate(async () => {
    const { preview, toolbarPreview, candidateBackgroundPreview } = await import('/src/app/canvas-interaction.ts')
    const { appState } = await import('/src/app/state.ts')
    await Promise.all([preview.rendered(), toolbarPreview.rendered(), candidateBackgroundPreview.rendered()])
    const pixel = (canvas, y) => Array.from(canvas.getContext('2d').getImageData(0, Math.floor(y * canvas.height), 1, 1).data)
    return {
      inset: preview.panelTopInset,
      panelTop: pixel(preview.canvas, 0), barTop: pixel(candidateBackgroundPreview.canvas, 0),
      toolbar: toolbarPreview.drawnScene?.keys.map(key => ({ section: key.section, types: key.layers(false).fore.map(layer => layer.kind) })),
      toolbarCorner: Array.from(toolbarPreview.canvas.getContext('2d').getImageData(toolbarPreview.canvas.width - 1, toolbarPreview.canvas.height - 1, 1, 1).data),
      inputHeight: appState.candidateInputBar?.metrics.height ?? 0,
      revision: appState.archive.revision,
    }
  })
  const idle = await inspect()
  assert.deepEqual(idle.toolbarCorner, [128, 128, 128, 255], 'other authored toolbar controls retain their own artwork')
  assert.equal(idle.inset, 50, 'iOS panel picture starts above the keys, at the toolbar top')
  assert.ok(Math.abs(idle.panelTop[0] - 50) <= 1, `panel starts at source row 50: ${idle.panelTop}`)
  assert.equal(idle.barTop[0], 0, 'transparent candidate bar shows the top of the same picture')
  assert.equal(idle.inputHeight, 0, 'an Android INPUT style does not add a permanent empty grey row')
  assert.equal(idle.toolbar.find(key => key.section === 'ICON1').types[0], 'image', 'native logo replaces Android text')
  assert.equal(idle.toolbar.find(key => key.section === 'ICON3').types[0], 'image', 'native hide replaces a whitespace-padded Android action')
  assert.equal(idle.toolbar.find(key => key.section === 'ICON2').types.length, 3, 'native functions fill the empty F14 container')
  await page.evaluate(async () => {
    const { setSimulatedComposition } = await import('/src/app/canvas-interaction.ts')
    const { refreshSimulationPreview } = await import('/src/app/preview-render.ts')
    setSimulatedComposition('ni')
    refreshSimulationPreview()
  })
  const composing = await inspect()
  assert.ok(composing.inputHeight > 0, 'typing still displays the input code row')
  assert.equal(composing.inset, 50 + composing.inputHeight)
  assert.equal(composing.revision, idle.revision, 'previewing does not rewrite the skin')
  await page.evaluate(async () => {
    const { setSimulatedComposition } = await import('/src/app/canvas-interaction.ts')
    const { refreshSimulationPreview } = await import('/src/app/preview-render.ts')
    setSimulatedComposition('')
    refreshSimulationPreview()
  })
  assert.equal((await inspect()).inputHeight, 0, 'clearing the composition removes the empty input row')
  await page.locator('#device').selectOption('pixel-10-pro')
  assert.equal((await inspect()).inset, 0, 'Android fits the panel picture below the bar')
  await page.locator('#device').selectOption('canvas-checkerboard')
  assert.ok((await inspect()).inset > 0, 'returning to canvas restores BDI rendering')
  assert.deepEqual(errors, [])
  console.log('iOS background, native toolbar, input and device-switch checks passed')
} finally {
  await browser.close()
  await server.close()
}
