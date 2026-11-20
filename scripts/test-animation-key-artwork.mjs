import assert from 'node:assert/strict'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const files = unzipSync(bdsFixture())
const skin = zipSync({ ...files,
  'light/port/py_26.ini': strToU8(strFromU8(files['light/port/py_26.ini'])
    .replace('[KEY2]\nBACK_STYLE=2', '[KEY2]\nBACK_STYLE=8\nBACK_ANIM_STYLE=7')),
  'light/res/default.css': strToU8(`${strFromU8(files['light/res/default.css'])}\n[STYLE7]\nPRESS_ANIM=1\n[STYLE8]\nNM_COLOR=FFFF0000\n`),
  'light/res/anim.ini': strToU8('[ANIM1]\nTYPE=4\nDURATION=600\nFROM=100,100\nTO=80,80\n'),
})
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const expectSkinArtwork = async (player, red) => {
  await player.scrollIntoViewIfNeeded()
  await player.and(page.locator('[data-sample="skin"][data-playing="true"]')).waitFor()
  const hasRedBackground = await player.locator('canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    return pixels.some((r, i) => i % 4 === 0 && r > 220 && pixels[i + 1] < 50 && pixels[i + 2] < 50 && pixels[i + 3] > 200)
  })
  assert.equal(hasRedBackground, red, '缩略图实际绘制了对应按键的背景')
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'animation-key-artwork.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(skin) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await page.evaluate(async () => {
    const { selectFile } = await import('/src/app/navigation.ts')
    const { appState } = await import('/src/app/state.ts')
    const { populateKeyInspector } = await import('/src/app/key-inspector.ts')
    selectFile('light/skin/port/py_26.ini')
    appState.selectedKeySections = ['KEY2']
    populateKeyInspector()
  })
  await expectSkinArtwork(page.locator('.key-animation-fields .ui-animation-player'), true)
  await page.locator('[data-workspace-page="animation"]').click()
  const thumbnail = page.locator('#animation-library [data-animation-id="ANIM1"] .ui-animation-player')
  await page.evaluate(async () => (await import('/src/app/animation-resource.ts')).pickAnimationKeys([]))
  await expectSkinArtwork(thumbnail, true)
  // The same card ID must refresh when a different trial key is selected.
  await page.evaluate(async () => (await import('/src/app/animation-resource.ts')).pickAnimationKeys(['KEY1']))
  await expectSkinArtwork(thumbnail, false)
  assert.deepEqual(errors, [])
  console.log('animation key artwork: inspector, bound key in animation list, and refreshed trial key passed')
} finally {
  await browser.close()
  await server.close()
}
