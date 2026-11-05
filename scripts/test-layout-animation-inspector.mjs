import assert from 'node:assert/strict'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const files = unzipSync(bdsFixture())
const LAYOUT = 'light/skin/port/py_26.ini'
const skin = zipSync({ ...files,
  'light/port/py_26.ini': strToU8(strFromU8(files['light/port/py_26.ini'])
    .replace('CENTER=q', 'CENTER=q\nANIM_STYLE=7\nBACK_ANIM_STYLE=7\nFORE_ANIM_STYLE=,7,0,7,\nPRESS_STYLE=8')),
  'light/res/default.css': strToU8(strFromU8(files['light/res/default.css']) + '\n[STYLE7]\nPRESS_ANIM=1\n[STYLE8]\nPRESS_ANIM=2\n'),
  'light/res/anim.ini': strToU8('[ANIM1]\nTYPE=4\nDURATION=600\nFROM=100,100\nTO=80,80\n[ANIM2]\nCATEGORY=3\nPARTICLE_IMAGE=2\nTOTAL_NUMBER=3\nBIRTH_RATE=5\nLIFE=1000,1500\nDURATION=300\n'),
})
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41868, strictPort: false, host: '127.0.0.1', hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const selectKey = async (sections = ['KEY1']) => page.evaluate(async ({ path, sections }) => {
  const { selectFile } = await import('/src/app/navigation.ts')
  const { appState } = await import('/src/app/state.ts')
  const { populateKeyInspector } = await import('/src/app/key-inspector.ts')
  selectFile(path)
  appState.selectedKeySections = sections
  populateKeyInspector()
}, { path: LAYOUT, sections })
const group = () => page.locator('.key-animation-fields')
const row = key => group().locator('label').filter({ has: page.locator(`input[data-key-field="${key}"]`) })
const text = () => page.evaluate(async path => (await import('/src/app/state.ts')).appState.archive.getText(path), LAYOUT)
const history = () => page.evaluate(async () => (await import('/src/app/state.ts')).appState.undoStack.length)
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'layout-animation.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(skin) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await selectKey()
  await group().waitFor()
  assert.equal(await group().locator(':scope > .inspector-grid > label').count(), 4)
  assert.deepEqual(await row('FORE_ANIM_STYLE').locator('.ui-style-ref-number').evaluateAll(inputs => inputs.map(input => input.value)), ['', '7', '0', '7', ''])
  assert.equal(await group().locator('.ui-style-state[data-state="pressed"]').count(), 0, '动画不是正常/按下图片对')
  const before = await text(), undo = await history()
  const card = row('BACK_ANIM_STYLE').getByRole('button', { name: /动画 1/ })
  await card.scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.querySelector('.key-animation-fields [data-key-field="BACK_ANIM_STYLE"]')?.value === '7')
  await card.click()
  const picker = page.frameLocator('#picker-frame')
  await picker.locator('[data-library-kind="anim"][aria-pressed="true"]').waitFor()
  // Esc 分层：先关预览栏，再关选择器。
  while (await page.locator('#picker-dialog[open]').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
  }
  await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
  assert.equal(await text(), before, '打开样式选择器不写布局')
  assert.equal(await history(), undo, '预览和选择器不进入撤销栈')
  await card.click({ modifiers: ['Control'] })
  await page.waitForFunction(async () => {
    const { appState } = await import('/src/app/state.ts')
    return appState.animationDesignMode === 'motion' && appState.selectedAnimations[`${appState.selectedPath}|motion`] === 'ANIM1'
  })
  await selectKey()
  await row('PRESS_STYLE').getByRole('button', { name: /动画 2/ }).click({ modifiers: ['Control'] })
  await page.waitForFunction(async () => {
    const { appState } = await import('/src/app/state.ts')
    return appState.animationDesignMode === 'particle' && appState.selectedAnimations[`${appState.selectedPath}|particle`] === 'ANIM2'
  })
  await selectKey()
  const slot = () => row('FORE_ANIM_STYLE').getByRole('textbox', { name: '前景 2 动画样式编号', exact: true })
  await slot().fill('8'); await slot().press('Tab')
  assert.match(await text(), /FORE_ANIM_STYLE=,8,0,7,/)
  await slot().fill(''); await slot().press('Tab')
  assert.match(await text(), /FORE_ANIM_STYLE=,,0,7,/)
  assert.equal(await row('FORE_ANIM_STYLE').locator('.ui-style-ref').count(), 5, '清空不移动后续槽位')
  await row('ANIM_STYLE').locator('.ui-style-ref-number').fill('999')
  await row('ANIM_STYLE').locator('.ui-style-ref-number').press('Tab')
  assert.equal(await row('ANIM_STYLE').getByRole('button', { name: /缺失|未设置/ }).count(), 1)
  await selectKey(['KEY1', 'KEY2'])
  await page.waitForFunction(() => document.querySelector('.key-animation-fields [data-key-field="BACK_ANIM_STYLE"].ui-style-ref-number')?.value === '')
  assert.equal(await row('BACK_ANIM_STYLE').locator('.ui-style-ref-number').inputValue(), '')
  assert.equal(await row('BACK_ANIM_STYLE').locator('.ui-style-ref-number').getAttribute('placeholder'), '混合')
  await selectKey([])
  const beforePanel = await text(), panelUndo = await history()
  const panel = page.locator('#document-fields [data-inspector-group-label="动画"]')
  await panel.waitFor()
  assert.equal(await panel.locator('[data-document-key="ANIM_STYLE"]').count(), 1)
  assert.equal(await panel.locator('.ui-style-ref-number').inputValue(), '')
  assert.equal(await text(), beforePanel, '显示缺省选项不写入布局')
  assert.equal(await history(), panelUndo, '显示缺省选项不进入撤销栈')
  await panel.locator('.ui-style-ref-number').fill('7')
  await panel.locator('.ui-style-ref-number').press('Tab')
  assert.match(await text(), /\[PANEL\][^\[]*ANIM_STYLE=7/)
  assert.equal(await history(), panelUndo + 1, '设置面板动画进入撤销栈')
  await panel.getByRole('button', { name: /动画 1/ }).click({ modifiers: ['Control'] })
  await page.waitForFunction(async () => (await import('/src/app/state.ts')).appState.animationDesignMode === 'motion')
  await selectKey()
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme })
    for (const width of [1440, 900]) {
      await page.setViewportSize({ width, height: 1000 })
      await group().scrollIntoViewIfNeeded()
      assert.equal(await group().locator('.ui-style-ref').evaluateAll(cards => cards.some(card => card.scrollWidth > card.clientWidth + 1)), false, `${colorScheme}/${width} 卡片无横向溢出`)
      assert.equal(await group().locator('.ui-style-ref .ui-style-state > button').count(), 0, '循环预览无需独立播放键')
      assert.ok(await group().locator('.ui-animation-stage').evaluateAll(stages => stages.every(stage => {
        const bounds = stage.getBoundingClientRect(), canvas = stage.querySelector('canvas').getBoundingClientRect()
        return canvas.top >= bounds.top - 1 && canvas.bottom <= bounds.bottom + 1 && canvas.left >= bounds.left - 1 && canvas.right <= bounds.right + 1
      })), '预览画布完整位于舞台内')
      // 只在指定了截图目录时留图供人工比对，否则会在仓库里建出名为 undefined 的目录。
      if (process.env.PI_SCRATCH_DIR) await group().screenshot({ path: `${process.env.PI_SCRATCH_DIR}/layout-animation-${colorScheme}-${width}.png` })
    }
  }
  assert.deepEqual(errors, [])
  console.log('layout animation inspector: auto-loop, style picker with animation filter, Ctrl motion/particle navigation, sparse slots, missing references, multi-select and unclipped light/dark responsive layout passed')
} finally {
  await browser.close()
  await server.close()
}
