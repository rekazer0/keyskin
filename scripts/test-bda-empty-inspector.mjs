import assert from 'node:assert/strict'
import { pickStyleReference } from '../tests/helpers/style-reference-picker.mjs'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdaStyleID } from '../src/bda.ts'
import { SkinArchive } from '../src/skin.ts'
import { removeFields, updateStringMapValue } from '../src/bda-encode.ts'

const archive = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/default-template.bda', import.meta.url))), 'bda')
const appearancePath = 'light/skin/port/appearanceConfig'
archive.setBytes(appearancePath, updateStringMapValue(archive.getBytes(appearancePath), 4, 'py_9', (bytes) =>
  updateStringMapValue(removeFields(bytes, new Set([1, 4, 5, 6])), 2, 'port', (list) => removeFields(list, new Set([1, 2, 3, 4])))))
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41947, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const row = (path) => page.locator(`#bda-config-fields [data-bda-style-path="${path}"]`)
const bytes = () => page.evaluate(async () => [...(await import('/src/app/bda-documents.ts')).currentBdaAppearance().bytes])
const snapshot = () => page.evaluate(async () => {
  const { appState } = await import('/src/app/state.ts')
  const { currentBdaAppearance } = await import('/src/app/bda-documents.ts')
  const { decodedBdaAppearancePart } = await import('/src/bda-source.ts')
  const info = currentBdaAppearance()
  return { panel: JSON.parse(decodedBdaAppearancePart(info.bytes, { kind: 'panel', name: 'py_9' })), undo: appState.undoStack.length, image: info.appearance.imageStyles.keys().next().value, text: info.appearance.textStyles.keys().next().value }
})
const candidate = (selected) => page.evaluate(async (selected) => {
  const { appState } = await import('/src/app/state.ts')
  appState.selectedCandidate = selected
  appState.selectedKeySections = []
  ;(await import('/src/app/key-inspector.ts')).populateKeyInspector()
}, selected)
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'empty-capabilities.bda', mimeType: 'application/octet-stream', buffer: Buffer.from(archive.toBytes('bda')) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await page.evaluate(async () => (await import('/src/app/navigation.ts')).selectFile('light/skin/port/py_9.ini', 'overview'))
  const baseline = await bytes(), original = await snapshot()
  for (const path of ['input.backStyle', 'more.backStyle', 'hints.short.backStyle', 'hints.long.cellStyle']) assert.equal(await row(path).count(), 0, `${path} does not belong to the selected panel`)
  assert.equal(await row('lists.port.cellForeStyle').count(), 0, 'panel selection hides list properties')
  assert.equal(await page.locator('.text-style-fields').isVisible(), false)
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    appState.selectedKeySections = ['LIST']
    ;(await import('/src/app/key-inspector.ts')).populateKeyInspector()
  })
  assert.equal(await row('backStyle').count(), 0, 'list selection hides panel properties')
  assert.equal(await row('lists.port.cellForeStyle').locator('.ui-style-ref-append').count(), 1, 'an existing list keeps its unconfigured fields')
  assert.equal(await row('lists.port.foreStyles.0').getByRole('button', { name: '添加前景', exact: true }).count(), 1)
  assert.deepEqual(await bytes(), baseline, 'opening empty panel controls does not write source')
  assert.equal((await snapshot()).undo, original.undo)

  async function firstEdit(path, style, check) {
    if (path.startsWith('cand.')) await candidate(true)
    const undo = (await snapshot()).undo
    await pickStyleReference(page, row(path), bdaStyleID({ type: path.includes('cellFore') ? 'text' : 'image', key: style }))
    const next = await snapshot()
    check(next.panel)
    assert.equal(next.undo, undo + 1, `${path} creates one undo step`)
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    assert.deepEqual(await bytes(), baseline, `${path} undo restores the absent object byte for byte`)
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).redo())
    check((await snapshot()).panel)
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
  }
  const image = { type: 'image', key: original.image }, text = { type: 'text', key: original.text }
  await firstEdit('lists.port.cellForeStyle', text.key, (panel) => assert.deepEqual(panel.lists.port.cellForeStyle, text))
  await candidate(true)
  assert.equal(await row('lists.port.cellForeStyle').count(), 0, 'candidate selection hides list properties')
  await firstEdit('input.backStyle', image.key, (panel) => assert.deepEqual(panel.input.backStyle, image))
  for (const path of ['cand.candBarStyle', 'cand.switch.selectFore', 'cand.cellForeStyle', 'cand.candKeys.CAND_F31.backStyle', 'cand.menuKeys.MENU_PASTE.backStyle', 'cand.aiIcon.backStyle']) assert.equal(await row(path).locator('.ui-style-ref-append').count(), 1, path)
  assert.deepEqual(await bytes(), baseline)
  await firstEdit('cand.candBarStyle', image.key, (panel) => assert.deepEqual(panel.cand.candBarStyle, image))
  await firstEdit('cand.cellForeStyle', text.key, (panel) => assert.deepEqual(panel.cand.cellForeStyle, text))
  await firstEdit('cand.switch.normalBack', image.key, (panel) => assert.deepEqual(panel.cand.switch.normalBack, image))
  await firstEdit('cand.menuKeys.MENU_PASTE.backStyle', image.key, (panel) => assert.deepEqual(panel.cand.menuKeys.MENU_PASTE.backStyle, image))

  await candidate(true)
  await pickStyleReference(page, row('cand.candBarStyle'), bdaStyleID(image))
  await row('cand.candBarStyle').getByRole('button', { name: '移除', exact: true }).click()
  assert.equal((await snapshot()).panel.cand.candBarStyle, undefined, 'a newly created single reference can be removed')
  await page.getByRole('button', { name: '交互预览', exact: true }).click()
  assert.equal(await row('cand.cellForeStyle').locator('.ui-style-ref-append').isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log('BDA selection inspector: panel, existing lists, candidate and input scopes; first edits, undo/redo, removal and read-only passed')
} finally {
  await browser.close()
  await server.close()
}
