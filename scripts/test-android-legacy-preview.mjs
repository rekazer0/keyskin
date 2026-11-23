import assert from 'node:assert/strict'
import { dismissStartupDisclaimer } from '../tests/helpers/open-editor-template.mjs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strToU8, zipSync } from 'fflate'
import { encodePng } from '../src/ssf/ssf-png.ts'

function png(width, height, pixel) {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4)
  return encodePng({ width, height, data })
}

const skin = zipSync({
  'Info.txt': strToU8('Name=Android legacy preview\nSupportPlatform=A'),
  'port/gen.ini': strToU8('[PANEL]\nSIZE=360,258\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,360,50\nTYPE=4\n'),
  'port/py_9.ini': strToU8('[PANEL]\nKEY_NUM=1\n[KEY1]\nVIEW_RECT=3,4,90,62\nCENTER=a\nBACK_STYLE=4\n'),
  'port/cand1.cnd': strToU8('[CAND]\nBACK_STYLE=1\n[ICON1]\nKEY=F31\nANCHOR_TYPE=4\nPOS=7,-18\nSIZE=43,37\nFORE_STYLE=2\n[ICON2]\nKEY=F14\nANCHOR_TYPE=5\nPOS=-125,-17\nSIZE=250,34\n[ICON3]\nKEY=F8\nANCHOR_TYPE=6\nPOS=-50,-23\nSIZE=45,44\nFORE_STYLE=3\n'),
  'res/default.css': strToU8('[STYLE1]\nNM_IMG=bar,1\nHL_IMG=bar,8\n[STYLE2]\nNM_IMG=icons,1\n[STYLE3]\nNM_IMG=icons,2\n[STYLE4]\nNM_IMG=key,1\n'),
  'res/bar.png': png(1, 1, () => [255, 255, 255, 255]),
  'res/bar.til': strToU8('[IMG1]\nSOURCE_RECT=0,0,1,1\n'),
  'res/icons.png': png(32, 64, (_, y) => y < 32 ? [17, 34, 51, 255] : [81, 99, 117, 255]),
  'res/icons.til': strToU8('[IMG1]\nSOURCE_RECT=0,0,32日,32\n[IMG2]\nSOURCE_RECT=0,32日,32日,32\n'),
  'res/key.png': png(106, 144, (x, y) => x && y ? [255, 255, 255, 255] : [0, 0, 0, 255]),
  'res/key.til': strToU8('[IMG1]\nSOURCE_RECT=0,0,106,144\nINNER_RECT=40,54,26,40\nSCALE=1,1,1,1,1\n'),
})
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await dismissStartupDisclaimer(page)
  await page.locator('#browser-open').setInputFiles({ name: 'legacy.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(skin) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.waitForFunction(async () => {
    const { preview, toolbarPreview, candidateBackgroundPreview } = await import('/src/app/canvas-interaction.ts')
    return preview.lastRenderCache?.visuals.has('KEY1') && toolbarPreview.lastRenderCache?.visuals.has('ICON3') && candidateBackgroundPreview.drawnScene
  })
  const rendered = await page.evaluate(async () => {
    const { preview, toolbarPreview, candidateBackgroundPreview } = await import('/src/app/canvas-interaction.ts')
    const { appState } = await import('/src/app/state.ts')
    await Promise.all([preview.rendered(), toolbarPreview.rendered(), candidateBackgroundPreview.rendered()])
    const pixel = (preview, x, y) => Array.from(preview.canvas.getContext('2d').getImageData(x, y, 1, 1).data)
    return {
      bar: pixel(candidateBackgroundPreview, 10, 10),
      logo: pixel(toolbarPreview, 29, 25),
      hide: pixel(toolbarPreview, 333, 24),
      functions: (await toolbarPreview.resolveToolbar()).map(icon => [icon.atlas.index, Boolean(icon.image)]),
      keyEdge: pixel(preview, 3, 20),
      keyInside: pixel(preview, 4, 20),
      revision: appState.archive.revision,
    }
  })
  assert.deepEqual(rendered.bar, [255, 255, 255, 255], 'a missing highlight slice does not erase the candidate background')
  assert.deepEqual(rendered.logo, [17, 34, 51, 255], 'legacy F31 artwork is drawn')
  assert.deepEqual(rendered.hide, [81, 99, 117, 255], 'legacy F8 artwork is drawn from the second slice')
  assert.deepEqual(rendered.functions, [[26, true], [31, true], [27, true]], 'without skin artwork the canvas uses the reference three-slot toolbar')
  assert.ok(rendered.keyEdge[0] > 0 && rendered.keyEdge[0] < 255, `a one-device-pixel edge is thinner than a layout unit: ${rendered.keyEdge}`)
  assert.deepEqual(rendered.keyInside, [255, 255, 255, 255])
  assert.equal(rendered.revision, 0, 'preview does not rewrite legacy source files')
  console.log('Android legacy canvas matches the reference toolbar, background and key borders')
} finally {
  await browser.close()
  await server.close()
}
