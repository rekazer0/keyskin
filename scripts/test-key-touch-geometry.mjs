import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const output = mkdtempSync(join(tmpdir(), 'keyskin-touch-'))
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
const point = (page, x, y) => page.evaluate(async ({ x, y }) => {
  const { preview } = await import('/src/app/canvas-interaction.ts')
  await preview.rendered()
  const rect = preview.canvas.getBoundingClientRect(), size = preview.logicalSize()
  return [rect.x + x / size.width * rect.width, rect.y + y / size.height * rect.height]
}, { x, y })
const snapshot = (page, section = 'KEY6') => page.evaluate(async section => {
  const { appState } = await import('/src/app/state.ts')
  return { view: appState.layoutDocument.get(section, 'VIEW_RECT'), touch: appState.layoutDocument.get(section, 'TOUCH_RECT'), undo: appState.undoStack.length }
}, section)
const undo = page => page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
const strokes = page => page.evaluate(async () => {
  const { preview } = await import('/src/app/canvas-interaction.ts')
  const context = preview.canvas.getContext('2d')
  const stroke = context.strokeRect
  const output = []
  context.strokeRect = function (...rect) {
    output.push({ rect, dash: this.getLineDash(), width: this.lineWidth, color: this.strokeStyle })
    return stroke.apply(this, rect)
  }
  try { await preview.rendered(); await preview.render(); return output }
  finally { context.strokeRect = stroke }
})
const hasRect = (draw, rect, dashed, width) => draw.some(line => JSON.stringify(line.rect) === JSON.stringify(rect) && Boolean(line.dash.length) === dashed && line.width === width)

try {
  const page = await open(fileURLToPath(new URL('../public/templates/oppo-dual-color.bds', import.meta.url)))
  const touch = page.locator('[data-key-touch]')
  const display = page.locator('.key-layout-fields')
  const follow = touch.getByRole('switch', { name: '跟随显示区域' })
  const width = touch.getByRole('spinbutton', { name: '触控区域尺寸W', exact: true })
  // The template's unconfigured KEY1 is a full-panel key, not a canvas click target.
  await page.evaluate(async () => (await import('/src/app/canvas-interaction.ts')).preview.onSelect(['KEY1']))
  assert.equal(await follow.isChecked(), true, 'an unconfigured key follows by default')
  assert.equal(await width.count(), 0)
  assert.deepEqual(await snapshot(page, 'KEY1'), { view: '0,0,1080,573', touch: undefined, undo: 0 })
  await page.mouse.click(...await point(page, 765, 205))
  await follow.and(page.locator('input:not(:checked)')).waitFor({ timeout: 5000 })
  assert.equal(await touch.locator('.ui-geometry-preview').count(), 0)
  assert.equal(await touch.getByRole('button').count(), 0)
  const before = await snapshot(page)
  assert.deepEqual(before, { view: '662,143,227,133', touch: '658,140,235,139', undo: 0 })
  const displayStroke = [664, 145, 223, 129], touchStroke = [660, 142, 231, 135]
  let draw = await strokes(page)
  assert.ok(hasRect(draw, displayStroke, false, 4) && hasRect(draw, touchStroke, true, 2), `both configured regions are drawn, display selected: ${JSON.stringify(draw)}`)
  assert.notEqual(draw.find(line => line.width === 4).color, draw.find(line => line.dash.length).color)
  assert.equal(await width.inputValue(), '235')
  await page.mouse.move(1088, 140)
  await page.screenshot({ path: join(output, 'oppo-display.png') })
  await width.fill('245')
  await width.blur()
  assert.deepEqual(await snapshot(page), { ...before, touch: '658,140,245,139', undo: 1 })
  await undo(page)
  assert.deepEqual(await snapshot(page), before)
  await display.locator(':scope > .ui-geometry-preview [data-corner="se"]').press('ArrowRight')
  assert.deepEqual(await snapshot(page), { ...before, view: '662,143,228,133', undo: 1 })
  await undo(page)
  await page.getByRole('button', { name: '拖动按键', exact: true }).click()
  const start = await point(page, 765, 205), end = await point(page, 805, 205)
  await page.mouse.move(...start)
  await page.mouse.down()
  await page.mouse.move(...end, { steps: 4 })
  await page.mouse.up()
  const moved = await snapshot(page)
  const dx = Number(moved.view.split(',')[0]) - 662
  assert.ok(dx > 0)
  assert.equal(moved.touch, `${658 + dx},140,235,139`)
  assert.equal(moved.undo, 1, 'whole-key drag saves both rectangles in one undo step')
  await undo(page)
  assert.deepEqual(await snapshot(page), before)
  await follow.press('Space')
  assert.equal(await follow.isChecked(), true)
  assert.equal(await width.count(), 0)
  assert.ok(await follow.evaluate(node => node === document.activeElement), 'the switch keeps keyboard focus')
  assert.deepEqual(await snapshot(page), { ...before, touch: undefined, undo: 1 })
  assert.ok(!(await strokes(page)).some(line => line.dash.length), 'following hides the independent guide')
  await page.screenshot({ path: join(output, 'oppo-follow.png') })
  await undo(page)
  assert.equal(await follow.isChecked(), false)
  assert.equal(await width.inputValue(), '235')
  assert.deepEqual(await snapshot(page), before, 'undo restores the original rectangle')
  await follow.click()
  await follow.click()
  assert.equal(await follow.isChecked(), false)
  assert.equal(await width.inputValue(), '227')
  assert.deepEqual(await snapshot(page), { ...before, touch: before.view, undo: 2 })
  draw = await strokes(page)
  assert.ok(hasRect(draw, displayStroke, false, 4) && hasRect(draw, [668, 149, 215, 121], true, 2), 'equal rectangles remain distinguishable')
  await page.getByRole('button', { name: /重置本次修改/ }).click()
  assert.equal((await snapshot(page)).touch, before.touch, 'reset restores the original independent geometry')
  await page.setViewportSize({ width: 390, height: 844 })
  await follow.click()
  assert.equal(await width.count(), 0)
  await follow.click()
  const mobileWidth = touch.getByRole('slider', { name: '触控区域尺寸W滑块', exact: true })
  assert.equal(await mobileWidth.inputValue(), '227')
  await mobileWidth.press('ArrowRight')
  assert.equal((await snapshot(page)).touch, '662,143,228,133')
  assert.ok(await touch.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'touch fields fit a narrow viewport')
  await follow.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await page.screenshot({ path: join(output, 'oppo-mobile.png') })
  await page.close()

  if (process.env.TOUCH_SKIN) {
    const sample = await open(process.env.TOUCH_SKIN)
    await sample.mouse.click(...await point(sample, 530, 225))
    await sample.getByText('触控区域（虚线）', { exact: true }).waitFor()
    assert.equal((await snapshot(sample, 'KEY5')).touch, '416,148,247,149')
    await sample.screenshot({ path: join(output, 'mok-key5.png') })
    await sample.mouse.move(...await point(sample, 490, 345))
    await sample.mouse.down()
    await sample.mouse.move(...await point(sample, 575, 380), { steps: 5 })
    await sample.mouse.up()
    assert.deepEqual(await sample.evaluate(async () => (await import('/src/app/state.ts')).appState.selectedKeySections), ['KEY8'], 'marquee ignores JKL artwork extending into TUV')
    await sample.close()
  }
  assert.deepEqual(errors, [])
  console.log(`触控几何通过；截图：${output}`)
} finally {
  await browser.close()
  await server.close()
}
