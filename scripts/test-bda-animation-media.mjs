import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { updateBdaAnimationEffect } from '../src/bda-encode.ts'
import { bdaAnimatedSkinBytes } from '../tests/helpers/bda-animation-fixture.mjs'
import { dismissStartupDisclaimer } from '../tests/helpers/open-editor-template.mjs'

const files = unzipSync(bdaAnimatedSkinBytes())
const config = 'light/port/animationConfig'
const fixture = name => readFileSync(new URL(`../tests/fixtures/animation-media/${name}`, import.meta.url))
files[config] = updateBdaAnimationEffect(files[config], 'video:video', 'resourceID', 'celebrate')
files['light/port/res/celebrate.webm'] = fixture('two-colors.webm')
files['light/res/spark.gif'] = fixture('two-colors.gif')
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41878, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await dismissStartupDisclaimer(page)
  await page.locator('#browser-open').setInputFiles({ name: 'media.bda', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync(files)) })
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  if (await close.isVisible()) await close.click()
  const open = (id, phase) => page.evaluate(async ({ id, phase }) => {
    const { appState } = await import('/src/app/state.ts')
    const { selectFile } = await import('/src/app/navigation.ts')
    const path = 'light/skin/port/animationConfig'
    if (phase === 'missing') appState.archive.delete('light/skin/port/res/celebrate.webm')
    appState.selectedAnimations[`${path}|motion`] = id
    selectFile(path, 'overview', 'motion')
  }, { id, phase })
  const stage = page.locator('#animation-stage')
  const sample = () => page.evaluate(() => {
    const canvas = document.querySelector('#animation-stage .ui-animation-stage > canvas')
    const [r, g, b, a] = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data
    return [r, g, b, a]
  })
  const seek = stage.getByRole('slider', { name: '预览时间', exact: true })
  for (const id of ['frame:gif', 'video:video']) {
    await open(id)
    await stage.getByRole('button', { name: '播放预览', exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector('#animation-stage input[aria-label="预览时间"]')?.disabled)
    assert.equal(await seek.getAttribute('max'), '1000', `${id}: timeline is derived from the media duration`)
    const red = await sample()
    assert.ok(red[0] > red[2] + 80, `${id}: first frame is red (${red})`)
    await seek.fill('750')
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#animation-stage .ui-animation-stage > canvas')
      const [r, , b] = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data
      return b > r + 80
    })
    await seek.fill('0')
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#animation-stage .ui-animation-stage > canvas')
      const [r, , b] = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data
      return r > b + 80
    })
  }
  await open('lottie:lottie')
  await stage.getByText('Lottie暂不支持桌面预览', { exact: false }).waitFor()
  await open('video:video', 'missing')
  await stage.locator('.ui-animation-note').filter({ hasText: '未找到视频 celebrate，显示占位图片' }).waitFor()
  assert.equal(await stage.getByRole('button', { name: '播放预览', exact: true }).isDisabled(), true)
  assert.ok((await sample())[3] > 0, 'missing video uses the real placeholder')
  assert.deepEqual(errors, [])
  console.log('BDA media: GIF and video sample actual frames, scrubbing, duration and missing-file fallback passed')
} finally {
  await browser.close()
  await server.close()
}
