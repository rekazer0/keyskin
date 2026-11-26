import { confirmDeletion } from "../tests/helpers/ask-dialogs.mjs"
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

async function assertPreviewToolbar(page) {
  const toolbar = await rect(page, '.preview-toolbar')
  const canvas = await rect(page, '.canvas-wrap')
  assert.ok(toolbar.visible && Math.abs(toolbar.bottom - canvas.y) <= 1, 'toolbar sits above the canvas without covering it')
  let right = toolbar.x
  for (const selector of ['#toggle-guides', '#skin-state-control:not([hidden])', '#device-control', '[data-mobile-choice="orientation"]', '[data-mobile-choice="theme"]']) {
    if (!await page.locator(selector).count()) continue
    const control = await rect(page, selector)
    assert.ok(control.visible && control.height >= 44 && control.width >= 44, `${selector} has a full-size touch target`)
    assert.ok(control.x >= right && control.right <= toolbar.right, `${selector} fits in order on the toolbar`)
    right = control.right
  }
}

async function assertPreviewSecondaryMenu(page) {
  await page.locator('#mobile-app-more > summary').click()
  await page.locator('#mobile-app-more [data-mobile-action=mobile-canvas-options]').click()
  const options = page.getByRole('dialog', { name: '画布选项', exact: true })
  const device = options.getByRole('combobox', { name: '设备' })
  const deviceBox = await device.boundingBox()
  assert.ok(deviceBox.height >= 44, 'device select has a full-size touch target')
  const originalDevice = await device.inputValue()
  await device.selectOption(originalDevice === 'canvas-glass' ? 'canvas-checkerboard' : 'canvas-glass')
  assert.equal(await page.locator('#device').inputValue(), await device.inputValue())
  await device.selectOption(originalDevice)
  for (const [label, selector] of [['方向', '#orientation'], ['外观', '#theme']]) {
    const choices = options.locator(`.ui-segmented[aria-label="${label}"]`)
    const selected = choices.locator('[aria-pressed="true"]')
    await selected.waitFor()
    assert.ok((await selected.boundingBox()).height >= 44, `${label} has a full-size touch target`)
    assert.ok(Math.abs((await choices.boundingBox()).x - (await options.locator(".ui-select").boundingBox()).x) <= 1, `${label} aligns with device select`)
    await choices.locator('[aria-pressed="false"]').first().click()
    const actualLabel = await page.locator(selector).evaluate(select => select.selectedOptions[0].textContent)
    assert.equal(await selected.textContent(), actualLabel, 'sheet reflects the actual variant, including rejected unavailable variants')
    await selected.waitFor()
  }
  const guides = options.getByRole('switch', { name: '辅助线与安全区' })
  const before = await guides.isChecked()
  await options.getByText('辅助线与安全区', { exact: true }).tap()
  assert.notEqual(await guides.isChecked(), before)
  assert.equal(await page.locator('#toggle-guides').getAttribute('aria-pressed'), String(!before))
  await page.keyboard.press('Escape')
  await options.waitFor({state:'hidden'})
  assert.equal(await page.locator('#mobile-app-more > summary:focus').count(), 1)
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
    assert.equal(await page.locator('.mobile-welcome-hero h1').textContent(), '键设')
    const navigation = await rect(page, '#mobile-navigation')
    assert.equal(navigation.visible, true, 'welcome keeps its home navigation')
    assert.equal(navigation.height, 56, 'home uses the same floating capsule as editing')
    assert.ok(navigation.bottom <= viewport.height && navigation.y >= workspace.bottom - 1, 'welcome navigation sits below the page')
    assert.equal(await page.locator('#mobile-navigation [aria-current="page"]').textContent(), '首页')
    assert.deepEqual(await page.locator('#mobile-navigation button:visible').allTextContents(), ['首页', '编辑', '资源', '设置'])
    assert.equal(await page.locator('.ui-mobile-navigation').count(), 1, 'home and editing share one navigation')
    assert.equal(await page.locator('#mobile-navigation [data-settings-entry="settings"]').isEnabled(), true)
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
    assert.ok(workspace.height >= 180 && inspector.height >= 72)
    assert.equal((await rect(page, '.titlebar')).height, 48, 'compact header preserves the workspace')
    const navigation = await rect(page, '#mobile-navigation')
    assert.equal(navigation.height, 56, 'floating capsule follows the reference height')
    assert.ok(navigation.x >= 12 && navigation.right <= viewport.width - 12, 'capsule leaves symmetric side gutters')
    assert.deepEqual(await page.locator('#mobile-navigation button:visible').allTextContents(), ['首页', '编辑', '资源', '设置'])
    assert.equal(await page.locator('#mobile-preview-summary, #mobile-canvas-mode, .mobile-canvas-options, #mobile-share-page, .titlebar #recent-files').count(), 0, 'marked controls are removed')
    assert.ok(Math.abs(inspector.bottom - viewport.height) <= 1, 'property panel reaches the viewport bottom under the floating navigation')
    assert.match(await page.locator('#mobile-navigation').evaluate(node => getComputedStyle(node).backdropFilter), /blur/)
    assert.equal(await page.locator('#mobile-save').count(), 0)
    for (const id of ['#mobile-undo', '#mobile-redo']) {
      assert.ok(await page.locator(id).isVisible(), `${id} is directly available in the titlebar`)
      assert.ok(await page.locator(id).isDisabled(), `${id} is disabled when its history is empty`)
    }
    assert.deepEqual(await page.locator('#document-name').evaluate(node => {
      const style = getComputedStyle(node)
      return [style.maxWidth, style.textOverflow, getComputedStyle(node, '::after').fontSize]
    }), ['180px', 'ellipsis', '13px'])
    assert.ok((await rect(page, '.source-heading')).height <= 128, 'inspector heading leaves room for properties')
    assert.ok((await rect(page, '.canvas-wrap')).height >= workspace.height - 64, 'canvas uses the space beyond its toolbar')
    const touchTargets = await page.locator('#mobile-undo, #mobile-redo, #mobile-navigation button:visible').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))
    assert.ok(touchTargets.every(height => height >= 44), 'compact controls retain 44px touch targets')
    assert.ok(await page.locator('main > aside').evaluate(n => n.inert), 'closed files cannot take focus')
    assert.equal(await page.locator('main > .source').evaluate(n => n.inert), false)
    await assertPreviewToolbar(page)
    await assertPreviewSecondaryMenu(page)
    await openFiles(page)
    const drawer = await rect(page, '#mobile-project-dialog')
    assert.equal(drawer.visible, true)
    assert.ok(drawer.x === 0 && drawer.width <= viewport.width - 44, 'project slides in from the left with an exposed backdrop')
    assert.equal(await page.locator('#mobile-project-toggle').getAttribute('aria-expanded'), 'true')
    assert.equal(await page.locator('html').getAttribute('data-mobile-pane'), 'inspector', 'drawer preserves the editing view')
    assert.equal(await page.locator('#mobile-navigation [aria-current=page]').textContent(), '编辑')
    await page.locator('[data-sidebar-view=source]').click()
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
    assert.equal(await page.locator('#mobile-navigation [data-mobile-page="ai"]').isVisible(), false, 'browser navigation omits AI design')
    await page.locator('#mobile-navigation [data-settings-entry="settings"]').click()
    await page.waitForSelector('#settings-workspace:not([hidden])')
    await page.keyboard.press('Escape')
    await page.waitForSelector('#settings-workspace:not([hidden])', {state:'hidden'})
    assert.equal(await page.locator('#mode').inputValue(), 'preview', 'closing settings preserves preview')
    await page.locator('.mobile-preview-return').click()
    await page.waitForFunction(() => document.documentElement.dataset.mobilePage === 'edit')
  }))

  await check(`${tag} more menu and settings workspace`, () => withPage(viewport, async (page) => {
    assert.equal(await page.locator('#mobile-app-more > summary').isVisible(), false, 'welcome uses its own home navigation')
    await openTemplate(page)
    await page.locator('#mobile-app-more > summary').click()
    const menu = await rect(page, '#mobile-app-more > .ui-menu')
    assert.ok(menu.x >= 0 && menu.right <= viewport.width && menu.bottom <= viewport.height, 'more fits the phone')
    assert.equal(await page.locator('#mobile-app-more [data-mobile-action="mode"]').isDisabled(), false, 'document actions are available after opening a skin')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#mobile-app-more').getAttribute('open'), null)
    await page.locator('#mobile-app-more > summary').click()
    await page.locator('#mobile-app-more [data-settings-entry="settings"]').click()
    await page.waitForSelector('#settings-workspace:not([hidden])')
    const dialog = await rect(page, '#settings-workspace')
    assert.ok(dialog.x >= -1 && dialog.right <= viewport.width + 1 && dialog.bottom <= viewport.height + 1)
    for (const button of await page.locator('#settings-workspace .settings-nav-item:visible').all()) {
      await button.click()
      const overflow = await page.locator('#settings-workspace .settings-page:not([hidden])').evaluate(panel => {
        const bounds = panel.closest('#settings-workspace').getBoundingClientRect()
        return Array.from(panel.querySelectorAll('*')).filter(el => el.checkVisibility()).filter(el => {
          const r = el.getBoundingClientRect()
          return r.width && (r.left < bounds.left - 1 || r.right > bounds.right + 1)
        }).map(el => el.id || el.className)
      })
      assert.deepEqual(overflow, [], 'settings content stays inside the workspace')
      await page.locator('.mobile-settings-back').click()
    }
    assert.ok((await rect(page, '#settings-save')).bottom <= viewport.height)
  }))
}

for (const viewport of [{width:320,height:568}, {width:390,height:844}]) {
  await check(`${viewport.width}×${viewport.height} inspector canvas refits after resizing`, () => withPage(viewport, async page => {
    await openTemplate(page)
    await backToEditing(page)
    const sourceToggle = page.locator('#inspector-source-toggle')
    assert.ok((await rect(page, '#inspector-source-toggle')).height >= 44, 'source toggle keeps a 44px touch target')
    await sourceToggle.tap()
    await page.locator('#source-editor').getByRole('textbox').waitFor()
    assert.equal(await sourceToggle.getAttribute('aria-pressed'), 'true')
    await sourceToggle.tap()
    assert.equal(await page.locator('#source-editor').isVisible(), false)
    assert.equal(await page.locator('#quick-inspector').isVisible(), true)
    const handle = page.locator('#mobile-inspector-resize')
    for (const key of ['End', 'Home', 'End']) {
      await handle.focus()
      await page.keyboard.press(key)
      await page.waitForTimeout(250)
      const workspace = await rect(page, 'main > .workspace')
      const canvas = await rect(page, '.canvas-wrap')
      const keyboard = await rect(page, '.device-shell')
      const toolbar = await rect(page, '.preview-toolbar')
      assert.ok(Math.abs(canvas.height + toolbar.height - workspace.height) <= 1 && canvas.height > 60, 'canvas fills the space below the toolbar')
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

await check('geometry, undo and selection survive navigation with the PC inspector', () => withPage({width:320,height:680}, async page => {
  await openTemplate(page, 'official-android-bds')
  await setEditMode(page)
  await selectKey(page)
  const rail = page.getByRole('group', { name: '属性导航' })
  const position = page.locator('#quick-inspector [data-key-field="x"]')
  const positionY = page.locator('#quick-inspector [data-key-field="y"]')
  const x = await position.boundingBox(), y = await positionY.boundingBox(), nav = await rail.boundingBox()
  assert.ok(x.x + x.width <= y.x && x.y === y.y && y.x + y.width <= nav.x, 'X/Y are side by side to the left of the rail')
  assert.equal(await page.getByRole('slider', { name: 'X 位置滑块', exact: true }).count(), 0)
  await rail.getByRole('button', { name: '样式', exact: true }).tap()
  assert.equal(await rail.getByRole('button', { name: '样式', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.locator('.key-appearance-fields .ui-style-ref').first().waitFor()
  await rail.getByRole('button', { name: '筛选属性', exact: true }).tap()
  const filter = page.getByRole('searchbox', { name: '筛选属性' })
  await filter.fill('位置')
  await filter.press('Escape')
  await filter.press('Escape')
  await rail.getByRole('button', { name: '布局', exact: true }).tap()
  await assertPreviewToolbar(page)
  assert.equal(await page.locator('[data-key-action="copy"]').isHidden(), true)
  const summaryX = Number(await position.inputValue())
  const editPosition = async (value) => {
    await position.fill(String(value))
    await position.press('Tab')
  }
  await editPosition(summaryX + 1)
  await page.locator('#mobile-undo').tap()
  assert.equal(Number(await position.inputValue()), summaryX, 'undo restores the field via the titlebar')
  await page.locator('#mobile-redo').tap()
  assert.equal(Number(await position.inputValue()), summaryX + 1, 'redo restores the edit via the titlebar')
  await page.locator('#mobile-undo').tap()
  const selected = await page.locator('#selected-key').textContent()
  const before = Number(await position.inputValue())
  await editPosition(before + 1)
  await openFiles(page)
  await backToEditing(page)
  assert.equal(Number(await position.inputValue()), before + 1)
  assert.equal(await page.locator('#selected-key').textContent(), selected)
  await page.locator('#mobile-undo').tap()
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
  assert.equal(await page.locator('#inspector-actions-more [data-key-action-ref="copy"]').isVisible(), true)
  await page.locator('#inspector-actions-more [data-key-action-ref="delete"]').click()
  await confirmDeletion(page)
  await page.waitForFunction(selected => document.querySelector('#selected-key').textContent !== selected, selected)
  await page.locator('#mobile-undo').tap()
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
    assert.equal(inspector.bottom, 852, 'the inspector surface fills the bottom safe area')
    const nav = await rect(page, '#mobile-navigation')
    assert.equal(nav.bottom, 852 - 34 - 12, 'the navigation clears the home indicator once')
    const inset = await page.locator('#quick-inspector').evaluate(node => {
      const style = getComputedStyle(node)
      return [style.paddingBottom, style.scrollPaddingBottom]
    })
    assert.deepEqual(inset, ['114px', '114px'], 'the property scroll area clears the navigation and safe area once')
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
    assert.equal(accent.toLowerCase(), colorScheme === 'dark' ? '#7a9bff' : '#3a6df0')
    await openFiles(page)
    assert.equal((await rect(page, '#mobile-project-dialog')).y, 0, 'drawer includes the top safe area')
    assert.ok((await rect(page, '#mobile-files-close')).y >= 59, 'drawer header clears the notch')
    assert.ok((await rect(page, '.ui-mobile-sidebar #files')).bottom <= page.viewportSize().height - 34, 'drawer file list clears the home indicator')
    assert.equal(await page.locator('#mobile-project-dialog').getByRole('button', { name: '返回首页' }).count(), 0)
    assert.equal(await page.locator('.ui-mobile-sidebar .sidebar-overview').isVisible(), true)
    for (const selector of ['#mobile-files-close', '[data-sidebar-view=overview]', '[data-sidebar-view=source]']) {
      assert.ok((await rect(page, selector)).height >= 44, `${selector} has a 44px touch target`)
    }
    await page.locator('[data-sidebar-view=source]').click()
    assert.equal(await page.locator('.mobile-page-heading').textContent(), '项目')
    assert.equal(await page.locator('[data-sidebar-view=source]').getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('#source-file-toolbar').isVisible(), true)
    await page.locator('[data-sidebar-view=overview]').click()
    assert.equal(await page.locator('.ui-mobile-sidebar .sidebar-overview').isVisible(), true)
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

await check('more drops from the titlebar and scrolls on a short phone', () => withPage({width:320,height:568}, async page => {
  await openTemplate(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const trigger = page.locator('#mobile-app-more > summary')
  const menu = page.locator('#mobile-app-more > .ui-menu')
  const close = menu.locator('[data-mobile-menu-close]')
  const travel = await trigger.evaluate(summary => {
    summary.click()
    const menu = summary.nextElementSibling
    const [animation] = menu.getAnimations()
    animation.pause()
    animation.currentTime = 0
    const y = new DOMMatrixReadOnly(getComputedStyle(menu).transform).m42
    animation.finish()
    return y
  })
  assert.ok(travel < 0, 'the menu enters from above')
  const [panel, titlebar, navigation] = await Promise.all([menu.boundingBox(), rect(page, '.titlebar'), rect(page, '.ui-mobile-navigation')])
  assert.ok(panel.y >= titlebar.bottom, 'the menu starts below the titlebar')
  assert.ok(panel.x > 0 && panel.x + panel.width < 320 && panel.y + panel.height < navigation.y, 'the menu stays within the workspace')
  const closeBeforeScroll = await close.boundingBox()
  await trigger.press('End')
  assert.ok(await menu.evaluate(element => element.scrollTop > 0), 'keyboard can reach the final item in the scrollable menu')
  assert.equal((await close.boundingBox()).y, closeBeforeScroll.y, 'the close button stays visible when scrolling')
  await page.keyboard.press('Escape')
  assert.equal(await menu.isVisible(), false)
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true)
  await trigger.tap()
  await page.touchscreen.tap(2, panel.y + 10)
  assert.equal(await menu.isVisible(), false, 'tapping the backdrop dismisses the menu')
  for (const preference of ['app', 'system']) {
    await page.emulateMedia({ reducedMotion: preference === 'system' ? 'reduce' : 'no-preference' })
    await page.evaluate(app => { document.documentElement.dataset.reducedMotion = String(app) }, preference === 'app')
    await trigger.tap()
    assert.equal(await menu.evaluate(element => getComputedStyle(element).animationDuration), '0s')
    await close.tap()
  }
}))

await check('more opens the real save and export flows', () => withPage({width:320,height:568}, async page => {
  await page.evaluate(() => { window.showSaveFilePicker = undefined })
  await openTemplate(page, 'official-android-bds')
  await page.locator('#mobile-app-more > summary').click()
  await page.locator('#mobile-app-more [data-mobile-action="mobile-export-open"]').click()
  await page.locator('#share-dialog[open]').waitFor()
  const sheet = await rect(page, '#share-dialog')
  assert.ok(sheet.x >= 0 && sheet.right <= 320 && sheet.bottom <= 568, 'share page fits the narrow phone')
  assert.equal(await page.locator('.ui-share-formats input[type="radio"]').count(), 6, 'all existing platform targets are available')
  assert.equal(await page.locator('.ui-share-formats input:checked').inputValue(), 'bds')
  await page.locator('#share-dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('#share-dialog').waitFor({state:'hidden'})
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
  await page.locator('#file-operation-close').click()
  await page.locator('#file-operation-dialog').waitFor({ state: 'hidden' })
  const saved = page.waitForEvent('download')
  await page.locator('#share-dialog #save').tap()
  assert.match((await saved).suggestedFilename(), /\.bds$/)
  await page.waitForFunction(() => document.querySelector('#file-operation-dialog').dataset.outcome === 'success')
  assert.match(await page.locator('#file-operation-title').textContent(), /保存/)
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
