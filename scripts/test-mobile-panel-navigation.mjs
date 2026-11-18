import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { openEditorTemplate } from '../tests/helpers/open-editor-template.mjs'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('onboarding-tour-v1', 'done'))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
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
  const dialog = page.locator('#settings-dialog')
  const title = dialog.locator('#settings-title')
  await nav.getByRole('button', { name: 'AI 设计' }).click()
  await page.locator('#mobile-ai-privacy').click()
  assert.equal(await dialog.locator('[data-settings-panel=model]').isVisible(), true, 'the direct link opens model details, not settings home')
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
  const tabs = page.locator('#mobile-resource-tabs')
  await tabs.waitFor()
  assert.deepEqual(await current(), ['资源'])
  await tabs.getByRole('button', { name: /图片/ }).click()
  assert.equal(await tabs.locator('[aria-pressed=true]').getAttribute('data-mobile-resource'), 'resource')
  assert.equal(await page.locator('html').getAttribute('aria-pressed'), null, 'only resource buttons expose pressed state')
  console.log('PASS inspector motion, mobile settings deep link, back, navigation ownership and resource tabs')
} finally {
  await browser.close()
  await server.close()
}
