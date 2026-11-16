import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { openEditorTemplate } from '../tests/helpers/open-editor-template.mjs'

const root = new URL('..', import.meta.url).pathname
const output = `${root}.ui-current/mobile-home`
mkdirSync(output, { recursive: true })
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 41767, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(() => localStorage.setItem('onboarding-tour-v1', 'done'))
const capture = async name => {
  await page.evaluate(async () => { await document.fonts.ready })
  await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' })
}
const closeDialog = async () => {
  const dialog = page.locator('dialog[open]').last()
  await dialog.evaluate(node => node.dispatchEvent(new Event('cancel', { cancelable: true })))
  await dialog.waitFor({ state: 'hidden' })
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#mobile-welcome-new').waitFor()
  assert.equal(await page.locator('.mobile-welcome-hero h1').textContent(), '键设 KeySkin')
  assert.equal(await page.locator('#mobile-welcome-resume .template-name').textContent(), '设计你的皮肤')
  assert.equal(await page.locator('#welcome-recent-empty').isVisible(), true)
  assert.equal(await page.locator('.welcome-recent h2').isVisible(), true)
  assert.equal(await page.locator('#recent-clear').isVisible(), false)
  assert.equal(await page.locator('#mobile-navigation').isVisible(), false)
  const [create, open] = await Promise.all(['#mobile-welcome-new', '#mobile-welcome-open'].map(selector => page.locator(selector).boundingBox()))
  assert.equal(create.y, open.y, 'home actions share one row')
  assert.equal(create.height, 48)
  assert.ok(Math.abs(create.width - open.width) < 1, 'home actions have equal width')
  await capture('empty')
  await page.locator('#mobile-home-navigation [data-home-action=new]').click()
  await page.locator('#new-project-dialog[open]').waitFor()
  await closeDialog()
  await page.locator('#mobile-welcome-open').click()
  await page.getByRole('dialog', { name: '打开皮肤', exact: true }).waitFor()
  await closeDialog()
  for (const selector of ['.mobile-welcome-hero [data-app-dialog=settings]', '#mobile-home-navigation [data-app-dialog=settings]']) {
    await page.locator(selector).click()
    await page.locator('#settings-dialog[open]').waitFor()
    await closeDialog()
  }
  await openEditorTemplate(page, 'official-android-bds')
  assert.equal(await page.locator('#mobile-home-navigation').isVisible(), false)
  assert.equal(await page.locator('#mobile-navigation').isVisible(), true)
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { recentPreviewCache, renderRecentFiles } = await import('/src/app/recent-files.ts')
    const records = [
      { path: '/fixtures/薄雾蓝.bds', name: '薄雾蓝', at: Date.now() },
      { path: '/fixtures/奶油白.bda', name: '奶油白', at: Date.now() - 86400000 },
      { path: '/fixtures/午夜蓝.sxi', name: '午夜蓝', at: Date.now() - 8 * 86400000 },
    ]
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' } }, invoke: async (command) => {
      if (command === 'skin_file_stamp') return [1887437, 1]
      if (['plugin:window|set_title', 'plugin:window|set_theme'].includes(command)) return null
      throw new Error(`Unexpected native command: ${command}`)
    } }
    for (const record of records) {
      const image = new Image()
      image.src = '/templates/official-android-bds.png'
      await image.decode()
      recentPreviewCache.set(record.path, { stamp: '1887437:1', image })
    }
    localStorage.setItem('recent-files', JSON.stringify(records))
    document.querySelector('.welcome-recent').removeAttribute('data-platform-hidden')
    appState.currentPath = records[0].path
    appState.unsavedNew = false
    document.querySelector('.canvas-wrap').classList.add('empty')
    renderRecentFiles()
  })
  await page.waitForFunction(() => [...document.querySelectorAll('.recent-card .template-preview')].every(node => node.dataset.preview === 'rendered'))
  assert.equal(await page.locator('#mobile-welcome-resume .template-name').textContent(), '薄雾蓝')
  assert.equal(await page.locator('#mobile-welcome-resume .ui-skin-entry-meta').textContent(), '百度 Android · BDS')
  assert.match(await page.locator('#welcome-recent-grid .ui-skin-entry-meta').first().textContent(), /刚刚 · BDS · 1\.8 MB/)
  assert.equal(await page.locator('.recent-card .template-preview img').count(), 4, 'resume and first recent row both retain their preview')
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px page fits`)
    const rows = await page.locator('#welcome-recent-grid .recent-card').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))
    assert.ok(rows.every(row => row.width === width - 40 && row.height === 72), 'recent rows keep their single-column layout')
    await capture(`recent-${width}`)
  }
  await page.evaluate(async () => {
    const records = JSON.parse(localStorage.getItem('recent-files'))
    const { recentPreviewCache, renderRecentFiles } = await import('/src/app/recent-files.ts')
    for (let i = 3; i < 9; i++) {
      const record = { ...records[0], path: `/fixtures/long-${i}.bds`, name: '很长的皮肤名称用于检查窄屏省略和滚动'.repeat(3) }
      records.push(record)
      const image = new Image()
      image.src = '/templates/official-android-bds.png'
      recentPreviewCache.set(record.path, { stamp: '1887437:1', image })
    }
    localStorage.setItem('recent-files', JSON.stringify(records))
    renderRecentFiles()
  })
  await page.setViewportSize({ width: 320, height: 568 })
  await page.locator('#welcome-recent-grid .recent-card').last().scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'long names stay inside the page')
  const last = await page.locator('#welcome-recent-grid .recent-card').last().boundingBox()
  const footer = await page.locator('#mobile-home-navigation').boundingBox()
  assert.ok(last.y + last.height <= footer.y, 'last record scrolls above the footer')
  assert.equal((await page.locator('.mobile-welcome-hero').boundingBox()).y, 0, 'home header remains visible while scrolling')
  await page.locator('#mobile-home-navigation [data-home-action=home]').click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#mobile-welcome-resume .template-preview img').waitFor()
  await page.emulateMedia({ colorScheme: 'dark' })
  await capture('recent-dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 390, height: 844 })
  const depth = await page.evaluate(async () => (await import('/src/app/state.ts')).appState.undoStack.length)
  await page.locator('#mobile-welcome-resume .recent-card').click()
  await page.locator('.canvas-wrap:not(.empty)').waitFor()
  assert.equal(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.undoStack.length), depth, 'resume preserves the current document')
  assert.equal(await page.locator('#mobile-home-navigation').isVisible(), false)
  await page.evaluate(() => { document.querySelector('.canvas-wrap').classList.add('empty'); document.querySelector('#recent-clear').click() })
  assert.equal(await page.locator('#mobile-welcome-resume .template-name').textContent(), '设计你的皮肤')
  assert.equal(await page.locator('#welcome-recent-empty').isVisible(), true)
  assert.equal(await page.locator('.welcome-recent h2').isVisible(), true)
  assert.equal(await page.locator('.recent-card').count(), 0)
  assert.deepEqual(errors, [])
  writeFileSync(`${output}/result.json`, JSON.stringify({ passed: true, widths: [320, 390, 430], errors }, null, 2))
  console.log('PASS mobile home: empty, real recent previews, responsive, dark theme, new/open/settings, resume and clear')
} finally {
  await browser.close()
  await server.close()
}
