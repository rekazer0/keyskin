import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const archive = SkinArchive.open(bdsFixture())
const nine = 'light/skin/port/py_9.ini'
const full = 'light/skin/port/py_26.ini'
archive.setText(nine, '[PANEL]\nSIZE=1080,600\n[KEY15]\nVIEW_RECT=350,450,370,140\nCENTER=F38\nUP=F3\n')
archive.setText(full, '[PANEL]\nSIZE=1080,600\n[KEY1]\nVIEW_RECT=350,450,370,140\nCENTER=F3\n')

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const keyPoint = section => page.evaluate(async section => {
  const { preview } = await import('/src/app/canvas-interaction.ts')
  await preview.whenDrawn()
  const { rect } = preview.keys.find(key => key.section === section)
  const box = preview.canvas.getBoundingClientRect()
  return {
    x: box.left + (rect.x + rect.width / 2) / preview.panelWidth * box.width,
    y: box.top + (rect.y + rect.height / 2) / preview.surfaceHeight * box.height,
  }
}, section)
const snapshot = () => page.evaluate(async paths => {
  const { appState } = await import('/src/app/state.ts')
  return { undo: appState.undoStack.length, boards: paths.map(path => appState.archive.getText(path)) }
}, [nine, full])
const checkSwitch = async (path, event, section) => {
  assert.equal(await page.locator('#event-log').textContent(), `${event} → 已切换预览到 ${path.split('/').pop()}`)
  assert.equal(await page.locator(`[data-path="${path}"][aria-current="true"]`).count(), 1)
  await keyPoint(section)
}

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'F3.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(archive.toBytes('bds')) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled && (!document.querySelector('#file-operation-dialog').open || !document.querySelector('#file-operation-close').disabled))
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.count()) await close.click()
  const mode = name => page.getByRole('button', { name, exact: true })
  if (await page.locator('#mode').inputValue() !== 'edit') await mode('编辑模式').click()
  await page.getByRole('button', { name: '拼音 9 键', exact: false }).click()
  const p = await keyPoint('KEY15')
  await page.mouse.click(p.x, p.y)
  const before = await snapshot()
  const gesture = page.locator('#quick-inspector .inspector-gesture[data-gesture="UP"]')
  assert.match(await gesture.textContent(), /切换 9 键 \/ 26 键/)
  await gesture.getByRole('button').click()
  const picker = page.getByRole('dialog', { name: '选择动作码' })
  await picker.getByRole('searchbox').fill('26 键')
  assert.equal(await picker.getByRole('option').textContent(), 'F3 · 切换 9 键 / 26 键')
  await picker.getByRole('button', { name: '取消', exact: true }).click()
  await picker.waitFor({ state: 'detached' })

  await mode('交互预览').click()
  const start = await keyPoint('KEY15')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x, start.y - 42, { steps: 4 })
  await page.mouse.up()
  await checkSwitch(full, 'KEY15 · UP · F3', 'KEY1')
  const end = await keyPoint('KEY1')
  await page.mouse.click(end.x, end.y)
  await checkSwitch(nine, 'KEY1 · CENTER · F3', 'KEY15')
  assert.deepEqual(await snapshot(), before, 'preview switching does not modify source or undo history')
  assert.deepEqual(errors, [])
  console.log('F3: shared description, 9→26 swipe, 26→9 tap, and read-only preview passed')
} finally {
  await browser.close()
  await server.close()
}
