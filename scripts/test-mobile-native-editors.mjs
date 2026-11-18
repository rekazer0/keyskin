import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

const fixtures = {
  bda: readFileSync(new URL('../public/default-template.bda', import.meta.url)),
  ssf: Buffer.from(ssfFixture()),
  sxi: readFileSync(new URL('../public/templates/palm-harmony.sxi', import.meta.url)),
}
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41897, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const [format, buffer] of Object.entries(fixtures)) {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    await page.locator('#browser-open').setInputFiles({ name: `mobile.${format}`, mimeType: 'application/octet-stream', buffer })
    await page.getByRole('button', { name: '开始编辑' }).tap()
    await page.locator('#mobile-project-toggle').tap()
    const dialog = page.locator('#mobile-project-dialog[open]')
    const path = await page.evaluate(async () => (await import('/src/app/state.ts')).appState.layoutPath)
    await dialog.locator(`button[data-path="${path}"]`).first().tap()
    await dialog.waitFor({ state: 'hidden' })
    const point = await page.evaluate(async () => {
      const { preview } = await import('/src/app/canvas-interaction.ts')
      const key = preview.keys.find(key => key.center === 'F36') ?? preview.keys[0]
      const box = preview.canvas.getBoundingClientRect()
      return { x: box.x + (key.rect.x + key.rect.width / 2) * box.width / preview.panelWidth, y: box.y + (key.rect.y + key.rect.height / 2) * box.height / preview.surfaceHeight, section: key.section }
    })
    await page.touchscreen.tap(point.x, point.y)
    await page.waitForFunction(key => JSON.parse(document.querySelector('#quick-inspector').dataset.selectionNames || '[]').includes(key), point.section)
    // 断点只改变分组入口，不改变选区、字段或原生文档。
    const nativeGroups = () => page.locator('#quick-inspector .mobile-inspector-managed:visible').evaluateAll(nodes => nodes.map(node => node.dataset.inspectorGroupLabel).sort())
    const rail = page.locator('#mobile-inspector-groups')
    const labels = () => rail.locator('button:visible .inspector-group-label').allTextContents()
    const mobileLabels = await labels()
    if (format === 'bda') assert.ok(mobileLabels.includes('面板'), 'BDA panel destination is reachable')
    const mobile = await nativeGroups()
    assert.ok(mobile.length >= 3, `${format}: native sections missing`)
    await page.setViewportSize({ width: 1440, height: 900 })
    assert.deepEqual(await labels(), mobileLabels, `${format}: navigation differs between breakpoints`)
    assert.deepEqual(await nativeGroups(), mobile, `${format}: desktop exposes different sections`)
    await page.setViewportSize({ width: 393, height: 852 })
    await rail.getByRole('button', { name: format === 'sxi' ? '布局' : '文字', exact: true }).tap()
    const edit = page.locator({
      bda: '.key-typography-fields [data-style-field="FONT_SIZE"]',
      ssf: '#document-fields [data-document-key="TEXT_SIZE"] input[type="number"]',
      sxi: '#document-fields [data-document-key="rect.size"] input[type="number"]',
    }[format]).first()
    const original = await edit.inputValue()
    const value = format === 'sxi' ? String(Number(original) + 1) : format === 'ssf' ? '0.05' : '44'
    async function nativeValue() {
      return page.evaluate(async format => {
        const { appState } = await import('/src/app/state.ts')
        if (format === 'bda') {
          const { appearance } = (await import('/src/app/bda-documents.ts')).currentBdaAppearance()
          const text = appearance.panels.get('py_9').keys.get('KEY_F36').foreStyles.find(ref => ref.type === 'text')
          return text ? String(appearance.textStyles.get(text.key).fontSize) : ''
        }
        if (format === 'ssf') {
          const { ssfSkinPath, ssfDocument } = await import('/src/app/ssf-documents.ts')
          return ssfDocument(ssfSkinPath()).get('TextStyle_FuncKey_T9', 'TEXT_SIZE') ?? ''
        }
        const model = appState.layoutPath.split('/').slice(1).reduce((obj, part) => obj[part], JSON.parse(appState.archive.getText('skin.json')))
        return String(model.keys.find(key => String(key.id) === appState.selectedKeySections[0].slice(3)).rect[1][0])
      }, format)
    }
    assert.equal(await nativeValue(), original)
    assert.ok(await page.locator('#mobile-undo').isDisabled(), `${format}: navigation created history`)
    if (format !== 'sxi') {
      assert.ok(await page.locator('[data-key-field="width"]').isDisabled(), `${format}: template geometry must be read only`)
      assert.ok(await page.locator('[data-key-field="CENTER"]').evaluate(input => input.readOnly))
    }
    const groupAdd = edit.locator('xpath=ancestor::section[1]').locator(':scope > h3 [data-config-section-add]:visible')
    if (await groupAdd.count()) await groupAdd.tap()
    const add = edit.locator('xpath=ancestor::*[@data-document-key][1]').locator('[data-config-add]:visible')
    if (await add.count()) await add.tap()
    await edit.fill(value)
    await edit.press('Enter')
    assert.equal(await nativeValue(), value, `${format}: edit must reach the native document`)
    await page.locator('#mobile-undo').tap()
    assert.equal(await nativeValue(), original)
    assert.equal(await edit.inputValue(), original)
    assert.ok(await page.locator('#mobile-undo').isDisabled(), `${format}: a field edit is one undo step`)
    if (format === 'bda') {
      const ref = page.locator('[data-bda-style-path="keys.KEY_F36.backStyle"]')
      await ref.getByRole('button', { name: /编辑.*样式/ }).tap()
      const slice = page.getByRole('button', { name: '编辑正常图片切片', exact: true })
      await slice.waitFor()
      await page.locator('#resource-back').tap()
      const styleID = await ref.locator('.ui-style-ref-name').inputValue()
      for (const [highlighted, label] of [[false, '正常'], [true, '按下']]) {
        await ref.getByRole('button', { name: /编辑.*样式/ }).tap()
        await page.getByRole('button', { name: `编辑${label}图片切片` }).tap()
        await page.locator('#image-resource-detail:visible').waitFor()
        assert.ok(await page.evaluate(async highlighted => {
          const { appState } = await import('/src/app/state.ts')
          return appState.bdaTileUsages.some(usage => usage.index === appState.selectedTileIndex && usage.highlighted === highlighted && String(usage.ref.key) === appState.bdaSliceReturn?.styleID)
        }, highlighted), `slice editor selected the ${label} tile`)
        await page.locator('#resource-back').tap()
        await slice.waitFor()
        assert.equal(await page.locator('#resource-name').innerText(), `STYLE ${styleID}`)
        await page.locator('#resource-back').tap()
        assert.equal(await ref.isVisible(), true, 'second back restores the original key inspector, not the style list')
        assert.deepEqual(await page.evaluate(async () => {
          const { appState } = await import('/src/app/state.ts')
          return [appState.selectedPath, appState.selectedKeySections]
        }), [path, [point.section]])
      }
      assert.ok(await page.locator('#mobile-undo').isDisabled(), 'inspecting a style and slice must not write')
    }
    assert.deepEqual(errors, [])
    console.log(`PASS: ${format.toUpperCase()} native mobile editor`)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
