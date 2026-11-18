import { openEditorTemplate } from "../tests/helpers/open-editor-template.mjs"
// Mobile layout regression test.
// Run: node scripts/test-mobile-layout.mjs
// Starts a Vite dev server and drives Chromium through Playwright (a local or global
// `playwright` install; set PLAYWRIGHT_MODULE to its path if it cannot be found).
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createServer } from "vite"
import { acceptAskDialogs } from "../tests/helpers/ask-dialogs.mjs"

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright"]
  try {
    candidates.push(join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright", "index.mjs"))
  } catch {}
  for (const candidate of candidates.filter(Boolean)) {
    try {
      return await import(candidate.startsWith("/") ? pathToFileURL(candidate).href : candidate)
    } catch {}
  }
  throw new Error("Playwright is not installed; install it or set PLAYWRIGHT_MODULE")
}

const { chromium } = await loadPlaywright()
const root = new URL("..", import.meta.url).pathname
const server = await createServer({ root, logLevel: "error", server: { port: 41730, strictPort: false, host: "127.0.0.1", hmr: false } })
await server.listen()
const address = server.httpServer.address()
const baseURL = `http://127.0.0.1:${address.port}/`
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})

const phoneUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const results = []

async function withPage(viewport, run, { mobile = true, storage = {}, colorScheme = "light" } = {}) {
  const context = await browser.newContext({
    viewport,
    colorScheme,
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile ? phoneUA : undefined,
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await acceptAskDialogs(page)
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value)
  }, storage)
  await page.goto(baseURL)
  await page.waitForSelector(".template-card", { state: "attached" })
  try {
    await run(page)
    assert.deepEqual(errors, [], "page errors")
  } finally {
    await context.close()
  }
}

const rect = (page, selector) =>
  page.$eval(selector, (element) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom,
      visible: style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0,
    }
  })

async function assertNoPageOverflow(page, label) {
  const { scrollWidth, width } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    width: innerWidth,
  }))
  assert.ok(scrollWidth <= width + 1, `${label}: page scrolls horizontally (${scrollWidth} > ${width})`)
}

// Visible titlebar controls must not overlap each other or leave the bar.
async function assertTitlebarClean(page, label) {
  const boxes = await page.evaluate(() => {
    const bar = document.querySelector(".titlebar").getBoundingClientRect()
    const items = Array.from(document.querySelectorAll(
      ".titlebar summary, .titlebar button, .titlebar .document-title",
    )).filter((element) => {
      if (element.closest(".ui-menu, template")) return false
      if (element.closest(".document-title") && element !== element.closest(".document-title")) return false
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0
    })
    return {
      bar: { left: bar.left, right: bar.right },
      items: items.map((element) => {
        const box = element.getBoundingClientRect()
        return { name: element.id || element.className || element.tagName, left: box.left, right: box.right, top: box.top, bottom: box.bottom }
      }),
    }
  })
  for (const item of boxes.items) {
    assert.ok(item.left >= boxes.bar.left - 1 && item.right <= boxes.bar.right + 1, `${label}: ${item.name} leaves the title bar`)
  }
  const statusFits = await page.locator('#mobile-document-status').evaluate(node => {
    const box = node.getBoundingClientRect(), parent = node.parentElement.getBoundingClientRect()
    return box.width === 0 || box.left >= parent.left - 1 && box.right <= parent.right + 1
  })
  assert.ok(statusFits, `${label}: saved status is clipped within the document title`)
  for (let i = 0; i < boxes.items.length; i += 1) {
    for (let j = i + 1; j < boxes.items.length; j += 1) {
      const a = boxes.items[i]
      const b = boxes.items[j]
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      assert.ok(overlapX <= 1 || overlapY <= 1, `${label}: ${a.name} overlaps ${b.name}`)
    }
  }
}

async function openTemplate(page, template = "default-android") {
  await openEditorTemplate(page, template)
  await page.waitForSelector(".canvas-wrap:not(.empty)")
  await page.waitForFunction(() => document.querySelector("#preview")?.getBoundingClientRect().height > 60)
}

async function check(name, run) {
  try {
    await run()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error })
  }
}

const portraitPhones = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 430, height: 932 },
]

async function assertPreviewToggles(page) {
  assert.equal(await page.locator(".preview-toolbar .preview-choice:visible").count(), 0, "preview toggles hidden on phones")
  assert.equal(await page.locator('.preview-toolbar [data-mobile-choice="orientation"]:visible').count(), 0, "orientation is secondary on phones")
  assert.equal(await page.locator('.preview-toolbar [data-mobile-choice="theme"]:visible').count(), 0, "theme is secondary on phones")
  assert.equal(await page.locator(".preview-toolbar #toggle-guides:visible").count(), 0, "guides are secondary on phones")
}

async function assertPreviewSecondaryMenu(page) {
  assert.equal(await page.locator("#device-control:visible").count(), 0)
  await page.locator('#mobile-app-more > summary').click()
  await page.locator('#mobile-app-more [data-mobile-action=mobile-canvas-options]').click()
  const options = page.getByRole('dialog', { name: '画布选项', exact: true })
  for (const [label, selector] of [['方向', '#orientation'], ['外观', '#theme']]) {
    const choices = options.locator(`.ui-segmented[aria-label="${label}"]`)
    const selected = choices.locator('[aria-pressed="true"]')
    await selected.waitFor()
    await choices.locator('[aria-pressed="false"]').first().click()
    const actualLabel = await page.locator(selector).evaluate(select => select.selectedOptions[0].textContent)
    assert.equal(await selected.textContent(), actualLabel, 'sheet reflects the actual variant, including rejected unavailable variants')
    await selected.waitFor()
  }
  const guides = options.getByRole('switch', { name: '辅助线与安全区' })
  const before = await guides.isChecked()
  await guides.click()
  assert.notEqual(await guides.isChecked(), before)
  await page.keyboard.press('Escape')
  await options.waitFor({state:'hidden'})
}

async function openFiles(page) {
  await page.locator('#mobile-project-toggle').click()
  await page.locator('#mobile-project-dialog').evaluate(async dialog => { await Promise.all(dialog.getAnimations().map(animation => animation.finished)) })
}
async function backToEditing(page) {
  if (await page.locator('#mobile-project-dialog').evaluate(dialog => dialog.open)) {
    await page.locator('#mobile-files-close').click()
    await page.locator('#mobile-project-dialog').waitFor({ state: 'hidden' })
  }
}

async function setEditMode(page) {
  if (await page.locator('#mode').inputValue() !== 'edit') await page.locator('.mobile-preview-return').click()
  await page.waitForFunction(() => document.querySelector('#mode').value === 'edit')
}

async function selectKey(page) {
  const canvas = await rect(page, '#preview')
  await page.mouse.click(canvas.x + canvas.width * 0.45, canvas.y + canvas.height * 0.45)
  await page.waitForSelector('#selected-key')
}

for (const viewport of portraitPhones) {
  const tag = `${viewport.width}×${viewport.height}`

  await check(`${tag} welcome and file entry`, () => withPage(viewport, async (page) => {
    await assertTitlebarClean(page, 'welcome')
    await assertNoPageOverflow(page, 'welcome')
    assert.equal(await page.locator('.mobile-workspace-tabs').count(), 0, 'same-screen design has no legacy navigation')
    const main = await rect(page, 'main'), workspace = await rect(page, 'main > .workspace')
    assert.equal(workspace.y, main.y)
    assert.equal(workspace.height, main.height)
    assert.ok(await page.locator('#mobile-welcome-open').isVisible(), 'open-file entry is visible')
    assert.equal(await page.locator('.mobile-welcome-hero h1').textContent(), '键设 KeySkin')
    const navigation = await rect(page, '#mobile-navigation')
    assert.equal(navigation.visible, true, 'welcome keeps its home navigation')
    assert.equal(navigation.height, 56, 'home uses the same floating capsule as editing')
    assert.ok(navigation.bottom <= viewport.height && navigation.y >= workspace.bottom - 1, 'welcome navigation sits below the page')
    assert.equal(await page.locator('#mobile-navigation [aria-current="page"]').textContent(), '首页')
    assert.deepEqual(await page.locator('#mobile-navigation button').allTextContents(), ['首页', '编辑', '资源', 'AI 设计', '设置'])
    assert.equal(await page.locator('.ui-mobile-navigation').count(), 1, 'home and editing share one navigation')
    assert.equal(await page.locator('#mobile-navigation [data-app-dialog="settings"]').isEnabled(), true)
    const cards = await page.locator('.template-card').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()))
    assert.ok(cards.every(card => card.left >= 0 && card.right <= viewport.width), 'all templates stay inside the phone')
  }))

  await check(`${tag} same-screen canvas and files`, () => withPage(viewport, async page => {
    await openTemplate(page)
    await assertTitlebarClean(page, 'editing')
    await assertNoPageOverflow(page, 'editing')
    assert.equal(await page.locator('html').getAttribute('data-mobile-pane'), 'inspector')
    const workspace = await rect(page, 'main > .workspace'), inspector = await rect(page, 'main > .source')
    assert.ok(Math.abs(workspace.bottom - inspector.y) <= 1, 'canvas touches the property panel')
    assert.ok(workspace.height >= 180 && inspector.height >= 180)
    assert.equal((await rect(page, '.titlebar')).height, 48, 'compact header preserves the workspace')
    const navigation = await rect(page, '#mobile-navigation')
    assert.equal(navigation.height, 56, 'floating capsule follows the reference height')
    assert.ok(navigation.x >= 12 && navigation.right <= viewport.width - 12, 'capsule leaves symmetric side gutters')
    assert.deepEqual(await page.locator('#mobile-navigation button').allTextContents(), ['首页', '编辑', '资源', 'AI 设计', '设置'])
    assert.equal((await rect(page, '.preview-toolbar')).visible, false, 'removed layout and trial controls leave no toolbar row')
    assert.equal(await page.locator('#mobile-preview-summary, #mobile-canvas-mode, .mobile-canvas-options, #mobile-share-page, .titlebar #recent-files').count(), 0, 'marked controls are removed')
    assert.equal(await page.locator('#mobile-undo').isVisible(), true, 'undo remains available in the titlebar')
    assert.ok((await rect(page, '.source-heading')).height <= 128, 'inspector heading leaves room for properties')
    assert.ok((await rect(page, '.canvas-wrap')).height >= workspace.height - 64, 'canvas uses the space beyond its toolbar')
    const touchTargets = await page.locator('#mobile-save, #mobile-undo, #mobile-navigation button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))
    assert.ok(touchTargets.every(height => height >= 44), 'compact controls retain 44px touch targets')
    assert.ok(await page.locator('main > aside').evaluate(n => n.inert), 'closed files cannot take focus')
    assert.equal(await page.locator('main > .source').evaluate(n => n.inert), false)
    await assertPreviewToggles(page)
    await assertPreviewSecondaryMenu(page)
    await openFiles(page)
    const drawer = await rect(page, '#mobile-project-dialog')
    assert.equal(drawer.visible, true)
    assert.ok(drawer.x === 0 && drawer.width <= viewport.width - 44, 'project slides in from the left with an exposed backdrop')
    assert.equal(await page.locator('#mobile-project-toggle').getAttribute('aria-expanded'), 'true')
    assert.equal(await page.locator('html').getAttribute('data-mobile-pane'), 'inspector', 'drawer preserves the editing view')
    assert.equal(await page.locator('#mobile-navigation [aria-current=page]').textContent(), '编辑')
    await page.locator('[data-sidebar-view=source]').click()
    assert.equal(await page.locator('.mobile-page-heading').textContent(), '源文件')
    await page.locator('[data-sidebar-view=overview]').click()
    await page.keyboard.press('Escape')
    await page.locator('#mobile-project-dialog').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('#mobile-project-toggle').getAttribute('aria-expanded'), 'false')
    assert.equal(await page.locator('#mobile-project-toggle').evaluate(n => n === document.activeElement), true, 'dismiss restores the trigger focus')
    await openFiles(page)
    await page.mouse.click(viewport.width - 8, viewport.height / 2)
    await page.locator('#mobile-project-dialog').waitFor({ state: 'hidden' })
    await openFiles(page)
    await backToEditing(page)
    assert.equal((await rect(page, 'main > .source')).visible, true)
    assert.equal((await rect(page, 'main > .workspace')).visible, true)
    await assertNoPageOverflow(page, 'files return')
    await page.locator('#mobile-app-more > summary').click()
    await page.locator('#mobile-app-more [data-mobile-action=mode]').click()
    await page.locator('#mobile-navigation [data-mobile-page="ai"]').click()
    await page.waitForFunction(() => document.documentElement.dataset.mobilePage === 'ai')
    assert.equal(await page.locator('#mobile-navigation [aria-current="page"]').textContent(), 'AI 设计')
    assert.ok(await page.locator('#ai-design-panel').isVisible(), 'AI entry opens the existing design panel')
    assert.equal(await page.locator('#mode').inputValue(), 'edit', 'AI remains visible when entered from trial mode')
    await page.locator('#mobile-navigation [data-app-dialog="settings"]').click()
    await page.waitForSelector('#settings-dialog[open]')
    await page.keyboard.press('Escape')
    await page.waitForSelector('#settings-dialog[open]', {state:'hidden'})
    assert.equal(await page.locator('#mobile-navigation [aria-current="page"]').textContent(), 'AI 设计', 'settings returns to the original workspace')
    await page.locator('#mobile-ai-return').click()
    await page.waitForFunction(() => document.documentElement.dataset.mobilePage === 'edit')
  }))

  await check(`${tag} more and settings sheets`, () => withPage(viewport, async (page) => {
    assert.equal(await page.locator('#mobile-app-more > summary').isVisible(), false, 'welcome uses its own home navigation')
    await openTemplate(page)
    await page.locator('#mobile-app-more > summary').click()
    const menu = await rect(page, '#mobile-app-more > .ui-menu')
    assert.ok(menu.x >= 0 && menu.right <= viewport.width && menu.bottom <= viewport.height, 'more fits the phone')
    assert.equal(await page.locator('#mobile-app-more [data-mobile-action="mode"]').isDisabled(), false, 'document actions are available after opening a skin')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#mobile-app-more').getAttribute('open'), null)
    await page.locator('#mobile-app-more > summary').click()
    await page.locator('#mobile-app-more [data-app-dialog="settings"]').click()
    await page.waitForSelector('#settings-dialog[open]')
    const dialog = await rect(page, '#settings-dialog')
    assert.ok(dialog.x >= -1 && dialog.right <= viewport.width + 1 && dialog.bottom <= viewport.height + 1)
    for (const button of await page.locator('#settings-dialog .settings-nav-item:visible').all()) {
      await button.click()
      const overflow = await page.locator('#settings-dialog .settings-page:not([hidden])').evaluate(panel => {
        const bounds = panel.closest('dialog').getBoundingClientRect()
        return Array.from(panel.querySelectorAll('*')).filter(el => el.checkVisibility()).filter(el => {
          const r = el.getBoundingClientRect()
          return r.width && (r.left < bounds.left - 1 || r.right > bounds.right + 1)
        }).map(el => el.id || el.className)
      })
      assert.deepEqual(overflow, [], 'settings content stays inside the sheet')
      await page.locator('.mobile-settings-back').click()
    }
    assert.ok((await rect(page, '#settings-save')).bottom <= viewport.height)
  }))
}

for (const viewport of [{width:320,height:568}, {width:390,height:844}]) {
  await check(`${viewport.width}×${viewport.height} inspector canvas refits after resizing`, () => withPage(viewport, async page => {
    await openTemplate(page)
    await backToEditing(page)
    const handle = page.locator('#mobile-inspector-resize')
    for (const key of ['End', 'Home', 'End']) {
      await handle.focus()
      await page.keyboard.press(key)
      await page.waitForTimeout(250)
      const workspace = await rect(page, 'main > .workspace')
      const canvas = await rect(page, '.canvas-wrap')
      const keyboard = await rect(page, '.device-shell')
      assert.ok(Math.abs(canvas.height - workspace.height) <= 1 && canvas.height > 60, 'canvas fills the space released by the removed toolbar')
      assert.ok(keyboard.x >= canvas.x && keyboard.right <= canvas.right + 1, 'keyboard fits the canvas width')
      assert.ok(keyboard.y >= canvas.y && keyboard.bottom <= canvas.bottom + 1, 'keyboard fits the canvas height')
      const padding = await page.locator('.canvas-wrap').evaluate(node => {
        const style = getComputedStyle(node)
        return { top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom), left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), borderX: parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth), borderY: parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) }
      })
      assert.ok(canvas.width - padding.left - padding.right - padding.borderX - keyboard.width <= 2 || canvas.height - padding.top - padding.bottom - padding.borderY - keyboard.height <= 2, 'auto fit fills an axis inside the actual canvas padding and borders')
      assert.ok(Math.abs(keyboard.y + keyboard.height / 2 - canvas.y - (canvas.height + padding.top - padding.bottom) / 2) <= 1, 'keyboard stays centered inside the padded canvas')
      const surface = await page.locator('#preview').evaluate(element => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        logicalWidth: Number(element.dataset.logicalWidth),
        logicalHeight: Number(element.dataset.logicalHeight),
      }))
      assert.ok(Math.abs(surface.width / surface.height - surface.logicalWidth / surface.logicalHeight) < 0.01, 'keyboard keeps its aspect ratio')
    }
    await handle.dblclick()
    assert.equal(await handle.getAttribute('aria-valuenow'), '32', 'double click expands the panel')
    const canvasHeight = (await rect(page, '.canvas-wrap')).height
    await backToEditing(page)
    await page.waitForTimeout(250)
    assert.ok(Math.abs((await rect(page, '.canvas-wrap')).height - canvasHeight) <= 1, 'returning to editing preserves the canvas')
  }))
}

await check('geometry, undo and selection survive navigation', () => withPage({width:393,height:852}, async page => {
  await openTemplate(page, 'official-android-bds')
  await setEditMode(page)
  await selectKey(page)
  await page.locator('.mobile-appearance:not([hidden])').waitFor()
  assert.equal(await page.locator('#mobile-property-tabs').isVisible(), true, 'all six categories are available above the continuous properties')
  assert.ok(await page.locator('.key-layout-fields').isVisible(), 'position and size are editable in the summary')
  assert.ok((await rect(page, '.key-layout-fields')).bottom <= (await rect(page, '.mobile-appearance')).y, 'geometry appears before appearance')
  assert.equal(await page.locator('#mobile-property-tabs > button').count(), 6)
  assert.equal((await rect(page, '.preview-toolbar')).visible, false, 'summary gives the upper area to the actual keyboard')
  const summaryPosition = page.locator('#quick-inspector [data-key-field="x"]')
  const summaryX = Number(await summaryPosition.inputValue())
  await summaryPosition.fill(String(summaryX + 1))
  await summaryPosition.dispatchEvent('change')
  await page.locator('#mobile-app-more > summary').click()
  await page.locator('#mobile-app-more [data-mobile-action="mobile-undo"]').click()
  assert.equal(Number(await summaryPosition.inputValue()), summaryX, 'summary edits undo through the menu while the toolbar is hidden')
  const selected = await page.locator('#selected-key').textContent()
  await page.locator('#mobile-property-tabs [data-mobile-category="geometry"]').click()
  const position = page.locator('#quick-inspector [data-key-field="x"]')
  const before = Number(await position.inputValue())
  await position.fill(String(before + 1))
  await position.dispatchEvent('change')
  await openFiles(page)
  await backToEditing(page)
  assert.equal(Number(await position.inputValue()), before + 1)
  assert.equal(await page.locator('#selected-key').textContent(), selected)
  await page.locator('#mobile-app-more > summary').click()
  await page.locator('#mobile-app-more [data-mobile-action="mobile-undo"]').click()
  assert.equal(Number(await position.inputValue()), before)
  for (const [key, value] of [['Home','32'],['End','90']]) {
    await page.locator('#mobile-inspector-resize').focus()
    await page.keyboard.press(key)
    assert.equal(await page.locator('#mobile-inspector-resize').getAttribute('aria-valuenow'),value)
    assert.equal(await page.locator('#selected-key').textContent(), selected)
  }
  await page.locator('#mobile-inspector-resize').dblclick()
  assert.equal(await page.locator('#mobile-inspector-resize').getAttribute('aria-valuenow'),'32')
  await page.locator('#inspector-actions-more > summary').click()
  await page.locator('#inspector-actions-more [data-key-action-ref="delete"]').click()
  await page.waitForFunction(selected => document.querySelector('#selected-key').textContent !== selected, selected)
  await page.locator('#mobile-app-more > summary').click()
  await page.locator('#mobile-app-more [data-mobile-action="mobile-undo"]').click()
  await assertNoPageOverflow(page, 'geometry and object menu')
}))

for (const colorScheme of ['light','dark']) {
  await check(`safe areas, theme and orientation (${colorScheme})`, () => withPage({width:393,height:852}, async page => {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setSafeAreaInsetsOverride', {insets:{top:59,bottom:34}})
    await openTemplate(page, 'official-android-bds')
    await assertTitlebarClean(page, 'safe area')
    const bar = await rect(page, '.titlebar'), canvas = await rect(page, 'main > .workspace'), inspector = await rect(page, 'main > .source')
    assert.equal(bar.height, 107, 'compact header reserves top inset once')
    assert.equal(canvas.y, bar.bottom)
    assert.ok(inspector.bottom <= 818, 'properties clear the home indicator')
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
    assert.equal(accent.toLowerCase(), colorScheme === 'dark' ? '#7a9bff' : '#3a6df0')
    await openFiles(page)
    assert.equal((await rect(page, '#mobile-project-dialog')).y, 0, 'drawer includes the top safe area')
    await page.setViewportSize({width:844,height:390})
    await page.waitForFunction(() => !document.querySelector('#mobile-project-dialog').open && document.querySelector('main > aside.sidebar'))
    for (const selector of ['main > aside','main > .source','main > .workspace']) assert.equal(await page.locator(selector).evaluate(n=>n.inert), false, 'landscape releases all panes')
    await page.setViewportSize({width:393,height:852})
    assert.equal(await page.locator('html').getAttribute('data-mobile-pane'),'inspector')
    assert.equal((await rect(page,'main > .source')).visible,true)
  }, {colorScheme}))
}

await check('more uses shared guide and mode state', () => withPage({width:393,height:852}, async page => {
  await openTemplate(page)
  await assertPreviewSecondaryMenu(page)
  await setEditMode(page)
  await page.locator('#mobile-app-more > summary').click()
  assert.equal(await page.locator('#mobile-mode-label').textContent(),'编辑模式')
  await page.locator('[data-mobile-menu-close]').click()
  assert.equal(await page.locator('#mobile-app-more').getAttribute('open'),null)
}))

await check('export format selection delegates to the real export flow', () => withPage({width:320,height:568}, async page => {
  await page.evaluate(() => { window.showSaveFilePicker = undefined })
  await openTemplate(page, 'official-android-bds')
  await page.locator('#mobile-app-more > summary').click()
  await page.locator('#mobile-app-more [data-mobile-action="mobile-export-open"]').click()
  await page.locator('#share-page:not([hidden])').waitFor()
  const sheet = await rect(page, '#share-page')
  assert.ok(sheet.x >= 0 && sheet.right <= 320 && sheet.bottom <= 568, 'share page fits the narrow phone')
  assert.equal(await page.locator('.ui-share-formats input[type="radio"]').count(), 6, 'all existing platform targets are available')
  assert.equal(await page.locator('.ui-share-formats input:checked').inputValue(), 'bds')
  await page.locator('#share-back').click()
  await page.locator('#share-page').waitFor({state:'hidden'})
  assert.equal(await page.locator('#file-operation-dialog[open]').count(), 0, 'returning does not start export')
  await page.locator('#mobile-app-more > summary').click()
  await page.locator('#mobile-app-more [data-mobile-action=mobile-export-open]').click()
  const download = page.waitForEvent('download')
  await page.locator('#share-export').click()
  const result = await download
  assert.match(result.suggestedFilename(), /\.bds$/)
  await page.waitForFunction(() => document.querySelector('#file-operation-dialog').dataset.outcome === 'success')
  assert.equal(await page.locator('#file-operation-dialog').getAttribute('data-inline'), 'true', 'share keeps its progress inside the page')
  assert.match(await page.locator('#file-operation-dialog').textContent(), /完成/)

}))

for (const viewport of [{width:740,height:360},{width:1280,height:800}]) {
  await check(`${viewport.width}×${viewport.height} keeps desktop columns`, () => withPage({width:1280,height:800}, async page => {
    await openTemplate(page)
    await page.setViewportSize(viewport)
    await assertTitlebarClean(page,'desktop')
    await assertNoPageOverflow(page,'desktop')
    assert.equal(await page.locator('.mobile-workspace-tabs').count(),0)
    assert.equal((await rect(page,'#mobile-app-more')).visible,false)
    assert.equal((await rect(page,'main > aside')).visible,true)
    assert.equal((await rect(page,'main > .source')).visible,true)
    assert.equal((await rect(page,'main > .workspace')).visible,true)
  }, {mobile:false}))
}

await browser.close()
await server.close()
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}: ${result.name}`)
  if (!result.ok) console.error(result.error)
}
const failed=results.filter(result=>!result.ok).length
console.log(`${results.length-failed}/${results.length} mobile layout checks passed`)
if(failed) process.exitCode=1
