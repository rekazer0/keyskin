import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { strToU8, zipSync } from 'fflate'
import { encodePng } from '../src/ssf/ssf-png.ts'

const files = {}
for (const theme of ['light', 'dark']) {
  const root = `${theme}/`
  files[`${root}res/default.css`] = '[STYLE1]\nNM_IMG=pic,1\n[STYLE2]\nNM_IMG=pic,2\n[STYLE3]\nSHOW=百度\nNM_COLOR=202020\nFONT_SIZE=20\n'
  files[`${root}res/pic.png`] = encodePng({ width: 6, height: 8,
    data: Uint8Array.from({ length: 6 * 8 * 4 }, (_, i) => (i < 6 * 2 * 4 ? [255, 0, 0, 255] : [0, 0, 255, 255])[i % 4]) })
  files[`${root}res/pic.til`] = '[IMG1]\nSOURCE_RECT=0,0,6,2\n[IMG2]\nSOURCE_RECT=0,2,6,6\n'
  for (const orientation of ['port', 'land']) {
    const path = `${root}${orientation}/`
    files[`${path}gen.ini`] = '[PANEL]\nSIZE=360,240\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,360,60\n'
    files[`${path}py_26.ini`] = '[PANEL]\nBACK_STYLE=2\nKEY_NUM=1\n[KEY1]\nVIEW_RECT=0,0,40,40\nCENTER=q\n'
    files[`${path}cand1.cnd`] = '[CAND]\nBACK_STYLE=1\nFORE_STYLE=3\nICON_NUM=1\n[ICON1]\nFORE_STYLE=3\nKEY=F31\n'
  }
}
const source = SkinArchive.open(zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) =>
  [path, typeof value === 'string' ? strToU8(value) : value]))), 'bds')
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true })
const errors = []
try {
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    window.showSaveFilePicker = undefined
    window.exportDialogTitles = []
    new MutationObserver(() => {
      for (const title of document.querySelectorAll('dialog[open]:not([id]) h2')) {
        window.exportDialogTitles.push(title.textContent)
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'backgrounds.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(source.toBytes()) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled, null, { timeout: 120000 })
  await page.waitForFunction(() => !document.querySelector('#file-operation-dialog').open)
  await page.locator('.pen-file-menu > summary').click()
  const pending = page.waitForEvent('download', { timeout: 120000 })
  pending.catch(() => {})
  await page.locator('.pen-file-menu [data-export-format="bdi"]').click()
  const tap = page.locator('#file-operation-dialog[open] button[data-variant="primary"]', { hasText: '下载' })
  const ready = tap.waitFor({ state: 'visible', timeout: 120000 }).then(() => 'tap')
  ready.catch(() => {})
  if (await Promise.race([pending, ready]) === 'tap') await tap.click()
  const exported = SkinArchive.open(readFileSync(await (await pending).path()), 'bdi')
  assert.deepEqual(await page.evaluate(() => window.exportDialogTitles), [], 'export completes without an adjustment dialog, including text-logo warnings')
  for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) {
    const path = `${theme}/skin/${orientation}/`
    assert.equal(IniDocument.parse(exported.getText(`${path}py_26.ini`)).get('PANEL', 'BACK_STYLE'), '2')
    assert.equal(exported.getText(`${path}cand1.cnd`), source.getText(`${path}cand1.cnd`))
    assert.deepEqual(exported.getBytes(`${theme}/skin/res/pic.png`), source.getBytes(`${theme}/skin/res/pic.png`))
  }
  assert.ok(exported.names().every(name => !name.includes('ios_keyboard_')))
  assert.deepEqual(errors, [])
  console.log('BDS → BDI: menu export preserves backgrounds in both themes and orientations without adjustment dialogs')
} finally {
  await browser.close()
  await server.close()
}
