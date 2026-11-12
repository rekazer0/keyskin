import assert from 'node:assert/strict'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

const files = unzipSync(ssfFixture({ single: true }))
files['1080/phoneSkin.ini'] = strToU8(strFromU8(files['1080/phoneSkin.ini']) + `
[Key_W]
ICONS=CustomIcons,unused.png
FG_STYLE=IconLayout
[CustomIcons]
NORMAL=delf_26.png
PRESSED=26q_x.png
[IconLayout]
ICON_RECT=0.1,0.1,0.3,0.3
[Key_E]
FG_STYLE=LabelLayout
[LabelLayout]
LABEL_VISIBLE=1
[Key_Space_Land]
ICON=transparent.png
ICON_PRESSED=delf_26.png
`)
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41863, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, bypassCSP: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const row = (key) => page.locator(`#document-fields [data-inspector-group-label="前景"] [data-document-key~="${key}"]`)
const history = (action) => page.evaluate(async (action) => (await import('/src/app/edit-history.ts'))[action](), action)
async function foreground(action, pressed = false) {
  return page.evaluate(async ({ action, pressed }) => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const scene = await preview.sceneForState()
    await preview.whenDrawn()
    const key = preview.keys.find((key) => key.center === action)
    const item = scene.keys.find((item) => item.section === key.section)
    return { rect: item.rect, layers: item.layers(pressed).fore.map((layer) => ({ kind: layer.kind, rect: layer.rect, text: layer.text?.text })) }
  }, { action, pressed })
}
async function select(action) {
  const point = await page.evaluate(async (action) => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const key = preview.keys.find((key) => key.center === action)
    const bounds = document.querySelector('#preview').getBoundingClientRect()
    return { x: bounds.x + (key.rect.x + key.rect.width / 2) / preview.panelWidth * bounds.width, y: bounds.y + (key.rect.y + key.rect.height / 2) / preview.surfaceHeight * bounds.height, section: key.section }
  }, action)
  await page.mouse.click(point.x, point.y)
  await page.waitForFunction((section) => JSON.parse(document.querySelector('#quick-inspector').dataset.selectionNames).includes(section), point.section)
}
function fits({ rect, layers }) {
  assert.equal(layers.length, 1)
  const icon = layers[0].rect
  assert.ok(icon.x >= rect.x + rect.width * 0.1 - 0.01)
  assert.ok(icon.y >= rect.y + rect.height * 0.1 - 0.01)
  assert.ok(icon.x + icon.width <= rect.x + rect.width * 0.3 + 0.01)
  assert.ok(icon.y + icon.height <= rect.y + rect.height * 0.3 + 0.01)
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: '前景回归.ssf', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync(files)) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await page.locator('.sidebar-overview button[data-path="light/skin/port/py_26.ini"]').click()
  fits(await foreground('w'))
  fits(await foreground('w', true))
  await select('w')
  assert.equal(await row('NORMAL').locator('.ui-style-ref input').first().inputValue(), 'delf_26.png')
  const before = await foreground('w')
  const left = row('ICON_RECT').locator('input').first()
  await left.fill('0.2'); await left.press('Enter')
  const moved = await foreground('w')
  assert.ok(moved.layers[0].rect.x > before.layers[0].rect.x)
  await history('undo')
  assert.deepEqual(await foreground('w'), before)
  await history('redo')
  assert.deepEqual(await foreground('w'), moved)
  await select('e')
  const label = await foreground('e')
  assert.ok(label.layers.some((layer) => layer.kind === 'text'))
  await row('LABEL_VISIBLE').locator('input').fill('0')
  await row('LABEL_VISIBLE').locator('input').press('Enter')
  assert.deepEqual((await foreground('e')).layers, [])
  await history('undo')
  assert.deepEqual(await foreground('e'), label)
  await page.locator('[data-orientation-choice="land"]').click()
  assert.deepEqual((await foreground('F38')).layers, [])
  assert.equal((await foreground('F38', true)).layers[0].kind, 'image')
  assert.deepEqual(errors, [])
  console.log('SSF foreground: ICONS groups, ICON_RECT live edits, label visibility, undo/redo and transparent/pressed landscape states passed')
} finally {
  await browser.close()
  await server.close()
}
