import assert from 'node:assert/strict'
import { pickStyleReference } from '../tests/helpers/style-reference-picker.mjs'
import { strToU8, zipSync } from 'fflate'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { SkinArchive } from '../src/skin.ts'
import { acceptAskDialogs } from '../tests/helpers/ask-dialogs.mjs'

const skin = {
  info: { name: '空配置手心' },
  default: {
    port_layout: {
      b: { defaultGlobal: {}, full26Pinyin: { keys: [{ id: '1', rect: [[0, 0], [100, 100]], extension: 'keep-key' }], extension: 'keep-board' } },
      c: { cand1: { extension: 'keep-candidate' } },
    },
    s_info: {
      ss_1: { 7: { id: 'STYLE7', s_1: { for_back: true, c_normal: 'FF223344' } }, 8: { id: 'STYLE8', s_5: { 1: 100 } }, 9: { id: 'STYLE9', s_4: { path_1: 'click.wav' } } },
      ss_2: { 100: { a1: { b: { t: 3, count: 1 }, from_p: [100, 100], to_p: [75, 75], duration: 300 } } },
    },
    s_port: { ss_2: { 100: { a1: { b: { t: 3, count: 1 }, from_p: [100, 100], to_p: [50, 50], duration: 650 } } } },
  },
}
const original = JSON.stringify(skin, null, 2) + '\n'
const bytes = zipSync({ 'skin.json': strToU8(original) })
const boardPath = 'skin.json/default/port_layout/b/full26Pinyin'
const candidatePath = 'skin.json/default/port_layout/c/cand1'
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41839, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await acceptAskDialogs(page)
const fields = page.locator('#document-fields')
const state = () => page.evaluate(async () => {
  const { appState } = await import('/src/app/state.ts')
  const text = appState.archive.getText('skin.json')
  return { text, skin: JSON.parse(text), undo: appState.undoStack.length }
})
const select = (path) => page.evaluate(async (path) => {
  const { selectFile } = await import('/src/app/navigation.ts')
  selectFile(path, 'overview')
}, path)
const history = (action) => page.evaluate(async (action) => (await import('/src/app/edit-history.ts'))[action](), action)
const row = (key, scope = fields) => scope.locator(`[data-document-key="${key}"]`)
const enter = async (input, value) => { await input.fill(value); await input.press('Enter') }
const checkChange = async (change, verify) => {
  const before = await state()
  await change()
  const after = await state()
  assert.equal(after.undo, before.undo + 1, 'the first edit creates only one undo step')
  verify(after.skin)
  await history('undo')
  assert.equal((await state()).text, before.text, 'undo restores missing fields and objects exactly')
  await history('redo')
  assert.deepEqual((await state()).skin, after.skin)
  await history('undo')
}
const checkEdit = (input, value, verify) => checkChange(() => enter(input, value), verify)
const enterStyle = async (row, value) => {
  if (value.includes(',')) {
    // Seed sparse references through the backing field; empty slots no longer have editable cards.
    await row.locator('.ui-style-ref-list > input').evaluate((input, value) => {
      input.value = value
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
  } else if (await row.locator('.ui-style-ref input').count()) await enter(row.locator('.ui-style-ref input').first(), value)
  else await pickStyleReference(page, row, value)
}
const checkStyleEdit = (row, value, verify) => checkChange(() => enterStyle(row, value), verify)

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  await page.locator('#browser-open').setInputFiles({ name: 'empty.sxi', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await select(boardPath)
  const opened = await state()
  assert.equal(opened.text, original, 'opening a sparse native skin must preserve its source')
  const groups = await fields.locator('[data-inspector-group-label]').evaluateAll((nodes) => nodes.map((node) => node.dataset.inspectorGroupLabel))
  assert.ok(groups.includes('面板'), 'panel properties remain available without configuration')
  for (const name of ['候选栏', '输入码', '气泡', '符号列表', '更多候选', '状态按键', '偏移', '按压力度']) assert.equal(groups.includes(name), false, `${name} is not part of this board selection`)
  await select(candidatePath)
  const candidateGroup = fields.locator('[data-inspector-group-label="候选栏 cand1"]')
  for (const key of ['rect.origin', 'rect.size', 'f_size']) assert.equal(await row(key, candidateGroup).locator('input[type="number"]').count(), 2, `${key} keeps paired number controls when absent`)
  assert.equal(await row('insets', candidateGroup).locator('input[type="number"]').count(), 4, 'absent candidate padding has four number controls')
  assert.equal(await row('gap', candidateGroup).locator('input[type="number"]').count(), 1, 'absent candidate gap is numeric')
  for (const key of ['b.base_b', 'b.base_f']) assert.equal(await row(key, candidateGroup).locator('.ui-style-ref-append').count(), 1, `${key} exposes an add button`)
  const switchGroup = fields.locator('[data-inspector-group-label="切换按钮"]')
  assert.equal(await row('i_normal', switchGroup).locator('.ui-style-ref-append').count(), 1, 'a missing switch exposes its add button')
  assert.equal(await row('insets', switchGroup).locator('input[type="number"]').count(), 1, 'switch padding stays scalar')
  for (const label of ['添加图标', '添加状态按键']) assert.equal(await fields.getByRole('button', { name: label, exact: true }).isDisabled(), true, 'collection creation respects preview mode')
  assert.deepEqual(await state(), opened, 'browsing supported capabilities does not create configuration or history')

  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await checkEdit(row('gap', candidateGroup).locator('input[type="number"]'), '16.5', (next) => assert.equal(next.default.port_layout.c.cand1.gap, 16.5))
  await checkEdit(row('f_size', candidateGroup).locator('input[type="number"]').first(), '1080', (next) => assert.deepEqual(next.default.port_layout.c.cand1.f_size, [1080, 0]))
  await checkEdit(row('insets', candidateGroup).locator('input[type="number"]').nth(1), '8', (next) => assert.deepEqual(next.default.port_layout.c.cand1.insets, { top: 0, right: 8, bottom: 0, left: 0 }))
  await checkEdit(row('rect.size', candidateGroup).locator('input[type="number"]').first(), '1080', (next) => assert.deepEqual(next.default.port_layout.c.cand1.rect, [[0, 0], [1080, 0]]))
  await checkStyleEdit(row('i_normal', switchGroup), '7', (next) => assert.equal(next.default.port_layout.c.cand1.switch.i_normal, 7))
  const icons = fields.locator('[data-inspector-group-label="图标"]')
  await checkChange(() => icons.getByRole('button', { name: '添加图标', exact: true }).click(), (next) => assert.deepEqual(next.default.port_layout.c.cand1.icon_list, [{}]))
  await icons.getByRole('button', { name: '添加图标', exact: true }).click()
  await enter(row('p', icons).locator('input[type="number"]').first(), '24')
  assert.equal(await row('icon_list', icons).getAttribute('data-modified'), '', 'adding to an absent collection marks it modified')
  await page.locator('.inspector-reset').click()
  assert.deepEqual((await state()).skin.default.port_layout.c.cand1, skin.default.port_layout.c.cand1, 'reset removes a newly created collection and its edited children')
  assert.equal(await row('icon_list', icons).getAttribute('data-modified'), null)
  await icons.getByRole('button', { name: '添加图标', exact: true }).click()
  assert.equal(await row('p', icons).locator('input[type="number"]').count(), 2, 'new icons expose position controls')
  assert.equal(await row('s', icons).locator('input[type="number"]').count(), 2, 'new icons expose size controls')
  await checkEdit(row('p', icons).locator('input[type="number"]').first(), '24', (next) => assert.deepEqual(next.default.port_layout.c.cand1.icon_list[0].p, [24, 0]))
  await checkChange(() => icons.getByRole('button', { name: '删除图标 1', exact: true }).click(), (next) => assert.deepEqual(next.default.port_layout.c.cand1.icon_list, []))
  await history('undo')
  const candidateFixes = fields.locator('[data-inspector-group-label="状态按键"]')
  await checkChange(() => candidateFixes.getByRole('button', { name: '添加状态按键', exact: true }).click(), (next) => assert.deepEqual(next.default.port_layout.c.cand1.fix, { 1: {} }))
  await candidateFixes.getByRole('button', { name: '添加状态按键', exact: true }).click()
  await checkEdit(candidateFixes.getByLabel('点击动作', { exact: true }), 'abc', (next) => assert.deepEqual(next.default.port_layout.c.cand1.fix[1].v, [4, 'abc']))
  await history('undo')

  await select(boardPath)
  assert.equal(await fields.locator('[data-inspector-group-label="候选栏"]').count(), 0, 'candidate controls disappear when the board is selected')
  const panel = fields.locator('[data-inspector-group-label="面板"]')
  await checkChange(() => row('exact', panel).locator('input[role="switch"]').check(), (next) => assert.equal(next.default.port_layout.b.full26Pinyin.board.exact, true))
  assert.equal(await row('b.a', panel).locator('.ui-style-ref-append').count(), 1, 'an absent border animation exposes its add button')
  await checkStyleEdit(row('b.a', panel), '8', (next) => assert.equal(next.default.port_layout.b.full26Pinyin.board.bd.b.a, 8))
  await checkChange(() => panel.getByRole('button', { name: '添加播放范围', exact: true }).click(), (next) => assert.deepEqual(next.default.port_layout.b.full26Pinyin.board.bd.b.r, [[0, 1]]))
  await panel.getByRole('button', { name: '添加播放范围', exact: true }).click()
  await checkEdit(row('b.r', panel).locator('input[type="number"]').first(), '0.25', (next) => assert.deepEqual(next.default.port_layout.b.full26Pinyin.board.bd.b.r, [[0.25, 1]]))
  await checkChange(() => panel.getByRole('button', { name: '删除播放范围 1', exact: true }).click(), (next) => assert.deepEqual(next.default.port_layout.b.full26Pinyin.board.bd.b.r, []))
  await history('undo')
  await select('skin.json/default/port_layout/b/defaultGlobal')
  const fixes = fields.locator('[data-inspector-group-label="状态按键"]')
  await checkChange(() => fixes.getByRole('button', { name: '添加状态按键', exact: true }).click(), (next) => assert.deepEqual(next.default.port_layout.b.defaultGlobal.key_fix, { 1: {} }))
  const offsets = fields.locator('[data-inspector-group-label="偏移"]')
  await checkChange(() => offsets.getByRole('button', { name: '添加偏移', exact: true }).click(), (next) => assert.deepEqual(next.default.port_layout.b.defaultGlobal.offset, { 1: {} }))
  const forces = fields.locator('[data-inspector-group-label="按压力度"]')
  await checkChange(() => forces.getByRole('button', { name: '添加按压力度', exact: true }).click(), (next) => assert.deepEqual(next.default.port_layout.b.defaultGlobal.force, [{}]))
  await select(boardPath)
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { populateKeyInspector } = await import('/src/app/key-inspector.ts')
    appState.selectedKeySections = ['KEY1']
    populateKeyInspector()
  })
  for (const key of ['b.base_s', 'b.asi', 'b.base_ba', 'b.base_fa', 'b.base_pa', 'fix_a']) assert.equal(await row(key).count(), 1, `${key} is available on an unconfigured key`)
  for (const key of ['b.asi', 'b.base_ba', 'b.base_fa', 'b.base_pa']) assert.equal(await row(key).locator('.ui-style-ref-append').count(), 1, `${key} exposes an animation add button`)
  for (const label of ['显示', '长按符号', '符号栏', '符号栏选中']) assert.equal(await fields.getByLabel(`${label}动作`, { exact: true }).count(), 1, `${label} is available before it is configured`)
  await checkEdit(fields.getByLabel('长按符号动作', { exact: true }), 'abc', (next) => assert.deepEqual(next.default.port_layout.b.full26Pinyin.keys[0].values, [7, 'abc']))
  await checkChange(() => fields.getByRole('button', { name: '新建文字样式', exact: true }).click(), (next) => {
    const id = next.default.port_layout.b.full26Pinyin.keys[0].b.base_f[0]
    assert.deepEqual(next.default.s_info.ss_1[id].s_1, {}, 'a key without text can create and bind a text style')
  })
  await enterStyle(row('b.base_f'), '7')
  await checkChange(() => fields.getByRole('button', { name: '新建文字样式', exact: true }).click(), (next) => {
    const layers = next.default.port_layout.b.full26Pinyin.keys[0].b.base_f
    assert.equal(layers[0], 7, 'creating text preserves an existing fill foreground')
    assert.equal(layers.length, 2)
    assert.deepEqual(next.default.s_info.ss_1[layers[1]].s_1, {})
  })
  await history('undo')
  const keySelected = async () => page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { selectFile } = await import('/src/app/navigation.ts')
    selectFile(appState.layoutPath, 'overview')
    appState.selectedKeySections = ['KEY1']
    ;(await import('/src/app/key-inspector.ts')).populateKeyInspector()
  })
  await checkStyleEdit(row('b.asi'), '8', (next) => assert.equal(next.default.port_layout.b.full26Pinyin.keys[0].b.asi, 8))
  await enterStyle(row('b.asi'), '8')
  const animationCard = row('b.asi').getByRole('button', { name: '动画 100', exact: true })
  assert.equal(await animationCard.locator('.ui-animation-player[data-variant="thumbnail"]').count(), 1, 'Palm animation references render a real thumbnail')
  const beforePicker = await state()
  await animationCard.click()
  await page.frameLocator('#picker-frame').locator('[data-library-kind="anim"][aria-pressed="true"]').waitFor()
  await page.frameLocator('#picker-frame').locator('#picker-close').click()
  await page.waitForFunction(() => !document.querySelector('#picker-dialog').open)
  assert.deepEqual(await state(), beforePicker, 'opening the animation picker does not write configuration')
  await animationCard.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
  await page.locator('#animation-stage .ui-animation-time').waitFor()
  assert.match(await page.locator('#animation-stage .ui-animation-time').textContent(), /650 ms/, 'animation cards use the orientation override')
  await keySelected()
  await history('undo')
  await checkStyleEdit(row('b.base_fa'), ',8,0,8', (next) => assert.deepEqual(next.default.port_layout.b.full26Pinyin.keys[0].b.base_fa, [0, 8, 0, 8]))
  await enterStyle(row('b.base_fa'), ',8,0,8')
  assert.equal(await row('b.base_fa').locator('.ui-style-ref').count(), 2)
  const firstBoundSlot = row('b.base_fa').getByRole('textbox', { name: '前景 2 动画样式编号', exact: true })
  await enter(firstBoundSlot, '')
  assert.deepEqual((await state()).skin.default.port_layout.b.full26Pinyin.keys[0].b.base_fa, [0, 0, 0, 8], 'clearing an animation keeps later foreground layers in place')
  await history('undo')
  await history('undo')
  await checkStyleEdit(row('b.base_s'), '9', (next) => assert.equal(next.default.port_layout.b.full26Pinyin.keys[0].b.base_s, 9))
  await checkEdit(row('fix_a').locator('input').first(), '1,2', (next) => assert.deepEqual(next.default.port_layout.b.full26Pinyin.keys[0].fix_a, [1, 2]))
  await enterStyle(row('b.base_s'), '9')
  const edited = await state()
  assert.equal(edited.skin.default.port_layout.b.full26Pinyin.extension, 'keep-board')
  assert.equal(edited.skin.default.port_layout.b.full26Pinyin.keys[0].extension, 'keep-key')
  assert.equal(edited.skin.default.port_layout.c.cand1.extension, 'keep-candidate')
  const saved = await page.evaluate(async () => Array.from((await import('/src/app/state.ts')).appState.archive.toBytes('sxi')))
  const reopened = SkinArchive.open(new Uint8Array(saved), 'sxi')
  assert.deepEqual(JSON.parse(reopened.getText('skin.json')), edited.skin)
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const skin = JSON.parse(appState.archive.getText('skin.json'))
    skin.default.port_layout.b.full26Pinyin.cand = null
    skin.default.port_layout.c.cand1 = { b: null, gap: null, f_size: null, insets: null, switch: null }
    appState.archive.setText('skin.json', JSON.stringify(skin))
    ;(await import('/src/app/sxi-documents.ts')).refreshSxiDocument()
  })
  await select(candidatePath)
  assert.equal(await row('gap', candidateGroup).locator('input[type="number"]').count(), 1, 'null candidate values keep numeric controls')
  assert.equal(await row('f_size', candidateGroup).locator('input[type="number"]').count(), 2, 'null candidate sizes keep paired controls')
  assert.equal(await row('insets', candidateGroup).locator('input[type="number"]').count(), 4, 'null padding keeps four controls')
  assert.equal(await row('b.base_b', candidateGroup).count(), 1, 'a null base exposes one style card without duplicate nested controls')
  assert.equal(await row('i_normal', switchGroup).locator('.ui-style-ref-append').count(), 1, 'a null switch keeps its add button')
  await checkEdit(row('gap', candidateGroup).locator('input[type="number"]'), '4', (next) => assert.equal(next.default.port_layout.c.cand1.gap, 4))
  await select(boardPath)
  assert.equal(await fields.locator('[data-inspector-group-label="候选栏"]').count(), 0, 'a null candidate override does not appear in board properties')
  assert.equal((await state()).skin.default.port_layout.b.full26Pinyin.cand, null, 'changing selections preserves hidden configuration')
  assert.deepEqual(errors, [])
  console.log('Palm empty inspector: supported controls, lazy object creation, typed edits, undo/redo, unknown fields and save/reopen passed')
} catch (error) {
  if (errors.length) console.error(errors)
  await page.screenshot({ path: '/tmp/bdi-inspector-empty-palm-failure.png' }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await server.close()
}
