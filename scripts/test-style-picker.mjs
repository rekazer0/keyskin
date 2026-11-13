import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { SkinArchive } from '../src/skin.ts'
import { buildSxiZip } from '../src/palm/palm-export.ts'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41982, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const errors = []
const picker = page => page.frameLocator('#picker-frame')
const referenceInput = format => format === 'sxi' ? '#document-fields input[data-document-style-key="BACK_STYLE"]' : '#quick-inspector input[data-key-field="BACK_STYLE"]'
async function open(page, name, buffer) {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(buffer) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
}
async function chooseImage(page, toStyle) {
  const library = picker(page)
  await library.locator('[data-library-mode="images"]').click()
  await library.locator('.ui-image-card[data-path$="/bg.png"]').click()
  assert.equal(await library.locator('#style-library-apply-to-style').isVisible(), true)
  await library.locator(toStyle ? '#style-library-apply-to-style' : '#style-library-apply').click()
  await library.locator('#picker-canvas').click({ position: { x: 1, y: 1 } })
}
async function selectKey(page, format) {
  await page.evaluate(async format => {
    const { selectFile } = await import('/src/app/navigation.ts')
    const { appState } = await import('/src/app/state.ts')
    const { populateKeyInspector } = await import('/src/app/key-inspector.ts')
    if (format === 'sxi') selectFile('skin.json/default/port_layout/b/full26Pinyin', 'overview')
    else selectFile('light/skin/port/py_26.ini', 'overview')
    appState.selectedKeySections = ['KEY1']
    populateKeyInspector()
  }, format)
}
async function snapshot(page, format) {
  return page.evaluate(async format => {
    const { appState } = await import('/src/app/state.ts')
    const { styleConfigPath } = await import('/src/app/config-context.ts')
    const { palmStyle } = await import('/src/app/sxi-styles.ts')
    const id = document.querySelector(format === 'sxi' ? '#document-fields input[data-document-style-key="BACK_STYLE"]' : '#quick-inspector input[data-key-field="BACK_STYLE"]').value
    const styles = (await import('/src/app/style-picker.ts')).styleConfigDocument()
    return { id, undo: appState.undoStack.length,
      text: appState.archive.getText(format === 'sxi' ? 'skin.json' : styleConfigPath()),
      image: format === 'sxi' ? palmStyle(id)?.s_2 : { normal: styles.get(`STYLE${id}`, 'NM_IMG'), hl: styles.get(`STYLE${id}`, 'HL_IMG') } }
  }, format)
}
try {
  for (const format of ['bds', 'sxi']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('pageerror', error => errors.push(error.message))
    const bytes = format === 'sxi' ? buildSxiZip(SkinArchive.open(bdsFixture())).bytes : bdsFixture()
    await open(page, `picker.${format}`, bytes)
    await selectKey(page, format)
    const before = await snapshot(page, format)
    const background = page.locator(referenceInput(format)).locator('..')
    await background.locator('.ui-style-remove').click()
    assert.equal((await snapshot(page, format)).id, '', '移除背景样式清空引用')
    assert.equal(await page.locator('#picker-dialog').isVisible(), false, '移除后不误触图片或添加入口')
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    assert.equal((await snapshot(page, format)).id, before.id, '移除可以撤销')
    const pressed = () => page.locator(referenceInput(format)).locator('..').locator('.ui-style-state[data-state="pressed"]')
    await pressed().click()
    await chooseImage(page, false)
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
    const after = await snapshot(page, format)
    assert.notEqual(after.id, before.id, '应用新建样式并替换当前引用')
    assert.equal(after.undo, before.undo + 1, '新建和替换引用只记一步撤销')
    assert.equal(after.image.normal, before.image.normal, '保留正常图')
    assert.equal(after.image.hl, 'bg,0', '只替换进入时点击的按下图')
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    assert.equal((await snapshot(page, format)).text, before.text, '撤销同时删除新样式')
    assert.equal((await snapshot(page, format)).id, before.id)
    await pressed().click()
    await chooseImage(page, true)
    const edited = await snapshot(page, format)
    assert.equal(edited.id, before.id, '应用至样式保留引用')
    assert.equal(edited.image.normal, before.image.normal)
    assert.equal(edited.image.hl, 'bg,0')
    await picker(page).locator('#picker-close').click()
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    assert.equal((await snapshot(page, format)).text, before.text)
    console.log(`${format}: new style / edit style, pressed image and single-step undo passed`)
    const foreground = () => page.evaluate(() => {
      return document.querySelector('#quick-inspector input[data-key-field="FORE_STYLE"]').value.split(',')
    })
    const beforeLayers = await foreground()
    const field = page.locator('.ui-style-ref-list').filter({ has: page.locator(':scope > input[data-key-field="FORE_STYLE"]') })
    await field.locator(':scope > .ui-style-ref').nth(1).locator('.ui-style-state[data-state="pressed"]').click()
    await chooseImage(page, false)
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
    const afterLayers = await foreground()
    assert.equal(afterLayers.length, beforeLayers.length)
    assert.equal(afterLayers[0], beforeLayers[0], '其他前景层保持原引用')
    assert.notEqual(afterLayers[1], beforeLayers[1], '仅替换点击的前景层')
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    assert.deepEqual(await foreground(), beforeLayers)
    console.log(`${format}: foreground layer selection and undo passed`)
    await page.close()
  }
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('pageerror', error => errors.push(error.message))
    await open(page, 'picker.bda', readFileSync(new URL('../public/default-template.bda', import.meta.url)))
    const selectBdaKey = () => page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      const { populateKeyInspector } = await import('/src/app/key-inspector.ts')
      const { bdaPanelKeyName } = await import('/src/bda.ts')
      const { selectFile } = await import('/src/app/navigation.ts')
      selectFile('light/skin/port/py_9.ini', 'overview')
      appState.selectedKeySections = [appState.layoutDocument.sections().find(section => ['CENTER', 'DOWN'].some(field => bdaPanelKeyName(appState.layoutDocument.get(section, field) ?? '') === 'KEY_Q'))]
      if (!appState.selectedKeySections[0]) throw new Error('Missing BDA KEY_Q')
      populateKeyInspector()
    })
    const bdaSnapshot = () => page.evaluate(async () => {
      const { currentBdaAppearance } = await import('/src/app/bda-documents.ts')
      const { appState } = await import('/src/app/state.ts')
      const info = currentBdaAppearance()
      const ref = info.appearance.panels.get('py_9').keys.get('KEY_Q').backStyle
      return { ref, style: info.appearance.imageStyles.get(ref.key), undo: appState.undoStack.length,
        count: info.appearance.imageStyles.size, bytes: Array.from(info.bytes) }
    })
    for (const state of ['normal', 'pressed']) for (const toStyle of [false, true]) {
      await selectBdaKey()
      const before = await bdaSnapshot()
      await page.locator(`[data-bda-style-path="keys.KEY_Q.backStyle"] .ui-style-state[data-state="${state}"]`).click()
      const library = picker(page)
      await library.locator('[data-library-mode="images"]').click()
      const image = library.locator('.ui-image-card').first()
      const path = await image.getAttribute('data-path')
      await image.click()
      await library.locator(toStyle ? '#style-library-apply-to-style' : '#style-library-apply').click()
      await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
      const after = await bdaSnapshot()
      assert.equal(after.undo, before.undo + 1)
      assert.equal(after.count, before.count + (toStyle ? 0 : 1))
      if (toStyle) assert.deepEqual(after.ref, before.ref)
      else assert.notDeepEqual(after.ref, before.ref)
      const changed = state === 'pressed' ? 'highlightImage' : 'normalImage'
      const preserved = state === 'pressed' ? 'normalImage' : 'highlightImage'
      assert.equal(after.style[changed].resource.resourceID, path.split('/').pop().replace(/\.png$/i, ''))
      assert.deepEqual(after.style[preserved], before.style[preserved])
      await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
      assert.deepEqual((await bdaSnapshot()).bytes, before.bytes)
    }
    console.log('bda: normal / pressed, new style / edit style and single-step undo passed')
    await page.close()
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  const files = unzipSync(bdsFixture())
  files['light/res/default.css'] = strToU8(strFromU8(files['light/res/default.css']) + '\n' + Array.from({ length: 1200 }, (_, index) => {
    files[`light/res/many${index}.png`] = files['light/res/btn.png']
    files[`light/res/many${index}.til`] = files['light/res/btn.til']
    return `[STYLE${1000 + index}]\nNM_IMG=many${index},0\nHL_IMG=many${index},1`
  }).join('\n'))
  await open(page, 'large.bds', zipSync(files))
  const start = Date.now()
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { visualResolver } = await import('/src/app/bda-documents.ts')
    const { openStylePicker } = await import('/src/app/style-picker.ts')
    const resolver = visualResolver()
    const resolve = resolver.resolve.bind(resolver)
    window.previewResolves = 0
    resolver.resolve = (...args) => { window.previewResolves++; return resolve(...args) }
    window.libraryMessages = []
    addEventListener('message', event => {
      if (event.data?.pickerEvent === 'style-library-preview-request') window.libraryMessages.push(event.data.payload.styleID)
    })
    const target = document.createElement('input')
    target.dataset.keyField = 'BACK_STYLE'
    target.value = '1000'
    openStylePicker(target)
  })
  await picker(page).locator('.ui-style-card[data-style-id="1000"][aria-selected="true"]').waitFor()
  await picker(page).locator('#style-library-preview-image canvas').first().evaluate(async canvas => {
    while (!canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value)) await new Promise(resolve => requestAnimationFrame(resolve))
  })
  const elapsed = Date.now() - start
  const initial = await page.evaluate(() => ({ resolves: window.previewResolves, requests: window.libraryMessages.length }))
  assert.ok(initial.resolves < 100, `首屏不解析全部样式：${initial.resolves}`)
  // 网格只渲染可见的行：滚到底部，最后一个样式才会出现。
  await picker(page).locator('#style-library-scroll').evaluate(scroll => { scroll.scrollTop = scroll.scrollHeight })
  await picker(page).locator('.ui-style-card[data-style-id="2199"]').click()
  await page.waitForFunction(() => window.libraryMessages.includes('2199'))
  const requests = await page.evaluate(() => window.libraryMessages)
  assert.equal(new Set(requests).size, requests.length, '列表和选中预览共用请求，滚动不重复获取')
  assert.ok(requests.length < 120, `滚动跳过的卡片不请求预览：${requests.length}`)
  const frames = await picker(page).locator('#style-library-scroll').evaluate(async grid => {
    grid.scrollTop = 0
    await new Promise(resolve => requestAnimationFrame(resolve))
    const delays = []
    let previous = performance.now()
    for (let frame = 0; frame < 60; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve))
      const now = performance.now()
      delays.push(now - previous)
      previous = now
      grid.scrollTop += 50
    }
    return { max: Math.max(...delays), p95: delays.sort((a, b) => a - b)[Math.floor(delays.length * .95)] }
  })
  assert.ok(frames.max < 250, `滚动不产生长时间停顿：${frames.max}ms`)
  assert.ok(await picker(page).locator('#style-library-grid > .ui-style-card').count() < 200, '大列表只渲染可见的几行')
  // 皮肤没改时再次打开复用主页面的样式列表与预览缓存，不重新解析已看过的样式。
  await picker(page).locator('#picker-close').click()
  await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
  const resolvedBefore = await page.evaluate(() => window.previewResolves)
  await page.evaluate(async () => {
    const target = document.createElement('input')
    target.dataset.keyField = 'BACK_STYLE'
    target.value = '1000'
    ;(await import('/src/app/style-picker.ts')).openStylePicker(target)
  })
  await picker(page).locator('.ui-style-card[data-style-id="1000"][aria-selected="true"] canvas').first().waitFor()
  await picker(page).locator('#style-library-preview-image canvas').first().evaluate(async canvas => {
    while (!canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value)) await new Promise(resolve => requestAnimationFrame(resolve))
  })
  assert.equal(await page.evaluate(() => window.previewResolves), resolvedBefore, '再次打开复用预览缓存')
  console.log(`scroll frames: p95 ${frames.p95.toFixed(1)}ms, max ${frames.max.toFixed(1)}ms`)
  console.log(`1200 image styles: first preview ${elapsed}ms, initial resolves ${initial.resolves}, after scroll ${requests.length} unique preview requests`)
  await page.close()
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
}
