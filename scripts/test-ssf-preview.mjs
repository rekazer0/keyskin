import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41809, strictPort: false, host: '127.0.0.1' } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, bypassCSP: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const sample = process.env.SSF_SKIN_PATH
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: sample?.split('/').pop() ?? '搜狗骨架.ssf', mimeType: 'application/octet-stream', buffer: sample ? readFileSync(sample) : Buffer.from(ssfFixture()) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  const state = () => page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { preview, toolbarPreview } = await import('/src/app/canvas-interaction.ts')
    return { width: preview.panelWidth, height: preview.panelHeight, keys: preview.keys.map(({ center, rect }) => ({ center, rect })), toolbar: toolbarPreview.keys.filter((key) => /^ICON/.test(key.section)).length, changed: [...appState.archive.changed], path: appState.layoutPath }
  })
  const initial = await state()
  assert.equal(initial.width, sample ? initial.width : 1080)
  assert.equal(initial.height, Math.round(initial.width * 0.5944))
  assert.equal(initial.toolbar, 7)
  const find = (action) => initial.keys.find((key) => key.center === action).rect
  assert.ok(find('F1').x < find('F6').x && find('F6').x < find('F38').x && find('F38').x < find('F16').x && find('F16').x < find('F39').x)
  assert.ok(find('F36').y < find('F40').y && find('F40').y < find('0').y && find('0').y < find('F39').y)
  assert.deepEqual(initial.changed, [])
  await page.screenshot({ path: '/tmp/bdi-sogou-canvas-fixed.png' })
  if (sample) await page.screenshot({ path: '/tmp/bdi-sogou-skin-fixed.png' })
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  const layouts = ['py_9.ini', 'py_26.ini']
  const choose = (kind, value) => page.locator(`[data-${kind}-choice="${value}"]`).click()
  for (const theme of ['light', 'dark']) {
    await choose('theme', theme)
    for (const orientation of ['port', 'land']) {
      await choose('orientation', orientation)
      for (const name of layouts) {
        await page.locator(`.sidebar-overview button[data-path="${theme}/skin/${orientation}/${name}"]`).click()
        const result = await state()
        assert.match(result.path, new RegExp(`${theme}/skin/${orientation}/${name.replace('.', '\\.')}$`))
        assert.ok(result.keys.length > 10, `${result.path}: missing keys`)
        assert.ok(result.keys.every(({ rect }) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= result.width + 2 && rect.y + rect.height <= result.height + 2), `${result.path}: keys overflow`)
        assert.deepEqual(result.changed, [])
      }
    }
  }
  await choose('orientation', 'port')
  await choose('theme', 'light')
  // The overview lists Sogou's keyboards; a board picked there survives a look switch.
  const boards = page.locator('#files .nav-group[data-overview-group="键盘布局"] .nav-group-body .nav-label')
  assert.deepEqual(await boards.allTextContents(), ['拼音九键', '拼音全键', '拼音 14 键', '拼音九键大回车', '拼音九键大按键', '双拼九键', '双拼九键大回车', '双拼全键', '五笔', '笔画', '笔画大回车', '粤语九键', '粤语九键大回车', '粤语全键', '英文九键', '英文九键多击', '英文全键', '英文全键带数字行', '英文专业版', '英文专业版带数字行'])
  // Every Sogou board draws on the canvas inside its panel, in both orientations and looks.
  await page.evaluate(() => document.querySelectorAll('#files .nav-group').forEach((group) => { group.open = true }))
  let boardChecks = 0
  for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) {
    await choose('theme', theme)
    await choose('orientation', orientation)
    for (const button of await page.locator('#files .sidebar-overview button.nav-layout').all()) {
      if (!await button.isVisible()) await page.locator('.nav-layout-more > summary').click()
      await button.click()
      const result = await state()
      assert.ok(result.keys.length > 0, `${result.path}: no keys`)
      assert.ok(result.keys.every(({ rect }) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= result.width + 2 && rect.y + rect.height <= result.height + 2), `${result.path}: keys overflow`)
      if (/py_9.*double_input/.test(result.path)) {
        assert.ok(result.keys.some((key) => key.center === 'F38'), `${result.path}: missing space`)
        assert.ok(result.keys.some((key) => key.center === "'"), `${result.path}: missing punctuation`)
      }
      assert.deepEqual(result.changed, [])
      boardChecks++
      if (sample && theme === 'light' && orientation === 'port' && /\/(?:big_9|py_9_big_enter_double_input)\.ini$/.test(result.path)) {
        await page.evaluate(async () => {
          const { preview, toolbarPreview } = await import('/src/app/canvas-interaction.ts')
          await preview.rendered()
          await toolbarPreview.rendered()
        })
        await page.screenshot({ path: `/tmp/bdi-sogou-${result.path.split('/').pop().replace('.ini', '')}-fixed.png` })
      }
    }
  }
  await choose('orientation', 'port')
  await choose('theme', 'light')
  await page.locator('#files .nav-group[data-overview-group="键盘布局"]').getByText('英文全键', { exact: true }).click()
  assert.match((await state()).path, /light\/skin\/port\/en_26\.ini$/)
  await choose('theme', 'dark')
  assert.match((await state()).path, /dark\/skin\/port\/en_26\.ini$/)
  await choose('theme', 'light')
  await page.locator('.sidebar-overview button[data-path="light/skin/port/py_9.ini"]').click()
  // Selection must edit the very same Sogou class as the canvas, including new function slots.
  for (const action of ['F36', 'F40', 'F1', 'F6', 'F38', 'F16', 'F39']) {
    const result = await state()
    const key = result.keys.find((key) => key.center === action)
    const box = await page.locator('#preview').boundingBox()
    await page.mouse.click(box.x + (key.rect.x + key.rect.width / 2) / result.width * box.width, box.y + (key.rect.y + key.rect.height / 2) / result.height * box.height)
    assert.ok(await page.locator('#document-fields .ui-section').count() > 0)
    await page.waitForTimeout(30)
  }
  assert.deepEqual(errors, [])
  console.log(`Sogou native preview: ${layouts.length} primary boards × 2 orientations × both looks, ${boardChecks} overview board checks, toolbar, geometry, selection and unchanged source passed${sample ? ` (${sample})` : ''}`)
} catch (error) {
  await page.screenshot({ path: '/tmp/bdi-sogou-preview-failure.png' })
  throw error
} finally {
  await browser.close()
  await server.close()
}
