import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

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
            await new Promise((resolve, reject) => { window.finishAdbShare = resolve; window.rejectAdbShare = reject })
          }
          if (cmd === 'cancel_adb_share') {
            window.rejectAdbShare?.(new Error('已取消分享到 ADB'))
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
      const progress = await page.locator('#file-operation-progress').evaluate(el => el.value)
      assert.ok(progress > 0 && progress < 100, `in-progress meter is ${progress}%`)
      await page.evaluate(() => window.finishAdbShare())
      const shared = await page.evaluate(() => {
        const { args } = window.adbCalls.find(call => call.cmd === 'share_skin_adb')
        return { name: args.name, format: args.format, serial: args.settings.serial, host: args.settings.host, port: args.settings.port, directory: args.settings.directory, activity: args.settings.activity, bytes: args.data.length }
      })
      assert.equal(shared.format, 'bds')
      assert.equal(shared.name, '测试 皮肤.bds')
      assert.equal(shared.serial, 'saved-device')
      assert.equal(shared.host, '192.0.2.10')
      assert.equal(shared.port, '12345')
      assert.equal(shared.directory, '')
      // 导入入口留空，由 Rust 按输入法选 .ImeUpdateActivity。
      assert.equal(shared.activity, '')
      assert.ok(shared.bytes > 0)
      await page.locator('#file-operation-dialog').waitFor({ state: 'hidden' })
      // SSF + 旧百度设置：保留原格式，自动选搜狗，不沿用百度的入口或目录。
      await page.evaluate(async bytes => {
        const { appState } = await import('/src/app/state.ts')
        const { SkinArchive } = await import('/src/skin.ts')
        appState.archive = SkinArchive.open(new Uint8Array(bytes), 'ssf')
        document.querySelector('#adb-package').value = 'com.baidu.input'
        document.querySelector('#adb-activity').value = '.ImeUpdateActivity'
        document.querySelector('#adb-directory').value = '/sdcard/Android/data/com.baidu.input/files/KeySkin'
        document.querySelector('#document-name').textContent = '测试 皮肤.ssf'
      }, [...(() => {
        // 运营皮肤标记会让搜狗把本地皮肤按云端皮肤处理，分享时必须清掉。
        const files = unzipSync(ssfFixture())
        const theme = `${strFromU8(files['phoneTheme.ini'])}operational_skin=32\n`
        return zipSync({ ...files, 'phoneTheme.ini': strToU8(theme) })
      })()])
      const share = async count => {
        await page.locator('#adb-share').evaluate(el => el.click())
        await page.waitForFunction(count => window.adbCalls.filter(call => call.cmd === 'share_skin_adb').length === count, count)
        await page.evaluate(() => window.finishAdbShare())
        await page.locator('#file-operation-dialog').waitFor({ state: 'hidden' })
        return page.evaluate(() => {
          const { args } = window.adbCalls.filter(call => call.cmd === 'share_skin_adb').at(-1)
          return { name: args.name, format: args.format, settings: args.settings, bytes: args.data.length }
        })
      }
      const sogou = await share(2)
      assert.equal(sogou.format, 'ssf')
      assert.match(sogou.name, /^keyskin-[a-z0-9]+\.ssf$/)
      assert.equal(sogou.settings.package, 'com.sohu.inputmethod.sogou')
      for (const key of ['activity', 'directory']) assert.equal(sogou.settings[key], '')
      assert.ok(sogou.bytes > 0)
      const sogouTheme = await page.evaluate(async () => {
        const { args } = window.adbCalls.filter(call => call.cmd === 'share_skin_adb').at(-1)
        const { unzipSync, strFromU8 } = await import('/node_modules/fflate/esm/browser.js')
        return strFromU8(unzipSync(args.data)['phoneTheme.ini'])
      })
      assert.ok(!sogouTheme.includes('operational_skin'), 'Sogou share drops the cloud-only operational_skin flag')
      assert.match(sogouTheme, new RegExp(`skin_id=${sogou.name.slice(0, -4)}`))
      assert.equal(await page.locator('#adb-package').inputValue(), 'com.baidu.input', 'automatic routing does not rewrite preferences')
      assert.equal(await page.evaluate(() => localStorage.getItem('adb-package')), null)
      assert.equal(await page.locator('#ask-dialog').isVisible(), false, 'same-format SSF sharing never asks to convert to BDS')
      await page.locator('[data-app-dialog="settings"]').first().evaluate(el => el.click())
      await page.locator('#adb-test').click()
      await page.waitForFunction(() => document.querySelector('#adb-test-status').textContent.includes('连接成功'))
      assert.equal(await page.evaluate(() => adbCalls.at(-1).args.settings.package), 'com.baidu.input', 'connection testing uses the explicit settings')
      await page.locator('#settings-cancel').click()
      await page.locator('#settings-dialog').waitFor({ state: 'hidden' })
      // 同类定制版保持包名及自定义入口。
      await page.evaluate(() => {
        document.querySelector('#adb-package').value = 'com.sohu.inputmethod.sogou.chuizi'
        document.querySelector('#adb-activity').value = 'com.sohu.inputmethod.sogou.SkinActivity'
      })
      const customized = await share(3)
      assert.equal(customized.format, 'ssf')
      assert.equal(customized.settings.package, 'com.sohu.inputmethod.sogou.chuizi')
      assert.equal(customized.settings.activity, 'com.sohu.inputmethod.sogou.SkinActivity')
      // 未知包名不能改变 SSF 的目标，按后缀回到搜狗默认包名。
      await page.evaluate(() => {
        document.querySelector('#adb-package').value = 'com.example.input'
        document.querySelector('#adb-activity').value = '.CustomActivity'
      })
      const unknownSogou = await share(4)
      assert.equal(unknownSogou.format, 'ssf')
      assert.equal(unknownSogou.settings.package, 'com.sohu.inputmethod.sogou')
      assert.equal(unknownSogou.settings.activity, '')
      // 反向切回 BDS 也不能因设置仍是搜狗而转换为 SSF。
      await page.evaluate(async () => {
        const { appState } = await import('/src/app/state.ts')
        const { SkinArchive } = await import('/src/skin.ts')
        appState.archive = SkinArchive.open(new Uint8Array(await (await fetch('/default-template.bds')).arrayBuffer()), 'bds')
      })
      const baidu = await share(5)
      assert.equal(baidu.format, 'bds')
      assert.equal(baidu.settings.package, 'com.baidu.input')
      assert.equal(baidu.settings.activity, '')
      await page.evaluate(async () => {
        const { appState } = await import('/src/app/state.ts')
        const { SkinArchive } = await import('/src/skin.ts')
        appState.archive = SkinArchive.open(new Uint8Array(await (await fetch('/templates/palm-harmony.sxi')).arrayBuffer()), 'sxi')
      })
      const shouxin = await share(6)
      assert.equal(shouxin.format, 'sxi')
      assert.equal(shouxin.name, '测试 皮肤.sxi')
      assert.equal(shouxin.settings.package, 'com.xinshuru.inputmethod')
      assert.ok(shouxin.bytes > 0)
      const shouxinFiles = await page.evaluate(async () => {
        const { args } = window.adbCalls.filter(call => call.cmd === 'share_skin_adb').at(-1)
        const { unzipSync } = await import('/node_modules/fflate/esm/browser.js')
        return Object.keys(unzipSync(args.data)).sort()
      })
      for (const file of ['skin.ini', 'skin.proto', 'preview.png', 'preview_small.png', 'skin.json', 'info.json']) {
        assert.ok(shouxinFiles.includes(file), `ShouXin Android package contains ${file}`)
      }
      assert.ok(shouxinFiles.some(file => file.startsWith('light/')), 'ShouXin share keeps the SXI resources')
      // 分享进行中可取消：按钮只在可取消的操作里出现，取消会调用后端命令并按「已取消」收尾。
      await page.evaluate(async () => {
        const { appState } = await import('/src/app/state.ts')
        const { SkinArchive } = await import('/src/skin.ts')
        appState.archive = SkinArchive.open(new Uint8Array(await (await fetch('/default-template.bds')).arrayBuffer()), 'bds')
        document.querySelector('#document-name').textContent = '取消 测试.bdi'
      })
      await page.locator('#adb-share').evaluate(el => el.click())
      await page.waitForFunction(() => window.adbCalls.filter(call => call.cmd === 'share_skin_adb').length === 7)
      assert.equal(await page.locator('#file-operation-cancel').evaluate(el => el.hidden), false)
      assert.equal(await page.locator('#file-operation-dialog').evaluate(el => el.open), true)
      await page.locator('#file-operation-cancel').click()
      await page.waitForFunction(() => window.adbCalls.some(call => call.cmd === 'cancel_adb_share'))
      await page.waitForFunction(() => document.querySelector('#file-operation-detail').textContent.includes('正在取消'))
      await page.locator('#file-operation-dialog').waitFor({ state: 'hidden' })
      assert.match(await page.locator('#event-log').textContent(), /已取消/)
      assert.equal(await page.locator('#file-operation-cancel').evaluate(el => el.hidden), true)
    }
    await context.close()
  }
  console.log('PASS: ADB desktop gating, network settings, pairing, code redaction, settings save/cancel, Baidu BDS export, Sogou SSF normalization, ShouXin SXI export and in-flight cancel')
} finally {
  await browser?.close()
  await server.close()
}
