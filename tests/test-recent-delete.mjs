import { dismissStartupDisclaimer } from "../tests/helpers/open-editor-template.mjs"
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41909, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const output = '.ui-current/recent-delete'
mkdirSync(output, { recursive: true })
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({
      viewport: mobile ? { width: 320, height: 720 } : { width: 1100, height: 800 },
      isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce',
    })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('onboarding-tour-v1', 'done'))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await dismissStartupDisclaimer(page)
    await page.waitForSelector('#mobile-welcome-open, #welcome-recent-open', { state: 'attached' })
    const paths = mobile ? ['content://provider/document/skin-a', 'content://provider/document/skin-b'] : ['/tmp/皮肤A.bds', '/tmp/皮肤B.bds']
    const sources = mobile ? ['content://provider/tree/sources/document/skin-a', 'content://provider/tree/sources/document/skin-b'] : ['/tmp/sources/皮肤A', '/tmp/sources/皮肤B']
    const skins = paths.map((path, index) => ({ path, source: sources[index] }))
    await page.evaluate(async ({ paths, sources }) => {
      const { recordRecentFile } = await import('/src/app/recent-files.ts')
      window.deleteRequests = []
      window.rejectSecondFile = true
      window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
        if (command === 'delete_skin_files') {
          window.deleteRequests.push(args.skins)
          return args.skins.map(({ path }) => window.rejectSecondFile && path === paths[1] ? '无删除权限' : null)
        }
        if (command === 'skin_file_stamp') return [1, 1]
        if (command === 'skin_file_size') return 1
        return null
      } }
      document.querySelector('.welcome-recent').removeAttribute('data-platform-hidden')
      recordRecentFile(paths[1], '皮肤B.bds', sources[1])
      recordRecentFile(paths[0], '皮肤A.bds', sources[0])
      recordRecentFile(paths[0], '皮肤A.bds') // Reopening with source saving disabled must preserve the link.
    }, { paths, sources })
    const cards = page.locator('.recent-card')
    const grid = page.getByRole('listbox', { name: '我的皮肤' })
    const selection = page.getByRole('group', { name: '皮肤多选' })
    const requests = () => page.evaluate(() => window.deleteRequests)
    const confirm = page.getByRole('dialog', { name: '删除 2 项皮肤？', exact: true })
    const touch = mobile ? await page.context().newCDPSession(page) : undefined
    const longPress = async (card) => {
      await card.scrollIntoViewIfNeeded()
      const box = await card.boundingBox()
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      else { await page.mouse.move(x, y); await page.mouse.down() }
      await page.waitForFunction(() => document.querySelectorAll('.recent-card[aria-selected="true"]').length === 1)
      if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      else await page.mouse.up()
    }
    await longPress(cards.first())
    assert.equal(await grid.getAttribute('aria-multiselectable'), 'true')
    assert.equal(await cards.first().getAttribute('aria-selected'), 'true', 'release does not toggle the held card')
    if (mobile) await cards.nth(1).tap()
    else await cards.nth(1).click()
    const remove = selection.getByRole('button', { name: '删除 (2)', exact: true })
    await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-selection.png` })
    await remove.click()
    assert.equal(await confirm.getByRole('button', { name: '取消', exact: true }).evaluate(el => el === document.activeElement), true)
    assert.deepEqual(await requests(), [])
    assert.ok((await confirm.textContent()).includes(sources[0]))
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    await confirm.waitFor({ state: 'hidden' })
    assert.equal(await cards.count(), 2)
    assert.deepEqual(await requests(), [])
    await remove.click()
    await confirm.getByRole('button', { name: '删除', exact: true }).click()
    const failure = page.getByRole('dialog', { name: '删除皮肤失败' })
    await failure.waitFor()
    assert.match(await failure.textContent(), /已删除 1 项.*无删除权限/)
    assert.deepEqual(await requests(), [skins])
    assert.equal(await cards.count(), 1)
    assert.equal(await cards.first().getAttribute('aria-selected'), 'true')
    await failure.getByRole('button', { name: '关闭', exact: true }).last().click()
    await failure.waitFor({ state: 'hidden' })
    await selection.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(await selection.isVisible(), false)
    await page.evaluate(() => { window.rejectSecondFile = false })
    if (mobile) {
      await longPress(cards.first())
      assert.ok((await selection.getByRole('button', { name: '删除 (1)' }).boundingBox()).height >= 44)
      await selection.getByRole('button', { name: '删除 (1)' }).click()
    } else {
      await cards.first().press('Shift+Space')
      assert.equal(await selection.isVisible(), true, 'keyboard can enter selection mode')
      await cards.first().press('Escape')
      assert.equal(await selection.isVisible(), false)
      await cards.first().click({ button: 'right' })
      await page.getByRole('menuitem', { name: '删除…', exact: true }).click()
    }
    await page.getByRole('dialog', { name: '删除「皮肤B.bds」？' }).getByRole('button', { name: '删除', exact: true }).click()
    await cards.first().waitFor({ state: 'detached' })
    assert.deepEqual(await requests(), [skins, [skins[1]]])
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('PASS recent delete: desktop and touch long press, keyboard, context menu, confirmation, partial failure and Android URIs')
} finally {
  await browser.close()
  await server.close()
}
