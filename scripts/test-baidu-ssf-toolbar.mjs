import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { convertSsfToBaidu } from '../src/ssf/ssf-to-baidu.ts'
import { encodePng } from '../src/ssf/ssf-png.ts'
import { solid, ssfFixture } from '../tests/helpers/ssf-fixture.mjs'
import { acceptAskDialogs } from "../tests/helpers/ask-dialogs.mjs"

const files = unzipSync(ssfFixture())
for (const status of ['status1', 'status2']) {
  files[`1080/${status}/ime_function_voice.png`] = encodePng(solid(48, 54, [180, status === 'status1' ? 30 : 90, 210]))
}
// Avoid key-sound transcoding in this toolbar-only browser regression.
files['default/sound_android.ini'] = strToU8('')
const template = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/sogou-template.bds', import.meta.url))))
const source = process.env.BAIDU_SSF_SAMPLE
  ? SkinArchive.open(new Uint8Array(readFileSync(process.env.BAIDU_SSF_SAMPLE)))
  : convertSsfToBaidu(await SsfPackage.open(zipSync(files)), template).archive
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41812, strictPort: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, bypassCSP: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await acceptAskDialogs(page)
const closeDialog = async () => {
  await page.waitForFunction(() => !document.querySelector('#file-operation-dialog')?.open || !document.querySelector('#file-operation-close')?.disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
}
const open = async (name, buffer) => {
  await page.locator('#browser-open').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(buffer) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  await closeDialog()
}
const toolbar = async (theme) => {
  if (await page.locator("#theme").inputValue() !== theme) await page.locator('[data-mobile-choice="theme"]').click()
  return page.evaluate(async () => {
    const { toolbarPreview } = await import('/src/app/canvas-interaction.ts')
    await toolbarPreview.resolver.ready()
    await toolbarPreview.draw()
    await toolbarPreview.rendered()
    return toolbarPreview.canvas.toDataURL()
  })
}
try {
  await page.addInitScript(() => { window.showSaveFilePicker = undefined })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  for (const format of ['bds', 'bdi']) {
    await open(`toolbar.${format}`, await source.platformBytesAsync(format, []))
    const before = { light: await toolbar('light'), dark: await toolbar('dark') }
    await page.locator('.pen-file-menu > summary').click()
    const pending = page.waitForEvent('download', { timeout: 120000 })
    pending.catch(() => {})
    await page.locator('.pen-file-menu [data-export-format="ssf"]').click()
    const tap = page.locator('#file-operation-dialog[open] button[data-variant="primary"]', { hasText: '下载' })
    const ready = tap.waitFor({ state: 'visible', timeout: 120000 }).then(() => 'tap')
    ready.catch(() => {})
    if (await Promise.race([pending, ready]) === 'tap') await tap.click()
    const downloaded = readFileSync(await (await pending).path())
    await closeDialog()
    await open('toolbar.ssf', downloaded)
    for (const theme of ['light', 'dark']) {
      assert.equal(await toolbar(theme), before[theme], `${format} → SSF ${theme}: every toolbar canvas pixel`)
    }
    if (process.env.BAIDU_SSF_SAMPLE) await page.screenshot({ path: `/tmp/bdi-toolbar-fixed-${format}.png` })
  }
  assert.deepEqual(errors, [])
  console.log('BDS/BDI → SSF: menu export, download and reopen preserve every toolbar pixel in light/dark themes')
} finally {
  await browser.close()
  await server.close()
}
