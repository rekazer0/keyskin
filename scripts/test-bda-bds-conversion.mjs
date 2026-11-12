import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { acceptAskDialogs } from '../tests/helpers/ask-dialogs.mjs'

const sample = process.env.BDA_SKIN_PATH
const source = SkinArchive.open(readFileSync(sample || new URL('../public/default-template.bda', import.meta.url)), 'bda')
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, bypassCSP: true })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await acceptAskDialogs(page)
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: '民生银行.bda', mimeType: 'application/octet-stream', buffer: Buffer.from(source.toBytes()) })
  await page.locator('#document-name').filter({ hasText: '民生银行.bda' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const colors = await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { BdaResolver } = await import('/src/bda-resolver.ts')
    const { decodeBdaAppearance } = await import('/src/bda-decode.ts')
    const { bdaStyleID } = await import('/src/bda.ts')
    const bytes = appState.archive.getBytes('light/skin/port/appearanceConfig')
    const { addBdaStyle, updateBdaStyle } = await import('/src/bda-encode.ts')
    const added = addBdaStyle(bytes, 'color')
    const resolver = new BdaResolver(appState.archive, updateBdaStyle(added.bytes, added.ref, 'HL_COLOR', '1A0079BB'))
    const id = bdaStyleID(added.ref)
    const appearance = decodeBdaAppearance(bytes)
    const backgroundRefs = [...appearance.panels.values()].flatMap(panel => [
      ...[...panel.lists.values()].map(list => list.cellBackStyle),
      ...[...(panel.cand?.candKeys.values() ?? [])].map(key => key.backStyle),
    ]).filter(ref => ref?.type === 'color' && !appearance.colorStyles.get(ref.key)?.normalColor)
    for (const ref of backgroundRefs) {
      if ((await resolver.resolve(bdaStyleID(ref), false))?.color) throw new Error(`normal background tinted: ${ref.key}`)
    }
    return { normal: (await resolver.resolve(id, false)).color, pressed: (await resolver.resolve(id, true)).color }
  })
  assert.equal(colors.normal, undefined)
  assert.equal(colors.pressed, 'rgba(0, 121, 187, 0.102)')
  if (process.env.BDA_PREVIEW_OUTPUT) await page.screenshot({ path: process.env.BDA_PREVIEW_OUTPUT })
  const bytes = new Uint8Array(await page.evaluate(async () => {
    const { exportArchive } = await import('/src/app/archive-io.ts')
    return [...(await exportArchive('bds')).bytes]
  }))
  const output = SkinArchive.open(bytes, 'bds')
  assert.equal(output.infoField('SupportDarkMode'), '1')
  for (const path of output.names().filter(path => path.endsWith('/default.css'))) {
    const styles = IniDocument.parse(output.getText(path))
    const ids = styles.sections().filter(section => /^STYLE\d+$/.test(section)).map(section => Number(section.slice(5)))
    assert.ok(Math.max(...ids) <= 32767)
    assert.equal(Number(styles.get('GLOBAL', 'STYLE_NUM')), Math.max(...ids))
  }
  if (process.env.BDS_EXPORT_OUTPUT) writeFileSync(process.env.BDS_EXPORT_OUTPUT, bytes)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  // Keep the exported text images when reopening, so the actual deliverable is exercised.
  await page.evaluate(() => new MutationObserver(() => {
    document.querySelector('dialog[open]:not([id]) button[value="cancel"]')?.click()
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] }))
  await page.locator('#browser-open').setInputFiles({ name: '民生银行.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await page.locator('#document-name').filter({ hasText: '民生银行.bds' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  assert.deepEqual(errors, [])
  console.log(`PASS: BDA normal/pressed backgrounds, BDS export and reopen (${bytes.length} bytes)`)
} finally {
  await browser.close()
  await server.close()
}
