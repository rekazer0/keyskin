import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

for (const engine of [chromium, webkit]) describe(engine.name(), () => {
  let server, browser, page
  const focused = locator => locator.evaluate(node => node === document.activeElement)
  before(async () => {
    server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
    await server.listen()
    browser = await engine.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#browser-open').setInputFiles({ name: '工具.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(bdsFixture()) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled && !document.querySelector('#file-operation-dialog').open)
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

  test('设置内的菜单先处理 Esc，第二次才关闭设置', async () => {
    await page.locator('#workspace-navigation [data-app-dialog="settings"]').click()
    // 浏览器测试不连接桌面服务；只展示已绑定的桌面模型设置控件。
    await page.locator('#settings-model-section').evaluate(node => node.removeAttribute('data-platform-hidden'))
    await page.evaluate(async () => (await import('/src/app/preferences.ts')).showSettingsPage('model'))
    const summary = page.locator('#model-profile-add > summary')
    await summary.press('ArrowDown')
    assert.equal(await focused(page.locator('#model-profile-add [role="menuitem"]').first()), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#model-profile-add[open]').count(), 0)
    assert.equal(await page.locator('#settings-dialog:modal').count(), 1)
    assert.equal(await focused(summary), true)
    await page.keyboard.press('Escape')
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' })
  })
})
