import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'
import { encodePng } from '../src/ssf/ssf-png.ts'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { acceptAskDialogs } from '../tests/helpers/ask-dialogs.mjs'

const source = SkinArchive.open(process.env.BAIDU_PALM_SAMPLE
  ? new Uint8Array(readFileSync(process.env.BAIDU_PALM_SAMPLE)) : bdsFixture(), 'bds')
if (!process.env.BAIDU_PALM_SAMPLE) {
  for (const theme of ['light', 'dark']) {
    source.setBytes(`${theme}/skin/res/logo/pop_menu_icons.png`, encodePng({ width: 78, height: 468, data: new Uint8Array(78 * 468 * 4).fill(255) }))
    source.setText(`${theme}/skin/res/logo/pop_menu_icons.til`, [26, 27, 29, 31, 25, 50].map((tile, index) => `[IMG${tile}]\nSOURCE_RECT=0,${index * 78},78,78\n`).join(''))
    for (const [orientation, width] of [['port', 1080], ['land', 1920]]) {
      source.setText(`${theme}/skin/${orientation}/gen.ini`, `[PANEL]\nSIZE=${width},600\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,${width},120\n`)
      source.setText(`${theme}/skin/${orientation}/py_26.ini`, '[PANEL]\nKEY_NUM=1\n[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=q\n')
      source.setText(`${theme}/skin/${orientation}/cand1.cnd`, '[CAND]\n[ICON1]\nSIZE=150,120\nPOS=0,0\nKEY=F31\n[ICON2]\n' + `SIZE=${width - 300},120\nPOS=150,0\nKEY=F14\n[ICON3]\nSIZE=150,120\nANCHOR_TYPE=3\nPOS=-150,0\nKEY=F8\n`)
    }
  }
}
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41813, strictPort: false } })
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
const open = async (name, bytes) => {
  await page.locator('#browser-open').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled, null, { timeout: 120000 })
  await closeDialog()
}
const toolbar = async (theme, orientation) => page.evaluate(async ({ theme, orientation }) => {
  const { appState } = await import('/src/app/state.ts')
  const dom = await import('/src/app/dom.ts')
  const { selectFile } = await import('/src/app/navigation.ts')
  dom.theme.value = theme
  dom.orientation.value = orientation
  const { sxiBoardAddress } = await import('/src/app/sxi-documents.ts')
  selectFile(appState.archive.format === 'sxi' ? sxiBoardAddress('full26Pinyin') : `${theme}/skin/${orientation}/py_26.ini`)
  const { toolbarPreview } = await import('/src/app/canvas-interaction.ts')
  await toolbarPreview.resolver.ready()
  await toolbarPreview.draw()
  await toolbarPreview.rendered()
  const scene = await toolbarPreview.sceneForState()
  return {
    keys: toolbarPreview.keys.map(({ section, rect }) => ({ section, rect })),
    functions: scene ? (await Promise.all(scene.keys.map(async (key) => (await key.layers(false)).fore))).flat().filter((layer) => layer.kind === 'image' && layer.visual.imagePath?.includes('/logo/')).map(({ rect, visual }) => ({ rect, source: visual.source })) : [],
  }
}, { theme, orientation })
try {
  await page.addInitScript(() => {
    window.showSaveFilePicker = undefined
    // Keep baked artwork: this regression changes only the toolbar resources.
    new MutationObserver(() => document.querySelector('dialog[open]:not([id]):has(button[value="restore"]) button[value="cancel"]')?.click())
      .observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.evaluate(async () => {
    const { source } = await import('/src/app/canvas-interaction.ts')
    await source.load()
  })
  await open('toolbar.bds', source.toBytes())
  const before = new Map()
  for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) before.set(`${theme}/${orientation}`, await toolbar(theme, orientation))
  await page.locator('.pen-file-menu > summary').click()
  const pending = page.waitForEvent('download', { timeout: 120000 })
  pending.catch(() => {})
  await page.locator('.pen-file-menu [data-export-format="sxi"]').click()
  const tap = page.locator('#file-operation-dialog[open] button[data-variant="primary"]', { hasText: '下载' })
  const ready = tap.waitFor({ state: 'visible', timeout: 120000 }).then(() => 'tap')
  ready.catch(() => {})
  if (await Promise.race([pending, ready]) === 'tap') await tap.click()
  const downloaded = readFileSync(await (await pending).path())
  await closeDialog()
  await open('toolbar.sxi', downloaded)
  const output = SkinArchive.open(downloaded, 'sxi')
  const skin = JSON.parse(output.getText('skin.json'))
  for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) {
    const after = await toolbar(theme, orientation)
    assert.deepEqual(after.keys, before.get(`${theme}/${orientation}`).keys, `${theme}/${orientation}: authored toolbar geometry`)
    assert.equal(after.functions.length, 6, `${theme}/${orientation}: six function icons draw after reopening`)
    const container = after.keys.find(({ section }) => section === 'ICON2').rect
    const slot = container.width / 6
    after.functions.forEach(({ rect, source }, index) => {
      assert.deepEqual(source, [0, 0, 88, 88])
      const side = Math.min(88, slot, container.height)
      assert.deepEqual(rect, { x: container.x + index * slot + (slot - side) / 2, y: container.y + (container.height - side) / 2, width: side, height: side })
    })
    const [menu] = skin[theme === 'light' ? 'default' : 'night'].menu
    for (const entry of menu) for (const suffix of ['_iphone@3x', '_ipad', '_ipad@2x']) assert.ok(output.getBytes(`${theme}/skin/res/logo/${entry.Images.Normal.Normal}${suffix}.png`))
  }
  assert.deepEqual(errors, [])
  if (process.env.BAIDU_PALM_SAMPLE) await page.screenshot({ path: '/tmp/keyskin-palm-toolbar.png' })
  console.log('BDS → Palm: menu export/download/reopen preserves toolbar placement in both themes and orientations; six centred 88px icons and all device images load')
} catch (error) {
  await page.screenshot({ path: '/tmp/keyskin-palm-toolbar-failure.png' }).catch(() => {})
  console.error(errors)
  throw error
} finally {
  await browser.close()
  await server.close()
}
