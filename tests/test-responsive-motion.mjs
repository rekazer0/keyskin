import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { openEditorTemplate } from '../tests/helpers/open-editor-template.mjs'

const server = await createServer({ logLevel: 'error', server: { port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('onboarding-tour-v1', 'done'))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  const rail = page.locator('.ui-workspace-navigation-pages')
  assert.equal(await rail.evaluate(el => el.clientHeight >= el.scrollHeight), true, 'all page entries fit a laptop without scrolling')
  async function checkDialog(selector, travel) {
    const result = await page.locator(selector).evaluate(async dialog => {
      const { closeDialog } = await import('/src/motion.ts')
      const travel = getComputedStyle(dialog).getPropertyValue('--_dialog-travel').trim()
      const done = closeDialog(dialog)
      const exit = dialog.getAnimations().find(a => a.effect.getKeyframes().at(-1)?.opacity === '0' && !a.effect.pseudoElement)
      const transform = exit?.effect.getKeyframes().at(-1).transform
      exit?.cancel()
      await done
      return { travel, transform, closed: !dialog.open }
    })
    assert.match(result.travel, travel)
    assert.ok(result.transform && result.closed, 'an interrupted exit still closes and releases the dialog')
  }
  await page.locator('#workspace-navigation [data-settings-entry=settings]').click()
  const settings = page.locator('#settings-workspace')
  await settings.waitFor()
  assert.equal(await page.locator('dialog:modal').count(), 0, 'settings is not a modal')
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 390, height: 844 })
  await openEditorTemplate(page, 'official-android-bds')
  const handle = await page.locator('#mobile-inspector-resize').boundingBox()
  assert.ok(handle?.height >= 44, 'the inspector divider has a full-size touch target')
  await page.locator('#mobile-project-toggle').click()
  await checkDialog('#mobile-project-dialog', /^translateX/)
  await page.locator('#mobile-app-more summary').click()
  await page.locator('[data-mobile-action=mobile-canvas-options]').click()
  await checkDialog('dialog.ui-mobile-sheet[open]', /^translateY/)
  for (const preference of ['app', 'system']) {
    await page.emulateMedia({ reducedMotion: preference === 'system' ? 'reduce' : 'no-preference' })
    const result = await page.evaluate(async app => {
      document.documentElement.dataset.reducedMotion = String(app)
      const { closeDialog } = await import('/src/motion.ts')
      const dialog = document.querySelector('#mobile-project-dialog')
      dialog.showModal()
      const style = getComputedStyle(dialog)
      const reduced = [style.animationDuration, style.getPropertyValue('--motion-repeat').trim()]
      const done = closeDialog(dialog)
      const immediate = !dialog.open
      await done
      return [...reduced, immediate]
    }, preference === 'app')
    assert.deepEqual(result, ['0s', '0', true], `${preference}: no transition or repeated motion`)
  }
  assert.deepEqual(errors, [])
  console.log('PASS compact desktop navigation, touch divider, modal travel, interrupted exits and both reduced-motion preferences')
} finally {
  await browser.close()
  await server.close()
}
