import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ logLevel: 'error', server: { port: 0, host: '127.0.0.1' } })
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
      if (mobile) await page.getByRole('button', { name: '免责声明', exact: true }).click()
      else await page.getByRole('tab', { name: '关于', exact: true }).click()
      const section = page.getByRole('region', { name: '免责声明' })
      await section.waitFor()
      assert.equal((await section.locator('p').allTextContents()).join('\n\n'), copy, 'About shows the same text')
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
