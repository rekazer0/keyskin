import assert from 'node:assert/strict'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { IniDocument } from '../src/ini.ts'
import { SIZES, ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

const skinPath = '1080/status1/phoneSkin.ini'
const original = '[RootView]\nBG_STYLE=1\nBG_IMAGE=bg.png\n[Extension]\nCUSTOM=keep\n'
const files = unzipSync(ssfFixture())
files[skinPath] = strToU8(original)
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41945, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const fields = page.locator('#document-fields')
const group = (label) => fields.locator(`[data-inspector-group-label="${label}"]`)
const row = (label, key) => group(label).locator(`[data-document-key="${key}"]`)
const state = () => page.evaluate(async (path) => {
  const { appState } = await import('/src/app/state.ts')
  return { text: appState.archive.getText(path), undo: appState.undoStack.length }
}, skinPath)
const selectSymbols = () => page.evaluate(async () => {
  const { appState } = await import('/src/app/state.ts')
  appState.selectedKeySections = ['LIST']
  ;(await import('/src/app/key-inspector.ts')).populateKeyInspector()
})
const history = (action) => page.evaluate(async (action) => (await import('/src/app/edit-history.ts'))[action](), action)
const edit = async (input, value) => { await input.fill(value); await input.press('Enter') }
async function checkChange(change, verify) {
  const before = await state()
  await change()
  const after = await state()
  assert.equal(after.undo, before.undo + 1, 'creating configuration is one undo step')
  verify(IniDocument.parse(after.text))
  await history('undo')
  assert.equal((await state()).text, before.text, 'undo restores absent sections and references exactly')
  await history('redo')
  assert.equal((await state()).text, after.text, 'redo restores the complete configuration')
  await history('undo')
}
async function addImage(label, action, key, file) {
  await checkChange(async () => {
    await group(label).getByRole('button', { name: action, exact: true }).click()
    const picker = page.frameLocator('#picker-frame')
    await picker.locator('#style-library-grid .ui-image-card').filter({ hasText: file }).first().evaluate((card) => card.click())
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
  }, (document) => {
    const owner = label === '候选栏' ? 'CandidateView' : 'CandidateCodeView'
    const section = document.get(owner, key)
    assert.ok(section && !/\.png$/i.test(section), `${owner}.${key} points to an image section`)
    assert.equal(document.get(section, 'NORMAL'), `${file}.png`)
    assert.equal(document.get(owner, 'BG_STYLE'), '1', 'the newly created view has the required background mode')
    assert.equal(document.get('Extension', 'CUSTOM'), 'keep')
  })
}
async function checkView(label) {
  assert.equal(await group(label).count(), 1, `${label} remains discoverable without its section`)
  for (const key of ['MARGINS', 'PADDINGS']) assert.equal(await row(label, key).locator('input[type=number]').count(), 4, `${label}.${key} has typed controls before configuration`)
  assert.equal(await row(label, 'BG_STYLE').getByRole('group', { name: '背景类型', exact: true }).count(), 1)
  assert.equal(await row(label, 'BG_STYLE').getByRole('button', { name: '纯色', exact: true }).count(), 1)
  assert.equal(await row(label, 'BG_COLOR').locator('.ui-swatch').count(), 1)
  for (const key of ['BG_IMAGE', 'BG_IMAGES']) assert.equal(await row(label, key).count(), 0, `${label}.${key} does not degrade to a file or text field`)
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'empty-inspector.ssf', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync(files)) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.locator('.sidebar-overview button[data-path="light/skin/port/py_9.ini"]').click()
  const opened = await state()
  assert.equal(opened.text, original, 'opening sparse source does not create defaults')
  for (const label of ['候选栏', '候选字', '输入码']) assert.equal(await group(label).count(), 0, `${label} is absent from board properties`)
  for (const label of ['符号列', '按键文字']) assert.equal(await group(label).count(), 0, `${label} is absent from panel properties`)
  await selectSymbols()
  await checkView('符号列')
  assert.equal(await group('符号列').getByRole('button', { name: '添加符号列背景', exact: true }).count(), 1)
  assert.equal(await group('符号列').getByRole('button', { name: '添加符号列单元格', exact: true }).count(), 1)
  assert.deepEqual(await state(), opened, 'browsing controls creates neither source changes nor history')
  await page.locator(`.sidebar-overview button[data-path="${skinPath}"]`).click()
  assert.equal(await group('候选栏').getByRole('button', { name: '添加候选栏背景', exact: true }).isDisabled(), true, 'raw phoneSkin.ini has the same readonly creation control')
  assert.deepEqual(await state(), opened, 'opening the raw file also leaves sparse source untouched')
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await addImage('候选栏', '添加候选栏背景', 'BG_IMAGE', 'bar')
  await page.locator('.sidebar-overview button[data-path="light/skin/port/py_9.ini"]').click()
  await page.locator('#candidate-area').click()
  await group('候选栏').waitFor()
  await checkView('候选栏')
  await checkChange(() => row('候选栏', 'BG_STYLE').getByRole('button', { name: '纯色', exact: true }).click(), document => {
    assert.equal(document.get('CandidateView', 'BG_STYLE'), '2')
    assert.equal(document.get('RootView', 'BG_IMAGE'), 'bg.png', 'changing background type keeps image resources')
  })
  for (const label of ['候选栏', '候选字', '输入码']) assert.equal(await group(label).count(), 1, `${label} remains available when the candidate bar is selected without configuration`)
  assert.equal(await group('候选栏').locator('h4').count(), 0, 'group and add button already name the candidate background')
  assert.deepEqual(await group('候选字').locator('h4').allTextContents(), ['首选字'], 'only the distinct candidate text style needs a subheading')
  await page.locator('.inspector-filter-open').click()
  await page.locator('#inspector-filter').fill('首选字')
  assert.equal(await group('候选字').locator('.ui-subsection').first().isVisible(), false)
  assert.equal(await group('候选字').locator('.ui-subsection').nth(1).isVisible(), true, 'distinct subheadings still filter their fields')
  await page.locator('#inspector-filter').press('Escape')
  await page.locator('#inspector-filter').press('Escape')
  assert.equal(await group('键盘背景').count(), 0, 'candidate selection hides board properties')
  assert.deepEqual(await state(), opened, 'selecting the candidate bar creates neither configuration nor history')
  await checkChange(() => edit(row('候选栏', 'MARGINS').locator('input[type=number]').first(), '0.1'), (document) => {
    assert.equal(document.get('CandidateView', 'MARGINS'), '0.1,0,0,0')
    assert.equal(document.get('CandidateView', 'BG_STYLE'), '1')
  })
  await addImage('候选栏', '添加候选栏背景', 'BG_IMAGE', 'bar')
  await page.locator('.canvas-wrap').click({ position: { x: 8, y: 8 } })
  for (const label of ['候选栏', '候选字', '输入码']) assert.equal(await group(label).count(), 0, `${label} disappears after clearing candidate selection`)
  await selectSymbols()
  await addImage('符号列', '添加符号列背景', 'BG_IMAGE', 'code_bg')
  await addImage('符号列', '添加符号列单元格', 'BG_IMAGES', 'code_cell')
  await page.locator('#candidate-area').click()
  await group('候选栏').waitFor()
  await group('候选栏').getByRole('button', { name: '添加候选栏背景', exact: true }).click()
  await page.frameLocator('#picker-frame').locator('#style-library-grid .ui-image-card').filter({ hasText: 'bar' }).first().evaluate((card) => card.click())
  await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
  const ref = row('候选栏', 'BG_IMAGE')
  await ref.waitFor()
  assert.equal(await ref.count(), 1, 'configured background has one reference card')
  assert.equal(await group('候选栏').locator('h4').count(), 0, 'background card needs no repeated subheading')
  assert.equal(await row('候选栏', 'BG_COLOR').locator('.document-field-name').textContent(), '背景色')
  assert.equal(await row('候选栏', 'TEXT_HIGHLIGHT_STYLE').locator('.document-field-name').textContent(), '高亮样式')
  assert.equal(await group('候选栏').locator('.ui-style-ref:visible').count(), 1, 'normal and pressed share one visible reference card; extended states start hidden')
  assert.equal(await ref.locator('.ui-style-ref').count(), 1)
  assert.equal(await ref.locator('.ui-style-state[role=button]').count(), 2)
  const beforeExtended = await state()
  await group('候选栏').locator('details[data-ssf-states] summary').click()
  for (const key of ['DISABLED', 'NORMAL_ON', 'PRESSED_ON']) assert.equal(await row('候选栏', key).isVisible(), true)
  assert.deepEqual(await state(), beforeExtended, 'expanding missing states creates neither values nor history')
  await checkChange(() => edit(row('候选栏', 'DISABLED').locator('input'), '26fn.png'), (document) => {
    const section = document.get('CandidateView', 'BG_IMAGE')
    assert.equal(document.get(section, 'DISABLED'), '26fn.png')
    assert.equal(document.get(section, 'NORMAL'), 'bar.png')
    assert.equal(document.get(section, 'NORMAL_ON'), undefined)
    assert.equal(document.get(section, 'PRESSED_ON'), undefined)
  })
  assert.equal(await row('候选栏', 'STRETCH').count(), 0, 'reference cards have no duplicate stretch inputs')
  await checkChange(async () => {
    await ref.locator('.ui-style-state').first().click()
    const editor = page.getByRole('dialog', { name: '编辑图片', exact: true })
    await page.waitForFunction(() => document.querySelector('.ui-image-editor input[type=number]')?.disabled === false)
    await editor.locator('input[type=number]').nth(1).fill('5')
    await editor.getByRole('button', { name: '完成', exact: true }).click()
    await editor.waitFor({ state: 'hidden' })
  }, (document) => {
    assert.equal(document.get(document.get('CandidateView', 'BG_IMAGE'), 'NORMAL'), `bar.png,0,5,0,${SIZES.bar[1]}`, 'the image editor creates an absent band from the full image')
  })
  const reference = await ref.locator('input').inputValue()
  await checkChange(async () => { await ref.locator('input').fill(`${reference}_other`); await ref.locator('input').blur() }, (document) => {
    assert.equal(document.get('CandidateView', 'BG_IMAGE'), `${reference}_other`)
  })
  await checkChange(() => ref.getByRole('button', { name: '移除背景图' }).click(), (document) => {
    assert.equal(document.get('CandidateView', 'BG_IMAGE'), undefined)
  })
  await history('undo')
  assert.equal((await state()).text, original)
  await page.locator('.sidebar-overview button[data-path="light/skin/port/py_26.ini"]').click()
  const point = await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const key = preview.keys.find((key) => key.center === 'q')
    const box = document.querySelector('#preview').getBoundingClientRect()
    return { x: box.x + (key.rect.x + key.rect.width / 2) / preview.panelWidth * box.width, y: box.y + (key.rect.y + key.rect.height / 2) / preview.surfaceHeight * box.height }
  })
  await page.mouse.click(point.x, point.y)
  await row('前景', 'LABEL_POSITION').waitFor()
  for (const key of ['LABEL_POSITION', 'MINOR_LABEL_POSITION', 'ICON_RECT']) assert.equal(await row('前景', key).locator('input[type=number]').count(), 4, `${key} can be created before FG_STYLE exists`)
  assert.equal(await row('前景', 'LABEL_VISIBLE').getByRole('switch').isChecked(), true)
  assert.equal(await row('前景', 'MINOR_LABEL_VISIBLE').getByRole('switch').isChecked(), true)
  assert.equal(await row('前景', 'MINOR_LABEL_STYLE').getByRole('combobox').count(), 1)
  assert.equal(await row('前景', 'MINOR_LABEL_STYLE').locator('.document-field-name').textContent(), '副文字样式')
  assert.equal((await state()).text, original, 'showing missing foreground layout controls does not create a style')
  await checkChange(() => row('前景', 'LABEL_VISIBLE').getByRole('switch').uncheck(), document => {
    assert.equal(document.get(document.get('Key_Q', 'FG_STYLE'), 'LABEL_VISIBLE'), '0')
  })
  await checkChange(() => row('前景', 'LABEL_ORIENTATION').getByRole('button', { name: '横排', exact: true }).click(), document => {
    assert.equal(document.get(document.get('Key_Q', 'FG_STYLE'), 'LABEL_ORIENTATION'), '1')
  })
  await checkChange(() => row('前景', 'LABEL_STYLE').getByRole('combobox').selectOption('TextStyle_Qwerty'), document => {
    assert.equal(document.get(document.get('Key_Q', 'FG_STYLE'), 'LABEL_STYLE'), 'TextStyle_Qwerty')
  })
  await checkChange(() => edit(row('前景', 'LABEL_POSITION').locator('input[type=number]').first(), '0.2'), (document) => {
    const style = document.get('Key_Q', 'FG_STYLE')
    assert.ok(style, 'the first layout edit binds the new style to the selected key')
    assert.equal(document.get(style, 'LABEL_POSITION'), '0.2,0,1,1')
    assert.equal(document.get(style, 'LABEL_STYLE'), 'TextStyle_Qwerty', 'new foregrounds keep a usable label style')
    assert.equal(document.get('Extension', 'CUSTOM'), 'keep')
  })
  await edit(row('前景', 'LABEL_POSITION').locator('input[type=number]').first(), '0.2')
  await page.locator('.inspector-reset').click()
  const reset = IniDocument.parse((await state()).text)
  assert.equal(reset.get('Key_Q', 'FG_STYLE'), undefined, 'reset removes the newly created binding')
  assert.equal(reset.get('FGStyle_Key_Q', 'LABEL_POSITION'), undefined)
  assert.equal(reset.get('FGStyle_Key_Q', 'LABEL_STYLE'), undefined)
  assert.equal((await state()).text, original, 'reset restores the missing foreground section and binding exactly')
  assert.deepEqual(errors, [])
  console.log('SSF empty inspector: board and raw-file creation, foreground layout binding, typed controls, lazy writes, reset and undo/redo passed')
} catch (error) {
  await page.screenshot({ path: '/tmp/bdi-ssf-empty-inspector-failure.png' }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await server.close()
}
