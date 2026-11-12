import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strToU8, zipSync } from 'fflate'
import { encodePng } from '../src/ssf/ssf-png.ts'

const files = {
  'skin/res/default.css': strToU8('[STYLE1]\nNM_IMG=picture,1\n[STYLE2]\nNM_COLOR=00000000\n[STYLE3]\nNM_COLOR=808080\n[STYLE4]\nFONT_SIZE=18\nNM_COLOR=63B8FF\n[STYLE5]\nSHOW=百度\nNM_COLOR=000000\n[STYLE6]\nSHOW=收回\nNM_COLOR=000000\n'),
  'skin/res/picture.png': encodePng({ width: 360, height: 250, data: Uint8Array.from({ length: 360 * 250 * 4 }, (_, i) => [Math.floor(i / 1440), 50, 100, 255][i % 4]) }),
  // BDI 按出现顺序取第 1 张切片，不能按被打乱的 IMG 编号查找。
  'skin/res/picture.til': strToU8('[GLOBAL]\nTILE_NUM=2\n[IMG14]\nSOURCE_RECT=0,0,360,250\n[IMG1]\nSOURCE_RECT=0,100,360,150\n'),
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

  const solid = (width, height, color) => encodePng({ width, height, data: Uint8Array.from({ length: width * height * 4 }, (_, i) => color[i % 4]) })
  const native = {
    'skin/res/default.css': strToU8('[STYLE1]\nNM_IMG=bar,1\n[STYLE2]\nNM_IMG=edge,1\nHL_IMG=edge,2\n[STYLE3]\nNM_IMG=input,1\n[STYLE4]\nFONT_SIZE=43\nNM_COLOR=285f47\n'),
    'skin/res/bar.png': solid(1125, 90, [255, 255, 255, 255]),
    'skin/res/bar.til': strToU8('[IMG1]\nSOURCE_RECT=0,0,1125,90\nINNER_RECT=270,22,550,1\n'),
    'skin/res/edge.png': solid(136, 220, [90, 150, 100, 255]),
    'skin/res/edge.til': strToU8('[IMG1]\nSOURCE_RECT=0,0,136,110\n[IMG2]\nSOURCE_RECT=0,110,136,110\n'),
    'skin/res/input.png': solid(1125, 30, [220, 230, 220, 255]),
    'skin/res/input.til': strToU8('[IMG1]\nSOURCE_RECT=0,0,1125,30\n'),
    'skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist': strToU8('<plist><array><dict><key>Position</key><string>toolbar</string><key>Name</key><string>17</string><key>Images</key><dict><key>Normal</key><dict><key>Normal</key><string>function</string></dict></dict></dict></array></plist>'),
    'skin/res/logo/function_iphone@3x.png': solid(80, 80, [20, 110, 80, 255]),
  }
  for (const orientation of ['port', 'land']) {
    native[`skin/${orientation}/gen.ini`] = strToU8('[PANEL]\nSIZE=1125,592\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,1125,124\n[INPUT]\nFORE_STYLE=4\n[SCAND]\nBACK_STYLE=3\nINPUT_STYLE=4\n[LOGO]\nLAYOUT_NAME=logo\n')
    native[`skin/${orientation}/py_26.ini`] = strToU8('[PANEL]\nKEY_NUM=1\n[KEY1]\nVIEW_RECT=0,0,1125,592\nCENTER=a\n')
    native[`skin/${orientation}/cand1.cnd`] = strToU8('[CAND]\nBACK_STYLE=1\n[ICON1]\nSIZE=229,186\nPOS=0,20\nANCHOR_TYPE=1\nFIX_SIZE=50,52\nFORE_STYLE=2\nKEY=F31\n[ICON2]\nSIZE=780,58\nPOS=-390,43\nANCHOR_TYPE=2\nKEY=F14\n')
  }
  await page.locator('#browser-open').setInputFiles({ name: 'native-toolbar.bdi', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync(native)) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  if (await close.isVisible()) await close.click()
  await page.locator('#layout').selectOption('py_26.ini', { force: true })
  await page.evaluate(async () => {
    const { toolbarPreview, candidateBackgroundPreview } = await import('/src/app/canvas-interaction.ts')
    const { appState } = await import('/src/app/state.ts')
    window.iosToolbarProbe = { toolbarPreview, candidateBackgroundPreview, appState }
  })
  const nativeGeometry = async (expectedHeight) => {
    const result = await page.waitForFunction((expectedHeight) => {
      const { toolbarPreview, candidateBackgroundPreview, appState } = window.iosToolbarProbe
      if (Math.abs(toolbarPreview.panelHeight - expectedHeight) > 0.000001) return false
      const android = document.querySelector('#device').value === 'pixel-10-pro'
      const background = candidateBackgroundPreview.drawnScene?.background.at(-1)
      const scene = toolbarPreview.drawnScene
      if (android ? scene : !scene?.keys.length || background?.rect.height !== toolbarPreview.panelHeight) return false
      return {
        height: toolbarPreview.panelHeight, input: appState.candidateInputBar?.metrics.height,
        backgroundHeight: background?.rect.height,
        layers: scene?.keys.flatMap(key => key.layers(false).fore.map(layer => layer.rect)),
        revision: appState.archive.revision,
      }
    }, expectedHeight)
    return result.jsonValue()
  }
  for (const [device, points] of [['canvas-checkerboard', 440], ['iphone-17-pro', 402], ['iphone-17-pro-max', 440]]) {
    await page.locator('#device').selectOption(device)
    const scale = 1125 / (3 * points)
    const geometry = await nativeGeometry(124 * scale)
    assert.ok(Math.abs(geometry.height - 124 * scale) < 0.000001, `${device}: native toolbar keeps its fixed point height`)
    assert.ok(Math.abs(geometry.input - 30 * scale) < 0.000001, `${device}: input row uses the same density`)
    assert.equal(geometry.backgroundHeight, geometry.height)
    assert.equal(geometry.layers.length, 2, 'fixed logo and native functions both render')
    for (const rect of geometry.layers) assert.ok(rect.y >= 0 && rect.y + rect.height <= geometry.height, 'all artwork remains inside the visible toolbar')
    assert.equal(geometry.revision, 0, 'preview calibration leaves the archive unchanged')
  }
  await page.locator('#orientation').selectOption('land', { force: true })
  const landscape = await nativeGeometry(124 * 1125 / (3 * 956))
  assert.ok(Math.abs(landscape.height - 124 * 1125 / (3 * 956)) < 0.000001, `landscape uses its own point width: ${JSON.stringify(landscape)}`)
  await page.locator('#orientation').selectOption('port', { force: true })
  await page.locator('#device').selectOption('pixel-10-pro')
  assert.equal((await nativeGeometry(124)).height, 124, 'Android keeps the skin coordinate height')
  await page.locator('#device').selectOption('canvas-checkerboard')
  assert.ok(Math.abs((await nativeGeometry(124 * 1125 / 1320)).height - 124 * 1125 / 1320) < 0.000001, 'returning to canvas restores native sizing')
  assert.deepEqual(errors, [])
  console.log('iOS background, native toolbar, input and device-switch checks passed')
} finally {
  await browser.close()
  await server.close()
}
