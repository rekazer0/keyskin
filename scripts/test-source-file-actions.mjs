import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41797, strictPort: false, host: '127.0.0.1' } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', (dialog) => dialog.accept())
const snapshot = () => page.evaluate(async () => {
  const { appState } = await import('/src/app/state.ts')
  return { names: appState.archive.names(), changed: [...appState.archive.changed], undo: appState.undoStack.length, transfer: appState.sourceTransfer?.mode }
})
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  assert.equal(await page.locator('#source-upload').isDisabled(), true)
  await page.locator('#browser-open').setInputFiles({ name: '操作栏测试.ssf', mimeType: 'application/octet-stream', buffer: Buffer.from(ssfFixture()) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.locator('[data-sidebar-view="source"]').click()
  await page.locator('.source-file-row[data-path="phoneTheme.ini"]').click()
  assert.equal(await page.locator('#mode').inputValue(), 'preview')
  assert.equal(await page.locator('#source-download').isEnabled(), true)
  // Preview keeps the source read-only but still lets the user select and copy it.
  await page.locator('[data-inspector-tab="source"]').click()
  const sourceLine = page.locator('#source .cm-line').nth(3)
  const lineText = await sourceLine.innerText()
  await sourceLine.click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  const copied = await page.evaluate(() => new Promise((resolve) => {
    window.addEventListener('copy', (event) => resolve(event.clipboardData.getData('text/plain')), { once: true })
    document.execCommand('copy')
  }))
  assert.equal(copied, lineText, 'preview source text can be copied')
  await page.keyboard.press('Control+x')
  await page.keyboard.type('x')
  assert.equal(await sourceLine.innerText(), lineText, 'preview source stays read-only')
  await page.locator('[data-inspector-tab="properties"]').click()
  assert.equal(await page.locator('#source-paste').isDisabled(), true, 'empty clipboard stays disabled')
  await page.locator('#source-copy').click()
  const before = await snapshot()
  for (const action of ['upload', 'paste', 'move', 'delete']) {
    // Cover pointer activation on the icon as well as keyboard activation of the button.
    const button = page.locator(`#source-${action}`)
    assert.equal(await button.isEnabled(), true, action)
    if (action === 'move') {
      await button.focus()
      await page.keyboard.press('Enter')
    } else {
      await button.locator('.icon').click()
    }
    await page.locator('#edit-mode-dialog').waitFor({ state: 'visible' })
    await page.locator('#edit-mode-dialog button[value="cancel"]').click()
    assert.equal(await page.locator('#mode').inputValue(), 'preview')
    assert.deepEqual(await snapshot(), before, `${action} must not modify files in preview`)
  }
  await page.locator('#source-paste').click()
  await page.locator('#edit-mode-dialog button[value="edit"]').click()
  await page.waitForFunction(() => document.querySelector('#mode').value === 'edit')
  await page.locator('#source-paste').click()
  await page.locator('.source-file-row[data-path="phoneTheme 副本.ini"]').waitFor({ state: 'visible' })
  assert.equal((await snapshot()).undo, before.undo + 1)
  await page.locator('#source-delete').click()
  await page.locator('.source-file-row[data-path="phoneTheme 副本.ini"]').waitFor({ state: 'detached' })
  await page.locator('#desktop-undo').click()
  await page.locator('.source-file-row[data-path="phoneTheme 副本.ini"]').waitFor({ state: 'visible' })
  assert.deepEqual(errors, [])
  console.log('Source file actions: preview prompt, cancel without mutation, keyboard activation, edit, paste, delete and undo passed')
} finally {
  await browser.close()
  await server.close()
}
