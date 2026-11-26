import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const errors = []
async function open(path) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles(path)
  await page.waitForFunction(() => !document.querySelector('#open').disabled &&
    (!document.querySelector('#file-operation-dialog').open || !document.querySelector('#file-operation-close').disabled))
  if (await page.locator('#file-operation-dialog[open]').count()) await page.locator('#file-operation-close').click()
  if (await page.locator('#mode').inputValue() !== 'edit') await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await page.locator('.sidebar-overview button[data-path$="/py_9.ini"]').click()
  return page
}
const snapshot = (page, section = 'KEY6') => page.evaluate(async section => {
  const { appState } = await import('/src/app/state.ts')
  return { view: appState.layoutDocument.get(section, 'VIEW_RECT'), touch: appState.layoutDocument.get(section, 'TOUCH_RECT'), undo: appState.undoStack.length }
}, section)
const undo = page => page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())

try {
  const page = await open(fileURLToPath(new URL('../public/templates/oppo-dual-color.bds', import.meta.url)))
  const display = page.locator('.key-layout-fields')
  const mixedWidth = display.locator('[data-key-field="width"]')
  const mixedHeight = display.locator('[data-key-field="height"]')
  await page.evaluate(async () => (await import('/src/app/canvas-interaction.ts')).preview.onSelect(['KEY1', 'KEY6']))
  await page.locator('[data-key-field="width"][placeholder="混合"]').waitFor()
  const initial = [await snapshot(page, 'KEY1'), await snapshot(page)]
  const expectDelta = async (index, delta, undoCount) => {
    for (const [i, key] of ['KEY1', 'KEY6'].entries()) {
      const rect = initial[i].view.split(',').map(Number)
      rect[index] += delta
      assert.deepEqual(await snapshot(page, key), { ...initial[i], view: rect.join(','), undo: undoCount })
    }
  }
  await mixedWidth.press('+')
  await expectDelta(2, 1, 1)
  assert.equal(await mixedWidth.inputValue(), '', 'relative edits keep widths mixed')
  await mixedWidth.press('-')
  await expectDelta(2, 0, 2)
  await undo(page)
  await undo(page)

  assert.equal(await mixedHeight.getAttribute('placeholder'), '混合')
  await mixedHeight.click()
  for (const [wheel, delta] of [[-100, 1], [-100, 2], [100, 1]]) {
    await page.mouse.wheel(0, wheel)
    await page.waitForFunction(async expectedHeight => {
      const { appState } = await import('/src/app/state.ts')
      return Number(appState.layoutDocument.get('KEY6', 'VIEW_RECT').split(',')[3]) === expectedHeight
    }, Number(initial[1].view.split(',')[3]) + delta)
    await expectDelta(3, delta, 1)
  }
  await undo(page)
  await expectDelta(3, 0, 0)

  const mixedX = display.locator('[data-key-field="x"]')
  await mixedX.press('+')
  for (const [i, key] of ['KEY1', 'KEY6'].entries()) {
    const shiftX = value => value?.replace(/^[^,]+/, x => String(Number(x) + 1))
    assert.deepEqual(await snapshot(page, key), { view: shiftX(initial[i].view), touch: shiftX(initial[i].touch), undo: 1 })
  }
  await undo(page)

  await mixedWidth.fill('200')
  for (const key of ['KEY1', 'KEY6']) assert.equal((await snapshot(page, key)).view.split(',')[2], '200')
  await undo(page)
  assert.deepEqual(errors, [])
  console.log('混合几何：加减键、连续滚轮、统一设值与撤销通过')
} finally {
  await browser.close()
  await server.close()
}
