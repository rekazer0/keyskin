// BDA key text: an image-only key gets a text layer on its first text edit, the hint layer after the
// main text is editable on its own, a key shown in a state edits its state key, and a key takes a
// new foreground layer from the layout style editor.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const template = readFileSync(new URL('../public/default-template.bda', import.meta.url))
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41797, strictPort: false, host: '127.0.0.1' } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const appearanceKey = (name) => page.evaluate(async (name) => {
  const { currentBdaAppearance } = await import('/src/app/bda-documents.ts')
  const info = currentBdaAppearance()
  const key = info.appearance.panels.get('py_9').keys.get(name)
  return key && { layers: key.foreStyles, texts: key.foreStyles.filter((ref) => ref.type === 'text').map((ref) => info.appearance.textStyles.get(ref.key)) }
}, name)
async function selectKey(action) {
  const point = await page.evaluate(async (action) => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const key = preview.keys.find((item) => item.center === action)
    if (!key) throw new Error(`Missing key ${action}`)
    const box = document.querySelector('#preview').getBoundingClientRect()
    return { x: box.x + (key.rect.x + key.rect.width / 2) / preview.panelWidth * box.width, y: box.y + (key.rect.y + key.rect.height / 2) / preview.surfaceHeight * box.height, section: key.section }
  }, action)
  await page.mouse.click(point.x, point.y)
  await page.waitForFunction((section) => JSON.parse(document.querySelector('#quick-inspector').dataset.selectionNames ?? '[]').includes(section), point.section)
}
const typography = page.locator('.key-typography-fields')
const style = (property) => typography.locator(`[data-style-field="${property}"]`)
async function change(input, value) { await input.fill(value); await input.press('Enter') }
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: '文字层.bda', mimeType: 'application/octet-stream', buffer: template })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()

  // Backspace only has an image: its first size edit adds a text layer copied from the panel's key text.
  await selectKey('F36')
  // BDA 的文字样式没有字体平滑 / 阴影字段；旧版百度 CSS 才有。
  assert.equal(await typography.locator('[data-style-field="FONT_CLEARTYPE"]').isVisible(), false)
  assert.equal(await page.locator('#key-text-shadow').isHidden(), true)
  assert.deepEqual((await appearanceKey('KEY_F36')).layers.map((ref) => ref.type), ['image'])
  assert.ok(await style('FONT_SIZE').isVisible(), 'text fields are offered for an image-only key')
  await change(style('FONT_SIZE'), '44')
  const added = await appearanceKey('KEY_F36')
  assert.deepEqual(added.layers.map((ref) => ref.type), ['image', 'text'])
  assert.equal(added.texts[0].fontSize, 44)
  await change(style('CONTENT_TEXT'), '删')
  assert.equal((await appearanceKey('KEY_F36')).texts[0].contentText, '删')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  await page.waitForFunction(async () => {
    const { currentBdaAppearance } = await import('/src/app/bda-documents.ts')
    return currentBdaAppearance().appearance.panels.get('py_9').keys.get('KEY_F36').foreStyles.length === 1
  })

  // ABC has a main text and a hint (2): the switch picks which one the fields edit.
  await selectKey('b')
  const layers = page.locator('#key-text-layers')
  assert.ok(await layers.isVisible())
  const before = await appearanceKey('KEY_B')
  await layers.getByRole('button', { name: '提示文字' }).click()
  assert.equal(await style('FONT_SIZE').inputValue(), String(before.texts[1].fontSize))
  await change(style('FONT_SIZE'), '31')
  const after = await appearanceKey('KEY_B')
  assert.equal(after.texts[1].fontSize, 31)
  assert.equal(after.texts[0].fontSize, before.texts[0].fontSize, 'the main text keeps its size')
  await layers.getByRole('button', { name: '主文字' }).click()
  assert.equal(await style('FONT_SIZE').inputValue(), String(before.texts[0].fontSize))

  // The layout style editor adds a foreground layer after the existing ones.
  await selectKey('F36')
  const slot = page.locator('#bda-config-fields [data-bda-style-path="keys.KEY_F36.foreStyles.1"]')
  await slot.scrollIntoViewIfNeeded()
  const image = (await appearanceKey('KEY_F36')).layers[0]
  // 添加前景是「前景」标签右端的 ＋：打开「全部样式」选一张样式后应用。
  await slot.locator('.ui-style-ref-append').click()
  await page.locator('#picker-dialog').waitFor({ state: 'visible' })
  const styleID = await page.evaluate(async (ref) => (await import('/src/bda.ts')).bdaStyleID(ref), image)
  const picker = page.frameLocator('#picker-frame')
  await picker.locator(`#style-library-grid > .ui-style-card[data-style-id="${styleID}"]`).click()
  await picker.locator('#style-library-apply').click()
  await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
  assert.deepEqual((await appearanceKey('KEY_F36')).layers, [image, image])
  // 前景层卡片右侧的移除条把这一层移出列表。
  const removeLayer = page.locator('#bda-config-fields [data-bda-style-path="keys.KEY_F36.foreStyles.1"] .ui-style-remove')
  await removeLayer.hover()
  await removeLayer.click()
  assert.deepEqual((await appearanceKey('KEY_F36')).layers, [image])

  // A key shown in a state edits the state key the canvas draws.
  const stateKey = await page.evaluate(async () => {
    const { currentBdaAppearance } = await import('/src/app/bda-documents.ts')
    const keys = [...currentBdaAppearance().appearance.panels.get('py_9').keys.keys()]
    return keys.find((name) => /_S\d+$/.test(name))
  })
  if (stateKey) {
    const [, action, state] = stateKey.match(/^KEY_(.+)_S(\d+)$/)
    const options = await page.locator('#skin-state option').evaluateAll((items) => items.map((item) => item.value))
    if (options.includes(state)) {
      await page.selectOption('#skin-state', state)
      await selectKey(action.length === 1 ? action.toLowerCase() : action)
      const names = await page.evaluate(async () => (await import('/src/app/document-inspector.ts')).selectedBdaKeyNames())
      assert.deepEqual(names, [stateKey])
    } else console.log(`skip state check: ${stateKey} has no state option`)
  }
  assert.deepEqual(errors, [])
  console.log('BDA key text: new text layer, hint layer switch, new foreground layer and state key selection passed')
} catch (error) {
  await page.screenshot({ path: '/tmp/bdi-bda-key-text-failure.png' })
  throw error
} finally {
  await browser.close()
  await server.close()
}
