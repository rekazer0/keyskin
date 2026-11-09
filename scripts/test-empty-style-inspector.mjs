import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const palm = JSON.stringify({ info: { name: '从零创建样式' }, default: { port_layout: { b: { full26Pinyin: { board: { size: [1080, 600] }, keys: [] } } } } })
const baidu = SkinArchive.open(bdsFixture())
const css = 'light/skin/res/default.css'
baidu.setText(css, '[GLOBAL]\nSTYLE_NUM=0\n')
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41946, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const snapshot = (path) => page.evaluate(async (path) => {
  const { appState } = await import('/src/app/state.ts')
  return { text: appState.archive.getText(path), undo: appState.undoStack.length }
}, path)
const history = (action) => page.evaluate(async (action) => (await import('/src/app/edit-history.ts'))[action](), action)
const fields = page.locator('#style-detail-fields')
const row = (key) => fields.locator(`[data-document-key="${key}"]`)
try {
  for (const [format, bytes, path] of [
    ['sxi', zipSync({ 'skin.json': strToU8(palm) }), 'skin.json'],
    ['bds', baidu.toBytes('bds'), css],
  ]) {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    await page.locator('#browser-open').setInputFiles({ name: `empty.${format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    const before = await snapshot(path)
    await page.locator('.sidebar-overview [data-nav-mode="style"]').first().click()
    assert.deepEqual(await snapshot(path), before, 'opening a missing style table never writes defaults')
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    await page.getByRole('button', { name: '新建样式', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#style-detail-fields')?.childElementCount > 0)
    const created = await snapshot(path)
    assert.equal(created.undo, before.undo + 1, 'creating the first style is one undo step')
    if (format === 'sxi') {
      const styles = JSON.parse(created.text).default.s_info.ss_1
      assert.equal(Object.keys(styles).length, 1)
      assert.equal(await row('f_s').getByRole('spinbutton').count(), 1, 'a new Palm style exposes text controls')
    } else {
      assert.equal(await row('FONT_CLEARTYPE').getByRole('switch').count(), 1)
      assert.equal(await row('BORDER_SIZE').getByRole('spinbutton').count(), 1)
      assert.equal(await row('BORDER_COLOR').locator('.ui-color-field').count(), 1)
      assert.equal(await row('PRESS_SOUND_PATH').getByRole('combobox').count(), 1, 'sound control exists before any sound is imported')
      for (const key of ['PRESS_ANIM', 'RELEASE_ANIM', 'SHOW_ANIM', 'HIDE_ANIM']) assert.equal(await row(key).locator('input').count() > 0, true)
      const size = row('BORDER_SIZE').getByRole('spinbutton')
      await size.fill('3')
      await size.press('Tab')
      assert.match((await snapshot(path)).text, /BORDER_SIZE=3/)
      await history('undo')
      assert.equal((await snapshot(path)).text, created.text)
    }
    await history('undo')
    assert.equal((await snapshot(path)).text, before.text, 'undo removes the first style and its previously missing table')
    await history('redo')
    assert.equal((await snapshot(path)).text, created.text)
  }
  assert.deepEqual(errors, [])
  console.log('Empty style inspector: first Palm/Baidu style, complete controls, no view writes and undo/redo passed')
} finally {
  await browser.close()
  await server.close()
}
