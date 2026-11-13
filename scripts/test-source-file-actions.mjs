import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'
import { acceptAskDialogs } from "../tests/helpers/ask-dialogs.mjs"

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41797, strictPort: false, host: '127.0.0.1' } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await acceptAskDialogs(page)
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
  for (const row of [page.locator('.source-root-row'), page.locator('.source-folder-row[data-folder-path]').first()]) {
    const folder = row.locator('..')
    const expanded = () => folder.evaluate((node) => node.open)
    const assertExpanded = async (expected, message) => {
      assert.equal(await expanded(), expected, message)
      await page.waitForFunction(({ path, expected }) => {
        const row = path === null ? document.querySelector('.source-root-row')
          : [...document.querySelectorAll('.source-folder-row')].find((node) => node.dataset.folderPath === path)
        return row?.getAttribute('aria-expanded') === String(expected)
      }, { path: await row.getAttribute('data-folder-path'), expected })
    }
    await row.locator('.nav-label').click()
    assert.equal(await row.evaluate((node) => node.getAttribute('aria-selected')), 'true')
    const initial = await expanded()
    await row.locator('.source-disclosure').click()
    await assertExpanded(!initial, 'selected folder triangle toggles once')
    await row.locator('.source-disclosure').click()
    await assertExpanded(initial, 'selected folder triangle toggles back')
    await row.locator('.source-disclosure').dblclick()
    await assertExpanded(initial, 'two triangle clicks must not trigger a third toggle from the row')
    await row.locator('.nav-label').dblclick()
    await assertExpanded(!initial, 'double-clicking the folder name still toggles')
    await row.focus()
    await page.keyboard.press('ArrowRight')
    await assertExpanded(true, 'right arrow expands')
    await row.focus()
    await page.keyboard.press('ArrowLeft')
    await assertExpanded(false, 'left arrow collapses')
    await page.keyboard.press('Enter')
    await assertExpanded(true, 'Enter toggles the folder')
    await page.keyboard.press('Space')
    await assertExpanded(false, 'Space toggles the folder')
    await page.keyboard.press('ArrowRight')
  }
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
  for (const action of ['upload', 'paste', 'move', 'rename', 'delete']) {
    // Cover pointer activation on the icon as well as keyboard activation of the button.
    const button = page.locator(`#source-${action}`)
    assert.equal(await button.isEnabled(), true, action)
    if (action === 'move') {
      await button.focus()
      await page.keyboard.press('Enter')
    } else {
      await button.locator('.icon').click()
    }
    await page.getByRole('dialog', { name: '交互预览中无法编辑' }).waitFor({ state: 'visible' })
    await page.getByRole('dialog', { name: '交互预览中无法编辑' }).getByRole('button', { name: '取消', exact: true }).click()
    // 对话框有退出动效，关完再继续（期间页面仍是模态的）。
    await page.getByRole('dialog', { name: '交互预览中无法编辑' }).waitFor({ state: 'detached' })
    assert.equal(await page.locator('#mode').inputValue(), 'preview')
    assert.deepEqual(await snapshot(), before, `${action} must not modify files in preview`)
  }
  await page.locator('#source-paste').click()
  await page.getByRole('dialog', { name: '交互预览中无法编辑' }).getByRole('button', { name: '切换至编辑模式', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#mode').value === 'edit')
  await page.locator('#source-paste').click()
  await page.locator('.source-file-row[data-path="phoneTheme 副本.ini"]').waitFor({ state: 'visible' })
  assert.equal((await snapshot()).undo, before.undo + 1)
  await page.locator('#source-delete').click()
  await page.locator('.source-file-row[data-path="phoneTheme 副本.ini"]').waitFor({ state: 'detached' })
  await page.locator('#desktop-undo').click()
  await page.locator('.source-file-row[data-path="phoneTheme 副本.ini"]').waitFor({ state: 'visible' })
  const copiedFile = page.locator('.source-file-row[data-path="phoneTheme 副本.ini"]')
  await copiedFile.click()
  const oldBytes = await page.evaluate(async () => [...(await import('/src/app/state.ts')).appState.archive.getBytes('phoneTheme 副本.ini')])
  await copiedFile.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '源文件操作' })
  await menu.waitFor()
  const toolbar = await page.locator('#source-file-toolbar button').evaluateAll(buttons => buttons.map(button => ({ label: button.title || button.ariaLabel, disabled: button.disabled })))
  assert.deepEqual(await menu.getByRole('menuitem').evaluateAll(buttons => buttons.map(button => ({ label: button.textContent, disabled: button.disabled }))), toolbar)
  await page.keyboard.press('End')
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '删除')
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'detached' })
  assert.equal(await copiedFile.evaluate(row => row === document.activeElement), true)
  await copiedFile.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: '重命名…' }).click()
  const rename = page.getByRole('dialog', { name: '重命名', exact: true })
  const name = rename.getByRole('textbox', { name: '名称' })
  await rename.getByRole('button', { name: '取消', exact: true }).click()
  await rename.waitFor({ state: 'detached' })
  assert.equal((await snapshot()).names.includes('phoneTheme 副本.ini'), true)
  await page.locator('#source-rename').click()
  for (const invalid of ['../escape.ini', 'phoneTheme.ini', 'default', '']) {
    await name.fill(invalid)
    await rename.getByRole('button', { name: '重命名', exact: true }).click()
    await rename.getByRole('alert').waitFor()
    assert.equal(await rename.isVisible(), true)
    assert.equal((await snapshot()).names.includes('phoneTheme 副本.ini'), true)
  }
  const beforeRename = await snapshot()
  await name.fill('重命名.ini')
  await name.press('Enter')
  await rename.waitFor({ state: 'detached' })
  const renamed = page.locator('.source-file-row[data-path="重命名.ini"]')
  await renamed.waitFor()
  assert.equal((await snapshot()).names.includes('phoneTheme 副本.ini'), false)
  assert.equal((await snapshot()).undo, beforeRename.undo + 1, 'rename is one undo step')
  assert.deepEqual(await page.evaluate(async () => [...(await import('/src/app/state.ts')).appState.archive.getBytes('重命名.ini')]), oldBytes)
  await page.locator('#desktop-undo').click()
  await copiedFile.waitFor()
  assert.equal((await snapshot()).names.includes('重命名.ini'), false)
  // Right-click targets the row under the pointer, even when another file is selected.
  await page.locator('.source-file-row[data-path="phoneTheme.ini"]').click()
  await copiedFile.click({ button: 'right' })
  assert.equal(await copiedFile.getAttribute('aria-selected'), 'true')
  await menu.getByRole('menuitem', { name: '删除', exact: true }).click()
  await copiedFile.waitFor({ state: 'detached' })
  assert.equal((await snapshot()).names.includes('phoneTheme.ini'), true)
  await page.locator('#desktop-undo').click()
  await copiedFile.waitFor()
  await copiedFile.focus()
  await page.keyboard.press('Shift+F10')
  await menu.waitFor()
  await page.waitForTimeout(350)
  assert.equal(await menu.evaluate(node => node.getBoundingClientRect().bottom <= window.innerHeight), true)
  await page.screenshot({ path: '/tmp/bdi-source-file-context-menu.png' })
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { renderFiles } = await import('/src/app/file-tree.ts')
    const { ensureSourcePathRendered } = await import('/src/app/source-files.ts')
    for (let index = 0; index < 80; index++) {
      const extension = index === 0 || index === 40 ? 'txt' : 'bin'
      appState.archive.setText(`000-scroll/file-${index}.${extension}`, 'scroll test')
    }
    appState.archive.setText('000-scroll/group/remove.bin', 'folder test')
    appState.archive.setText('zzz-scroll.txt', 'bottom test')
    renderFiles()
    ensureSourcePathRendered('000-scroll/file-0.txt')
  })
  for (const [path, folder, position] of [
    ['000-scroll/file-0.txt', false, 'top'],
    ['000-scroll/file-40.txt', false, 'middle'],
    ['000-scroll/group', true, 'top'],
    ['zzz-scroll.txt', false, 'bottom'],
  ]) {
    const row = page.locator(folder ? `.source-folder-row[data-folder-path="${path}"]` : `.source-file-row[data-path="${path}"]`)
    await row.click()
    const beforeScroll = await page.locator('#files').evaluate((list, position) => {
      const maximum = list.scrollHeight - list.clientHeight
      list.scrollTo({ top: position === 'top' ? 0 : position === 'bottom' ? maximum : maximum / 2, behavior: 'instant' })
      return list.scrollTop
    }, position)
    if (position !== 'top') assert.ok(beforeScroll > 0, `${position} scenario must scroll`)
    await page.locator('#source-delete').click()
    await row.waitFor({ state: 'detached' })
    const afterScroll = await page.locator('#files').evaluate(async (list) => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return { top: list.scrollTop, maximum: list.scrollHeight - list.clientHeight }
    })
    assert.ok(Math.abs(afterScroll.top - Math.min(beforeScroll, afterScroll.maximum)) <= 1,
      `deleting ${path} must preserve scroll position: ${beforeScroll} -> ${afterScroll.top}`)
  }
  assert.deepEqual(errors, [])
  console.log('Source file actions: shared context menu, rename validation/cancel/undo, preview prompt, keyboard, paste, delete and scroll position passed')
} catch (error) {
  console.log('page errors:', errors)
  await page.screenshot({ path: '/tmp/bdi-source-file-actions-failure.png' })
  throw error
} finally {
  await browser.close()
  await server.close()
}
