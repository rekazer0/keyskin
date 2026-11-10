import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { MAX_IMAGE_FILES } from '../src/bds-package.ts'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'
import { acceptAskDialogs } from '../tests/helpers/ask-dialogs.mjs'

const sample = process.env.SSF_SKIN_PATH
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, bypassCSP: true })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await acceptAskDialogs(page)
try {
  await page.addInitScript(() => {
    window.showSaveFilePicker = undefined
    new MutationObserver(() => {
      const dialog = [...document.querySelectorAll('dialog[open]:not([id])')].find(item => item.textContent.includes('还原按键文字？'))
      dialog?.querySelector('button[value="cancel"]')?.click()
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
  })
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`
  await page.goto(url)
  await page.locator('#browser-open').setInputFiles({ name: 'size.ssf', mimeType: 'application/octet-stream', buffer: sample ? readFileSync(sample) : Buffer.from(ssfFixture()) })
  await page.waitForFunction(async () => {
    const { appState } = await import('/src/app/state.ts')
    return appState.archive?.format === 'ssf' && !document.querySelector('#open').disabled
  }, null, { timeout: 60000 })
  await page.locator('.pen-file-menu > summary').click()
  const pending = page.waitForEvent('download', { timeout: 120000 })
  pending.catch(() => {})
  await page.locator('.pen-file-menu [data-export-format="bds"]').click()
  const tap = page.locator('#file-operation-dialog[open] button[data-variant="primary"]', { hasText: '下载' })
  const ready = tap.waitFor({ state: 'visible', timeout: 120000 }).then(() => 'tap')
  ready.catch(() => {})
  if (await Promise.race([pending, ready]) === 'tap') await tap.click()
  const download = await pending
  const bytes = new Uint8Array(readFileSync(await download.path()))
  const archive = SkinArchive.open(bytes, 'bds')
  for (const theme of ['light', 'dark']) {
    const root = `${theme}/skin/`
    assert.ok(archive.names().filter(path => path.startsWith(`${root}res/`) && /^[^/]+\.png$/.test(path.slice(`${root}res/`.length))).length <= MAX_IMAGE_FILES)
    for (const orientation of ['port', 'land']) {
      const dir = `${root}${orientation}/`
      const css = IniDocument.parse(archive.getText(archive.getBytes(`${dir}res/default.css`) ? `${dir}res/default.css` : `${root}res/default.css`))
      for (const path of archive.names().filter(path => path.startsWith(dir) && path.endsWith('.ini'))) {
        for (const { key, value } of IniDocument.parse(archive.getText(path)).entries()) {
          if (key === 'BACK_STYLE' && value.trim() && value !== '0') assert.ok(css.sections().includes(`STYLE${value}`), `${path}: BACK_STYLE=${value}`)
        }
      }
    }
  }
  if (process.env.BDS_EXPORT_MAX_BYTES) assert.ok(bytes.length <= Number(process.env.BDS_EXPORT_MAX_BYTES), `export grew to ${bytes.length} bytes`)
  if (process.env.BDS_EXPORT_OUTPUT) await download.saveAs(process.env.BDS_EXPORT_OUTPUT)
  await page.goto(url)
  await page.locator('#browser-open').setInputFiles({ name: 'size.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await page.waitForFunction(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { preview } = await import('/src/app/canvas-interaction.ts')
    return appState.archive?.format === 'bds' && preview.keys.length > 10 && !document.querySelector('#open').disabled
  }, null, { timeout: 60000 })
  assert.deepEqual(errors, [])
  console.log(`SSF → BDS: menu download and reopen passed; ${bytes.length} bytes; background styles resolve in both orientations; image count ≤ ${MAX_IMAGE_FILES}`)
} finally {
  await browser.close()
  await server.close()
}
