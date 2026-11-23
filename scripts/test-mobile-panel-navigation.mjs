import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dismissStartupDisclaimer, openEditorTemplate } from '../tests/helpers/open-editor-template.mjs'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    localStorage.setItem('onboarding-tour-v1', 'done')
    localStorage.setItem('source-directory-enabled', 'false')
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1,
      invoke: async command => {
        if (command === 'take_opened_files' || command === 'model_oauth_accounts') return []
        if (command === 'load_model_configuration') return { path: 'test.json', configurations: JSON.parse(sessionStorage.getItem('test-models') ?? '[]') }
        if (command === 'plugin:window|scale_factor') return 1
        return null
      },
    }
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await dismissStartupDisclaimer(page)
  const aiEntry = page.locator('#mobile-navigation [data-mobile-page="ai"]')
  const model = { provider: 'openai', protocol: 'openai-chat', apiUrl: 'https://api.example.test/v1', apiKey: 'test', model: 'test-model' }
  for (const [configurations, visible] of [[[], false], [[{ ...model, kind: 'image' }], false], [[model], true]]) {
    await page.evaluate(models => sessionStorage.setItem('test-models', JSON.stringify(models)), configurations)
    await page.reload()
    await page.waitForFunction(() => document.querySelector('#model-configuration-path')?.title === 'test.json')
    assert.equal(await aiEntry.isVisible(), visible)
  }
  await openEditorTemplate(page, 'official-android-bds')
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion })
    const animations = await page.evaluate(async () => {
      const { setMobileInspectorGroup } = await import('/src/app/mobile-layout.ts')
      const group = document.querySelector('#quick-inspector .mobile-inspector-managed')
      const independent = group.animate([{ opacity: 1 }, { opacity: 1 }], { duration: Infinity })
      setMobileInspectorGroup(group.dataset.mobileInspectorGroup)
      setMobileInspectorGroup(group.dataset.mobileInspectorGroup)
      const result = { independent: independent.playState, entering: group.getAnimations().filter(a => a !== independent).length }
      independent.cancel()
      return result
    })
    assert.deepEqual(animations, { independent: 'running', entering: reducedMotion === 'reduce' ? 0 : 1 }, `inspector group re-entry: ${reducedMotion}`)
  }
  const nav = page.locator('#mobile-navigation')
  const current = () => nav.locator('[aria-current=page]').allTextContents()
  const dialog = page.locator('#settings-workspace')
  const title = dialog.locator('#settings-title')
  const layoutField = await page.locator('#document-fields input').first().elementHandle()
  await nav.getByRole('button', { name: '设置' }).tap()
  await dialog.waitFor()
  await nav.getByRole('button', { name: '编辑' }).tap()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await current(), ['编辑'])
  assert.equal(await layoutField.evaluate(field => field.isConnected), true, 'returning to the same layout does not rebuild its properties')
  await nav.getByRole('button', { name: 'AI 设计' }).click()
  await page.getByRole('heading', { name: 'AI 设计', exact: true }).waitFor()
  assert.equal(await page.locator('main > .workspace').isVisible(), false, 'AI conversation has no keyboard preview')
  assert.equal(await page.locator('#mobile-inspector-resize').isVisible(), false, 'AI conversation has no preview divider')
  await nav.getByRole('button', { name: '设置' }).click()
  await dialog.getByRole('button', { name: 'AI 模型', exact: true }).click()
  assert.equal(await dialog.locator('[data-settings-panel=model]').isVisible(), true, 'model settings opens from settings home')
  assert.equal(await title.textContent(), 'AI 模型设置')
  assert.deepEqual(await current(), ['设置'])
  await dialog.getByRole('button', { name: '返回设置' }).click()
  assert.equal(await title.textContent(), '设置')
  await dialog.getByRole('button', { name: '更多外观设置' }).click()
  assert.equal(await title.textContent(), '外观设置')

  // A layout refresh behind the dialog must not announce the background page again.
  const writes = await page.evaluate(async () => {
    const records = []
    const observer = new MutationObserver(batch => records.push(...batch))
    observer.observe(document.querySelector('#mobile-navigation'), { attributes: true, subtree: true, attributeFilter: ['aria-current', 'disabled'] })
    const { setMobilePane } = await import('/src/app/mobile-layout.ts')
    setMobilePane('inspector')
    await new Promise(requestAnimationFrame)
    observer.disconnect()
    return records.length
  })
  assert.deepEqual(await current(), ['设置'])
  assert.equal(writes, 0, 'unchanged navigation does not rewrite button state')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await current(), ['AI 设计'])
  await nav.getByRole('button', { name: '设置' }).click()
  assert.equal(await dialog.locator('.mobile-settings-overview').isVisible(), true, 'ordinary entry starts at settings home')
  await nav.getByRole('button', { name: '资源' }).click()
  await dialog.waitFor({ state: 'hidden' })
  const category = page.getByRole('combobox', { name: '资源分类' })
  await category.waitFor()
  assert.deepEqual(await current(), ['资源'])
  await category.selectOption('image')
  assert.equal(await category.inputValue(), 'image')
  assert.equal(await page.locator('html').getAttribute('aria-pressed'), null, 'only resource buttons expose pressed state')
  await nav.getByRole('button', { name: '设置' }).tap()
  await dialog.waitFor()
  await nav.getByRole('button', { name: '编辑' }).tap()
  await dialog.waitFor({ state: 'hidden' })
  await page.locator('#document-fields input').first().waitFor()
  assert.deepEqual(await current(), ['编辑'])
  console.log('PASS inspector motion, mobile model settings, back, navigation ownership and resource tabs')
} finally {
  await browser.close()
  await server.close()
}
