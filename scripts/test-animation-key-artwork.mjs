import assert from 'node:assert/strict'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { dismissStartupDisclaimer } from '../tests/helpers/open-editor-template.mjs'

const files = unzipSync(bdsFixture())
const skin = zipSync({ ...files,
  'light/port/py_26.ini': strToU8(strFromU8(files['light/port/py_26.ini'])
    .replace('[KEY1]', '[KEY99]\nBACK_STYLE=9\nVIEW_RECT=0,0,1080,600\n[KEY1]')
    .replace('[KEY2]\nBACK_STYLE=2', '[KEY2]\nBACK_STYLE=8\nBACK_ANIM_STYLE=7\nFORE_ANIM_STYLE=10')),
  'light/res/default.css': strToU8(`${strFromU8(files['light/res/default.css'])}\n[STYLE7]\nPRESS_ANIM=1\n[STYLE8]\nNM_COLOR=FFFF0000\n[STYLE9]\nNM_COLOR=00FFFFFF\n[STYLE10]\nPRESS_ANIM=5\n`),
  'light/res/anim.ini': strToU8('[ANIM1]\nTYPE=4\nDURATION=600\nFROM=100,100\nTO=80,80\n' +
    '[ANIM2]\nBUILD_LIST=1\nBUILD_METHOD=1\n' +
    '[ANIM3]\nTYPE=2\nFROM_PX=0,0\nTO_PX=0,0\nDURATION=20\n[ANIM4]\n' +
    '[ANIM5]\nTYPE=4\nDURATION=400\nFROM=100,100\nTO=65,65\n' +
    '[ANIM30]\nTYPE=4\nDURATION=400\nFROM=100,100\nTO=100,100\nREPEAT_MODE=1\n' +
    '[ANIM32]\nBUILD_LIST=3,30\nBUILD_METHOD=0\n'),
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
  const { visible, hasRedBackground } = await player.locator('canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    return {
      visible: pixels.some((alpha, i) => i % 4 === 3 && alpha > 0),
      hasRedBackground: pixels.some((r, i) => i % 4 === 0 && r > 220 && pixels[i + 1] < 50 && pixels[i + 2] < 50 && pixels[i + 3] > 200),
    }
  })
  assert.ok(visible, '缩略图不应全透明')
  assert.equal(hasRedBackground, red, '缩略图实际绘制了对应按键的背景')
}
const expectMovingPixels = async player => {
  await player.scrollIntoViewIfNeeded()
  await player.and(page.locator('[data-playing="true"]')).waitFor()
  const canvas = await player.locator('canvas').elementHandle()
  const initial = await canvas.evaluate(canvas => canvas.toDataURL())
  await page.waitForFunction(({ canvas, initial }) => canvas.toDataURL() !== initial, { canvas, initial }, { timeout: 3000 })
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await dismissStartupDisclaimer(page)
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
  await expectSkinArtwork(page.locator('.key-animation-fields .ui-animation-player').first(), true)
  await page.locator('[data-workspace-page="animation"]').click()
  const card = id => page.locator(`#animation-library [data-animation-id="ANIM${id}"]`)
  const thumbnail = card(1).locator('.ui-animation-player')
  await page.evaluate(async () => (await import('/src/app/animation-resource.ts')).pickAnimationKeys([]))
  await expectSkinArtwork(thumbnail, true)
  await expectSkinArtwork(card(2).locator('.ui-animation-player'), false)
  await page.evaluate(async () => (await import('/src/app/animation-resource.ts')).pickAnimationKeys(['KEY99']))
  await expectSkinArtwork(thumbnail, true)
  // The same card ID must refresh when a different trial key is selected.
  await page.evaluate(async () => (await import('/src/app/animation-resource.ts')).pickAnimationKeys(['KEY1']))
  await expectSkinArtwork(thumbnail, false)
  await page.evaluate(async () => (await import('/src/app/animation-resource.ts')).pickAnimationKeys([]))
  await card(4).scrollIntoViewIfNeeded()
  await card(4).locator('.ui-empty').getByText('未配置动画', { exact: true }).waitFor()
  const still = card(3).locator('.ui-animation-player')
  await card(3).scrollIntoViewIfNeeded()
  await still.and(page.locator('[data-sample="skin"][data-playing="false"]')).waitFor()
  assert.match(await card(3).innerText(), /无位移 · 20 ms/)
  const node = await card(3).elementHandle()
  await card(3).click()
  const handle = page.locator('#animation-stage').getByRole('slider', { name: '位移 X', exact: true })
  await handle.press('ArrowRight')
  await expectSkinArtwork(still, false)
  assert.doesNotMatch(await card(3).innerText(), /无位移/)
  assert.ok(await card(3).evaluate((card, original) => card === original, node), '预览状态变化不替换卡片节点')
  // A transform bound to a missing foreground layer needs a visible key for trial playback.
  await expectSkinArtwork(card(5).locator('.ui-animation-player'), true)
  await expectMovingPixels(card(5).locator('.ui-animation-player'))

  // Editing the endpoint must update both the already opened card and its combination,
  // even though neither card changes type or duration.
  const scale = card(30).locator('.ui-animation-player')
  const combo = card(32).locator('.ui-animation-player')
  await expectSkinArtwork(scale, false)
  await expectSkinArtwork(combo, false)
  await card(30).click()
  const scaleX = page.locator('#animation-stage').getByRole('slider', { name: '缩放 X', exact: true })
  await scaleX.press('Shift+ArrowLeft')
  await expectMovingPixels(scale)
  await expectMovingPixels(combo)
  assert.deepEqual(errors, [])
  console.log('animation key artwork: bound and trial artwork, transparent key fallback, empty and stationary previews, and live status edits passed')
} finally {
  await browser.close()
  await server.close()
}
