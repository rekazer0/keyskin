import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41841, strictPort: false } })
await server.listen()
let browser
try {
  browser = await chromium.launch()
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`
  for (const [userAgent, native, touch, visible] of [
    ['Windows NT', false, 0, false], ['Windows NT', true, 10, true],
    ['Macintosh', true, 0, true], ['Macintosh', true, 5, false],
    ['Android', true, 5, false], ['iPhone', true, 5, false], ['Linux', true, 0, false],
  ]) {
    const context = await browser.newContext({ bypassCSP: true, userAgent })
    const page = await context.newPage()
    await page.addInitScript((touch) => Object.defineProperty(navigator, 'maxTouchPoints', { value: touch }), touch)
    await page.goto(url)
    await page.waitForSelector('.template-card')
    assert.equal(await page.locator('#adb-share').getAttribute('hidden'), '', 'web menu stays hidden')
    if (native) await page.evaluate(async () => {
      // Install the native stub after startup; other native subsystems remain real browser paths.
      window.adbCalls = []
      window.__TAURI_INTERNALS__ = {
        transformCallback: fn => { window.adbProgress = fn; return 1 },
        invoke: async (cmd, args) => {
          window.adbCalls.push({ cmd, args })
          if (window.adbFailure) throw window.adbFailure
          if (cmd === 'share_skin_adb') {
            args.progress.onmessage('等待百度输入法完成导入；请在设备上查看兼容性或权限提示')
            await new Promise(resolve => { window.finishAdbShare = resolve })
          }
          return 'test-device'
        },
      }
      const { wireAdbShare } = await import('/src/app/adb-share.ts')
      wireAdbShare()
    })
    assert.equal(await page.locator('#settings-adb-nav').evaluate(el => !el.hidden), visible)
    assert.equal(await page.locator('#adb-share').evaluate(el => !el.hidden), visible)
    if (visible && userAgent === 'Macintosh') {
      await page.locator('[data-app-dialog="settings"]').first().evaluate(el => el.click())
      await page.locator('#settings-adb-nav').click()
      await page.locator('#adb-serial').fill('unsaved-device')
      await page.locator('#adb-test').click()
      await page.waitForFunction(() => document.querySelector('#adb-test-status').textContent.includes('连接成功'))
      assert.equal(await page.evaluate(() => adbCalls.at(-1).args.settings.serial), 'unsaved-device')
      assert.equal(await page.evaluate(() => localStorage.getItem('adb-serial')), null, 'testing does not save draft')
      await page.evaluate(() => { window.adbFailure = '设备尚未授权' })
      await page.locator('#adb-test').click()
      await page.waitForFunction(() => document.querySelector('#adb-test-status').textContent.includes('连接失败'))
      assert.match(await page.locator('#adb-test-status').textContent(), /尚未授权/)
      await page.locator('#settings-cancel').click()
      await page.locator('#settings-dialog').waitFor({ state: 'hidden' })
      assert.equal(await page.locator('#adb-serial').inputValue(), '')
      await page.locator('[data-app-dialog="settings"]').first().evaluate(el => el.click())
      await page.locator('#adb-host').fill('192.0.2.10')
      await page.locator('#adb-port').fill('12345')
      await page.locator('#adb-pair-port').fill('23456')
      const code = '1'.repeat(6)
      await page.getByLabel('一次性配对码', { exact: true }).fill(code)
      await page.evaluate(() => { window.adbFailure = undefined })
      await page.locator('#adb-pair').click()
      await page.waitForFunction(() => document.querySelector('#adb-pair-status').textContent.includes('配对成功'))
      const paired = await page.evaluate(() => adbCalls.at(-1))
      assert.equal(paired.cmd, 'pair_adb_device')
      assert.equal(paired.args.settings.host, '192.0.2.10')
      assert.equal(paired.args.settings.port, '12345')
      assert.equal(paired.args.pairPort, '23456')
      assert.equal(paired.args.code, code)
      assert.equal(await page.getByLabel('一次性配对码', { exact: true }).inputValue(), '')
      assert.equal(await page.evaluate(code => Object.values(localStorage).some(value => value.includes(code)), code), false)
      await page.getByLabel('一次性配对码', { exact: true }).fill(code)
      await page.evaluate(code => { window.adbFailure = `Error: rejected ${code}` }, code)
      await page.locator('#adb-pair').click()
      await page.waitForFunction(() => document.querySelector('#adb-pair-status').textContent.includes('配对失败'))
      assert.ok(!(await page.locator('#adb-pair-status').textContent()).includes(code))
      await page.evaluate(() => { window.adbFailure = undefined })
      await page.locator('#adb-test').click()
      await page.waitForFunction(() => document.querySelector('#adb-test-status').textContent.includes('连接成功'))
      assert.equal(await page.evaluate(() => adbCalls.at(-1).args.settings.host), '192.0.2.10')
      assert.equal(await page.evaluate(() => localStorage.getItem('adb-host')), null)
      await page.getByLabel('一次性配对码', { exact: true }).fill(code)
      await page.locator('#settings-cancel').click()
      await page.locator('#settings-dialog').waitFor({ state: 'hidden' })
      assert.equal(await page.getByLabel('一次性配对码', { exact: true }).inputValue(), '')
      assert.equal(await page.locator('#adb-host').inputValue(), '')
      await page.locator('[data-app-dialog="settings"]').first().evaluate(el => el.click())
      await page.locator('#adb-serial').fill('saved-device')
      await page.locator('#adb-host').fill('192.0.2.10')
      await page.locator('#adb-port').fill('12345')
      await page.locator('#settings-save').click()
      await page.locator('#settings-dialog').waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate(() => localStorage.getItem('adb-serial')), 'saved-device')
      assert.equal(await page.evaluate(() => localStorage.getItem('adb-host')), '192.0.2.10')
      assert.equal(await page.evaluate(() => localStorage.getItem('adb-port')), '12345')
      await page.evaluate(async () => {
        window.adbFailure = undefined
        const { appState } = await import('/src/app/state.ts')
        const { SkinArchive } = await import('/src/skin.ts')
        appState.archive = SkinArchive.open(new Uint8Array(await (await fetch('/default-template.bds')).arrayBuffer()), 'bds')
        document.querySelector('#document-name').textContent = '测试 皮肤.bdi'
        document.querySelector('#adb-share').disabled = false
      })
      await page.locator('#adb-share').evaluate(el => el.click())
      await page.waitForFunction(() => window.adbCalls.some(call => call.cmd === 'share_skin_adb'))
      await page.waitForFunction(() => document.querySelector('#file-operation-detail').textContent.includes('兼容性或权限提示'))
      assert.equal(await page.locator('#file-operation-progress').evaluate(el => el.value), 94)
      await page.evaluate(() => window.finishAdbShare())
      const shared = await page.evaluate(() => {
        const { args } = window.adbCalls.find(call => call.cmd === 'share_skin_adb')
        return { name: args.name, format: args.format, serial: args.settings.serial, host: args.settings.host, port: args.settings.port, directory: args.settings.directory, activity: args.settings.activity, previewActivity: args.settings.previewActivity, bytes: args.data.length }
      })
      assert.equal(shared.format, 'bds')
      assert.equal(shared.name, '测试 皮肤.bds')
      assert.equal(shared.serial, 'saved-device')
      assert.equal(shared.host, '192.0.2.10')
      assert.equal(shared.port, '12345')
      assert.equal(shared.directory, '')
      assert.equal(shared.activity, '.ImeUpdateActivity')
      assert.ok(shared.bytes > 0)
      assert.equal(shared.previewActivity, '.ImeSkinTryActivity')
      await page.locator('#file-operation-dialog').waitFor({ state: 'hidden' })
    }
    await context.close()
  }
  console.log('PASS: ADB desktop gating, network settings, pairing success/failure, code redaction/cleanup, settings save/cancel and export')
} finally {
  await browser?.close()
  await server.close()
}
