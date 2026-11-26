import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41876, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 760, hasTouch: width < 760 })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#browser-open').setInputFiles({ name: 'rename.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(bdsFixture()) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    const button = page.locator('#resource-rename')
    const cardPath = '.ui-image-card[data-path="light/skin/res/btn.png"]'
    if (width < 760) {
      await page.locator('#mobile-navigation [data-mobile-page="resources"]').click()
      await page.locator('#mobile-resource-category').selectOption('image')
      await page.locator(cardPath).dblclick()
    } else {
      const selectMode = value => page.evaluate(async value => {
        const { mode } = await import('/src/app/dom.ts')
        mode.value = value
        mode.dispatchEvent(new Event('change', { bubbles: true }))
      }, value)
      await selectMode('preview')
      await page.locator('[data-workspace-page="resources"]').click()
      await page.locator('[data-resource-page="image"]').click()
      await page.locator(cardPath).click()
      assert.equal(await button.isVisible(), true)
      assert.equal(await button.isDisabled(), true, 'preview cannot rename')
      await selectMode('edit')
    }
    const originalCard = page.locator(cardPath)
    assert.equal(await button.isVisible(), true)
    assert.equal(await button.isEnabled(), true)
    const actions = page.locator('.resource-detail-heading')
    assert.equal(await actions.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'inspector header fits')
    const rows = await actions.locator('button:visible').evaluateAll(buttons => buttons.map(el => el.getBoundingClientRect().y + el.getBoundingClientRect().height / 2))
    assert.ok(rows.length > 1 && Math.max(...rows) - Math.min(...rows) < 1, 'inspector actions stay on one row')
    const snapshot = () => page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      return { names: appState.archive.names(), undo: appState.undoStack.length, css: appState.archive.getText('light/skin/res/default.css'), selected: appState.selectedResourceGalleryPath }
    })
    const original = await snapshot()
    await button.click()
    const dialog = page.getByRole('dialog', { name: '重命名', exact: true })
    assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).evaluate(el => el === document.activeElement), true)
    const input = dialog.getByRole('textbox', { name: '名称' })
    assert.equal(await input.inputValue(), 'btn.png')
    await input.fill('cancel.png')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await snapshot(), original)
    if (width < 760) await page.locator('#resource-back').click()
    await originalCard.click({ button: 'right' })
    await page.getByRole('menu', { name: '资源操作' }).getByRole('menuitem', { name: '重命名…' }).click()
    for (const name of ['', '../bad.png', 'wrong.jpg', 'BG.png']) {
      await input.fill(name)
      await dialog.getByRole('button', { name: '重命名', exact: true }).click()
      assert.ok(await dialog.getByRole('alert').textContent(), name)
      assert.deepEqual(await snapshot(), original)
    }
    await input.fill('新图片.png')
    await input.press('Enter')
    await dialog.waitFor({ state: 'detached' })
    const renamed = await snapshot()
    assert.equal(renamed.undo, original.undo + 1)
    assert.ok(renamed.names.includes('light/skin/res/新图片.png'))
    assert.ok(renamed.names.includes('light/skin/res/新图片.til'))
    assert.equal(renamed.names.includes('light/skin/res/btn.png'), false)
    assert.match(renamed.css, /NM_IMG=新图片,0/)
    assert.equal(renamed.selected, 'light/skin/res/新图片.png')
    assert.equal(await page.locator('#resource-list-view').isVisible(), true, 'rename keeps the image list open')
    const card = page.locator('.ui-image-card[data-path="light/skin/res/新图片.png"]')
    assert.equal(await card.getAttribute('aria-selected'), 'true')
    mkdirSync('.ui-current', { recursive: true })
    await page.screenshot({ path: `.ui-current/image-rename-${width}.png` })
    await card.focus()
    await page.keyboard.press('F2')
    await dialog.waitFor({ state: 'visible' })
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    const undone = await snapshot()
    assert.deepEqual(undone.names, original.names)
    assert.equal(undone.css, original.css)
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).redo())
    assert.deepEqual((await snapshot()).names, renamed.names)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`image rename ${width}px: validation, cancel, references, slices, selection, undo/redo, F2 and toolbar layout passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
