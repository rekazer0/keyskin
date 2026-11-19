import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'
import { legacyToolbarFixture, nativeToolbarFixture } from '../tests/helpers/native-toolbar-fixture.mjs'
import { buildSxiZip } from '../src/palm/palm-export.ts'
import { encodePng } from '../src/ssf/ssf-png.ts'

const png = color => encodePng({ width: 8, height: 4, data: Uint8Array.from({ length: 128 }, (_, index) => color[index % 4]) })
const original = png([10, 20, 30, 255])
const replacement = png([240, 50, 60, 255])
const ssf = unzipSync(ssfFixture())
ssf['1080/status1/ime_function_multimedia.png'] = original
ssf['1080/status1/ime_function_multimedia_p.png'] = original
ssf['1080/status1/replacement.png'] = replacement
const fixtures = [{ format: 'ssf', bytes: zipSync(ssf), label: '菜单', target: '1080/status1/ime_function_multimedia.png', source: '1080/status1/replacement.png', count: 9 }]
const legacy = legacyToolbarFixture()
legacy.setBytes('light/skin/res/replacement.png', replacement)
fixtures.push({ format: 'bdi', bytes: legacy.toBytes(), label: '键盘类型',
  target: 'light/skin/res/logo/1.0/toolbarMenuItem_KBSwitch_Normal_iphone@3x.png',
  source: 'light/skin/res/replacement.png', count: 29, legacy: true, builtIn: true })
for (const format of ['bdi', 'bds']) {
  const archive = await nativeToolbarFixture(format)
  archive.setBytes('light/skin/res/replacement.png', replacement)
  if (format === 'bds') {
    const css = 'light/skin/res/default.css'
    archive.setText(css, archive.getText(css).replace('NM_IMG=bar,1', 'NM_IMG=bar,1\nHL_IMG=overlay,1'))
    const originalOverlayColor = [80, 150, 100, 255]
    archive.setBytes('light/skin/res/overlay.png', encodePng({ width: 8, height: 4,
      data: Uint8Array.from({ length: 128 }, (_, i) => i % 32 < 8 || i % 32 >= 24 ? 0 : originalOverlayColor[i % 4]),
    }))
    archive.setText('light/skin/res/overlay.til', '[IMG1]\nSOURCE_RECT=0,0,8,4\n')
    archive.setBytes('light/skin/res/logo/pop_menu_icons.png', original)
    archive.setText('light/skin/res/logo/pop_menu_icons.til', '[IMG26]\nSOURCE_RECT=0,0,4,4\n[IMG27]\nSOURCE_RECT=4,0,4,4\n')
    archive.delete('light/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist')
  }
  if (format === 'bds') fixtures.push({ format, bytes: archive.toBytes(), selectionOnly: true })
  const converted = unzipSync(buildSxiZip(archive).bytes)
  if (format === 'bds') {
    const skin = JSON.parse(new TextDecoder().decode(converted['skin.json']))
    delete skin.default.menu
    converted['skin.json'] = strToU8(JSON.stringify(skin))
  }
  fixtures.push({ format: 'sxi', bytes: zipSync(converted), label: format === 'bdi' ? '键盘类型' : '表情',
    target: format === 'bdi' ? 'light/skin/res/logo/function_iphone@3x.png' : 'light/skin/res/logo/pop_menu_icons.png',
    source: 'light/skin/res/replacement.png', count: format === 'bdi' ? 3 : 4 })
}
const insetEdges = nativeToolbarFixture()
insetEdges.setText('light/skin/port/cand1.cnd', '[CAND]\nBACK_STYLE=1\n[ICON1]\nSIZE=109,109\nPOS=20,-54\nANCHOR_TYPE=4\nFIX_SIZE=30,30\nFORE_STYLE=2\nKEY=F31\n[ICON2]\nSIZE=780,58\nPOS=-390,43\nANCHOR_TYPE=2\nKEY=F14\n[ICON3]\nSIZE=109,109\nPOS=-129,-54\nANCHOR_TYPE=6\nFIX_SIZE=30,30\nFORE_STYLE=2\nKEY=F8\n')
fixtures.unshift({ format: 'bdi', bytes: insetEdges.toBytes(), selectionOnly: true, insetEdges: true })
const palm = unzipSync(readFileSync(new URL('../public/templates/palm-harmony.sxi', import.meta.url)))
palm['light/skin/res/replacement.png'] = replacement
fixtures.push({ format: 'sxi', bytes: zipSync(palm), label: '键盘类型', target: 'light/skin/res/logo/1.0/toolbarMenuItem_KBSwitch_Normal_iphone@3x.png', source: 'light/skin/res/replacement.png', count: 5, builtIn: true })
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const fixture of fixtures) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#browser-open').setInputFiles({ name: `toolbar.${fixture.format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(fixture.bytes) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    const parts = await page.evaluate(async () => {
      const { toolbarPreview: p } = await import('/src/app/canvas-interaction.ts')
      await p.whenDrawn()
      const box = p.canvas.getBoundingClientRect()
      return p.keys.filter(key => key.editable).flatMap(({ section, rect }) => {
        const x1 = Math.max(0, rect.x), x2 = Math.min(p.panelWidth, rect.x + rect.width)
        const y1 = Math.max(0, rect.y), y2 = Math.min(p.panelHeight, rect.y + rect.height)
        return x1 < x2 && y1 < y2 ? [{ section, x: box.x + (x1 + x2) / 2 * box.width / p.panelWidth,
          y: box.y + (y1 + y2) / 2 * box.height / p.panelHeight }] : []
      })
    })
    const archiveBeforeSelection = await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      return { revision: appState.archive.revision, undo: appState.undoStack.length }
    })
    const check = async (selected, joined) => {
      await page.waitForFunction(async () => !(await import('/src/app/state.ts')).appState.selectionInspectorSyncPending)
      const state = await page.evaluate(async () => {
        const { toolbarPreview } = await import('/src/app/canvas-interaction.ts')
        const { appState } = await import('/src/app/state.ts')
        return { sections: [...toolbarPreview.selected].sort(), keys: appState.selectedKeySections,
          scope: appState.selectedCandidate, joined: toolbarPreview.joinedSelection }
      })
      assert.deepEqual(state, { sections: selected.map(p => p.section).sort(), keys: [], scope: joined ? true : 'parts', joined })
      assert.equal(await page.locator('#candidate-area').getAttribute('aria-selected'), String(joined))
    }
    if (fixture.insetEdges) {
      await page.waitForFunction(async () => Boolean((await import('/src/app/canvas-interaction.ts')).toolbarPreview.drawnScene?.keys.length))
      for (const part of [parts[0], parts.at(-1)]) {
        await page.mouse.click(part.x, part.y)
        await check([part], false)
        const selection = await page.evaluate(async section => {
          const { toolbarPreview: p } = await import('/src/app/canvas-interaction.ts')
          await p.whenDrawn()
          const key = p.keys.find(item => item.section === section)
          const rect = p.editRect(key)
          const x = Math.floor((rect.x + rect.width / 2) * p.canvas.width / p.panelWidth)
          const ctx = p.canvas.getContext('2d')
          const pixel = y => Array.from(ctx.getImageData(x, Math.round(y * p.canvas.height / p.panelHeight), 1, 1).data)
          const color = document.createElement('canvas').getContext('2d')
          color.fillStyle = getComputedStyle(p.canvas).getPropertyValue('--selection').trim()
          color.fillRect(0, 0, 1, 1)
          return { top: pixel(rect.y + 2), bottom: pixel(rect.y + rect.height - 2),
            orange: Array.from(color.getImageData(0, 0, 1, 1).data), sourceWidth: key.rect.width }
        }, part.section)
        assert.deepEqual(selection.top, selection.orange, `${part.section}: visible top selection border`)
        assert.deepEqual(selection.bottom, selection.orange, `${part.section}: visible bottom selection border`)
        assert.equal(selection.sourceWidth, 109, 'selection leaves the authored size intact')
      }
    }
    if (parts.length && !fixture.insetEdges) {
      assert.ok(parts.length >= 3)
      const click = p => page.mouse.click(p.x, p.y)
      await click(parts[0]); await check(parts.slice(0, 1), false)
      if (fixture.legacy) {
        await page.keyboard.down('Shift'); await click(parts.at(-1)); await page.keyboard.up('Shift')
        await check(parts, true)
      }
      await click(parts[1]); await check(parts.slice(1, 2), false)
      await page.keyboard.down('Control')
      await click(parts[0]); await check(parts.slice(0, 2), false)
      for (let i = 2; i < parts.length; ++i) {
        await click(parts[i]); await check(parts.slice(0, i + 1), i === parts.length - 1)
      }
      await click(parts[0]); await check(parts.slice(1), false)
      await click(parts[0]); await check(parts, true)
      await page.keyboard.up('Control')
    } else if (!parts.length) {
      await page.locator('#toolbar-preview').click(); await check([], true)
    }
    assert.deepEqual(await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      return { revision: appState.archive.revision, undo: appState.undoStack.length }
    }), archiveBeforeSelection, 'selecting the bar never edits the skin')
    if (fixture.format === 'bds') {
      const sampleBackground = (label, color, x = 0.5) => page.waitForFunction(async ({ color, x }) => {
        const { candidateBackgroundPreview: p } = await import('/src/app/canvas-interaction.ts')
        const { canvas } = p
        return [...canvas.getContext('2d').getImageData(Math.floor(canvas.width * x), canvas.height >> 1, 1, 1).data].join(',') === color
      }, { color, x }, { timeout: 3000 }).catch(error => { throw new Error(`${label}: candidate background did not match ${color}`, { cause: error }) })
      await sampleBackground('Android with HL_IMG', '80,150,100,255')
      await sampleBackground('Android shows NM_IMG through transparent HL_IMG edges', '255,255,255,255', 0.125)
      await page.locator('#quick-inspector input[data-toolbar-field="BACK_STYLE"]').locator('..')
        .locator('.ui-style-state[data-state="normal"]').click()
      const picker = page.frameLocator('#picker-frame')
      await picker.locator('.ui-image-card[data-path$="/replacement.png"]').click()
      await picker.locator('#picker-canvas').click({ position: { x: 1, y: 1 } })
      await picker.locator('#picker-apply').click()
      await sampleBackground('Replacing NM_IMG updates the full-width background', '240,50,60,255', 0.125)
      await sampleBackground('Replacing NM_IMG preserves HL_IMG', '80,150,100,255')
      await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
      await sampleBackground('Undo restores NM_IMG', '255,255,255,255', 0.125)
      await page.locator('#device').selectOption('iphone-17-pro-max')
      await sampleBackground('iPhone uses NM_IMG', '255,255,255,255')
      await page.locator('#device').selectOption('canvas-checkerboard')
      await page.locator('#theme').selectOption('dark', { force: true })
      await sampleBackground('Android without HL_IMG falls back to NM_IMG', '255,255,255,255')
    }
    if (fixture.selectionOnly) { assert.deepEqual(errors, []); await page.close(); continue }
    const card = page.getByRole('button', { name: `更换${fixture.label}图标`, exact: true })
    await card.waitFor()
    assert.equal(await page.locator('.ui-toolbar-icon').count(), fixture.count)
    if (fixture.legacy) {
      const groups = await page.locator('#mobile-inspector-groups .inspector-group-label').allTextContents()
      assert.deepEqual(groups.slice(0, 3), ['布局', '样式', '文字'])
      assert.deepEqual(groups.slice(3), ['图标', '候选栏', '输入区', '工具栏', '工具按钮', '动画'])
      const buttons = page.locator('#document-fields > [data-inspector-group-label="工具按钮"]')
      const animation = page.locator('#document-fields > [data-inspector-group-label="动画"]')
      const blocks = buttons.locator(':scope > .ui-subsection')
      assert.equal(await blocks.count(), 3)
      assert.equal(await buttons.locator('[data-document-key="BACK_ANIM_STYLE"]').count(), 3)
      assert.equal(await animation.locator('[data-document-key="BACK_ANIM_STYLE"]').count(), 2)
      const buttonRail = page.locator('#mobile-inspector-groups').getByRole('button', { name: '工具按钮', exact: true })
      await buttonRail.click()
      assert.equal(await buttonRail.getAttribute('aria-pressed'), 'true')
      await page.locator('.inspector-filter-open').click()
      const filter = page.locator('#inspector-filter')
      for (const query of ['工具按钮 2', 'ICON2']) {
        await filter.fill(query)
        assert.equal(await blocks.nth(1).isVisible(), true)
        assert.equal(await blocks.nth(0).isVisible(), false)
        assert.equal(await animation.isVisible(), false)
      }
      await filter.press('Escape')
      await filter.press('Escape')
      assert.equal(await blocks.nth(0).isVisible(), true)
      const width = blocks.nth(1).locator('[data-document-key="SIZE"]').getByRole('spinbutton', { name: '尺寸W', exact: true })
      await width.fill('240')
      await width.press('Tab')
      const sizes = () => page.evaluate(async () => {
        const { appState } = await import('/src/app/state.ts')
        return ['ICON1', 'ICON2', 'ICON3'].map(code => appState.selectedDocument.get(code, 'SIZE'))
      })
      assert.deepEqual(await sizes(), ['45,47', '240,34', '45,44'])
      await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
      assert.deepEqual(await sizes(), ['45,47', '250,34', '45,44'])
    }
    const snapshot = () => page.evaluate(async path => {
      const { appState } = await import('/src/app/state.ts')
      const { toolbarPreview } = await import('/src/app/canvas-interaction.ts')
      return { bytes: Array.from(appState.archive.getBytes(path) ?? []), undo: appState.undoStack.length, json: appState.archive.isText('skin.json') ? appState.archive.getText('skin.json') : undefined,
        height: toolbarPreview.panelHeight,
        functions: appState.archive.format === 'bdi' ? (await toolbarPreview.sceneForState()).keys.find(key => key.section === 'ICON2')?.layers(false).fore.length : undefined }
    }, fixture.target)
    const before = await snapshot()
    if (fixture.legacy) {
      assert.equal(before.height, 50)
      assert.equal(before.functions, 4, 'unconfigured functions appear as default artwork')
    }
    await card.click()
    await page.locator('#picker-dialog').waitFor({ state: 'visible' })
    await page.evaluate(async source => {
      const { appState } = await import('/src/app/state.ts')
      appState.pickerTarget.selectImage(source, [4, 0, 4, 4])
    }, fixture.source)
    await page.waitForFunction(async undo => {
      const { appState } = await import('/src/app/state.ts')
      return appState.undoStack.length === undo + 1
    }, before.undo)
    await page.frameLocator('#picker-frame').locator('#picker-close').click()
    await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
    const after = await snapshot()
    assert.equal(after.height, before.height, 'replacing artwork never changes the candidate bar height')
    assert.equal(after.functions, before.functions, 'replacing one icon keeps the other function slots visible')
    if (fixture.builtIn) assert.equal(await page.evaluate(async path => {
      const { toolbarPreview } = await import('/src/app/canvas-interaction.ts')
      const scene = await toolbarPreview.sceneForState()
      return scene.keys.some(key => key.layers(false).fore.some(layer => layer.kind === 'image' && layer.visual.imagePath === path))
    }, fixture.target), true, 'new native icon artwork appears on the canvas')
    assert.notDeepEqual(after.bytes, before.bytes)
    assert.equal(after.json, before.json, 'replacing existing artwork preserves the native JSON declarations')
    const pixels = await page.evaluate(async path => {
      const { appState } = await import('/src/app/state.ts')
      const bitmap = await createImageBitmap(new Blob([appState.archive.getBytes(path)]))
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close()
      return [Array.from(ctx.getImageData(0, 0, 1, 1).data), Array.from(ctx.getImageData(canvas.width - 1, 0, 1, 1).data)]
    }, fixture.target)
    assert.deepEqual(pixels[0], [240, 50, 60, 255])
    if (fixture.target.includes('pop_menu_icons')) assert.deepEqual(pixels[1], [10, 20, 30, 255], 'other atlas slices remain intact')
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    await card.waitFor()
    assert.deepEqual(await snapshot(), before, 'undo restores the exact native resource and toolbar scope')
    if (!fixture.legacy) assert.equal(await page.locator('#candidate-area').getAttribute('aria-selected'), 'true')
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).redo())
    assert.deepEqual(await snapshot(), after)
    if (fixture.format === 'ssf') {
      const missing = page.getByRole('button', { name: '更换剪贴板图标', exact: true })
      await missing.click()
      await page.evaluate(async source => {
        const { appState } = await import('/src/app/state.ts')
        appState.pickerTarget.selectImage(source)
      }, fixture.source)
      await page.waitForFunction(async () => {
        const { appState } = await import('/src/app/state.ts')
        return Boolean(appState.archive.getBytes('1080/status1/ime_function_clipboard.png'))
      })
      await page.frameLocator('#picker-frame').locator('#picker-close').click()
      await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
      assert.equal(await page.evaluate(async () => Boolean((await import('/src/app/state.ts')).appState.archive.getBytes('1080/status1/ime_function_clipboard.png'))), false)
    }
    await page.getByRole('button', { name: '交互预览', exact: true }).click()
    await card.waitFor()
    assert.equal(await card.isDisabled(), true)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`${fixture.format} ${fixture.target}: toolbar selection, replacement, isolation, undo/redo and read-only passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
