import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'
import { dismissStartupDisclaimer } from '../tests/helpers/open-editor-template.mjs'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

for (const engine of [chromium, webkit]) describe(engine.name(), () => {
  let server, browser, page
  const focused = locator => locator.evaluate(node => node === document.activeElement)
  async function openSkin(page) {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await dismissStartupDisclaimer(page)
    await page.locator('#browser-open').setInputFiles({ name: '工具.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(bdsFixture()) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled && !document.querySelector('#file-operation-dialog').open)
  }
  before(async () => {
    server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
    await server.listen()
    browser = await engine.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
    await openSkin(page)
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  })
  after(async () => { await browser?.close(); await server?.close() })

  test('工具弹窗直接聚焦可用操作，方向键循环，Esc 返回工具入口', async () => {
    const trigger = page.locator('[data-workspace-page="tools"]')
    const tools = page.locator('[data-workspace-tool]:enabled:visible')
    await trigger.press('Enter')
    try {
      assert.equal(await focused(tools.first()), true)
      await page.keyboard.press('ArrowUp')
      assert.equal(await focused(tools.last()), true)
      await page.keyboard.press('Home')
      assert.equal(await focused(tools.first()), true)
    } finally { await page.keyboard.press('Escape') }
    await page.locator('#workspace-tools-dialog').waitFor({ state: 'hidden' })
    assert.equal(await focused(trigger), true)
  })

  test('源文件菜单从触发行继续 Tab / Shift+Tab，Esc 只归还焦点', async () => {
    await page.locator('[data-workspace-page="source"]').click()
    const row = page.locator('.source-root-row')
    const menu = page.getByRole('menu', { name: '源文件操作' })
    for (const key of ['Tab', 'Shift+Tab']) {
      await row.press(key)
      const destination = await page.evaluateHandle(() => document.activeElement)
      await row.press('Shift+F10')
      await menu.waitFor()
      await page.keyboard.press('End')
      assert.equal(await focused(menu.locator('button:enabled').last()), true)
      await page.keyboard.press(key)
      assert.equal(await menu.isVisible(), false)
      assert.equal(await focused(destination), true)
      await destination.dispose()
    }
    await row.press('ContextMenu')
    await menu.waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await menu.isVisible(), false)
    assert.equal(await focused(row), true)
  })

  test('拖选名称到遮罩不丢草稿，单击遮罩仍可取消', async () => {
    await page.locator('[data-workspace-page="source"]').click()
    const row = page.locator('.source-file-row:visible').first()
    await row.click()
    await row.press('F2')
    const dialog = page.getByRole('dialog', { name: '重命名' })
    const name = dialog.getByRole('textbox', { name: '名称' })
    const original = await name.inputValue()
    await name.fill('未提交的名称')
    const box = await dialog.boundingBox(), input = await name.boundingBox()
    const y = input.y + input.height / 2
    await page.mouse.move(input.x + input.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x - 12, y, { steps: 6 })
    await page.mouse.up()
    assert.equal(await dialog.isVisible(), true, '从输入框拖出不是点遮罩')
    assert.equal(await name.inputValue(), '未提交的名称')
    await page.mouse.click(box.x - 12, y)
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await focused(row), true)
    assert.equal(await row.locator('.nav-label').textContent(), original)
  })

  test('项目抽屉的源文件菜单可聚焦，Esc 只退一层，触摸可执行菜单命令', async () => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })
    try {
      await openSkin(phone)
      await phone.locator('#mobile-project-toggle').tap()
      const drawer = phone.locator('#mobile-project-dialog')
      await drawer.locator('[data-sidebar-view="source"]').tap()
      const row = drawer.locator('.source-folder-row[data-folder-path]').first()
      await row.press('Shift+F10')
      const menu = phone.getByRole('menu', { name: '源文件操作' })
      await menu.waitFor()
      const items = menu.getByRole('menuitem', { disabled: false })
      assert.equal(await focused(items.first()), true)
      await phone.keyboard.press('End')
      assert.equal(await focused(items.last()), true)
      await phone.keyboard.press('Escape')
      assert.equal(await menu.isVisible(), false)
      assert.equal(await focused(row), true)
      await row.press('Shift+F10')
      await menu.getByRole('menuitem', { name: '复制', exact: true }).tap()
      assert.equal(await menu.isVisible(), false)
      assert.equal(await drawer.locator('#source-copy').getAttribute('aria-pressed'), 'true')
      await phone.keyboard.press('Escape')
      await drawer.waitFor({ state: 'hidden' })
    } finally { await phone.close() }
  })

  test('设置内的菜单先处理 Esc，第二次才关闭设置', async () => {
    await page.locator('#workspace-navigation [data-settings-entry="settings"]').click()
    // 浏览器测试不连接桌面服务；只展示已绑定的桌面模型设置控件。
    await page.locator('#settings-model-section').evaluate(node => node.removeAttribute('data-platform-hidden'))
    await page.evaluate(async () => (await import('/src/app/preferences.ts')).showSettingsPage('model'))
    const summary = page.locator('#model-profile-add > summary')
    await summary.press('ArrowDown')
    assert.equal(await focused(page.locator('#model-profile-add [role="menuitem"]').first()), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#model-profile-add[open]').count(), 0)
    assert.equal(await page.locator('#settings-workspace').isVisible(), true)
    assert.equal(await focused(summary), true)
    await page.keyboard.press('Escape')
    await page.locator('#settings-workspace').waitFor({ state: 'hidden' })
  })
})
