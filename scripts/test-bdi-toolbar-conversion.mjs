import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { nativeToolbarFixture } from '../tests/helpers/native-toolbar-fixture.mjs'
import { acceptAskDialogs } from '../tests/helpers/ask-dialogs.mjs'

const bytes = process.env.BDI_TOOLBAR_SAMPLE ? readFileSync(process.env.BDI_TOOLBAR_SAMPLE) : nativeToolbarFixture().toBytes()
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true })
const errors = []
try {
  page.on('pageerror', error => errors.push(error.message))
  await acceptAskDialogs(page)
  await page.addInitScript(() => {
    window.showSaveFilePicker = undefined
    new MutationObserver(() => document.querySelector('dialog[open]:not([id]):has(button[value="restore"]) button[value="cancel"]')?.click())
      .observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  const close = async () => {
    await page.waitForFunction(() => !document.querySelector('#file-operation-dialog')?.open || !document.querySelector('#file-operation-close')?.disabled)
    const button = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await button.isVisible()) await button.click()
  }
  const open = async (format, buffer) => {
    await page.locator('#browser-open').setInputFiles({ name: `toolbar.${format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(buffer) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled, null, { timeout: 120000 })
    await close()
  }
  const geometry = async (theme) => page.evaluate(async theme => {
    const dom = await import('/src/app/dom.ts')
    const { appState } = await import('/src/app/state.ts')
    const { selectFile } = await import('/src/app/navigation.ts')
    dom.theme.value = theme
    dom.orientation.value = 'port'
    dom.layout.value = 'py_26.ini'
    const path = appState.archive.format === 'sxi'
      ? (await import('/src/app/sxi-documents.ts')).sxiBoardAddress('full26Pinyin')
      : `${theme}/skin/port/py_26.ini`
    selectFile(path)
    const { preview, toolbarPreview, candidateBackgroundPreview } = await import('/src/app/canvas-interaction.ts')
    await Promise.all([preview, toolbarPreview, candidateBackgroundPreview].map(canvas => canvas.whenDrawn()))
    const scene = toolbarPreview.drawnScene
    const functions = scene?.keys.flatMap(key => key.layers(false).fore.filter(layer => layer.kind === 'image' && layer.visual.imagePath?.includes('/logo/')))
    return { height: toolbarPreview.panelHeight, panel: preview.panelHeight, revision: appState.archive.revision, functions: functions?.length ?? 0 }
  }, theme)
  for (const format of ['bds', 'sxi', 'ssf']) {
    await open('bdi', bytes)
    const original = await geometry('light')
    assert.ok(Math.abs(original.height - 124 * 1125 / 1320) < 0.000001)
    await page.locator('.pen-file-menu > summary').click()
    const pending = page.waitForEvent('download', { timeout: 120000 })
    pending.catch(() => {})
    await page.locator(`.pen-file-menu [data-export-format="${format}"]`).click()
    const tap = page.locator('#file-operation-dialog[open] button[data-variant="primary"]', { hasText: '下载' })
    const ready = tap.waitFor({ state: 'visible', timeout: 120000 }).then(() => 'tap')
    ready.catch(() => {})
    if (await Promise.race([pending, ready]) === 'tap') await tap.click()
    const download = readFileSync(await (await pending).path())
    await close()
    console.log(`${format}: downloaded ${download.length} bytes; reopening`)
    await open(format, download)
    for (const theme of ['light', 'dark']) {
      const state = await geometry(theme)
      assert.equal(state.height, format === 'ssf' ? 120 : 106, `${format}/${theme}: reopened package controls its toolbar height`)
      if (format !== 'ssf') assert.equal(state.panel, original.panel, 'the key panel retains its height')
      assert.equal(state.revision, 0, 'viewing the converted package does not rewrite it')
      if (format === 'sxi') assert.ok(state.functions > 0, 'native menu artwork survives reopening')
      if (process.env.BDI_TOOLBAR_SAMPLE) await page.locator('#device-shell').screenshot({ path: `/tmp/keyskin-height-${format}-${theme}.png` })
    }
    if (process.env.BDI_TOOLBAR_SAMPLE) writeFileSync(`/tmp/keyskin-height-verified.${format}`, download)
  }
  assert.deepEqual(errors, [])
  console.log('BDI → BDS/SXI/SSF: menu export, download and reopen preserve calibrated toolbar artwork and package geometry in both themes')
} catch (error) {
  await page.screenshot({ path: '/tmp/keyskin-height-failure.png' }).catch(() => {})
  console.error(errors, await page.locator('dialog[open]').allTextContents())
  throw error
} finally {
  await browser.close()
  await server.close()
}
