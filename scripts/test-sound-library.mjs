import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { mkdirSync } from 'node:fs'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41851, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const errors = []
const screenshots = process.env.PI_SCRATCH_DIR
if (screenshots) mkdirSync(screenshots, { recursive: true })
const fingerprint = page => page.evaluate(async () => {
  const { appState } = await import('/src/app/state.ts')
  return { revision: appState.archive.revision, undo: appState.undoStack.length }
})
try {
  for (const colorScheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('.template-grid .template-card[data-template="official-android-bds"]').click()
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    // Key sound is a separate inspector category, not part of visual styles.
    await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      const { selectFile } = await import('/src/app/navigation.ts')
      const { populateKeyInspector } = await import('/src/app/key-inspector.ts')
      selectFile(appState.layoutPath, 'overview')
      appState.selectedKeySections = [appState.layoutDocument.sections().find(name => /^KEY\d+$/.test(name))]
      populateKeyInspector()
    })
    const soundGroup = page.locator('.key-only[data-inspector-group-label="音效"]')
    const soundNav = page.locator('#mobile-inspector-groups button[title="音效"]')
    await soundNav.click()
    assert.equal(await soundGroup.isVisible(), true)
    // 隐藏的引用输入框 + 一张音效引用卡（卡片编号是它的克隆）
    assert.equal(await soundGroup.locator('input[data-key-field="SOUND_STYLE"]:not(.ui-style-ref-number)').count(), 1)
    assert.equal(await soundGroup.locator('.ui-style-ref').count(), 1)
    assert.equal(await page.locator('.key-appearance-fields [data-key-field="SOUND_STYLE"]').count(), 0)
    assert.equal(await soundGroup.locator('h3').getAttribute('title'), 'SOUND_STYLE')
    await page.keyboard.press('ControlOrMeta+f')
    await page.locator('#inspector-filter').fill('SOUND_STYLE')
    assert.equal(await soundGroup.getAttribute('data-filter-miss'), null)
    assert.equal(await page.locator('.key-appearance-fields').getAttribute('data-filter-miss'), '')
    await page.locator('#inspector-filter').press('Escape')
    await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      appState.selectedKeySections = []
      const { populateKeyInspector } = await import('/src/app/key-inspector.ts')
      populateKeyInspector()
    })
    assert.equal(await soundGroup.isVisible(), false)
    assert.equal(await soundNav.count(), 0)
    // Use real playable PCM data so playback/ended are tested, not mocked.
    await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      const { selectFile } = await import('/src/app/navigation.ts')
      const bytes = new Uint8Array(44 + 16000)
      const view = new DataView(bytes.buffer)
      const text = (at, value) => [...value].forEach((c, i) => { bytes[at + i] = c.charCodeAt(0) })
      text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
      view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
      text(36, 'data'); view.setUint32(40, 16000, true)
      for (let n = 0; n < 8000; n++) view.setInt16(44 + n * 2, Math.sin(n * 0.3) * 100, true)
      for (const name of ['a_click.wav', 'b_soft.wav', 'c_a_very_long_audio_filename_for_overflow_testing.wav']) appState.archive.setBytes(`light/skin/res/${name}`, bytes)
      selectFile(appState.selectedPath, 'overview', 'sound')
    })
    const rows = page.locator('.ui-sound-row')
    assert.ok(await rows.count() >= 3)
    const before = await fingerprint(page)
    await page.locator('[data-sound-id="file:light/skin/res/a_click.wav"]').click()
    assert.equal(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.keySoundPath), '')
    const selected = page.locator('.ui-sound-preview')
    await selected.getByRole('button', { name: '试听音效', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.ui-sound-row[data-playing="true"]'))
    await selected.getByRole('button', { name: '停止试听', exact: true }).click()
    assert.equal(await page.locator('.ui-sound-row[data-playing="true"]').count(), 0)
    await selected.getByRole('button', { name: '试听音效', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.ui-sound-preview [role="status"]').textContent === '试听结束')
    assert.deepEqual(await fingerprint(page), before, 'selection and audition never modify the archive')
    await page.locator('[data-sound-id="file:light/skin/res/a_click.wav"]').focus()
    await page.keyboard.press('ArrowDown')
    assert.equal(await page.locator('[data-sound-id="file:light/skin/res/b_soft.wav"]').getAttribute('aria-selected'), 'true')
    await page.locator('#resource-search').fill('no-such-audio')
    await page.locator('.ui-sound-list > .ui-empty').waitFor()
    assert.match(await page.locator('#resource-count').textContent(), /^0 \/ /)
    await page.locator('#resource-search').press('Escape')
    assert.equal(await page.locator('#resource-search').inputValue(), '')
    await page.locator('#resource-search').fill('.wav')
    assert.equal(await rows.count(), 3)
    await page.locator('#resource-search').fill('')
    // Replacement keeps original filename and every reference, and uses one undo step.
    const result = await page.evaluate(async () => {
      const { appState } = await import('/src/app/state.ts')
      const { uploadKeySound } = await import('/src/app/resource-inspector.ts')
      const target = 'light/skin/res/b_soft.wav'
      const data = appState.archive.getBytes(target).slice()
      data[44] ^= 1
      const undo = appState.undoStack.length
      await uploadKeySound(new File([data], 'other-name.wav'), target)
      let rejected = false
      try { await uploadKeySound(new File([data], 'wrong.ogg'), target) } catch { rejected = true }
      return { undo: appState.undoStack.length - undo, original: Boolean(appState.archive.getBytes(target)), renamed: Boolean(appState.archive.getBytes('light/skin/res/other-name.wav')), rejected }
    })
    assert.deepEqual(result, { undo: 1, original: true, renamed: false, rejected: true })
    await page.evaluate(() => {
      window.showSaveFilePicker = async options => {
        window.savedSoundName = options.suggestedName
        return { createWritable: async () => ({ write: async bytes => { window.savedSoundBytes = bytes.byteLength }, close: async () => {} }) }
      }
    })
    await selected.getByRole('button', { name: '下载选中按键音效', exact: true }).click()
    await page.waitForFunction(() => window.savedSoundBytes > 0)
    assert.equal(await page.evaluate(() => window.savedSoundName), 'b_soft.wav')
    if (screenshots) await page.screenshot({ path: `${screenshots}/sound-library-${colorScheme}.png` })
    // Narrow inspector: names truncate, actions remain inside the panel.
    await page.evaluate(() => document.documentElement.style.setProperty('--inspector-width', '240px'))
    assert.equal(await page.locator('.ui-sound-library').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
    assert.equal(await page.locator('.ui-sound-preview').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
    if (screenshots) await page.screenshot({ path: `${screenshots}/sound-library-${colorScheme}-narrow.png` })
    await page.close()
  }
  assert.deepEqual(errors, [])
  console.log('PASS sound library: select, keyboard, search, play/stop/end, replacement, download, light/dark, narrow layout')
} finally {
  await browser.close()
  await server.close()
}
