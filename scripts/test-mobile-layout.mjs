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
const server = await createServer({ root, logLevel: "error", server: { port: 41730, strictPort: false, host: "127.0.0.1" } })
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
  await page.waitForSelector(".template-card")
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
  await page.locator(`.template-card[data-template="${template}"]`).first().click()
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
  const menu = page.locator("#mobile-preview-more")
  assert.equal(await menu.count(), 1, "mobile preview has one secondary menu")
  assert.equal(await page.locator("#device-control:visible").count(), 0, "device picker is secondary on phones")
  assert.equal(await page.locator("#skin-state-control:visible").count(), 0, "skin state picker is secondary on phones")
  await menu.locator(":scope > summary").click()
  assert.equal(await page.locator("#mobile-preview-more[open]").count(), 1, "secondary menu opens")
  assert.equal(await page.locator('#mobile-preview-orientation:visible').count(), 1, "orientation is in the secondary menu")
  assert.equal(await page.locator('#mobile-preview-theme:visible').count(), 1, "theme is in the secondary menu")
  const guides = page.locator("#mobile-preview-guides")
  const before = await guides.getAttribute("aria-pressed")
  await guides.click()
  assert.notEqual(await guides.getAttribute("aria-pressed"), before, "guide state follows the shared control")
  assert.equal(await page.locator("#mobile-preview-more[open]").count(), 0, "secondary menu closes after an action")
}

const tab = (page, pane) => page.locator(`.mobile-workspace-tabs [data-mobile-pane="${pane}"]`)

async function setEditMode(page) {
  await page.locator('#mobile-app-more > summary').click()
  await page.locator('#mobile-app-more [data-mobile-action="mode"]').click()
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
    assert.equal((await rect(page, '.mobile-workspace-tabs')).visible, false, 'welcome has no document navigation')
    const main = await rect(page, 'main'), workspace = await rect(page, 'main > .workspace')
    assert.equal(workspace.y, main.y)
    assert.equal(workspace.height, main.height)
    assert.ok(await page.locator('#mobile-welcome-open').isVisible(), 'open-file entry is visible')
    assert.equal(await page.locator('.mobile-welcome-hero h1').textContent(), '把皮肤改到刚刚好')
    const cards = await page.locator('.template-card').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()))
    assert.ok(cards.every(card => card.left >= 0 && card.right <= viewport.width), 'all templates stay inside the phone')
  }))

  await check(`${tag} full canvas and three tabs`, () => withPage(viewport, async (page) => {
    await openTemplate(page)
    await assertTitlebarClean(page, 'canvas')
    await assertNoPageOverflow(page, 'canvas')
    assert.equal(await page.locator('html').getAttribute('data-mobile-pane'), 'canvas')
    assert.ok(await page.locator('main > aside').evaluate(n => n.inert), 'files cannot take focus')
    assert.ok(await page.locator('main > .source').evaluate(n => n.inert), 'properties cannot take focus')
    const main = await rect(page, 'main'), workspace = await rect(page, 'main > .workspace'), dock = await rect(page, '.mobile-workspace-tabs')
    assert.equal(workspace.y, main.y)
    assert.equal(workspace.bottom + 16, dock.y, 'canvas clears navigation')
    assert.equal(dock.bottom, viewport.height)
    const tabs = await page.locator('.mobile-workspace-tabs > button').evaluateAll(nodes => nodes.map(n => ({text:n.textContent.trim(),width:n.offsetWidth,height:n.offsetHeight})))
    assert.deepEqual(tabs.map(t => t.text), ['画布', '属性', '文件'])
    assert.ok(tabs.every(t => t.width >= 44 && t.height >= 44), 'navigation has touch targets')
    assert.equal(dock.height, 64, 'navigation stays compact')
    assert.ok(tabs.every(t => Math.abs(t.height - (dock.height - 10)) <= 1), 'tab backgrounds fill the navigation height inside its padding and border')
    const zoomIcon = await rect(page, '#preview-zoom-fit svg')
    assert.equal(zoomIcon.width, 20, 'zoom icons keep the design-system size inside the touch target')
    assert.equal(zoomIcon.height, 20)
    assert.ok((await rect(page, '.canvas-wrap')).height > workspace.height * 0.75, 'canvas owns the page')
    await assertPreviewToggles(page)
    await assertPreviewSecondaryMenu(page)
  }))

  await check(`${tag} page switching and keyboard navigation`, () => withPage(viewport, async (page) => {
    await openTemplate(page)
    await tab(page, 'layout').click()
    assert.equal((await rect(page, 'main > aside')).visible, true)
    assert.equal((await rect(page, 'main > .source')).visible, false)
    assert.equal((await rect(page, 'main > .workspace')).visible, false)
    await tab(page, 'inspector').click()
    assert.equal((await rect(page, 'main > .source')).visible, true)
    assert.equal((await rect(page, 'main > aside')).visible, false)
    await page.getByRole('button', {name:'完成',exact:true}).click()
    assert.equal((await rect(page, 'main > .workspace')).visible, true)
    await tab(page, 'canvas').focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await tab(page, 'inspector').getAttribute('aria-pressed'), 'true')
    await page.keyboard.press('End')
    assert.equal(await tab(page, 'layout').getAttribute('aria-pressed'), 'true')
    await page.keyboard.press('Home')
    assert.equal(await tab(page, 'canvas').getAttribute('aria-pressed'), 'true')
    await assertNoPageOverflow(page, 'navigation')
  }))

  await check(`${tag} more and settings sheets`, () => withPage(viewport, async (page) => {
    await page.locator('#mobile-app-more > summary').click()
    const menu = await rect(page, '#mobile-app-more > .ui-menu')
    assert.ok(menu.x >= 0 && menu.right <= viewport.width && menu.bottom <= viewport.height, 'more fits the phone')
    assert.equal(await page.locator('#mobile-app-more [data-mobile-action="mode"]').isDisabled(), true, 'document actions are disabled without a skin')
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
    }
    assert.ok((await rect(page, '#settings-save')).bottom <= viewport.height)
  }))
}

await check('editing, real key preview, undo and selection survive navigation', () => withPage({width:393,height:852}, async page => {
  await openTemplate(page, 'official-android-bds')
  await setEditMode(page)
  await selectKey(page)
  assert.equal(await tab(page, 'inspector').getAttribute('aria-pressed'), 'true')
  const selected = await page.locator('#selected-key').textContent()
  await page.waitForFunction(() => document.querySelector('#mobile-key-canvas').width > 1)
  assert.ok(await page.locator('#mobile-key-preview').isVisible())
  assert.match(await page.locator('#mobile-key-size').textContent(), /\d+ × \d+/)
  await page.locator('#mobile-property-tabs [data-mobile-category="all"]').click()
  await page.locator('.mobile-group-disclosure').getByText('布局', { exact: true }).click()
  const normal = await page.locator('#mobile-key-canvas').evaluate(n => n.toDataURL())
  const sample = await page.locator('#mobile-key-preview').boundingBox()
  await page.mouse.move(sample.x + sample.width / 2, sample.y + sample.height / 2)
  await page.mouse.down()
  await page.waitForFunction(normal => document.querySelector('#mobile-key-canvas').toDataURL() !== normal, normal)
  await page.mouse.up()
  await page.waitForTimeout(200)
  assert.equal(await page.locator('#selected-key').textContent(), selected)
  assert.ok(normal.length > 100, 'preview contains rendered pixels')
  const rows = await page.locator('#quick-inspector .ui-field').evaluateAll(ns => ns.filter(n => n.checkVisibility() && !n.closest('[hidden]')).map(n => n.getBoundingClientRect().height))
  assert.ok(rows.length > 4 && Math.min(...rows) >= 44, 'property rows have finger-sized controls')
  const position = page.locator('#quick-inspector [data-key-field="x"]')
  const before = Number(await position.inputValue())
  await position.fill(String(before + 1))
  await position.dispatchEvent('change')
  await page.waitForTimeout(200)
  assert.equal(Number(await position.inputValue()), before + 1)
  assert.equal(await page.locator('#mobile-undo').isEnabled(), true)
  await tab(page, 'canvas').click()
  await tab(page, 'inspector').click()
  assert.equal(Number(await position.inputValue()), before + 1, 'editing survives page switching')
  assert.equal(await page.locator('#selected-key').textContent(), selected)
  await page.locator('#mobile-undo').click()
  await page.waitForTimeout(200)
  assert.equal(Number(await position.inputValue()), before)
  await page.locator('#inspector-actions-more > summary').click()
  await page.locator('#inspector-actions-more [data-key-action-ref="delete"]').click()
  await page.waitForTimeout(200)
  assert.notEqual(await page.locator('#selected-key').textContent(), selected, 'object menu delegates deletion')
}))

for (const colorScheme of ['light','dark']) {
  await check(`safe areas, theme and orientation (${colorScheme})`, () => withPage({width:393,height:852}, async page => {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setSafeAreaInsetsOverride', {insets:{top:59,bottom:34}})
    await openTemplate(page, 'official-android-bds')
    await assertTitlebarClean(page, 'safe area')
    const bar = await rect(page, '.titlebar'), dock = await rect(page, '.mobile-workspace-tabs'), canvas = await rect(page, 'main > .workspace')
    assert.equal(bar.height, 111, 'header reserves top inset once')
    assert.equal(canvas.y, bar.bottom)
    assert.equal(dock.bottom, 818, 'navigation clears home indicator once')
    assert.equal(canvas.bottom + 16, dock.y)
    const colors = await page.evaluate(() => ({root:getComputedStyle(document.documentElement).backgroundColor,bar:getComputedStyle(document.querySelector('.titlebar')).backgroundColor,accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()}))
    assert.equal(colors.root, colors.bar)
    assert.equal(colors.accent.toLowerCase(), colorScheme === 'dark' ? '#4c8dff' : '#2563eb')
    await tab(page, 'inspector').click()
    await page.setViewportSize({width:844,height:390})
    assert.equal((await rect(page, '.mobile-workspace-tabs')).visible, false)
    for (const selector of ['main > aside','main > .source','main > .workspace']) assert.equal(await page.locator(selector).evaluate(n=>n.inert), false, 'landscape releases all panes')
    await page.setViewportSize({width:393,height:852})
    assert.equal(await tab(page,'inspector').getAttribute('aria-pressed'), 'true', 'portrait restores the selected page')
    assert.equal((await rect(page,'main > .source')).visible,true)
  }, {colorScheme}))
}

await check('more uses shared guide and mode state', () => withPage({width:393,height:852}, async page => {
  await openTemplate(page)
  await page.locator('#mobile-app-more > summary').click()
  const guides=page.locator('#mobile-app-more [data-mobile-action="toggle-guides"]')
  const before=await guides.getAttribute('aria-pressed')
  await guides.click()
  assert.equal(await page.locator('#mobile-app-more').getAttribute('open'),null)
  await page.locator('#mobile-app-more > summary').click()
  assert.notEqual(await guides.getAttribute('aria-pressed'),before)
  await page.keyboard.press('Escape')
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
  await page.waitForSelector('#mobile-export-dialog[open]')
  const sheet = await rect(page, '#mobile-export-dialog')
  assert.ok(sheet.x >= 0 && sheet.right <= 320 && sheet.bottom <= 568, 'format sheet fits the narrow phone')
  assert.equal(await page.locator('#mobile-export-dialog input[type="radio"]').count(), 6, 'all existing targets are available')
  assert.equal(await page.locator('#mobile-export-dialog input:checked').inputValue(), 'bds')
  await page.locator('#mobile-export-dialog button[value="cancel"]').click()
  await page.waitForSelector('#mobile-export-dialog[open]', {state:'hidden'})
  assert.equal(await page.locator('#file-operation-dialog[open]').count(), 0, 'cancelling does not start export')
  await page.locator('.pen-file-menu > summary').click()
  await page.locator('#mobile-export-open').click()
  const download = page.waitForEvent('download')
  await page.locator('#mobile-export-dialog button[value="export"]').click()
  const result = await download
  assert.match(result.suggestedFilename(), /\.bds$/)
  await page.waitForSelector('#file-operation-dialog[open]')
  await page.waitForFunction(() => !document.querySelector('#file-operation-close').disabled)
  assert.match(await page.locator('#file-operation-dialog').textContent(), /完成/)
}))

for (const viewport of [{width:740,height:360},{width:1280,height:800}]) {
  await check(`${viewport.width}×${viewport.height} keeps desktop columns`, () => withPage(viewport, async page => {
    await openTemplate(page)
    await assertTitlebarClean(page,'desktop')
    await assertNoPageOverflow(page,'desktop')
    assert.equal((await rect(page,'.mobile-workspace-tabs')).visible,false)
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
