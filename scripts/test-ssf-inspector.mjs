import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

// Sogou reads key text through FG_STYLE → LABEL_STYLE; give Q and W the shared qwerty label style.
const files = unzipSync(ssfFixture())
files['1080/status1/phoneSkin.ini'] = strToU8(strFromU8(files['1080/status1/phoneSkin.ini'])
  .replace('[Key_Q]\n', '[Key_Q]\nFG_STYLE=FGStyle_Qwerty\n')
  .replace('[TextStyle_Qwerty]', '[Key_W]\nFG_STYLE=FGStyle_Qwerty\n[FGStyle_Qwerty]\nLABEL_STYLE=TextStyle_Qwerty\nLABEL_POSITION=0,0,1,1\n[TextStyle_Qwerty]'))
// The phone installs only the folder nearest its width, so a 720 copy must receive the same edits.
for (const name of Object.keys(files)) if (name.startsWith('1080/status1/')) files[name.replace('1080/', '720/')] = files[name]
const fixture = zipSync(files)

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41796, strictPort: false, host: '127.0.0.1' } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const fields = page.locator('#document-fields')
const row = (key) => fields.locator(`[data-document-key="${key}"]`)
const read = (path, section, key) => page.evaluate(async ({ path, section, key }) => {
  const { ssfDocument } = await import('/src/app/ssf-documents.ts')
  return ssfDocument(path).get(section, key)
}, { path, section, key })
async function selectKey(action, shift = false) {
  const point = await page.evaluate(async (action) => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const key = preview.keys.find((item) => item.center === action)
    if (!key) throw new Error(`Missing key ${action}`)
    const box = document.querySelector('#preview').getBoundingClientRect()
    return { x: box.x + (key.rect.x + key.rect.width / 2) / preview.panelWidth * box.width, y: box.y + (key.rect.y + key.rect.height / 2) / preview.surfaceHeight * box.height, section: key.section }
  }, action)
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.click(point.x, point.y)
  if (shift) await page.keyboard.up('Shift')
  await page.waitForFunction(({ count, section }) => {
    const inspector = document.querySelector('#quick-inspector')
    return Number(inspector.dataset.selectionCount) === count && JSON.parse(inspector.dataset.selectionNames).includes(section)
  }, { count: shift ? 2 : 1, section: point.section })
}
async function change(input, value) { await input.fill(value); await input.press('Enter') }
const skin = '1080/status1/phoneSkin.ini'
const keys = '1080/status1/keys.ini'
const twin = '720/status1/phoneSkin.ini'
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: '属性测试.ssf', mimeType: 'application/octet-stream', buffer: Buffer.from(fixture) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  // Preview fields use the common edit-mode request dialog.
  const readonly = await row('BG_STYLE').first().locator('input').boundingBox()
  await page.mouse.click(readonly.x + 20, readonly.y + readonly.height / 2)
  await page.waitForSelector('#edit-mode-dialog[open]')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await page.locator('.sidebar-overview button[data-path="light/skin/port/py_26.ini"]').click()
  assert.equal(await page.locator('.raw-files button[data-path^="light/skin/"]').count(), 0)
  assert.equal(await page.locator('#source-name').textContent(), skin)
  assert.equal(await page.evaluate(async () => (await import('/src/app/canvas-interaction.ts')).source.value), strFromU8(files[skin]))
  assert.ok(await fields.locator(':scope > .ui-section').count() > 3)
  assert.equal(await fields.locator('details, summary').count(), 0)
  // Raw property names filter rows; unmatched subsections disappear as a unit.
  await page.locator('.inspector-filter-open').click()
  await page.locator('#inspector-filter').fill('TEXT_COLOR_PRESSED')
  assert.ok(await row('TEXT_COLOR_PRESSED').count() > 0)
  assert.equal(await row('BG_STYLE').first().isVisible(), false)
  await selectKey('q')
  assert.equal(await page.locator('#inspector-filter').inputValue(), 'TEXT_COLOR_PRESSED')
  await page.locator('#inspector-filter').press('Escape')
  await page.locator('#inspector-filter').press('Escape')
  // A composite edit preserves its other coordinates; reset survives inspector reconstruction.
  const coord = () => row('FG_RECT').locator('input')
  // A section's normal and pressed images share one Baidu-style card: two names, normal then pressed preview.
  const backgroundCard = fields.locator('[data-inspector-group-label="背景"] .ssf-image-card')
  assert.equal(await backgroundCard.count(), 1)
  assert.deepEqual(await backgroundCard.locator('.style-picker-state').evaluateAll((states) => states.map((state) => state.dataset.styleState)), ['normal', 'highlighted'])
  assert.equal(await backgroundCard.locator('.style-reference-name').count(), 2)
  // Boards are picked in the overview, not a 9 / 26 key switch; on phones a swipe that starts on a
  // thumbnail still scrolls the inspector, and a crowded category rail scrolls by itself.
  assert.equal(await page.locator('#layout').isHidden(), true)
  assert.equal(await backgroundCard.locator('canvas').first().evaluate((canvas) => getComputedStyle(canvas).touchAction), 'auto')
  assert.equal(await page.locator('.inspector-rail').evaluate((rail) => getComputedStyle(rail).overflowY), 'auto')
  assert.equal(await coord().count(), 4)
  await change(coord().nth(0), '0.1')
  assert.equal(await read(keys, 'Key_Q', 'FG_RECT'), '0.1,0.25,1,0.75')
  assert.equal(await page.locator('.inspector-changes').textContent(), '已改 1')
  await change(coord().nth(1), '0.5')
  assert.equal(await read(keys, 'Key_Q', 'FG_RECT'), '0.1,0.5,1,0.75')
  await page.locator('.inspector-reset').click()
  assert.equal(await read(keys, 'Key_Q', 'FG_RECT'), '0,0.25,1,0.75')
  assert.equal(await page.locator('.inspector-reset').isHidden(), true)
  // A continuous numeric gesture is one undo step and stays connected until it ends.
  const before = await page.evaluate(async () => (await import('/src/app/state.ts')).appState.undoStack.length)
  await coord().nth(0).focus()
  await page.keyboard.press('Shift+ArrowUp')
  await page.keyboard.press('Shift+ArrowUp')
  await page.waitForFunction(async (before) => (await import('/src/app/state.ts')).appState.undoStack.length === before + 1, before)
  await page.locator('#selected-key').click()
  assert.equal(await read(keys, 'Key_Q', 'FG_RECT'), '20,0.25,1,0.75')
  await page.locator('#desktop-undo').click()
  assert.equal(await read(keys, 'Key_Q', 'FG_RECT'), '0,0.25,1,0.75')
  // Shared background + per-key background display mixed previews and retain each stretch band.
  await selectKey('w', true)
  assert.match(await page.locator('#selected-key-context').textContent(), /共同属性/)
  assert.equal(await row('FG_RECT').count(), 0)
  const background = fields.locator('[data-inspector-group-label="背景"]')
  assert.equal(await background.locator('.style-picker-state').first().textContent(), '混合')
  const stretch = row('STRETCH').locator('input')
  assert.equal(await stretch.first().getAttribute('placeholder'), '混合')
  await change(stretch.first(), '5')
  assert.equal(await read(skin, 'SMA_Key26Bg_Q', 'NORMAL'), '26keyq.png,5,96,3,139')
  assert.equal(await read(twin, 'SMA_Key26Bg_Q', 'NORMAL'), '26keyq.png,2,96,3,139', 'the 720 copy keeps its own stretch band')
  assert.equal(await read(skin, 'KeyBg_Default_Latin', 'NORMAL'), '26key.png,5,97,1,141')
  await page.locator('.inspector-reset').click()
  assert.equal(await read(skin, 'SMA_Key26Bg_Q', 'NORMAL'), '26keyq.png,2,96,3,139')
  // A missing pressed image stays missing after resetting a replacement.
  await selectKey('F36')
  const pressedBackground = fields.locator('[data-inspector-group-label="背景"] .style-picker-state').nth(1)
  assert.equal(await read(skin, 'SMA_Key26Bg_Backspace_Qwerty', 'PRESSED'), undefined)
  await pressedBackground.click()
  const picker = page.frameLocator('#picker-frame')
  await picker.locator('#resource-picker-grid button').filter({ hasText: '26fn' }).first().click()
  assert.match(await read(skin, 'SMA_Key26Bg_Backspace_Qwerty', 'PRESSED'), /^26fn\.png/)
  await page.locator('.inspector-reset').click()
  assert.equal(await read(skin, 'SMA_Key26Bg_Backspace_Qwerty', 'PRESSED'), undefined)
  // Colour alpha edits preserve the exact RGB value and reset without rounding the original alpha.
  await selectKey('q')
  const color = row('TEXT_COLOR').locator('input:not([type])')
  await change(color, '0x7F112233')
  await selectKey('w')
  await change(row('TEXT_COLOR').locator('input[type=number]'), '0.25')
  assert.equal(await read(skin, 'TextStyle_Qwerty', 'TEXT_COLOR'), '0x40112233')
  await page.locator('.inspector-reset').click()
  assert.equal(await read(skin, 'TextStyle_Qwerty', 'TEXT_COLOR'), '0x7F112233')
  assert.equal(await read(skin, 'KeyBg_Default_Latin', 'NORMAL'), '26key.png,1,97,1,141')
  // Image changes have markers and reset both states, including an originally absent pressed state.
  await selectKey('q')
  await fields.locator('[data-inspector-group-label="背景"] .style-picker-state').first().click()
  await picker.locator('#resource-picker-view:not([hidden])').waitFor()
  const resources = picker.locator('#resource-picker-grid button')
  await resources.filter({ hasText: '26fn' }).first().click()
  assert.match(await read(skin, 'SMA_Key26Bg_Q', 'NORMAL'), /^26fn\.png,2,96,3,139$/)
  assert.equal(await page.locator('.inspector-changes').textContent(), '已改 1')
  await page.locator('.inspector-reset').click()
  assert.equal(await read(skin, 'SMA_Key26Bg_Q', 'NORMAL'), '26keyq.png,2,96,3,139')
  await change(background.locator('.ssf-image-card input').first(), '26fn.png')
  assert.equal(await read(skin, 'SMA_Key26Bg_Q', 'NORMAL'), '26fn.png,2,96,3,139')
  await page.locator('.inspector-reset').click()
  assert.equal(await read(skin, 'SMA_Key26Bg_Q', 'NORMAL'), '26keyq.png,2,96,3,139')
  // 单独设置 copies the label style and the FG_STYLE naming it, so only Q changes.
  await fields.locator('[data-inspector-group-label="文字"]').getByRole('button', { name: '单独设置' }).click()
  assert.equal(await read(skin, 'Key_Q', 'FG_STYLE'), 'FGStyle_Key_Q')
  assert.equal(await read(skin, 'FGStyle_Key_Q', 'LABEL_STYLE'), 'TextStyle_Key_Q')
  assert.equal(await read(skin, 'FGStyle_Key_Q', 'LABEL_POSITION'), '0,0,1,1')
  assert.equal(await read(skin, 'TextStyle_Key_Q', 'TEXT_COLOR'), '0x7F112233')
  await change(row('TEXT_COLOR').locator('input:not([type])'), '0x7F556677')
  // Size and bold are offered before the style has them.
  assert.match(await row('TEXT_SIZE').locator('input').getAttribute('placeholder'), /^未设置/)
  await change(row('TEXT_SIZE').locator('input'), '0.05')
  assert.equal(await read(skin, 'TextStyle_Key_Q', 'TEXT_SIZE'), '0.05')
  await row('BOLD').locator('input').check()
  assert.equal(await read(skin, 'TextStyle_Key_Q', 'BOLD'), 'true')
  assert.equal(await read(twin, 'TextStyle_Key_Q', 'BOLD'), 'true')
  await row('BOLD').locator('input').uncheck()
  assert.equal(await read(skin, 'TextStyle_Key_Q', 'BOLD'), undefined)
  for (const [section, key, value] of [['Key_Q', 'FG_STYLE', 'FGStyle_Key_Q'], ['FGStyle_Key_Q', 'LABEL_STYLE', 'TextStyle_Key_Q'], ['TextStyle_Key_Q', 'TEXT_COLOR', '0x7F556677'], ['TextStyle_Key_Q', 'TEXT_SIZE', '0.05'], ['TextStyle_Key_Q', 'BOLD', undefined]]) {
    assert.equal(await read(twin, section, key), value, `720 copy: [${section}] ${key}`)
  }
  await selectKey('w', true)
  assert.equal(await row('TEXT_COLOR').locator('input:not([type])').getAttribute('placeholder'), '混合')
  await change(row('TEXT_COLOR').locator('input[type=number]'), '0.5')
  assert.equal(await read(skin, 'TextStyle_Key_Q', 'TEXT_COLOR'), '0x80556677')
  assert.equal(await read(skin, 'TextStyle_Qwerty', 'TEXT_COLOR'), '0x80112233')
  await page.locator('.inspector-reset').click()
  assert.equal(await read(skin, 'TextStyle_Key_Q', 'TEXT_COLOR'), '0x7F556677')
  assert.equal(await read(skin, 'TextStyle_Qwerty', 'TEXT_COLOR'), '0x7F112233')
  // Board text styles the skin lacks still show their rows; the first write creates the section, and a
  // six-digit colour is stored the way Sogou's Long.decode reads it (0xAARRGGBB, opaque).
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Escape')
  const space = fields.locator('[data-inspector-group-label="按键文字"] .ui-subsection').filter({ hasText: '[TextStyle_Space_Label]' })
  assert.equal(await read(skin, 'TextStyle_Space_Label', 'TEXT_COLOR'), undefined)
  await change(space.locator('[data-document-key="TEXT_COLOR"] input:not([type])'), '#336699')
  assert.equal(await read(skin, 'TextStyle_Space_Label', 'TEXT_COLOR'), '0xFF336699')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: '/tmp/bdi-ssf-inspector.png' })
  console.log('SSF inspector: shared structure, readonly prompt, persistent filter, paired values, gesture undo, mixed multi-selection, image edits and exact reset passed')
} catch (error) {
  await page.screenshot({ path: '/tmp/bdi-ssf-failure.png' })
  throw error
} finally {
  await browser.close()
  await server.close()
}
