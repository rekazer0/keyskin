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
async function chooseImage(page, toStyle, name = 'bg') {
  const library = picker(page)
  await library.locator('[data-library-mode="images"]').click()
  await library.locator(`.ui-image-card[data-path$="/${name}.png"]`).click()
  assert.equal(await library.locator('#style-library-apply-to-style').isVisible(), true)
  await library.locator(toStyle ? '#style-library-apply-to-style' : '#style-library-apply').click()
  await library.locator('#picker-canvas').click({ position: { x: 1, y: 1 } })
  await library.locator('#picker-apply').click()
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
async function checkMediaReferences(page, format) {
  const row = key => page.locator(`.ui-style-ref-list:visible`).filter({ has: page.locator(`:scope > input[data-document-style-key="${key}"]`) })
  const animation = row('ANIM_STYLE')
  const sound = row('SOUND_STYLE')
  const current = () => page.evaluate(async format => {
    const { appState } = await import('/src/app/state.ts')
    const { styleConfigDocument, styleSoundFile } = await import('/src/app/style-picker.ts')
    const { palmStyle } = await import('/src/app/sxi-styles.ts')
    return {
      animation: format === 'sxi' ? String(Object.values(palmStyle('7').s_5)[0]) : styleConfigDocument().get('STYLE7', 'PRESS_ANIM'),
      sound: styleSoundFile('8'), undo: appState.undoStack.length,
    }
  }, format)
  const before = await current()
  await animation.locator('.ui-style-ref-action').click()
  await picker(page).locator('.ui-style-card[data-style-id="7"][aria-selected="true"]').waitFor()
  await picker(page).locator('#picker-close').click()
  await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
  await animation.locator('.ui-style-state').click()
  const animationPicker = page.getByRole('dialog', { name: '选择动画', exact: true })
  await animationPicker.locator('[data-value="2"]').click()
  await animationPicker.getByRole('button', { name: '应用', exact: true }).click()
  await animationPicker.waitFor({ state: 'hidden' })
  assert.equal(await animation.locator(':scope > input').inputValue(), '7')
  await sound.locator('.ui-style-state').click({ position: { x: 4, y: 4 } })
  const soundPicker = page.getByRole('dialog', { name: '选择音效', exact: true })
  await soundPicker.getByRole('option', { name: 'b.wav', exact: true }).click()
  await soundPicker.getByRole('button', { name: '应用', exact: true }).click()
  await soundPicker.waitFor({ state: 'hidden' })
  assert.equal(await sound.locator(':scope > input').inputValue(), '8')
  assert.deepEqual(await current(), { animation: '2', sound: 'b.wav', undo: before.undo + 2 })
  for (let index = 0; index < 2; index++) await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
  assert.deepEqual(await current(), before)
  console.log(`${format}: animation style selector, independent animation/sound replacement and undo passed`)
}
try {
  for (const format of ['bdi', 'bds', 'sxi']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('pageerror', error => errors.push(error.message))
    const files = unzipSync(bdsFixture())
    const add = (path, text) => { files[path] = strToU8(strFromU8(files[path]) + text) }
    files['light/port/py_26.ini'] = strToU8(strFromU8(files['light/port/py_26.ini']).replace('[KEY1]', '[KEY1]\nANIM_STYLE=7\nSOUND_STYLE=8'))
    add('light/res/default.css', '\n[STYLE7]\nPRESS_ANIM=1\n[STYLE8]\nPRESS_SOUND_PATH=a.wav\n')
    add('light/res/anim.ini', '\n[ANIM2]\nCATEGORY=0\nTYPE=1\nDURATION=300\nFROM=0\nTO=1\n')
    for (const name of ['a.wav', 'b.wav']) files[`light/res/${name}`] = new Uint8Array(44)
    const bds = zipSync(files)
    const bytes = format === 'sxi' ? buildSxiZip(SkinArchive.open(bds)).bytes
      : format === 'bdi' ? SkinArchive.open(bds).toBytes('bdi') : bds
    await open(page, `picker.${format}`, bytes)
    await selectKey(page, format)
    await checkMediaReferences(page, format)
    const before = await snapshot(page, format)
    const background = page.locator(referenceInput(format)).locator('..')
    await background.locator('.ui-style-remove').click()
    assert.equal((await snapshot(page, format)).id, '', '移除背景样式清空引用')
    assert.equal(await page.locator('#picker-dialog').isVisible(), false, '移除后不误触图片或添加入口')
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    assert.equal((await snapshot(page, format)).id, before.id, '移除可以撤销')
    const pressed = () => page.locator(referenceInput(format)).locator('..').locator('.ui-style-state[data-state="pressed"]')
    const changeStyle = background.locator('.ui-style-ref-action')
    await changeStyle.hover({ position: { x: 4, y: 4 } })
    assert.equal(await changeStyle.evaluate(button => button.matches(':hover')), true, '左侧悬停命中更换样式区')
    await pressed().hover()
    assert.equal(await pressed().evaluate(state => getComputedStyle(state).cursor), 'pointer')
    assert.equal(await changeStyle.evaluate(button => button.matches(':hover')), false, '预览悬停不高亮引用')
    await changeStyle.press('Enter')
    await picker(page).locator(`.ui-style-card[data-style-id="${before.id}"][aria-selected="true"]`).waitFor()
    await chooseImage(page, false)
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
    const after = await snapshot(page, format)
    assert.notEqual(after.id, before.id, '应用新建样式并替换当前引用')
    assert.equal(after.undo, before.undo + 1, '新建和替换引用只记一步撤销')
    assert.equal(after.image.normal, 'bg,0', '样式选择器默认编辑正常图')
    assert.equal(after.image.hl, before.image.hl, '保留按下图')
    await changeStyle.click()
    await picker(page).getByRole('button', { name: '最近使用', exact: true }).click()
    assert.equal(await picker(page).locator(`.ui-style-card[data-style-id="${after.id}"]`).count(), 1, '最近使用保留刚应用的样式')
    await picker(page).locator('#picker-close').click()
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    assert.equal((await snapshot(page, format)).text, before.text, '撤销同时删除新样式')
    assert.equal((await snapshot(page, format)).id, before.id)
    await pressed().click()
    await picker(page).locator('#picker-title').getByText('全部图片', { exact: true }).waitFor()
    await picker(page).locator('.ui-image-card[data-path$="/bg.png"]').click()
    await picker(page).locator('#picker-canvas').click({ position: { x: 1, y: 1 } })
    await picker(page).locator('#picker-apply').click()
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
    await field.locator(':scope > .ui-style-ref').nth(1).locator('.ui-style-ref-action').click()
    await chooseImage(page, false)
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
    const afterLayers = await foreground()
    assert.equal(afterLayers.length, beforeLayers.length)
    assert.equal(afterLayers[0], beforeLayers[0], '其他前景层保持原引用')
    assert.notEqual(afterLayers[1], beforeLayers[1], '仅替换点击的前景层')
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    assert.deepEqual(await foreground(), beforeLayers)
    console.log(`${format}: foreground layer selection and undo passed`)
    const imageSlices = () => page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      const { palmTileSlices } = await import('/src/palm/palm-style-edit.ts')
      const { openPalmSkin } = await import('/src/app/sxi-documents.ts')
      const { IniDocument } = await import('/src/ini.ts')
      const { tileSlices } = await import('/src/tiles.ts')
      const path = 'light/skin/res/unsliced.til'
      const text = appState.archive.isText(path) ? appState.archive.getText(path) : null
      return { text, slices: appState.archive.format === 'sxi'
        ? palmTileSlices(openPalmSkin(), 'light/skin/res/unsliced.png')
        : text === null ? [] : tileSlices(IniDocument.parse(text)) }
    })
    for (const [state, toStyle] of [['normal', false], ['normal', true], ['pressed', true]]) {
      await page.evaluate(({ format, toStyle }) => {
        return import('/src/app/state.ts').then(({ appState }) => {
          appState.archive.setBytes('light/skin/res/unsliced.png', appState.archive.getBytes('light/skin/res/bg.png').slice())
          if (format === 'bds' && toStyle) appState.archive.setText('light/skin/res/unsliced.til', '[GLOBAL]\nUSE_ALPHA=1\nTILE_NUM=0\n')
          else appState.archive.delete('light/skin/res/unsliced.til')
        })
      }, { format, toStyle })
      const before = await snapshot(page, format)
      const beforeSlices = await imageSlices()
      const stateImage = () => page.locator(referenceInput(format)).locator('..').locator(`.ui-style-state[data-state="${state}"]`)
      // 只查看和取消不写入切片。
      await stateImage().click()
      await picker(page).locator('.ui-image-card[data-path$="/unsliced.png"]').click()
      await picker(page).locator('#picker-canvas').waitFor({ state: 'visible' })
      assert.equal(await picker(page).locator('#picker-apply').isDisabled(), true)
      await picker(page).locator('#picker-canvas').click({ position: { x: 1, y: 1 } })
      assert.equal(await picker(page).locator('#picker-slice').inputValue(), '-1')
      assert.equal(await picker(page).locator('#picker-apply').isEnabled(), true)
      assert.deepEqual(await imageSlices(), beforeSlices)
      await picker(page).locator('#picker-close').click()
      await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
      assert.deepEqual(await snapshot(page, format), before)
      if (toStyle) {
        await stateImage().click()
        await picker(page).locator('.ui-image-card[data-path$="/unsliced.png"]').click()
        await picker(page).locator('#picker-canvas').click({ position: { x: 1, y: 1 } })
        await picker(page).locator('#picker-apply').click()
      } else {
        await changeStyle.click()
        await chooseImage(page, false, 'unsliced')
      }
      await page.waitForFunction(async () => {
        const { appState } = await import('/src/app/state.ts')
        return appState.pickerSelectedIndex === 1 || !appState.pickerTarget
      })
      const after = await snapshot(page, format)
      const afterSlices = await imageSlices()
      assert.deepEqual(afterSlices.slices, [{ index: 1, source: [0, 0, 2, 2] }], '无切片时自动创建整图切片')
      if (format === 'bds' && toStyle) assert.match(afterSlices.text, /USE_ALPHA=1\nTILE_NUM=1/, '保留已有切片文件的设置')
      assert.equal(after.undo, before.undo + 1, '切片、样式与引用合为一步撤销')
      assert.equal(after.image[state === 'pressed' ? 'hl' : 'normal'], 'unsliced,1')
      assert.deepEqual(await page.evaluate(async ({ id, state }) => {
        const { visualResolver } = await import('/src/app/bda-documents.ts')
        return (await visualResolver().resolve(id, state === 'pressed')).source
      }, { id: after.id, state }), [0, 0, 2, 2], '应用后的样式能解析到真实切片')
      assert.equal(after.image[state === 'pressed' ? 'normal' : 'hl'], before.image[state === 'pressed' ? 'normal' : 'hl'])
      if (toStyle) {
        assert.equal(after.id, before.id)
        // 应用至样式后窗口仍在，整张图已变为真正的切片，再次应用不重复创建。
        await picker(page).locator('#picker-canvas').waitFor()
        assert.equal(await picker(page).locator('#picker-slice').inputValue(), '1')
        await picker(page).locator('#picker-canvas').press('Enter')
        assert.deepEqual(await imageSlices(), afterSlices)
        await picker(page).locator('#picker-close').click()
      } else assert.notEqual(after.id, before.id)
      await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
      await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
      assert.equal((await snapshot(page, format)).text, before.text)
      assert.equal((await snapshot(page, format)).id, before.id)
      assert.deepEqual(await imageSlices(), beforeSlices, '撤销恢复原切片信息，原本没有 TIL 时删除新文件')
      await page.evaluate(async () => (await import('/src/app/edit-history.ts')).redo())
      assert.equal((await snapshot(page, format)).text, after.text)
      assert.deepEqual(await imageSlices(), afterSlices)
      await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    }
    console.log(`${format}: unsliced images, normal / pressed, new / existing style, cancel and undo / redo passed`)
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
    for (const [state, toStyle] of [['normal', false], ['normal', true], ['pressed', true]]) {
      await selectBdaKey()
      const before = await bdaSnapshot()
      const field = page.locator('[data-bda-style-path="keys.KEY_Q.backStyle"]')
      await field.locator(toStyle ? `.ui-style-state[data-state="${state}"]` : '.ui-style-ref-action').click()
      const library = picker(page)
      if (!toStyle) await library.locator('[data-library-mode="images"]').click()
      const image = library.locator('.ui-image-card').first()
      const path = await image.getAttribute('data-path')
      await image.click()
      if (!toStyle) await library.locator('#style-library-apply').click()
      await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
      const after = await bdaSnapshot()
      assert.equal(after.undo, before.undo + 1)
      assert.equal(after.count, before.count + (toStyle ? 0 : 1))
      if (toStyle) assert.deepEqual(after.ref, before.ref)
      else assert.notDeepEqual(after.ref, before.ref)
      const changed = toStyle && state === 'pressed' ? 'highlightImage' : 'normalImage'
      const preserved = changed === 'highlightImage' ? 'normalImage' : 'highlightImage'
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
