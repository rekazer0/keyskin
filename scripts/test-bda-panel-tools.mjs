// Native BDA tools through the file menu, binary writeback, canvas, history and package reload.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'
import { convertBdaPlatform } from '../src/bda-platform.ts'
import { decodeBdaAppearance } from '../src/bda-decode.ts'
import { encodePng } from '../src/ssf/ssf-png.ts'
import { solid } from '../tests/helpers/ssf-fixture.mjs'

const template = readFileSync(new URL('../public/default-template.bda', import.meta.url))
const ios = convertBdaPlatform(SkinArchive.open(new Uint8Array(template), 'bda'), 'ios').toBytes()
const red = Buffer.from(encodePng(solid(100, 100, [230, 20, 20])))
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41837, strictPort: false, host: '127.0.0.1' } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const evaluateState = (operation) => page.evaluate(async (operation) => {
  const { appState } = await import('/src/app/state.ts')
  const { currentBdaAppearance } = await import('/src/app/bda-documents.ts')
  if (operation === 'depth') return appState.undoStack.length
  if (operation === 'snapshot') return Object.fromEntries(appState.archive.names().map(path => [path, [...appState.archive.getBytes(path)]]))
  if (operation === 'save') return [...appState.archive.toBytes()]
  const info = currentBdaAppearance()
  const panel = info.appearance.panels.get('py_26')
  if (operation === 'key') return panel.keys.get('KEY_Q')
  const ref = operation === 'panel' ? panel.wholeBackStyle ?? panel.backStyle : panel.cand.candBarStyle
  return info.appearance.imageStyles.get(ref.key)
}, operation)
const depth = () => evaluateState('depth')
const history = (action) => page.evaluate(async (action) => (await import('/src/app/edit-history.ts'))[action](), action)
const snapshot = () => evaluateState('snapshot')
const selectedKey = () => evaluateState('key')
async function menu(id) {
  const menu = page.locator('.pen-file-menu')
  if (!await menu.evaluate((node) => node.open)) await menu.locator('> summary').click()
  await page.locator(id).click()
}
async function open(buffer) {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'tools.bda', mimeType: 'application/octet-stream', buffer: Buffer.from(buffer) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  for (const id of ['#replace-layout-image', '#adapt-ios26']) assert.equal(await page.locator(id).isDisabled(), true)
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  for (const id of ['#replace-layout-image', '#adapt-ios26']) assert.equal(await page.locator(id).isDisabled(), false)
  await page.evaluate(async () => {
    const { selectFile } = await import('/src/app/navigation.ts')
    selectFile('light/skin/port/py_26.ini')
  })
}
async function selectQ() {
  const point = await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const key = preview.keys.find((key) => key.center === 'q')
    const box = document.querySelector('#preview').getBoundingClientRect()
    return { x: box.x + (key.rect.x + key.rect.width / 2) / preview.panelWidth * box.width, y: box.y + (key.rect.y + key.rect.height / 2) / preview.surfaceHeight * box.height, section: key.section }
  })
  await page.mouse.click(point.x, point.y)
  await page.waitForFunction(async (section) => {
    const { appState } = await import('/src/app/state.ts')
    return appState.selectedKeySections.join() === section && !appState.selectionInspectorSyncPending
  }, point.section)
}
async function replace(target, config = 'none') {
  await menu('#replace-layout-image')
  await page.locator('#layout-image-dialog[open]').waitFor()
  assert.equal(await page.locator('[data-layout-image-config="layout-follows-image"]').isHidden(), true)
  await page.locator('#layout-image-open').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: red })
  await page.locator(`input[name="layout-image-target"][value="${target}"]`).check()
  if (!['panel', 'candidate'].includes(target)) await page.locator(`[data-layout-image-config="${config}"]`).click()
  await page.waitForFunction(() => !document.querySelector('#layout-image-apply').disabled)
  await page.locator('#layout-image-apply').click()
  await page.waitForFunction(() => !document.querySelector('#layout-image-dialog').open || !document.querySelector('#layout-image-error').hidden)
  if (await page.locator('#layout-image-error').isVisible()) throw new Error(await page.locator('#layout-image-error').textContent())
}
async function savedArchive() {
  return SkinArchive.open(Uint8Array.from(await evaluateState('save')), 'bda')
}
try {
  for (const [family, bytes] of [['android', template], ['ios', ios]]) {
    await open(bytes)
    const original = await snapshot()
    await menu('#adapt-ios26')
    await page.waitForFunction(() => /适配 iOS 26完成/.test(document.querySelector('#event-log').textContent))
    assert.equal(await depth(), 1)
    const adapted = await snapshot()
    assert.notDeepEqual(adapted, original)
    await menu('#adapt-ios26')
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    assert.equal(await depth(), 1, 'repeated adaptation adds no undo step')
    await history('undo')
    assert.deepEqual(await snapshot(), original)
    await history('redo')
    assert.deepEqual(await snapshot(), adapted)
    const saved = await savedArchive()
    for (const path of saved.names().filter((path) => /appearanceConfig$/.test(path))) {
      const appearance = decodeBdaAppearance(saved.getBytes(path))
      assert.equal(appearance.colorStyles.get(appearance.panels.get('py_26').backStyle.key).normalColor, 0x01d0d4db)
    }
    await history('undo')

    // Panel background and candidate changes each preserve a whole package snapshot on undo / redo.
    for (const target of ['panel', 'candidate']) {
      const before = await snapshot()
      const initialDepth = await depth()
      await replace(target)
      assert.equal(await depth(), initialDepth + 1)
      const changed = await snapshot()
      const current = await evaluateState(target)
      const resource = current.normalImage.resource.resourceID
      const exported = await savedArchive()
      const resourcePath = exported.names().find((name) => name.endsWith(`/${resource}.png`))
      assert.ok(resourcePath, 'saved BDA contains the imported image')
      assert.equal(exported.names().some((name) => /replace_image.*\.til$/.test(name)), false)
      await history('undo')
      assert.deepEqual(await snapshot(), before)
      await history('redo')
      assert.deepEqual(await snapshot(), changed)
      await history('undo')
    }
    await replace('key-normal')
    assert.ok(await page.evaluate(async () => {
      const { currentBdaAppearance } = await import('/src/app/bda-documents.ts')
      const { appearance } = currentBdaAppearance()
      return [...appearance.panels.get('py_26').keys.values()].filter((key) =>
        appearance.imageStyles.get(key.backStyle?.key)?.normalImage?.resource?.resourceID?.startsWith('replace_image_')).length > 20
    }), 'no selection replaces all keys')
    await history('undo')
    await selectQ()
    const before = await snapshot()
    const oldKey = await selectedKey()
    for (const target of ['key-normal', 'key-highlight', 'fore-normal', 'fore-highlight']) {
      await replace(target, target === 'fore-normal' ? 'image-follows-layout' : 'none')
      assert.equal(await depth(), 1)
      const after = await selectedKey()
      if (target.startsWith('fore')) assert.deepEqual(after.foreStyles.slice(0, -1), oldKey.foreStyles)
      else assert.notDeepEqual(after.backStyle, oldKey.backStyle)
      await history('undo')
      assert.deepEqual(await snapshot(), before)
    }
    // A new PNG is allocated on every invocation, and reload resolves the written style as red.
    await replace('key-normal')
    await replace('key-normal')
    const result = await savedArchive()
    assert.ok(result.names().some((name) => /replace_image2_\d+\.png$/.test(name)), 'new resource names do not collide')
    await open(result.toBytes())
    const color = await page.evaluate(async () => {
      const { currentBdaAppearance, visualResolver } = await import('/src/app/bda-documents.ts')
      const { bdaStyleID } = await import('/src/bda.ts')
      const key = currentBdaAppearance().appearance.panels.get('py_26').keys.get('KEY_Q')
      const visual = await visualResolver().resolve(bdaStyleID(key.backStyle), false)
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
      const context = canvas.getContext('2d'); context.drawImage(visual.image, 0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data]
    })
    assert.deepEqual(color, [230, 20, 20, 255])
    console.log(`BDA ${family}: both tools, six image targets, selection, slicing, history and saved package reload passed`)
  }
  assert.deepEqual(errors, [])
} catch (error) {
  await page.screenshot({ path: '/tmp/keyskin-bda-panel-tools-failure.png' })
  throw error
} finally {
  await browser.close()
  await server.close()
}
