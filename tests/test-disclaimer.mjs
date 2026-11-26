import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41960, strictPort: false } })
await server.listen()
const url = `http://127.0.0.1:${server.httpServer.address().port}/`
try {
  const browser = await chromium.launch()
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
        isMobile: mobile,
        hasTouch: mobile,
      })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(url)
      const dialog = page.getByRole('dialog', { name: '免责声明' })
      await dialog.waitFor()
      const copy = await dialog.locator('.ui-dialog-body p').textContent()
      for (const phrase of ['帮助皮肤作者和用户', '技术学习和交流', '支持正版输入法和原版皮肤', '未经权利人授权', '与本软件无关', '228040912', '确认后立即下架相关内容']) {
        assert.ok(copy.includes(phrase), phrase)
      }
      const dismiss = dialog.getByRole('button', { name: '我知道了' })
      assert.ok(await dismiss.evaluate(button => document.activeElement === button), 'the primary action receives focus')
      if (mobile) await dismiss.tap()
      else await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      await page.reload()
      await page.waitForSelector('.template-card', { state: 'attached' })
      assert.equal(await dialog.count(), 0, 'the disclaimer is not shown again')

      const navigation = mobile ? '#mobile-navigation' : '#workspace-navigation'
      await page.locator(`${navigation} [data-settings-entry="settings"]`).click()
      const section = page.getByRole('region', { name: '免责声明' })
      if (mobile) await page.getByRole('button', { name: /^版本/ }).click()
      else await page.getByRole('tab', { name: '关于', exact: true }).click()
      await section.waitFor()
      assert.equal((await section.locator('p').allTextContents()).join('\n\n'), copy, 'About shows the same text')
      const save = page.locator('#settings-save')
      assert.equal(await save.isVisible(), false, 'clean About does not show a settings save action')
      if (mobile) {
        await page.locator('.mobile-settings-back').click()
        assert.ok(await save.isVisible(), 'the mobile settings index retains its save action')
        await page.getByRole('button', { name: '免责声明', exact: true }).click()
        const heading = section.getByRole('heading', { name: '免责声明' })
        assert.ok(await heading.evaluate(el => document.activeElement === el), 'the direct link focuses the disclaimer heading')
      } else {
        await page.getByRole('tab', { name: '外观', exact: true }).click()
        await page.getByRole('button', { name: '深色', exact: true }).click()
        await page.getByRole('tab', { name: '关于', exact: true }).click()
        assert.ok(await save.isVisible(), 'About preserves the save action when a draft is dirty')
      }
      assert.deepEqual(errors, [])
      await page.close()
      console.log(`PASS ${mobile ? 'mobile' : 'desktop'}: one-time startup disclaimer and About copy`)
    }
  } finally {
    await browser.close()
  }
} finally {
  await server.close()
}
