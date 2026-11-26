import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dismissStartupDisclaimer, openEditorTemplate } from '../tests/helpers/open-editor-template.mjs'

const root = new URL('..', import.meta.url).pathname
const output = `${root}.ui-current/mobile-home`
mkdirSync(output, { recursive: true })
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 41767, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' })
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
  await dismissStartupDisclaimer(page)
  await page.locator('#mobile-welcome-new').waitFor()
  assert.equal(await page.locator('.mobile-welcome-hero h1').textContent(), '键设')
  for (const selector of ['.titlebar', '.preview-toolbar', '.preview-zoom-control', '#layout-overview-toggle']) {
    assert.equal(await page.locator(`${selector}:visible`).count(), 0, `${selector} must not appear on the mobile home`)
  }
  const canvas = await page.locator('.canvas-wrap.empty').boundingBox()
  const welcome = await page.locator('.canvas-wrap.empty .empty-state').boundingBox()
  assert.deepEqual(welcome, canvas, 'the welcome view fills the canvas without a scroll gutter')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight))
  assert.equal(await page.locator('.mobile-welcome-empty h2').textContent(), '网页版不记录最近打开的皮肤')
  assert.equal(await page.locator('.mobile-welcome-empty').isVisible(), true)
  assert.equal(await page.locator('.welcome-main .template-card:visible').count(), 0)
  assert.equal(await page.locator('#welcome-recent-empty').isVisible(), false)
  assert.equal(await page.locator('.welcome-recent h2').isVisible(), false)
  assert.equal(await page.locator('#recent-clear').isVisible(), false)
  assert.equal(await page.locator('#mobile-navigation').isVisible(), true)
  assert.equal(await page.locator('#mobile-navigation [aria-current=page]').textContent(), '首页')
  assert.equal(await page.locator('#mobile-navigation [data-mobile-page=edit]').isDisabled(), true)
  assert.equal(await page.locator('.ui-mobile-navigation').count(), 1)
  const [create, open] = await Promise.all(['#mobile-welcome-new', '#mobile-welcome-open'].map(selector => page.locator(selector).boundingBox()))
  assert.equal(create.y, open.y, 'home actions share one row')
  assert.equal(create.height, 44)
  const navButtons = page.locator('#mobile-navigation button:visible')
  assert.deepEqual(await navButtons.allTextContents(), ['首页', '编辑', '资源', '设置'])
  const widths = await navButtons.evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().width))
  assert.ok(Math.max(...widths) - Math.min(...widths) < 1, 'browser navigation uses all four equal columns')
  assert.ok(Math.abs(create.width - open.width) < 1, 'home actions have equal width')
  const nav = await page.locator('#mobile-navigation').boundingBox()
  assert.ok(create.y + create.height <= nav.y && nav.y - create.y < 80, 'home actions sit just above navigation')
  await capture('empty')
  const navigation = await page.locator('#mobile-navigation').evaluate(node => { window.homeNavigation = node; return node.getBoundingClientRect().toJSON() })
  await page.locator('#mobile-welcome-new').click()
  await page.locator('#new-project-dialog[open]').waitFor()
  await closeDialog()
  await Promise.all([page.waitForEvent('filechooser'), page.locator('#mobile-welcome-open').click()])
  assert.equal(await page.locator('dialog[open]').count(), 0)
  await page.locator('#mobile-navigation [data-settings-entry=settings]').click()
  await page.locator('#settings-workspace:not([hidden])').waitFor()
  const settings = page.locator('.mobile-settings-overview')
  assert.equal(await settings.getByRole('button', { name: /^(文件|清除记录|ADB 预览)$/ }).count(), 0)
  await settings.getByRole('button', { name: '源代码', exact: true }).click()
  assert.equal(await page.locator('#settings-panel-source').isVisible(), true)
  await page.getByRole('button', { name: '返回设置' }).click()
  const theme = page.locator('.settings-appearance-mode')
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const layout = await theme.evaluate(group => ({
      row: group.parentElement.getBoundingClientRect().width,
      group: group.getBoundingClientRect().width,
      buttons: [...group.querySelectorAll('button')].map(b => b.getBoundingClientRect().toJSON()),
    }))
    assert.ok(layout.row - layout.group < 26 && layout.row > layout.group, 'appearance control fills the row inside its padding')
    assert.ok(layout.buttons.every(b => b.height >= 44 && Math.abs(b.width - layout.buttons[0].width) < 1))
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await theme.getByRole('button', { name: '深色' }).click()
  assert.equal(await theme.getByRole('button', { name: '深色' }).getAttribute('aria-pressed'), 'true')
  await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'dark')
  await page.locator('.mobile-settings-account').scrollIntoViewIfNeeded()
  await capture('settings-dark')
  await theme.getByRole('button', { name: '浅色' }).click()
  await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'light')
  await page.locator('.mobile-settings-account').scrollIntoViewIfNeeded()
  await capture('settings-light')
  await page.locator('#settings-cancel').click()
  await page.locator('#settings-workspace').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('#app-theme').inputValue(), 'system', 'cancel restores the opening appearance')
  await openEditorTemplate(page, 'official-android-bds', { preview: true })
  assert.equal(await page.locator('#mode').inputValue(), 'preview')
  assert.equal(await page.locator('main > .source').isVisible(), false)
  await capture('first-preview')
  await page.getByRole('button', { name: '开始编辑' }).click()
  assert.equal(await page.locator('#mode').inputValue(), 'edit')
  assert.equal(await page.locator('main > .source').isVisible(), true)
  assert.equal(await page.locator('#mobile-navigation [aria-current=page]').textContent(), '编辑')
  assert.equal(await page.locator('#mobile-navigation').evaluate(node => node === window.homeNavigation), true, 'same navigation element survives page switches')
  assert.deepEqual(await page.locator('#mobile-navigation').evaluate(node => node.getBoundingClientRect().toJSON()), navigation)
  const documentBefore = await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    window.homeArchive = appState.archive
    return { undo: appState.undoStack.length, unsaved: appState.unsavedNew }
  })
  await page.locator('#mobile-navigation [data-mobile-page=home]').click()
  assert.equal(await page.locator('#mobile-navigation [aria-current=page]').textContent(), '首页')
  assert.equal(await page.locator('dialog[open]').count(), 0, 'switching pages does not ask to discard the document')
  await page.locator('#mobile-navigation [data-mobile-page=edit]').click()
  assert.deepEqual(await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    return { undo: appState.undoStack.length, unsaved: appState.unsavedNew, same: appState.archive === window.homeArchive }
  }), { ...documentBefore, same: true })
  await page.locator('#mobile-navigation [data-mobile-page=resources]').click()
  assert.equal(await page.locator('#mobile-navigation [aria-current=page]').getAttribute('data-mobile-page'), 'resources')
  await page.locator('#mobile-navigation [data-mobile-page=home]').click()
  await page.locator('#mobile-welcome-new').waitFor()
  await page.locator('#mobile-navigation [data-mobile-page=edit]').click()
  assert.equal(await page.locator('#mobile-navigation [aria-current=page]').textContent(), '编辑')
  assert.equal(await page.locator('main > .source').isVisible(), true)
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
    document.querySelector('#document-name').textContent = '薄雾蓝.bds'
    appState.unsavedNew = false
    document.querySelector('.canvas-wrap').classList.add('empty')
    renderRecentFiles()
  })
  await page.waitForFunction(() => [...document.querySelectorAll('.recent-card .template-preview')].every(node => node.dataset.preview === 'rendered'))
  assert.equal(await page.locator('.mobile-welcome-empty').isVisible(), false)
  assert.match(await page.locator('#welcome-recent-grid .ui-skin-entry-meta').first().textContent(), /刚刚 · BDS · 1\.8 MB/)
  assert.equal(await page.locator('.recent-card .template-preview img').count(), 3, 'only recent rows display thumbnails')
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px page fits`)
    const rows = await page.locator('#welcome-recent-grid .recent-card').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))
    assert.ok(rows.every(row => row.width === width - 42 && row.height === 72), 'recent rows fill the bordered single-column list')
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
  const footer = await page.locator('.mobile-welcome-actions').boundingBox()
  await page.locator('#welcome-recent-grid .recent-card').last().scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'long names stay inside the page')
  const last = await page.locator('#welcome-recent-grid .recent-card').last().boundingBox()
  assert.ok(last.y + last.height <= footer.y, 'last record scrolls above the actions')
  assert.deepEqual(await page.locator('.mobile-welcome-actions').boundingBox(), footer, 'footer stays in place')
  assert.equal((await page.locator('.mobile-welcome-hero').boundingBox()).y, 0, 'home header remains visible while scrolling')
  await page.locator('#mobile-navigation [data-mobile-page=home]').click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await capture('recent-dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 390, height: 844 })
  const depth = await page.evaluate(async () => (await import('/src/app/state.ts')).appState.undoStack.length)
  await page.locator('#mobile-navigation [data-mobile-page=resources]').click()
  await page.locator('#mobile-navigation [data-mobile-page=home]').click()
  await page.locator('#welcome-recent-grid .recent-card').first().click()
  assert.equal(await page.locator('#mode').inputValue(), 'preview', 'opening the current recent skin returns to preview')
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  await page.locator('.canvas-wrap:not(.empty)').waitFor()
  assert.equal(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.undoStack.length), depth, 'reopening the current record preserves undo history')
  assert.equal(await page.locator('#mobile-navigation [aria-current=page]').textContent(), '编辑')
  await page.evaluate(() => { document.querySelector('.canvas-wrap').classList.add('empty'); document.querySelector('#recent-clear').click() })
  assert.equal(await page.locator('#document-name').textContent(), '薄雾蓝.bds', 'clearing recent records retains the current document')
  assert.equal(await page.locator('.mobile-welcome-empty').isVisible(), true)
  assert.equal(await page.locator('#welcome-recent-empty').isVisible(), false)
  assert.equal(await page.locator('.welcome-recent h2').isVisible(), false)
  assert.equal(await page.locator('.recent-card[data-variant=recent]').count(), 0)
  // 用同一个测试服务走客户端预览域名，覆盖有最近记录时真正可点的设置入口。
  await page.route('http://127.0.0.1:4173/**', async route => route.fulfill({ response: await route.fetch({ url: route.request().url().replace(':4173/', `:${server.httpServer.address().port}/`) }) }))
  await page.goto('http://127.0.0.1:4173/')
  await dismissStartupDisclaimer(page)
  await page.locator('#mobile-navigation [data-settings-entry=settings]').click()
  await settings.getByRole('button', { name: '文件', exact: true }).click()
  assert.equal(await page.locator('#recent-history-limit').isVisible(), true)
  await page.getByRole('button', { name: '返回设置' }).click()
  await settings.getByRole('button', { name: 'AI 模型', exact: true }).click()
  assert.equal(await page.locator('#settings-model-section').isVisible(), true)
  assert.equal(await page.locator('.mobile-model-notice').isVisible(), false)
  await page.getByRole('button', { name: '返回设置' }).click()
  const clear = settings.getByRole('button', { name: '清除记录', exact: true })
  assert.equal(await clear.isVisible(), false)
  await page.evaluate(async () => (await import('/src/app/recent-files.ts')).recordRecentFile('/fixtures/薄雾蓝.bds', '薄雾蓝'))
  await clear.click()
  const confirm = page.getByRole('dialog', { name: '清除最近打开记录？' })
  await confirm.getByRole('button', { name: '取消' }).click()
  await confirm.waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.recent-card').count(), 1)
  await clear.click()
  await confirm.getByRole('button', { name: '清除记录', exact: true }).click()
  await clear.waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.recent-card').count(), 0)
  assert.deepEqual(errors, [])
  writeFileSync(`${output}/result.json`, JSON.stringify({ passed: true, widths: [320, 390, 430], errors }, null, 2))
  console.log('PASS mobile home: empty, real recent previews, responsive, dark theme, new/open/settings, reopen and clear')
} finally {
  await browser.close()
  await server.close()
}
