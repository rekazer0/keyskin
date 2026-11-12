// Mobile app-shell regression test (DESIGN.md §14).
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

async function withPage(viewport, run, { mobile = true, colorScheme = "light" } = {}) {
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
  await page.addInitScript(() => localStorage.clear())
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

// Visible app-bar controls must not overlap each other or leave the bar.
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

async function closeFileOperationDialog(page) {
  await page.waitForFunction(() => {
    const dialog = document.querySelector("#file-operation-dialog")
    return !dialog?.open || !document.querySelector("#file-operation-close")?.disabled
  }, null, { timeout: 30000 }).catch(() => {})
  const close = page.locator("#file-operation-dialog[open] #file-operation-close")
  if (await close.isVisible().catch(() => false)) await close.click()
}

async function openTemplate(page, template = "official-android-bds") {
  await page.locator(`.template-grid .template-card[data-template="${template}"]`).first().click()
  await page.waitForSelector(".canvas-wrap:not(.empty)")
  await page.waitForFunction(() => document.querySelector("#preview")?.getBoundingClientRect().height > 60)
  await closeFileOperationDialog(page)
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

async function currentTab(page) {
  return page.evaluate(() => document.documentElement.dataset.mobileTab)
}

async function paneStates(page) {
  return page.evaluate(() => {
    const state = (selector) => {
      const el = document.querySelector(selector)
      const style = getComputedStyle(el)
      return {
        visible: style.visibility !== "hidden" && style.display !== "none",
        inert: el.inert,
        current: el.getAttribute("aria-current"),
      }
    }
    return {
      canvas: state("main > .workspace"),
      inspector: state("main > .source"),
      files: state("main > aside.sidebar"),
      buttons: [...document.querySelectorAll(".ui-tabbar-item")].map((button) => ({
        tab: button.dataset.mobileTab,
        current: button.getAttribute("aria-current"),
      })),
    }
  })
}

async function assertCanvasPage(page, label) {
  const main = await rect(page, "main")
  const tabbar = await rect(page, ".ui-tabbar")
  const workspace = await rect(page, "main > .workspace")
  assert.equal(await currentTab(page), "canvas", `${label}: canvas is the first page`)
  assert.ok(tabbar.visible, `${label}: tab bar is visible`)
  assert.equal(Math.round(tabbar.height), 56, `${label}: tab bar uses --mobile-tabbar-height`)
  assert.ok(Math.abs(tabbar.bottom - main.bottom) <= 1, `${label}: tab bar sits at the bottom`)
  assert.ok(Math.abs(workspace.y - main.y) <= 1, `${label}: canvas page starts at the top of main`)
  assert.ok(Math.abs(workspace.bottom - tabbar.y) <= 1, `${label}: canvas page ends above the tab bar`)
  const canvasWrap = await rect(page, "main > .workspace > .canvas-wrap")
  assert.ok(canvasWrap.height > workspace.height * 0.9, `${label}: canvas gets the page area (${canvasWrap.height}/${workspace.height})`)
  assert.equal((await rect(page, "main > .workspace > .preview-toolbar")).visible, false, `${label}: no preview toolbar row`)
  assert.equal((await rect(page, "main > .workspace > .workspace-status")).visible, false, `${label}: no status strip`)
  assert.equal((await rect(page, ".mobile-canvas-tools")).visible, true, `${label}: floating preview button`)
}

async function assertSheet(page, selector, label) {
  await page.waitForTimeout(400)
  const menu = await rect(page, selector)
  const viewport = page.viewportSize()
  assert.ok(menu.visible, `${label}: sheet is open`)
  assert.ok(Math.abs(menu.bottom - viewport.height) <= 1, `${label}: sheet is pinned to the bottom`)
  assert.ok(menu.height <= viewport.height * 0.7 + 2, `${label}: sheet height is capped (${menu.height})`)
  assert.ok(menu.height > 100, `${label}: sheet has room for its items`)
  const backdrop = await page.$eval(selector.replace(/ > \.ui-menu$/, ""), (details) => {
    const style = getComputedStyle(details, "::before")
    return style.content !== "none" && style.position === "fixed"
  })
  assert.ok(backdrop, `${label}: backdrop is drawn behind the sheet`)
}

for (const viewport of portraitPhones) {
  const tag = `${viewport.width}×${viewport.height}`

  await check(`${tag} welcome page`, () => withPage(viewport, async (page) => {
    await assertTitlebarClean(page, "welcome")
    await assertNoPageOverflow(page, "welcome")
    assert.equal((await rect(page, ".ui-tabbar")).visible, false, "tab bar is hidden without a skin")
    const main = await rect(page, "main")
    const workspace = await rect(page, "main > .workspace")
    assert.ok(Math.abs(workspace.y - main.y) <= 1 && Math.abs(workspace.height - main.height) <= 1, "welcome page covers main")
    const recent = await rect(page, ".welcome-recent")
    const hero = await rect(page, ".welcome-hero")
    assert.ok(recent.bottom <= hero.y, "recent section sits above the hero")
    const cards = await page.$$eval(".template-card", (nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { left: box.left, right: box.right }
    }))
    assert.ok(cards.every((card) => card.left >= 0 && card.right <= viewport.width), "template cards stay on screen")
  }))

  await check(`${tag} app shell`, () => withPage(viewport, async (page) => {
    await openTemplate(page, "official-android-bds")
    await assertTitlebarClean(page, "editor")
    await assertNoPageOverflow(page, "editor")
    assert.equal(await page.locator(".titlebar-preferences:visible").count(), 0, "settings button moved into the menu")
    assert.equal(await page.locator('[data-mobile-choice="mode"]:visible').count(), 1, "mode pill stays in the app bar")
    await assertCanvasPage(page, tag)
    const states = await paneStates(page)
    assert.deepEqual(states.buttons.map((button) => button.tab), ["canvas", "inspector", "files"], "tab bar has three pages")
    assert.equal(states.buttons[0].current, "page", "canvas tab is current")
    assert.equal(states.inspector.visible || states.files.visible, false, "other pages stay hidden")
    assert.equal(states.inspector.inert, true, "hidden inspector is inert")
    assert.equal(states.files.inert, true, "hidden files page is inert")
  }))

  await check(`${tag} switching pages`, () => withPage(viewport, async (page) => {
    await openTemplate(page)
    const pageArea = await rect(page, "main")
    await page.locator('.ui-tabbar-item[data-mobile-tab="inspector"]').click()
    await page.waitForTimeout(300)
    let states = await paneStates(page)
    assert.equal(await currentTab(page), "inspector", "inspector tab switches page")
    assert.equal(states.inspector.visible, true, "inspector page is shown")
    assert.equal(states.canvas.visible, false, "canvas page is hidden")
    assert.equal(states.inspector.inert, false, "inspector page accepts input")
    assert.equal(states.buttons[1].current, "page", "inspector tab is marked current")
    const source = await rect(page, "main > .source")
    assert.ok(Math.abs(source.y - pageArea.y) <= 1 && Math.abs(source.height - (pageArea.height - 56)) <= 1, "inspector fills the page area")
    await page.locator('.ui-tabbar-item[data-mobile-tab="files"]').click()
    await page.waitForTimeout(300)
    states = await paneStates(page)
    assert.equal(states.files.visible, true, "files page is shown")
    assert.equal(states.inspector.visible, false, "inspector page is hidden")
    const items = await page.$$eval(".sidebar-overview .mobile-overview-active .nav-item", (nodes) =>
      nodes.filter((node) => node.getBoundingClientRect().height > 0 && node.checkVisibility()).length)
    assert.ok(items > 0, "the active overview group lists its items")
    await page.locator('.ui-tabbar-item[data-mobile-tab="canvas"]').click()
    await page.waitForTimeout(300)
    assert.equal((await rect(page, "main > .workspace")).visible, true, "canvas tab returns to the canvas")
  }))

  await check(`${tag} swipe between pages`, () => withPage(viewport, async (page) => {
    await openTemplate(page)
    // 画布页保留自己的手势；从属性页开始验证翻页滑动。
    await page.locator('.ui-tabbar-item[data-mobile-tab="inspector"]').click()
    await page.waitForTimeout(300)
    const swipe = (deltaX) => page.evaluate((deltaX) => {
      const main = document.querySelector("main")
      const start = { x: 200, y: 400 }
      const init = { bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true, button: 0 }
      main.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: start.x, clientY: start.y }))
      main.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: start.x + deltaX, clientY: start.y }))
      main.dispatchEvent(new PointerEvent("pointerup", { ...init, clientX: start.x + deltaX, clientY: start.y }))
    }, deltaX)
    await swipe(-90)
    assert.equal(await currentTab(page), "files", "swipe left moves to the next page")
    await swipe(90)
    assert.equal(await currentTab(page), "inspector", "swipe right goes back")
    await swipe(90)
    assert.equal(await currentTab(page), "canvas", "swipe right again reaches the canvas")
  }))

  await check(`${tag} preview options sheet`, () => withPage(viewport, async (page) => {
    await openTemplate(page)
    await page.locator(".mobile-canvas-tools summary").click()
    await assertSheet(page, "#mobile-preview-more > .ui-menu", "preview options")
    for (const id of ["#mobile-preview-orientation", "#mobile-preview-theme", "#mobile-preview-device", "#mobile-preview-guides", "#mobile-preview-overview"]) {
      assert.equal(await page.locator(`${id}:visible`).count(), 1, `${id} is in the sheet`)
    }
    const stateHidden = await page.locator("#mobile-preview-state").evaluate((el) => el.hidden)
    assert.equal(await page.locator("#mobile-preview-state:visible").count(), stateHidden ? 0 : 1, "skin state follows the shared control")
    const guides = page.locator("#mobile-preview-guides")
    const before = await guides.getAttribute("aria-pressed")
    await guides.click()
    assert.notEqual(await guides.getAttribute("aria-pressed"), before, "guide state follows the shared control")
    assert.equal(await page.locator("#mobile-preview-more[open]").count(), 0, "preview sheet closes after an action")
  }))

  await check(`${tag} global menu sheet`, () => withPage(viewport, async (page) => {
    await openTemplate(page)
    await page.locator(".pen-file-menu > summary").click()
    await assertSheet(page, ".pen-file-menu > .ui-menu", "global menu")
    assert.equal(await page.locator("#new:visible").count(), 1, "file actions live in the sheet")
    await page.keyboard.press("Escape")
    assert.equal(await page.locator(".pen-file-menu[open]").count(), 0, "Escape closes the sheet")
    assert.equal(await page.locator(".pen-file-menu > summary").evaluate((el) => el === document.activeElement), true, "focus returns to the trigger")
  }))

  await check(`${tag} selecting a key opens the inspector page`, () => withPage(viewport, async (page) => {
    await openTemplate(page)
    await page.locator('[data-mobile-choice="mode"]').click()
    await page.waitForFunction(() => document.querySelector("#mode").value === "edit")
    const box = await page.locator("#preview").boundingBox()
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45)
    await page.waitForFunction(() => document.documentElement.dataset.mobileTab === "inspector")
    assert.equal(await currentTab(page), "inspector", "the property page follows the selection")
    assert.equal((await paneStates(page)).inspector.inert, false, "the property page accepts input")
  }))

  await check(`${tag} file selection opens the inspector page`, () => withPage(viewport, async (page) => {
    await openTemplate(page)
    await page.locator('.ui-tabbar-item[data-mobile-tab="files"]').click()
    await page.waitForTimeout(300)
    await page.locator(".sidebar-overview .mobile-overview-active .nav-item").first().click()
    await page.waitForFunction(() => document.documentElement.dataset.mobileTab === "inspector")
    assert.equal(await currentTab(page), "inspector", "picking a file shows the property page")
  }))

  await check(`${tag} mode switch keeps the title readable`, () => withPage(viewport, async (page) => {
    await openTemplate(page)
    await page.locator('[data-mobile-choice="mode"]').click()
    await page.waitForFunction(() => document.querySelector("#mode").value === "edit")
    await assertTitlebarClean(page, "edit mode")
    const title = await rect(page, "#document-name")
    assert.ok(title.width >= 40, `document name keeps room (${title.width}px)`)
  }))

  await check(`${tag} settings sheet`, () => withPage(viewport, async (page) => {
    await page.locator(".pen-file-menu > summary").click()
    await page.locator('.pen-file-menu [data-app-dialog="settings"]').click()
    await page.waitForSelector("#settings-dialog[open]")
    await page.waitForTimeout(400)
    const dialog = await rect(page, "#settings-dialog")
    assert.ok(Math.abs(dialog.width - viewport.width) <= 1, "settings sheet spans the screen")
    assert.ok(Math.abs(dialog.height - viewport.height) <= 2, "settings sheet uses the full height")
    const tabs = await page.$$eval("#settings-dialog .settings-nav-item", (nodes) => nodes
      .filter((node) => node.checkVisibility())
      .map((node) => ({ page: node.dataset.settingsPage, top: Math.round(node.getBoundingClientRect().top), scrollW: node.scrollWidth, clientW: node.clientWidth })))
    assert.equal(new Set(tabs.map((tab) => tab.top)).size, 1, "category chips stay on one row")
    assert.ok(tabs.every((tab) => tab.scrollW <= tab.clientW + 1), "category labels are not clipped")
    const save = await rect(page, "#settings-save")
    assert.ok(save.visible && save.bottom <= viewport.height + 1, "save button is reachable")
    await page.keyboard.press("Escape")
  }))

  await check(`${tag} new skin sheet keeps its buttons on screen`, () => withPage(viewport, async (page) => {
    await page.locator(".pen-file-menu > summary").click()
    await page.locator("#new").click()
    await page.waitForSelector("#new-project-dialog[open]")
    const create = await rect(page, '#new-project-form button[value="create"]')
    assert.ok(create.visible && create.bottom <= viewport.height + 1, "create button is visible without scrolling the sheet")
    await page.keyboard.press("Escape")
  }))
}

await check("390×844 safe areas", () => withPage({ width: 390, height: 844 }, async (page) => {
  const session = await page.context().newCDPSession(page)
  await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, bottom: 34 } })
  await openTemplate(page, "official-android-bds")
  await assertTitlebarClean(page, "Dynamic Island")
  const titlebar = await rect(page, ".titlebar")
  assert.equal(titlebar.height, 59 + 52, "app bar reserves the browser safe area")
  const tabbar = await rect(page, ".ui-tabbar")
  assert.equal(Math.round(tabbar.height), 56 + 34, "tab bar adds the bottom safe area")
  assert.equal(Math.round(tabbar.bottom), 844, "tab bar reaches the bottom edge")
  const workspace = await rect(page, "main > .workspace")
  assert.equal(Math.round(workspace.bottom), Math.round(tabbar.y), "page area ends above the tab bar")
  const canvasPadding = await page.$eval("main > .workspace > .canvas-wrap", (el) => getComputedStyle(el).paddingBottom)
  assert.equal(canvasPadding, "8px", "canvas page does not repeat the bottom safe area")
  await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, bottom: 0 } })
  assert.equal((await rect(page, ".titlebar")).height, 52, "removing the browser inset removes the reserved space")
}))

await check("390×844 keyboard hides the tab bar", () => withPage({ width: 390, height: 844 }, async (page) => {
  await openTemplate(page)
  const session = await page.context().newCDPSession(page)
  const setViewport = (top, bottom) => page.evaluate(({ top, bottom }) => {
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: innerHeight - top - bottom },
      offsetTop: { configurable: true, value: top },
      scale: { configurable: true, value: 1 },
    })
    visualViewport.dispatchEvent(new Event("resize"))
  }, { top, bottom })
  await page.evaluate(() => {
    const input = document.createElement("input")
    input.id = "keyboard-viewport-probe"
    document.body.append(input)
    input.focus()
  })
  await setViewport(0, 300)
  await page.waitForFunction(() => document.documentElement.dataset.keyboardOpen === "true")
  assert.equal((await rect(page, ".ui-tabbar")).visible, false, "tab bar gives its height back to the content")
  await setViewport(0, 0)
  await page.evaluate(() => document.querySelector("#keyboard-viewport-probe")?.remove())
  await page.waitForFunction(() => document.documentElement.dataset.keyboardOpen !== "true")
  assert.equal((await rect(page, ".ui-tabbar")).visible, true, "tab bar returns after the keyboard closes")
  await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, bottom: 0 } })
}))

await check("844×390 landscape phone", () => withPage({ width: 844, height: 390 }, async (page) => {
  await assertNoPageOverflow(page, "landscape welcome")
  await openTemplate(page, "official-android-bds")
  await assertTitlebarClean(page, "landscape")
  const titlebar = await rect(page, ".titlebar")
  assert.equal(titlebar.height, 44, "landscape keeps the shorter app bar")
  await assertCanvasPage(page, "landscape")
  await page.locator('.ui-tabbar-item[data-mobile-tab="inspector"]').click()
  await page.waitForTimeout(300)
  assert.equal((await rect(page, "main > .source")).visible, true, "inspector page opens in landscape")
}, { mobile: true }))

await check("1280×800 desktop is unchanged", () => withPage({ width: 1280, height: 800 }, async (page) => {
  await openTemplate(page)
  await assertTitlebarClean(page, "desktop")
  assert.equal(await page.locator('[data-mobile-choice]:visible').count(), 0, "mobile mode pill is hidden on desktop")
  assert.equal(await page.locator('.ui-tabbar:visible').count(), 0, "mobile tab bar is hidden on desktop")
  assert.equal(await page.locator('.preview-choice button:visible').count(), 4, "desktop keeps both preview options")
  assert.equal((await rect(page, ".pen-file-menu")).visible, true, "desktop file menu")
  assert.equal((await rect(page, "main > aside.sidebar")).visible, true, "sidebar column")
  assert.equal((await rect(page, "main > .workspace")).visible, true, "canvas column")
  assert.equal((await rect(page, "main > .source")).visible, true, "inspector column")
  assert.equal((await rect(page, ".mobile-canvas-tools")).visible, false, "mobile canvas tools are hidden on desktop")
}, { mobile: false }))

await browser.close()
await server.close()

for (const result of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok ? "" : `\n     ${result.error.message.split("\n")[0]}`}`)
}
const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
