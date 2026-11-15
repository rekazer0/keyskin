import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { readConversionLayout } from '../src/layout-conversion.ts'
import { IniDocument } from '../src/ini.ts'
import { encodeSkinJson, parseSkinJson } from '../src/palm/sxi-json.ts'
import { bdaAnimatedSkinBytes } from '../tests/helpers/bda-animation-fixture.mjs'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

const root = new URL('..', import.meta.url).pathname
const bds = readFileSync(new URL('../public/default-template.bds', import.meta.url))
const palm = readFileSync(new URL('../public/templates/palm-harmony.sxi', import.meta.url))
const bdi = await SkinArchive.open(bds).platformBytesAsync('bdi')
const sourcePath = 'light/skin/port/py_26.ini'
const address = 'skin.json/default/port_layout/b/full26Pinyin'
function templateFor(bytes, format) {
  const archive = SkinArchive.open(bytes, format)
  const definition = readConversionLayout(archive, format === 'sxi' ? address : sourcePath)
  const text = `[PANEL]\nSIZE=${definition.size.join(',')}\nKEY_NUM=2\n` + definition.keys.slice(0, 2).reverse().map((key, i) =>
    `[KEY${i + 1}]\n${Object.entries(key.actions).map(([name, value]) => `${name}=${value}`).join('\n')}\nVIEW_RECT=${[10 + i * 120, 20, 100, 70].join(',')}\nFORE_STYLE=99999\n`).join('')
  return zipSync({ 'light/port/py_26.ini': strToU8(text), 'dark/port/py_26.ini': strToU8(text),
    'light/land/py_26.ini': strToU8(text), 'dark/land/py_26.ini': strToU8(text),
    'light/port/en_26.ini': strToU8(text.replace('10,20,100,70', '20,20,100,70')) })
}
async function missingButtonSkin(bytes, format) {
  const archive = SkinArchive.open(bytes, format)
  if (format === 'sxi') {
    const skin = parseSkinJson(archive.getText('skin.json'))
    for (const theme of ['default', 'night']) for (const orientation of ['port_layout', 'land_layout']) {
      for (const board of Object.values(skin[theme]?.[orientation]?.b ?? {})) if (Array.isArray(board.keys)) {
        board.keys = board.keys.filter(key => !Array.isArray(key.values) || !key.values.some((value, index) => value === 4 && ['capslock', 'F11'].includes(key.values[index + 1])))
      }
    }
    archive.setText('skin.json', encodeSkinJson(skin))
  } else {
    for (const path of archive.names().filter(path => /\/skin\/(port|land)\/.*\.ini$/.test(path))) {
      const doc = IniDocument.parse(archive.getText(path))
      doc.removeSections(doc.sections().filter(section => /^KEY\d+$/.test(section) && doc.get(section, 'CENTER') === 'F11'))
      archive.setText(path, doc.toString())
    }
  }
  return archive.platformBytesAsync(format)
}
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 41842, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('pageerror', error => errors.push(error.message))
const file = (name, bytes) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
const openSkin = async (name, bytes) => {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles(file(name, bytes))
  await page.waitForFunction(async () => {
    const { appState } = await import('/src/app/state.ts')
    return appState.archive && !appState.fileOperationRunning
  })
}
const openDialog = async () => {
  await page.locator('.pen-file-menu > summary').click()
  await page.locator('#layout-conversion').click()
  await page.locator('#layout-conversion-dialog').waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('#layout-conversion-template')?.options.length > 0 && !document.querySelector('#layout-conversion-layout').disabled)
}
const snapshot = () => page.evaluate(async () => {
  const { appState } = await import('/src/app/state.ts')
  const path = appState.archive.format === 'sxi' ? 'skin.json' : appState.layoutPath
  return { text: appState.archive.getText(path), history: appState.undoStack.length, changed: [...appState.archive.changed],
    styles: Object.fromEntries(appState.archive.names().filter(path => path.endsWith('/default.css')).map(path => [path, appState.archive.getText(path)])) }
})
try {
  for (const [format, bytes] of [['bds', bds], ['bdi', bdi], ['sxi', palm]]) {
    await openSkin(`source.${format}`, bytes)
    assert.equal(await page.locator('#layout-conversion').isDisabled(), true, 'preview mode cannot apply layouts')
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    await page.evaluate(async path => (await import('/src/app/navigation.ts')).selectFile(path, 'overview'), format === 'sxi' ? address : sourcePath)
    const before = await snapshot()
    const template = templateFor(bytes, format)
    await openDialog()
    assert.equal(await page.locator('#layout-conversion-delete').isDisabled(), true, 'built-in templates cannot be deleted')
    if (format === 'bds') {
      const rejected = await page.evaluate(async bytes => {
        const { saveLayoutTemplate, deleteLayoutTemplate, layoutTemplates } = await import('/src/layout-templates.ts')
        let builtinProtected = false
        try { await deleteLayoutTemplate('builtin:pinyin18') } catch { builtinProtected = true }
        const put = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function (...args) {
          const request = put.apply(this, args)
          this.transaction.abort()
          return request
        }
        let failedSave = false
        try { await saveLayoutTemplate('failed.bds', new Uint8Array(bytes)) } catch { failedSave = true }
        finally { IDBObjectStore.prototype.put = put }
        return { builtinProtected, failedSave, templates: (await layoutTemplates()).length }
      }, [...template])
      assert.deepEqual(rejected, { builtinProtected: true, failedSave: true, templates: 1 }, 'aborted storage never reports a saved template')
    }
    await page.locator('#layout-conversion-file').setInputFiles(file('template.bds', template))
    await page.waitForFunction(() => document.querySelector('#layout-conversion-template').value.startsWith('user:') && !document.querySelector('#layout-conversion-apply').disabled)
    const storedId = await page.locator('#layout-conversion-template').inputValue()
    assert.equal(await page.locator('#layout-conversion-layout option').count(), 2, 'theme and orientation copies share one layout choice')
    assert.doesNotMatch(await page.locator('#layout-conversion-layout').textContent(), /浅色|深色|竖屏|横屏/)
    await page.locator('#layout-conversion-layout').selectOption('light/skin/port/en_26.ini')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.locator('#layout-conversion-dialog').waitFor({ state: 'detached' })
    assert.deepEqual(await snapshot(), before, 'cancel does not alter skin or history')

    await openSkin(`source.${format}`, bytes)
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    await page.evaluate(async path => (await import('/src/app/navigation.ts')).selectFile(path, 'overview'), format === 'sxi' ? address : sourcePath)

    await openDialog()
    assert.equal(await page.locator(`#layout-conversion-template option[value="${storedId}"]`).count(), 1, 'the uploaded template survives a reload')
    await page.locator('#layout-conversion-file').setInputFiles(file('bad.ssf', new Uint8Array([1, 2, 3])))
    await page.getByRole('alert').filter({ hasText: '请上传 BDS' }).waitFor()
    assert.equal(await page.locator('#layout-conversion-apply').isDisabled(), true)
    await page.locator('#layout-conversion-file').setInputFiles(file('template.bds', template))
    await page.waitForFunction(() => document.querySelector('#layout-conversion-template').value.startsWith('user:') && !document.querySelector('#layout-conversion-apply').disabled)
    assert.equal(await page.locator(`#layout-conversion-template option[value="${storedId}"]`).count(), 1, 're-uploading the same template does not duplicate it')
    await page.locator('#layout-conversion-layout').selectOption('light/skin/port/en_26.ini')
    if (format === 'bds') {
      await page.locator('#layout-conversion-dialog').evaluate(async node => {
        await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))
      })
      mkdirSync(`${root}/.ui-current`, { recursive: true })
      await page.screenshot({ path: `${root}/.ui-current/layout-conversion-desktop.png` })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.screenshot({ path: `${root}/.ui-current/layout-conversion-mobile.png` })
      const fits = await page.locator('#layout-conversion-dialog').evaluate(node => {
        const r = node.getBoundingClientRect()
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
      })
      assert.equal(fits, true, 'the dialog fits the phone viewport')
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await page.locator('#layout-conversion-apply').click()
    await page.locator('#layout-conversion-dialog').waitFor({ state: 'detached' })
    const after = await snapshot()
    assert.equal(after.history, before.history + 1, 'one history step')
    assert.notEqual(after.text, before.text)
    assert.deepEqual(after.changed.filter(path => !before.changed.includes(path)), [format === 'sxi' ? 'skin.json' : sourcePath])
    const result = await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      const { readConversionLayout } = await import('/src/layout-conversion.ts')
      const layout = readConversionLayout(appState.archive, appState.layoutPath)
      return { keys: layout.keys.length, first: layout.keys[0].actions.CENTER, rect: layout.keys[0].rect }
    })
    assert.equal(result.keys, 2)
    assert.equal(result.first, 'w')
    assert.deepEqual(result.rect, [20, 20, 100, 70], 'the chosen template layout supplies the geometry')
    await page.locator('#desktop-undo').click()
    assert.equal((await snapshot()).text, before.text)
    await page.locator('#desktop-redo').click()
    assert.equal((await snapshot()).text, after.text)
    await openDialog()
    await page.locator('#layout-conversion-template').selectOption(storedId)
    await page.waitForFunction(() => !document.querySelector('#layout-conversion-delete').disabled)
    await page.locator('#layout-conversion-delete').click()
    await page.getByRole('dialog', { name: '删除布局模板？' }).getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(await page.locator(`#layout-conversion-template option[value="${storedId}"]`).count(), 1)
    await page.locator('#layout-conversion-delete').click()
    await page.getByRole('dialog', { name: '删除布局模板？' }).getByRole('button', { name: '删除', exact: true }).click()
    await page.waitForFunction(id => ![...document.querySelector('#layout-conversion-template').options].some(option => option.value === id), storedId)
    assert.equal(await page.locator('#layout-conversion-delete').isDisabled(), true)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.locator('#layout-conversion-dialog').waitFor({ state: 'detached' })
    assert.equal((await snapshot()).text, after.text, 'deleting a template does not change the current skin')
    await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
    await openDialog()
    await page.waitForFunction(() => !document.querySelector('#layout-conversion-apply').disabled)
    assert.equal(await page.locator('#layout-conversion-layout option').count(), 1)
    assert.equal(await page.locator('#layout-conversion-layout').isVisible(), false, 'a single layout does not need a second selector')
    if (format === 'bds') {
      await page.locator('#layout-conversion-dialog').evaluate(async node => {
        await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))
      })
      await page.screenshot({ path: `${root}/.ui-current/layout-conversion-builtin.png` })
    }
    await page.locator('#layout-conversion-apply').click()
    await page.locator('#layout-conversion-dialog').waitFor({ state: 'detached' })
    const count = await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      return (await import('/src/layout-conversion.ts')).readConversionLayout(appState.archive, appState.layoutPath).keys.length
    })
    assert.equal(count, 26, '18 letter keys and 8 function keys from the built-in template')
    if (format === 'bds' || format === 'sxi') {
      await page.screenshot({ path: `${root}/.ui-current/layout-conversion-18-${format}.png` })
    }
    console.log(`${format}: template persistence, duplicate import, delete protection, conversion, undo and redo passed`)

    await openSkin(`missing-button.${format}`, await missingButtonSkin(bytes, format))
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    const nine = (format === 'sxi' ? address : sourcePath).replace('full26Pinyin', 't9Pinyin').replace('py_26', 'py_9')
    await page.evaluate(async path => (await import('/src/app/navigation.ts')).selectFile(path, 'overview'), nine)
    const nineBefore = await snapshot()
    await openDialog()
    await page.waitForFunction(() => !document.querySelector('#layout-conversion-apply').disabled)
    assert.equal(await page.getByRole('alert').textContent(), '')
    await page.locator('#layout-conversion-apply').click()
    await page.locator('#layout-conversion-dialog').waitFor({ state: 'detached' })
    const nineAfter = await snapshot()
    assert.equal(nineAfter.history, nineBefore.history + 1, 'fallback keys and typography are one undo step')
    const missing = await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      const layout = (await import('/src/layout-conversion.ts')).readConversionLayout(appState.archive, appState.layoutPath)
      return { actions: layout.keys.map(key => key.actions.CENTER), pair: layout.document?.get('KEY2', 'FORE_STYLE') ?? layout.board.keys[1].b.base_f }
    })
    assert.equal(missing.actions.length, 26)
    assert.ok(missing.actions.includes('F11'), 'a missing caps lock key is created with its correct action')
    assert.deepEqual(missing.pair, format === 'sxi' ? [98, 100] : '2,3', 'T9 letter groups must not be reused for single-letter artwork')
    await page.screenshot({ path: `${root}/.ui-current/layout-conversion-missing-${format}.png` })
    await page.locator('#desktop-undo').click()
    const undone = await snapshot()
    assert.equal(undone.text, nineBefore.text)
    assert.deepEqual(undone.styles, nineBefore.styles, 'undo also restores added text styles')
    await page.locator('#desktop-redo').click()
    assert.equal((await snapshot()).text, nineAfter.text)
    assert.deepEqual((await snapshot()).styles, nineAfter.styles)
    console.log(`${format}: 9-key to 18-key with a missing button, style isolation and undo passed`)
  }
  const cssless = SkinArchive.open(await missingButtonSkin(bds, 'bds'))
  for (const path of cssless.names().filter(path => path.endsWith('/default.css'))) cssless.delete(path)
  await openSkin('no-styles.bds', await cssless.platformBytesAsync('bds'))
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await page.evaluate(async path => (await import('/src/app/navigation.ts')).selectFile(path, 'overview'), sourcePath)
  const noStyles = await snapshot()
  await openDialog()
  await page.waitForFunction(() => !document.querySelector('#layout-conversion-apply').disabled)
  await page.locator('#layout-conversion-apply').click()
  await page.locator('#layout-conversion-dialog').waitFor({ state: 'detached' })
  assert.equal((await snapshot()).history, noStyles.history + 1)
  assert.ok(Object.keys((await snapshot()).styles).length)
  await page.locator('#desktop-undo').click()
  assert.deepEqual((await snapshot()).styles, noStyles.styles, 'undo removes a newly created text stylesheet')
  assert.equal((await snapshot()).text, noStyles.text)
  for (const [name, bytes] of [['unsupported.bda', bdaAnimatedSkinBytes()], ['unsupported.ssf', ssfFixture()]]) {
    await openSkin(name, bytes)
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    assert.equal(await page.locator('#layout-conversion').evaluate(node => node.hidden), true, name)
    assert.equal(await page.locator('#layout-conversion').isDisabled(), true, name)
  }
  assert.deepEqual(errors, [])
} catch (error) {
  console.error(await page.locator('#layout-conversion-dialog').textContent().catch(() => ''), errors)
  throw error
} finally {
  await browser.close()
  await server.close()
}
