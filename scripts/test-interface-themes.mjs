import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { openEditorTemplate } from '../tests/helpers/open-editor-template.mjs'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41925, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(() => localStorage.setItem('onboarding-tour-v1', 'done'))
mkdirSync('.ui-current/interface-themes', { recursive: true })
const themes = [
  ['refined', 'light', '#293448'], ['workbench', 'dark', '#E6EAF3'],
  ['paper', 'light', '#2A2622'], ['industrial', 'light', '#111111'],
  ['aurora', 'light', '#2A2640'], ['terminal', 'dark', '#CBEDD8'],
  ['rose-quartz', 'light', '#30222A'], ['deep-sea', 'dark', '#ECF6FF'],
]
const openSettings = async () => {
  await page.locator('#workspace-navigation [data-settings-entry="settings"]').click()
  await page.locator('#settings-workspace:not([hidden])').waitFor()
}
const themeList = page.getByRole('listbox', { name: '界面主题', exact: true })
const themeCard = name => themeList.locator(`[role="option"][data-value="${name}"]`)
const choose = async name => {
  await themeCard(name).click()
  await page.waitForFunction(value => document.documentElement.dataset.interfaceTheme === value, name)
  assert.equal(await themeCard(name).getAttribute('aria-selected'), 'true')
}
const closeSettings = async action => {
  await page.locator(`#settings-${action}`).click()
  await page.locator('#settings-workspace').waitFor({ state: 'hidden' })
}
const capture = async name => {
  await page.evaluate(async () => { await document.fonts.ready })
  await page.screenshot({ path: `.ui-current/interface-themes/${name}.png` })
}
const layout = selectors => page.evaluate(items => items.map(selector => {
  const node = document.querySelector(selector)
  const rect = node.getBoundingClientRect()
  const style = getComputedStyle(node)
  return [selector, ...[rect.x, rect.y, rect.width, rect.height].map(Math.round), style.display, style.gridTemplateColumns]
}), selectors)
const textToken = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text').trim().toUpperCase())

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.waitForFunction(() => document.documentElement.dataset.interfaceTheme === 'default')
  await page.evaluate(async () => { await document.fonts.ready })
  const defaultText = await textToken()
  const homeSelectors = ['#workspace-navigation', '.welcome-main', '.project-template-grid', '.project-template-card', '.template-preview']
  const defaultHome = await layout(homeSelectors)
  await capture('default-home')
  await openSettings()
  assert.equal(await themeList.getByRole('option').count(), themes.length + 1)
  await page.waitForFunction(() => [...document.querySelectorAll('#settings-theme-list img')].every(image => image.naturalWidth > 0))
  assert.equal(await themeList.locator('img').count(), themes.length + 1)
  assert.equal(await themeList.evaluate(list => list.scrollWidth > list.clientWidth && [...list.children].every(card => card.offsetTop === list.firstElementChild.offsetTop)), true, 'theme cards share one scrollable row')
  assert.equal(await themeCard('default').getAttribute('aria-selected'), 'true')
  await capture('theme-cards-desktop')
  await themeCard('default').press('ArrowRight')
  assert.equal(await themeCard('refined').getAttribute('aria-selected'), 'true')
  await page.keyboard.press('End')
  assert.equal(await themeCard('deep-sea').getAttribute('aria-selected'), 'true')
  assert.equal(await themeCard('deep-sea').evaluate(card => document.activeElement === card), true)
  assert.ok(await themeList.evaluate(list => list.scrollLeft) > 0)
  await page.keyboard.press('ArrowUp')
  assert.equal(await themeCard('deep-sea').getAttribute('aria-selected'), 'true', 'vertical arrows do not select a theme')
  await page.keyboard.press('Home')
  assert.equal(await themeCard('default').getAttribute('aria-selected'), 'true')
  await choose('paper')
  assert.equal(await textToken(), '#2A2622')
  assert.equal(await page.evaluate(() => localStorage.getItem('interface-theme')), null, 'preview remains uncommitted')
  await closeSettings('cancel')
  assert.equal(await textToken(), defaultText, 'cancel restores the default palette')
  assert.equal(await page.locator('#settings-theme-list [aria-selected="true"]').getAttribute('data-value'), 'default')
  assert.equal(await page.locator('#app-theme').isDisabled(), false)
  for (const [name, scheme, text] of themes) {
    await openSettings()
    await choose(name)
    assert.equal(await page.locator('#app-theme').isDisabled(), true)
    assert.equal(await page.locator('#interface-theme-note').isVisible(), true)
    assert.equal(await page.locator('html').getAttribute('data-app-theme'), scheme)
    assert.equal(await page.locator(`[data-setting-choice="app-theme"][data-value="${scheme}"]`).getAttribute('aria-pressed'), 'true')
    assert.equal(await textToken(), text)
    await closeSettings('save')
    assert.equal(await page.evaluate(() => localStorage.getItem('interface-theme')), name)
    assert.deepEqual(await layout(homeSelectors), defaultHome, `${name} preserves homepage geometry`)
    if (name === 'deep-sea') {
      await page.locator('html').evaluate(root => root.classList.add('macos'))
      assert.match(await page.locator('.empty-state').evaluate(el => getComputedStyle(el).backgroundImage), /repeating-radial-gradient/)
      assert.equal(await page.locator('.file-page-drag-region').evaluate(el => getComputedStyle(el).backgroundImage), 'none')
      await page.locator('html').evaluate(root => root.classList.remove('macos'))
    }
    await capture(`${name}-home`)
    await page.reload()
    await page.waitForFunction(value => document.documentElement.dataset.interfaceTheme === value, name)
    assert.equal(await textToken(), text, 'saved theme survives reload')
    await page.emulateMedia({ colorScheme: scheme === 'light' ? 'dark' : 'light' })
    assert.equal(await page.locator('html').getAttribute('data-app-theme'), scheme, 'design palette keeps its original mode')
    // Material selectors must not replace a design palette on Windows or glass surfaces.
    await page.evaluate(() => {
      document.documentElement.classList.add('windows')
      document.documentElement.dataset.windowMaterialKind = 'glass'
    })
    assert.equal(await textToken(), text)
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--material-window').trim()), 'transparent')
    await page.evaluate(() => {
      document.documentElement.classList.remove('windows')
      document.documentElement.dataset.windowMaterialKind = 'none'
    })
  }
  await openSettings()
  await choose('default')
  await page.locator('[data-setting-choice="app-theme"][data-value="light"]').click()
  await closeSettings('save')
  assert.equal(await textToken(), defaultText)
  await openEditorTemplate(page, 'official-android-bds')
  await page.evaluate(async () => { window.themeArchive = (await import('/src/app/state.ts')).appState.archive })
  const editorSelectors = ['#workspace-navigation', '#files', '.canvas-wrap', '#quick-inspector']
  const defaultEditor = await layout(editorSelectors)
  await capture('default-editor')
  for (const [name] of themes) {
    await openSettings()
    await choose(name)
    await capture(`${name}-settings`)
    await closeSettings('save')
    assert.deepEqual(await layout(editorSelectors), defaultEditor, `${name} preserves editor geometry`)
    assert.equal(await page.evaluate(async () => window.themeArchive === (await import('/src/app/state.ts')).appState.archive), true, 'theme changes preserve the skin document')
    await capture(`${name}-editor`)
    await openSettings()
    await page.locator('#window-material').uncheck()
    await closeSettings('save')
    assert.deepEqual(await layout(editorSelectors), defaultEditor)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#mobile-navigation [data-settings-entry="settings"]').click()
  await page.locator('#settings-workspace:not([hidden])').waitFor()
  await page.getByRole('button', { name: '更多外观设置', exact: true }).click()
  assert.equal(await themeList.evaluate(list => list.scrollWidth > list.clientWidth && list.getBoundingClientRect().right <= document.documentElement.clientWidth), true, 'only the carousel scrolls horizontally on mobile')
  await themeCard('deep-sea').press('Home')
  await capture('theme-cards-mobile')
  for (const name of ['paper', 'deep-sea', 'rose-quartz']) {
    await choose(name)
    await capture(`${name}-mobile-settings`)
  }
  await closeSettings('cancel')
  assert.equal(await page.locator('html').getAttribute('data-interface-theme'), 'deep-sea')
  assert.deepEqual(errors, [])
  console.log(`PASS interface themes: ${themes.length} palettes, default restoration, preview/cancel/save/reload, fixed modes, material compatibility, unchanged home/editor layout and mobile settings`)
} finally {
  await browser.close()
  await server.close()
}
