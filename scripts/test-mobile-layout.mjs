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
    console.log(`running ${name}`)
    await run()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error })
  }
}

const portraitPhones = [
  { width: 320, height: 568 }, { width: 360, height: 740 },
  { width: 390, height: 844 }, { width: 430, height: 932 },
]

async function assertPreviewToggles(page) {
  for (const [choice, values, icons] of [
    ["orientation", ["port", "land"], ["rectangle-vertical", "rectangle-horizontal"]],
    ["theme", ["light", "dark"], ["sun", "moon"]],
  ]) {
    const button = page.locator(`.preview-toolbar [data-mobile-choice="${choice}"]`)
    assert.equal(await page.locator(".preview-toolbar .preview-choice button:visible").count(), 0, "segmented choices hidden on phones")
    assert.equal(await page.locator(`.preview-toolbar [data-mobile-choice="${choice}"]:visible`).count(), 1, `${choice} has one mobile button`)
    for (const [step, index] of [0, 1, 0].entries()) {
      await page.waitForFunction(([choice, value]) => document.querySelector(`#${choice}`).value === value, [choice, values[index]])
      await button.locator(`svg[data-pen-icon="${icons[index]}"]`).waitFor({ state: "visible" })
      assert.equal(await page.locator(`#${choice}`).inputValue(), values[index], `${choice} state at step ${step}`)
      assert.equal(await button.locator("svg:visible").count(), 1, `${choice} shows one icon`)
      assert.ok(await button.locator(`svg[data-pen-icon="${icons[index]}"]`).isVisible(), `${choice} icon follows state`)
      if (step === 0) await button.click()
      if (step === 1) await button.press("Enter")
    }
  }
}

const pane = (page, value) => page.locator(`.mobile-workspace-tabs [data-mobile-pane="${value}"]`)

for (const viewport of portraitPhones) {
  const tag = `${viewport.width}×${viewport.height}`
  await check(`${tag} mobile home`, () => withPage(viewport, async (page) => {
    await assertTitlebarClean(page, "home")
    await assertNoPageOverflow(page, "home")
    assert.equal(await page.locator(".mobile-welcome-intro").isVisible(), true)
    assert.equal(await page.locator(".mobile-workspace-tabs").isVisible(), false)
    const main = await rect(page, "main"), workspace = await rect(page, "main > .workspace")
    assert.ok(Math.abs(main.y - workspace.y) <= 1 && Math.abs(main.height - workspace.height) <= 1)
    for (const action of ["open", "new"]) assert.ok((await rect(page, `[data-mobile-action="${action}"]`)).height >= 40)
    const chooser = page.waitForEvent("filechooser")
    await page.locator('[data-mobile-action="open"]').click()
    await chooser
  }))

  await check(`${tag} full-screen preview and project browsing`, () => withPage(viewport, async (page) => {
    await openTemplate(page, "official-android-bds")
    await assertTitlebarClean(page, "preview")
    await assertNoPageOverflow(page, "preview")
    await assertPreviewToggles(page)
    const main = await rect(page, "main"), workspace = await rect(page, "main > .workspace"), nav = await rect(page, ".mobile-workspace-tabs")
    assert.equal(await page.locator("#mode").inputValue(), "preview")
    assert.equal(await pane(page, "preview").getAttribute("aria-pressed"), "true")
    assert.ok(Math.abs(workspace.height - main.height) <= 1 && Math.abs(main.bottom - nav.y) <= 1)
    assert.equal(await page.locator("main > aside").isVisible(), false)
    assert.equal(await page.locator("main > .source").isVisible(), false)
    assert.ok((await rect(page, ".canvas-wrap")).height > main.height * 0.6)
    assert.equal(await page.locator("#mobile-save").isEnabled(), true)
    for (const button of ["preview", "layout", "inspector"]) assert.ok((await rect(page, `.mobile-workspace-tabs [data-mobile-pane="${button}"]`)).height >= 48)

    await pane(page, "layout").tap()
    assert.equal(await page.locator(".workspace").isVisible(), false)
    assert.equal(await page.locator("main > aside").evaluate((el) => el.inert), false)
    assert.equal(await page.locator("main > .source").evaluate((el) => el.inert), true)
    const sidebar = await rect(page, "main > aside")
    assert.ok(Math.abs(sidebar.height - main.height) <= 1)
    const categories = await page.locator(".mobile-overview-groups button").evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)))
    assert.equal(new Set(categories).size, 1, "project categories are a horizontal strip")
    await page.locator('.mobile-overview-groups [data-overview-group="键盘布局"]').click()
    await page.locator('.mobile-overview-active .nav-layout').first().click()
    assert.equal(await pane(page, "preview").getAttribute("aria-pressed"), "true", "selecting a layout returns to preview")
  }))

  await check(`${tag} live preview with inspector, object selection and trial mode`, () => withPage(viewport, async (page) => {
    await openTemplate(page, "official-android-bds")
    await pane(page, "inspector").tap()
    await assertTitlebarClean(page, "edit")
    assert.equal(await page.locator("#mode").inputValue(), "edit")
    const main = await rect(page, "main"), source = await rect(page, "main > .source")
    const workspace = await rect(page, ".workspace")
    assert.ok(workspace.height >= main.height * 0.28 && Math.abs(source.y - workspace.bottom) <= 1)
    assert.ok(Math.abs(source.bottom - main.bottom) <= 1)
    assert.equal(await page.locator(".workspace").isVisible(), true, "the canvas stays visible while editing")
    await page.locator("#mobile-preview-resize").press("ArrowDown")
    assert.equal(await page.locator("#mobile-preview-resize").getAttribute("aria-valuenow"), "37")
    await page.locator("#mobile-preview-resize").press("Home")
    assert.equal(await page.locator("#mobile-preview-resize").getAttribute("aria-valuenow"), "28")
    const propertyHeading = await rect(page, ".mobile-property-heading")
    assert.ok(propertyHeading.width >= viewport.width - 1, "property navigation uses the full screen width")
    assert.ok(await page.locator("#mobile-property-select").isVisible(), "property groups are collapsed into a second-level selector")
    assert.ok(await page.locator("#mobile-inspector-groups").isHidden(), "the full group list is not shown at once")
    const row = await page.locator('.source .ui-field:visible').first().evaluate((el) => {
      const label = el.firstElementChild.getBoundingClientRect(), control = el.children[1].getBoundingClientRect()
      return { labelBottom: label.bottom, controlTop: control.top, width: el.getBoundingClientRect().width }
    })
    assert.ok(row.labelBottom <= row.controlTop && row.width >= viewport.width - 40, "fields have full-width controls below their labels")
    await page.locator("#mobile-select-object").tap()
    assert.equal(await page.locator("main > .source").evaluate((el) => el.inert), true)
    assert.equal(await page.locator(".workspace").isVisible(), true)
    assert.equal(await page.locator("#device-shell").getAttribute("data-mode"), "edit")
    const box = await page.locator("#preview").boundingBox()
    await page.locator("#preview").tap({ position: { x: box.width * 0.45, y: box.height * 0.45 } })
    await page.waitForFunction(() => document.documentElement.dataset.mobileCanvas === "closed")
    assert.equal(await page.locator("main > .source").isVisible(), true)
    assert.equal(await page.locator("main > .source").evaluate((el) => el.inert), false)
    const groupSelect = page.locator("#mobile-property-select")
    await groupSelect.selectOption({ index: Math.max(0, await groupSelect.locator("option").count() - 1) })
    const scroll = await page.locator("#quick-inspector").evaluate((el) => el.scrollTop)
    await page.locator("#mobile-preview-toggle").tap()
    assert.equal(await page.locator("#device-shell").getAttribute("data-mode"), "preview")
    assert.equal(await page.locator("main > .source").evaluate((el) => el.inert), false)
    assert.equal(await page.locator("main > .source").isVisible(), true, "properties remain available while trying the skin")
    await page.locator("#mobile-preview-toggle").tap()
    assert.equal(await page.locator("#device-shell").getAttribute("data-mode"), "edit")
    assert.ok(Math.abs(await page.locator("#quick-inspector").evaluate((el) => el.scrollTop) - scroll) <= 1, "preview preserves the inspector scroll position")
    await page.locator("#mobile-select-object").tap()
    await page.keyboard.press("Escape")
    assert.equal(await page.locator("#mobile-select-object").evaluate((el) => el === document.activeElement), true)
    await page.locator("#quick-inspector").evaluate((el) => {
      for (const [type, x] of [["pointerdown", 250], ["pointermove", 80], ["pointerup", 80]]) el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, clientX: x, clientY: 500, pointerType: "touch" }))
    })
    assert.equal(await pane(page, "inspector").getAttribute("aria-pressed"), "true")
    await pane(page, "inspector").press("Home")
    assert.equal(await pane(page, "preview").getAttribute("aria-pressed"), "true")
    await pane(page, "preview").press("ArrowRight")
    assert.equal(await pane(page, "layout").getAttribute("aria-pressed"), "true")
  }))

  await check(`${tag} settings sheet`, () => withPage(viewport, async (page) => {
    await page.locator(".titlebar-preferences").click()
    await page.waitForSelector("#settings-dialog[open]")
    const dialog = await rect(page, "#settings-dialog")
    assert.ok(dialog.x >= -1 && dialog.right <= viewport.width + 1 && dialog.bottom <= viewport.height + 1, "sheet fits the screen")
    const tabs = await page.$$eval("#settings-dialog .settings-nav-item", (nodes) => nodes
      .filter((node) => node.checkVisibility())
      .map((node) => ({ page: node.dataset.settingsPage, top: Math.round(node.getBoundingClientRect().top), scrollW: node.scrollWidth, clientW: node.clientWidth })))
    assert.equal(new Set(tabs.map((tab) => tab.top)).size, 1, "category chips stay on one row")
    assert.ok(tabs.every((tab) => tab.scrollW <= tab.clientW + 1), "category labels are not clipped")
    for (const tab of tabs) {
      await page.locator(`#settings-dialog [data-settings-page="${tab.page}"]`).click()
      const overflow = await page.$eval("#settings-dialog", (sheet) => {
        const bounds = sheet.getBoundingClientRect()
        const panel = sheet.querySelector(".settings-page:not([hidden])")
        return Array.from(panel.querySelectorAll("*"))
          .filter((element) => element.checkVisibility() && element.getBoundingClientRect().width > 0)
          .filter((element) => {
            const box = element.getBoundingClientRect()
            return box.left < bounds.left - 1 || box.right > bounds.right + 1
          })
          .map((element) => element.id || element.className || element.tagName)
      })
      assert.deepEqual(overflow, [], `${tab.page} page stays inside the sheet`)
      const labelOverlaps = await page.$eval("#settings-dialog .settings-page:not([hidden])", (panel) =>
        Array.from(panel.querySelectorAll(".settings-row")).filter((row) => {
          const children = Array.from(row.children).filter((child) => child.checkVisibility())
          for (let i = 0; i < children.length; i += 1) {
            for (let j = i + 1; j < children.length; j += 1) {
              const a = children[i].getBoundingClientRect()
              const b = children[j].getBoundingClientRect()
              if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) return true
            }
          }
          return false
        }).length)
      assert.equal(labelOverlaps, 0, `${tab.page} rows do not overlap their controls`)
    }
    const save = await rect(page, "#settings-save")
    assert.ok(save.visible && save.bottom <= viewport.height + 1, "save button is reachable")
  }))

  await check(`${tag} new skin sheet keeps its buttons on screen`, () => withPage(viewport, async (page) => {
    await page.evaluate(() => document.getElementById("new-project-dialog").showModal())
    const create = await rect(page, '#new-project-form button[value="create"]')
    assert.ok(create.visible && create.bottom <= viewport.height + 1, "create button is visible without scrolling the sheet")
  }))
}

for (const colorScheme of ["light", "dark"]) {
  await check(`safe areas and soft keyboard (${colorScheme})`, () => withPage({ width: 393, height: 852 }, async (page) => {
    const session = await page.context().newCDPSession(page)
    await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, bottom: 34 } })
    await openTemplate(page, "official-android-bds")
    await assertTitlebarClean(page, "safe area")
    assert.equal((await rect(page, ".titlebar")).height, 111)
    const nav = await rect(page, ".mobile-workspace-tabs"), main = await rect(page, "main")
    assert.equal(nav.height, 98)
    assert.equal(nav.bottom, 852)
    assert.ok(Math.abs(main.bottom - nav.y) <= 1, "content ends before bottom navigation")
    for (const name of ["preview", "layout", "inspector"]) assert.ok((await rect(page, `.mobile-workspace-tabs [data-mobile-pane="${name}"]`)).bottom <= 818)
    await pane(page, "inspector").click()
    const field = page.locator('#quick-inspector input:visible:enabled:not([type="range"], [type="checkbox"], [type="hidden"], [type="file"])').first()
    await field.focus()
    await page.evaluate(() => {
      Object.defineProperties(visualViewport, { height: { configurable: true, value: innerHeight - 300 }, offsetTop: { configurable: true, value: 0 }, scale: { configurable: true, value: 1 } })
      visualViewport.dispatchEvent(new Event("resize"))
    })
    await page.waitForFunction(() => document.documentElement.dataset.keyboardOpen === "true")
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--browser-occlusion-bottom")), "0px")
    assert.equal(await page.locator(".workspace").isVisible(), true, "keyboard editing keeps the preview visible")
  }, { colorScheme }))
}

await check("844×390 landscape keeps the desktop workspace", () => withPage({ width: 844, height: 390 }, async (page) => {
  await openTemplate(page, "official-android-bds")
  await assertTitlebarClean(page, "landscape")
  await assertNoPageOverflow(page, "landscape")
  assert.equal(await page.locator(".mobile-workspace-tabs").isVisible(), false)
  const workspace = await rect(page, ".workspace"), canvas = await rect(page, ".canvas-wrap")
  assert.ok(canvas.height > workspace.height * 0.6)
}))

await check("1280×800 desktop frame remains available", () => withPage({ width: 1280, height: 800 }, async (page) => {
  await openTemplate(page, "official-android-bds")
  await assertTitlebarClean(page, "desktop")
  assert.equal(await page.locator(".mobile-workspace-tabs").isVisible(), false)
  assert.equal(await page.locator(".mobile-welcome-intro").isVisible(), false)
  assert.equal(await page.locator("#mobile-save").isVisible(), false)
  assert.equal(await page.locator("main > aside").isVisible(), true)
  assert.equal(await page.locator("main > .source").isVisible(), true)
  assert.equal(await page.locator('.preview-choice button:visible').count(), 4)
}, { mobile: false }))

await browser.close()
await server.close()
for (const result of results) console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok ? "" : `\n${result.error.stack}`}`)
const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
