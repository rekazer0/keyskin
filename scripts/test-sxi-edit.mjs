import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { SkinArchive } from '../src/skin.ts'
import { buildSxiZip } from '../src/palm/palm-export.ts'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const bytes = buildSxiZip(SkinArchive.open(bdsFixture())).bytes
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41829, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', (dialog) => dialog.accept())
const state = () => page.evaluate(async () => {
  const { appState } = await import('/src/app/state.ts')
  const { source } = await import('/src/app/canvas-interaction.ts')
  const skin = JSON.parse(appState.archive.getText('skin.json'))
  const key = skin.default.port_layout.b.full26Pinyin.keys.find((item) => item.id === '1')
  return { skin, source: source.value, undo: appState.undoStack.length, refs: (key.b.base_f ?? []).join(',') }
})
const selectKey = async (id) => {
  const point = await page.evaluate(async (id) => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const key = preview.keys.find((item) => item.section === `KEY${id}`)
    const box = preview.canvas.getBoundingClientRect()
    return { x: box.x + (key.rect.x + key.rect.width / 2) * box.width / preview.panelWidth, y: box.y + (key.rect.y + key.rect.height / 2) * box.height / preview.panelHeight }
  }, id)
  await page.mouse.click(point.x, point.y)
  await page.waitForFunction(async (id) => {
    const { appState } = await import('/src/app/state.ts')
    return appState.selectedKeySections[0] === `KEY${id}` && !appState.selectionInspectorSyncPending
  }, id)
}
const undoRedo = async (action) => page.evaluate(async (action) => {
  const history = await import('/src/app/edit-history.ts')
  history[action]()
}, action)
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  await page.locator('#browser-open').setInputFiles({ name: 'test.sxi', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await page.evaluate(async () => {
    const { selectFile } = await import('/src/app/navigation.ts')
    selectFile('skin.json/default/port_layout/b/full26Pinyin')
  })
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { source } = await import('/src/app/canvas-interaction.ts')
    const { commitSxiSourceEdit } = await import('/src/app/sxi-documents.ts')
    const before = appState.archive.getText('skin.json')
    source.value = before + '\n'
    commitSxiSourceEdit()
    if (appState.archive.getText('skin.json') !== before + '\n') throw new Error('native JSON source edit did not preserve text')
    ;(await import('/src/app/edit-history.ts')).undo()
    if (source.value !== before) throw new Error('native JSON source undo failed')
    const { selectFile } = await import('/src/app/navigation.ts')
    selectFile('skin.json/default/s_info/ss_1', 'overview', 'image')
    if (source.value !== appState.archive.getText('skin.json')) throw new Error('resource source is not skin.json')
    if (appState.archive.names().some((name) => /\.(?:ini|css|til|cnd|pop)$/.test(name))) throw new Error('files were generated from skin.json')
    selectFile('skin.json/default/port_layout/b/full26Pinyin', 'overview')
  })
  await selectKey(1)
  // defaultGlobal is a board model too, but it never becomes the canvas layout.
  const generalPath = 'skin.json/default/port_layout/b/defaultGlobal'
  const fields = page.locator('#document-fields')
  const beforeGeneral = (await state()).skin
  await page.locator(`.sidebar-overview button[data-path="${generalPath}"]`).click()
  assert.ok(await fields.locator('.document-property-field').count() > 0, 'general configuration exposes its model fields')
  assert.equal(await page.locator('#selected-key').textContent(), '通用配置')
  assert.equal(await page.locator('#selected-key-context').textContent(), 'skin.json · port_layout.b.defaultGlobal')
  assert.deepEqual(JSON.parse((await state()).source), beforeGeneral)
  assert.equal(await page.locator('#source-name').textContent(), 'skin.json')
  assert.equal(await page.locator('.raw-files button[data-path$=".ini"]').count(), 0)
  assert.equal((await state()).source, await page.evaluate(async () => (await import('/src/app/state.ts')).appState.archive.getText('skin.json')))
  const panel = fields.locator('[data-inspector-group-label="面板"]')
  const generalWidth = panel.locator('[data-document-key="size"] input').first()
  assert.equal(await generalWidth.inputValue(), '1080')
  assert.equal(await fields.locator('[data-inspector-group-label="候选栏"] [data-document-key="file"] input').inputValue(), 'cand1')
  await generalWidth.fill('1000')
  await generalWidth.press('Enter')
  const changedGeneral = (await state()).skin
  assert.deepEqual(changedGeneral.default.port_layout.b.defaultGlobal.board.size, [1000, 600])
  assert.deepEqual(changedGeneral.default.port_layout.b.full26Pinyin, beforeGeneral.default.port_layout.b.full26Pinyin)
  await undoRedo('undo')
  assert.deepEqual((await state()).skin, beforeGeneral)
  assert.equal(await generalWidth.inputValue(), '1080')
  await undoRedo('redo')
  assert.deepEqual((await state()).skin, changedGeneral)
  assert.equal(await generalWidth.inputValue(), '1000')
  await page.locator('.sidebar-overview button[data-path="skin.json/default/port_layout/b/full26Pinyin"]').click()
  await selectKey(1)
  const original = (await state()).skin
  const undoBaseline = (await state()).undo
  await page.locator('[data-inspector-tab="source"]').click()
  await selectKey(2)
  await page.waitForFunction(() => [...document.querySelectorAll('.cm-source-selected')].some((line) => /"id"\s*:\s*"2"/.test(line.textContent)))
  assert.match((await state()).source, /"keys"/)
  await page.locator('[data-inspector-tab="properties"]').click()
  await selectKey(1)
  await page.locator('#mobile-inspector-groups').getByRole('button', { name: '样式', exact: true }).click()
  // The Palm inspector shows the key's skin.json model: styles, text styles, gestures and rect.
  const add = fields.locator('.style-reference-add')
  const picker = page.frameLocator('#picker-frame')
  const pickerDialog = page.locator('#picker-dialog')
  await add.click()
  await pickerDialog.waitFor({ state: 'visible' })
  await picker.locator('#style-library-grid > button').filter({ hasText: '样式 120' }).click()
  await picker.locator('#style-library-apply').click()
  assert.equal((await state()).refs, '3,4,120', 'existing image style can be appended')
  await undoRedo('undo')
  assert.deepEqual((await state()).skin, original)
  await page.locator('#mobile-inspector-groups').getByRole('button', { name: '样式', exact: true }).click()
  await add.click()
  await pickerDialog.waitFor({ state: 'visible' })
  await picker.locator('[data-library-mode="images"]').click()
  await picker.locator('#style-library-grid > button').first().click()
  await picker.locator('#style-library-apply').click()
  // 图片加载完才会给画布写上尺寸，之后才能点中切片。
  const sliceCanvas = picker.locator('#picker-canvas[style*="width"]')
  await sliceCanvas.waitFor()
  const sliceBox = await sliceCanvas.boundingBox()
  await sliceCanvas.click({ position: { x: sliceBox.width / 2, y: sliceBox.height / 2 } })
  const added = await state()
  const id = added.refs.split(',').at(-1)
  assert.equal(added.refs.split(',').length, 3)
  assert.equal(added.undo, undoBaseline + 1, 'image creation and foreground append are one undo step')
  assert.deepEqual(added.skin.default.port_layout.b.full26Pinyin.keys.find((item) => item.id === '1').b.base_f, [3, 4, Number(id)])
  assert.ok(added.skin.default.s_info.ss_1[id].s_2.normal)
  assert.match(added.source, /"keys"/, 'inspector changes retain JSON in the source editor')
  await picker.locator('#picker-close').click()
  await pickerDialog.waitFor({ state: 'hidden' })
  await undoRedo('undo')
  assert.deepEqual((await state()).skin, original)
  await undoRedo('redo')
  assert.deepEqual((await state()).skin, added.skin)
  await page.locator('#mobile-inspector-groups').getByRole('button', { name: '样式', exact: true }).click()
  const normal = fields.locator('[data-key-field="FORE_STYLE"]').locator('..').locator('.style-reference-row').last().locator('[data-style-state="normal"]')
  await normal.click()
  await pickerDialog.waitFor({ state: 'visible' })
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { updateSelectedImageReference } = await import('/src/app/image-pickers.ts')
    if (!updateSelectedImageReference(appState.pickerTarget, 'btn,1')) throw new Error('state image edit failed')
  })
  assert.equal((await state()).skin.default.s_info.ss_1[id].s_2.normal, 'btn,1')
  // Esc is handled inside picker.html, so wait until the iframe has wired its keys.
  await page.waitForFunction(async () => (await import('/src/app/state.ts')).appState.pickerFrameReady)
  await page.keyboard.press('Escape')
  await pickerDialog.waitFor({ state: 'hidden' })
  // Text edits on a key and on the whole layout land in the styles' s_1 inside skin.json.
  await page.locator('#mobile-inspector-groups').getByRole('button', { name: '文字', exact: true }).click()
  const keySize = fields.locator('[data-inspector-group-label="文字"] .ui-subsection').filter({ hasText: 'ss_1.3.s_1' }).locator('[data-document-key="f_s"] input')
  await keySize.fill('44')
  await keySize.press('Enter')
  await page.waitForFunction(async () => {
    const { appState } = await import('/src/app/state.ts')
    return JSON.parse(appState.archive.getText('skin.json')).default.s_info.ss_1[3].s_1.f_s === 44
  })
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Escape')
  // Labels (each key's first text layer) change; the second layer (STYLE4, a hint) keeps its size.
  const layoutSize = page.locator(".text-style-fields input[aria-label='按键文字字号']")
  await layoutSize.fill('33')
  await layoutSize.press('Enter')
  await page.waitForFunction(async () => {
    const { appState } = await import('/src/app/state.ts')
    const styles = JSON.parse(appState.archive.getText('skin.json')).default.s_info.ss_1
    return styles[3].s_1.f_s === 33 && styles[4].s_1.f_s === undefined
  })
  // Gestures and geometry are written to the key in skin.json too.
  await selectKey(1)
  await page.locator('#mobile-inspector-groups').getByRole('button', { name: '手势', exact: true }).click()
  const up = fields.locator('[data-gesture="UP"] input')
  await up.fill('F12')
  await up.press('Tab')
  await page.waitForFunction(async () => {
    const { appState } = await import('/src/app/state.ts')
    const key = JSON.parse(appState.archive.getText('skin.json')).default.port_layout.b.full26Pinyin.keys.find((item) => item.id === '1')
    return key.values.includes(0) && key.values[key.values.indexOf(0) + 1] === 'webBoard'
  })
  await page.locator('#mobile-inspector-groups').getByRole('button', { name: '布局', exact: true }).click()
  const x = fields.locator('[data-document-key="rect.origin"] input').first()
  await x.fill('5')
  await x.press('Enter')
  await page.waitForFunction(async () => {
    const { appState } = await import('/src/app/state.ts')
    const key = JSON.parse(appState.archive.getText('skin.json')).default.port_layout.b.full26Pinyin.keys.find((item) => item.id === '1')
    return key.rect[0][0] === 5
  })
  // The inspector speaks Palm: skin.json locations and names, none of the Baidu groups or file names.
  assert.equal(await page.locator('.key-layout-fields').isHidden(), true)
  assert.match(await page.locator('#selected-key-context').textContent(), /^full26Pinyin · keys\.\d+$/)
  const board = page.locator('.sidebar-overview button[data-path="skin.json/default/port_layout/b/full26Pinyin"]')
  assert.equal(await board.locator('.nav-label').textContent(), '拼音全键')
  assert.equal(await board.locator('.nav-meta').textContent(), 'skin.json')
  // A changed row keeps its marker across the rebuild that follows every write, and reset restores it.
  const width = fields.locator('[data-document-key="rect.size"] input').first()
  const widthBefore = await width.inputValue()
  const changes = async () => Number((await page.locator('.inspector-changes').textContent()).replace(/\D/g, ''))
  const changedBefore = await changes()
  await width.fill('77')
  await width.press('Enter')
  assert.equal(await changes(), changedBefore + 1)
  await page.locator('.inspector-reset').click()
  assert.equal(await fields.locator('[data-document-key="rect.size"] input').first().inputValue(), widthBefore)
  // Skin info is skin.json `info`, edited in place.
  await page.locator('.sidebar-overview button[data-path="skin.json/info"]').click()
  assert.equal(await page.locator('.skin-fields').isHidden(), true)
  const name = fields.locator('[data-document-key="name"] input')
  await name.fill('手心测试')
  await name.press('Enter')
  assert.equal((await state()).skin.info.name, '手心测试')
  const saved = await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    return Array.from(appState.archive.toBytes('sxi'))
  })
  const reopened = SkinArchive.open(new Uint8Array(saved), 'sxi')
  assert.deepEqual(JSON.parse(reopened.getText('skin.json')), (await state()).skin)
  assert.deepEqual(errors, [])
  console.log('SXI editing: general config fields and undo/redo, canvas → JSON location, foreground image, text, gestures and save/reopen passed')
} catch (error) {
  await page.screenshot({ path: '/tmp/bdi-sxi-edit-failure.png' }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await server.close()
}
