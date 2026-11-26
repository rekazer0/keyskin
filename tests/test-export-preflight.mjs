import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const layout = 'light/skin/port/py_26.ini'
const atlas = 'light/skin/res/preflight.til'
mkdirSync('.ui-current', { recursive: true })

try {
  for (const mobile of [false, true]) {
    const viewport = mobile ? { width: 390, height: 760 } : { width: 1440, height: 900 }
    const page = await browser.newPage({ viewport, hasTouch: mobile, isMobile: mobile, acceptDownloads: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => { window.showSaveFilePicker = undefined; localStorage.setItem('onboarding-tour-v1', 'done') })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    const archive = SkinArchive.open(bdsFixture(), 'bds')
    const original = archive.getText(layout).replace('KEY_NUM=2', 'KEY_NUM＝7')
    const originalAtlas = '[GLOBAL]\nTILE_NUM=8\n[IMG1]\nSOURCE_RECT=0,0,1,1\n'
    archive.setText(layout, original)
    archive.setText(atlas, originalAtlas)
    if (mobile) archive.setText('light/skin/land/manual.ini', '[PANEL]\n语法错误')
    await page.locator('#browser-open').setInputFiles({ name: '格式检查.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(archive.normalizedBytes()) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled && !document.querySelector('#file-operation-dialog').open)
    const open = async () => {
      if (mobile) {
        await page.locator('#mobile-app-more > summary').tap()
        await page.locator('[data-mobile-action="mobile-export-open"]').tap()
      } else await page.locator('#workspace-export').click()
    }
    const share = page.locator('#share-dialog')
    const check = share.getByRole('region', { name: '格式检查' })
    const status = check.getByRole('status')
    const details = check.locator('details')
    const disclosure = details.locator('summary')
    const repair = check.getByRole('button', { name: '一键修复' })
    const close = async () => {
      await share.getByRole('button', { name: '关闭', exact: true }).click()
      await share.waitFor({ state: 'hidden' })
    }
    const editor = () => page.evaluate(async ([layout, atlas]) => {
      const { appState } = await import('/src/app/state.ts')
      return { layout: appState.archive.getText(layout), atlas: appState.archive.getText(atlas), history: appState.undoStack.length }
    }, [layout, atlas])

    await open()
    await repair.waitFor()
    assert.deepEqual(await editor(), { layout: original, atlas: originalAtlas, history: 0 })
    assert.match(await status.textContent(), /3 项可自动修复/)
    if (mobile) await disclosure.tap()
    else {
      await disclosure.focus()
      await page.keyboard.press('Enter')
    }
    await details.getByText(`${layout}:4`, { exact: true }).waitFor()
    assert.match(await details.textContent(), /全角段括号或等号/)
    assert.match(await details.textContent(), /TILE_NUM 应为 1/)

    if (!mobile) {
      await page.evaluate(async () => {
        const { appState } = await import('/src/app/state.ts')
        appState.archive.setText = () => { throw new Error('测试：写入失败') }
      })
      await repair.click()
      assert.match(await status.textContent(), /修复失败/)
      assert.deepEqual(await editor(), { layout: original, atlas: originalAtlas, history: 0 })
      await page.evaluate(async () => { delete (await import('/src/app/state.ts')).appState.archive.setText })
    }
    if (mobile) await repair.tap()
    else await repair.click()
    assert.match(await status.textContent(), mobile ? /部分修复 · 已修复 3 项 · 复查剩余 1 项/ : /修复成功 · 已修复 3 项 · 复查通过/)
    assert.equal(await repair.isHidden(), true)
    assert.match(await disclosure.textContent(), /查看修复详情/)
    assert.equal(await details.getByText('已修复', { exact: true }).count(), 3)
    assert.equal(await details.getByText('需手动处理', { exact: true }).count(), mobile ? 1 : 0)
    assert.deepEqual(await editor(), { layout: original.replace('KEY_NUM＝7', 'KEY_NUM=2'), atlas: originalAtlas.replace('TILE_NUM=8', 'TILE_NUM=1'), history: 1 })
    const body = share.locator('.ui-dialog-body')
    await check.locator('h3').evaluate(node => node.scrollIntoView({ block: 'start' }))
    assert.equal(await body.evaluate(node => node.scrollWidth > node.clientWidth), false)
    assert.equal(await share.locator('#save').isVisible(), true)
    await page.screenshot({ path: `.ui-current/export-preflight-${viewport.width}.png` })

    await close()
    if (mobile) {
      await page.locator('#mobile-undo').tap()
      assert.deepEqual(await editor(), { layout: original, atlas: originalAtlas, history: 0 })
    } else {
      await open()
      await check.getByText(/当前项目检查通过/).waitFor()
      const download = page.waitForEvent('download')
      await share.locator('#save').click()
      const downloadButton = share.locator('#file-operation-dialog[open] button', { hasText: /^下载$/ })
      if (await Promise.race([download.then(() => false), downloadButton.waitFor().then(() => true)])) await downloadButton.click()
      const saved = SkinArchive.open(readFileSync(await (await download).path()), 'bds')
      assert.match(saved.getText(layout), /KEY_NUM=2/)
      assert.match(saved.getText(atlas), /TILE_NUM=1/)
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
console.log('桌面和手机格式检查、详情、修复反馈、撤销及保存通过')
