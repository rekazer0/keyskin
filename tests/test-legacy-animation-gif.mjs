import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from './helpers/baidu-fixture.mjs'
import { dismissStartupDisclaimer } from './helpers/open-editor-template.mjs'

const files = unzipSync(bdsFixture())
// The GIF is relative to the selected direction's anim.ini, not the shared stylesheet.
const animPath = 'light/skin/port/anim.ini'
const gifPath = 'light/skin/port/102.gif'
const animation = '[ANIM2]\nANIM_PATH=102.gif\n[ANIM3]\nANIM_PATH=broken.gif\n'
files['light/port/anim.ini'] = strToU8(animation)
files['light/port/broken.gif'] = strToU8('GIF89a')
files['light/res/default.css'] = strToU8(strFromU8(files['light/res/default.css']) + '\n[STYLE702]\nPRESS_ANIM=2\n[STYLE703]\nPRESS_ANIM=3\n')
const gif = readFileSync(new URL('./fixtures/animation-media/two-colors.gif', import.meta.url))
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41939, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(10000)

  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await dismissStartupDisclaimer(page)
  await page.locator('#browser-open').setInputFiles({ name: 'gif.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync(files)) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  const gallery = page.locator('#resource-gallery')
  const style = async id => {
    await page.locator('[data-workspace-page="resources"]').click()
    await page.getByRole('button', { name: /^动画样式/ }).click()
    await gallery.locator(`[data-style-id="${id}"]`).click()
  }
  const detail = page.locator('#style-detail-fields > .ui-animation-player')
  await style(703)
  await detail.getByText('无法解码 GIF broken.gif', { exact: true }).waitFor()
  await style(702)
  await detail.getByText('未找到 GIF 102.gif', { exact: true }).waitFor()
  await page.evaluate(async path => (await import('/src/app/navigation.ts')).selectFile(path, 'overview', 'motion'), animPath)
  await page.locator('#animation-library [data-animation-id="ANIM2"]').click()
  const preview = page.locator('#animation-stage')
  await preview.getByText('未找到 GIF 102.gif', { exact: true }).waitFor()
  const upload = page.locator('.ui-style-state[role="button"][aria-label="上传 GIF…"]')
  const chooseGif = async buffer => {
    const chooser = page.waitForEvent('filechooser')
    await upload.click()
    await (await chooser).setFiles({ name: 'original.gif', mimeType: 'image/gif', buffer })
  }
  await chooseGif(Buffer.from('GIF89a'))
  await page.locator('#file-operation-result').filter({ hasText: '请选择可解码的 GIF 文件' }).waitFor()
  await close.click()
  await close.waitFor({ state: 'hidden' })
  await chooseGif(gif)
  const readySlider = 'input[aria-label="预览时间"][max="1000"]:enabled'
  await preview.locator(readySlider).waitFor()
  assert.deepEqual(await page.evaluate(async ({ animPath, gifPath }) => {
    const { archive } = (await import('/src/app/state.ts')).appState
    return [archive.getText(animPath), Array.from(archive.getBytes(gifPath))]
  }, { animPath, gifPath }), [animation, [...gif]], 'upload restores the original reference as one file edit')
  await style(702)
  await detail.locator(readySlider).fill('750')
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#style-detail-fields > .ui-animation-player .ui-animation-stage > canvas')
    const [r, , b] = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data
    return b > r + 80
  })
  await page.locator('#desktop-undo').click()
  await detail.getByText('未找到 GIF 102.gif', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('BDI/BDS GIF: missing and invalid assets, upload, frame sampling and undo passed')
} finally {
  await browser.close()
  await server.close()
}
