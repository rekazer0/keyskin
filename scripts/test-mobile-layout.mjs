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
  assert.equal(await page.locator(".preview-toolbar .preview-choice button:visible").count(), 0, "segmented choices hidden on phones")
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

for (const viewport of portraitPhones) {
  const tag = `${viewport.width}×${viewport.height}`

  await check(`${tag} welcome page fills the window`, () => withPage(viewport, async (page) => {
    await assertTitlebarClean(page, "welcome")
    await assertNoPageOverflow(page, "welcome")
    assert.equal((await rect(page, ".mobile-workspace-tabs")).visible, false, "pane dock is hidden without a skin")
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

  await check(`${tag} split editor layout`, () => withPage(viewport, async (page) => {
    await openTemplate(page, "official-android-bds")
    await assertPreviewToggles(page)
    await assertPreviewSecondaryMenu(page)
    await assertTitlebarClean(page, "editor")
    await assertNoPageOverflow(page, "editor")
    const main = await rect(page, "main")
    const sidebar = await rect(page, "main > aside")
    const dock = await rect(page, ".mobile-workspace-tabs")
    const workspace = await rect(page, "main > .workspace")
    // 停靠条是手指尺寸的面板切换器：两个 44 高的标签 + 拖动调高的手柄
    assert.equal(dock.height, 56, "pane dock keeps the 56px touch bar")
    const tabs = await page.$$eval('.mobile-workspace-tabs button[data-mobile-pane]', (buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect()
      const style = getComputedStyle(button)
      return { x: box.x, width: box.width, height: box.height, text: button.textContent.trim(), background: style.backgroundColor, pointer: style.pointerEvents }
    }))
    assert.deepEqual(tabs.map((tab) => tab.text), ["文件与布局", "属性检查器"], "pane tabs keep their labels")
    assert.ok(tabs.every((tab) => tab.height >= 44), "pane tabs are finger sized")
    assert.ok(tabs.every((tab) => tab.pointer !== "none"), "pane tabs take taps")
    assert.ok(tabs[0].width > dock.width / 3 && tabs[1].width > dock.width / 3, "each tab owns its half of the dock")
    assert.notEqual(tabs[0].background, tabs[1].background, "current pane is visually distinct")
    assert.ok(Math.abs(sidebar.y - main.y) <= 1, `panes start at the top of main (gap ${sidebar.y - main.y}px)`)
    assert.ok(Math.abs(sidebar.bottom - dock.y) <= 1, "panes end at the dock")
    assert.ok(Math.abs(dock.bottom - workspace.y) <= 1, "canvas starts below the dock")
    assert.ok(Math.abs(workspace.bottom - main.bottom) <= 1, "canvas reaches the bottom")
    const canvasWrap = await rect(page, "main > .workspace > .canvas-wrap")
    assert.ok(canvasWrap.height > workspace.height * 0.6, `canvas gets the workspace (${canvasWrap.height}/${workspace.height})`)
    assert.equal((await rect(page, ".workspace-status")).visible, false, "status strip is hidden on phones")
    const toolbar = await rect(page, ".preview-toolbar")
    assert.ok(toolbar.visible && toolbar.y >= workspace.y && toolbar.bottom <= canvasWrap.y + 1, "preview toolbar sits above the canvas")
    const items = await page.$$eval(".sidebar-overview .mobile-overview-active .nav-item", (nodes) =>
      nodes.filter((node) => node.getBoundingClientRect().height > 0 && node.checkVisibility()).length)
    assert.ok(items > 0, "the active overview group lists its items")
  }))

  await check(`${tag} pane switching and collapse`, () => withPage(viewport, async (page) => {
    await openTemplate(page)
    const hidden = await rect(page, "main > .source")
    assert.ok(hidden.x >= viewport.width - 1, `inspector stays off screen on the layout pane (x ${hidden.x})`)
    // 点标签切换（拖动手柄只调高度，不切换面板）
    await page.locator('button[data-mobile-pane="inspector"]').click()
    await page.waitForTimeout(350)
    const source = await rect(page, "main > .source")
    assert.ok(source.x >= -1 && source.right <= viewport.width + 1, "inspector slides in")
    assert.equal(await page.locator('button[data-mobile-pane="inspector"]').getAttribute("aria-pressed"), "true", "inspector tab is selected")
    const handle = await rect(page, "#mobile-split-handle")
    assert.ok(handle.width >= 32 && handle.height >= 32, "split handle keeps a finger sized drag target")
    await page.locator("#mobile-split-handle").click()
    await page.waitForTimeout(250)
    assert.equal((await rect(page, "main > .workspace")).visible, false, "collapsing hides the canvas")
    const main = await rect(page, "main")
    const expanded = await rect(page, "main > .source")
    assert.ok(Math.abs(expanded.bottom - main.bottom) <= 1, "panes use the freed space")
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
    // 极窄手机的标题栏不留设置按钮（入口在文件菜单里）
    const preferences = page.locator(".titlebar-preferences")
    if (await preferences.isVisible()) await preferences.click()
    else {
      await page.locator(".pen-file-menu summary").click()
      await page.locator('.pen-file-menu [data-app-dialog="settings"]').click()
    }
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

await check("390×844 preview above the panes", () => withPage({ width: 390, height: 844 }, async (page) => {
  await openTemplate(page)
  const main = await rect(page, "main")
  const workspace = await rect(page, "main > .workspace")
  const dock = await rect(page, ".mobile-workspace-tabs")
  const sidebar = await rect(page, "main > aside")
  assert.ok(Math.abs(workspace.y - main.y) <= 1, "canvas on top")
  assert.ok(Math.abs(workspace.bottom - dock.y) <= 1, "dock under the canvas")
  assert.ok(Math.abs(dock.bottom - sidebar.y) <= 1 && Math.abs(sidebar.bottom - main.bottom) <= 1, "panes below the dock")
}, { storage: { "mobile-preview-position": "top" } }))

// 检查器为手指而改：44 触控目标、数值用 − / + 步进、复制 / 交换 / 删除进「更多」。
await check("390×844 inspector is finger sized", () => withPage({ width: 390, height: 844 }, async (page) => {
  await openTemplate(page, "official-android-bds")
  await page.locator('[data-mobile-choice="mode"]').click()
  await page.waitForFunction(() => document.querySelector("#mode").value === "edit")
  const canvas = await rect(page, "#preview")
  await page.mouse.click(canvas.x + canvas.width * 0.45, canvas.y + canvas.height * 0.45)
  await page.waitForSelector('#quick-inspector .ui-field:has(.ui-step)')
  assert.equal(await page.locator('button[data-mobile-pane="inspector"]').getAttribute("aria-pressed"), "true", "selecting a key opens the inspector")

  const rows = await page.$$eval("#quick-inspector .ui-field", (fields) => fields
    .filter((field) => field.checkVisibility() && field.getBoundingClientRect().width > 0 && !field.closest("[hidden]"))
    .map((field) => Math.round(field.getBoundingClientRect().height)))
  assert.ok(rows.length > 4, `inspector lists property rows (${rows.length})`)
  assert.ok(Math.min(...rows) >= 44, `property rows are 44 tall (min ${Math.min(...rows)})`)

  await page.waitForTimeout(300)
  const numericRow = page.locator("#quick-inspector .ui-field:has(.ui-step)").first()
  const numericInput = numericRow.locator("input").first()
  const before = Number(await numericInput.inputValue())
  await numericRow.locator(".ui-step").nth(1).click()
  await page.waitForTimeout(200)
  assert.equal(Number(await numericInput.inputValue()), before + 1, "plus step adds one")
  assert.equal(await page.locator("#mobile-undo").isEnabled(), true, "stepping is undoable")

  const actions = await rect(page, ".inspector-object-actions")
  assert.ok(actions.visible, "object actions stay in the inspector header")
  assert.equal(await page.locator('.inspector-object-actions > button[data-key-action="copy"]').isVisible(), false, "copy leaves the header on phones")
  await page.locator("#inspector-actions-more summary").click()
  assert.equal(await page.locator('#inspector-actions-more [data-key-action-ref="copy"]').isVisible(), true, "copy moves into the more menu")
  assert.equal(await page.locator("#inspector-actions-more").getAttribute("open"), "", "menu opens")
  // 菜单项真的执行同一个对象操作：删除后选中对象回到空态
  const selected = await page.locator("#selected-key").textContent()
  await page.locator('#inspector-actions-more [data-key-action-ref="delete"]').click()
  await page.waitForTimeout(500)
  assert.equal(await page.locator("#inspector-actions-more").getAttribute("open"), null, "menu closes after the action")
  assert.notEqual(await page.locator("#selected-key").textContent(), selected, "more menu runs the same delete action")
}))

await check("1280×800 keeps inline object actions", () => withPage({ width: 1280, height: 800 }, async (page) => {
  await openTemplate(page, "official-android-bds")
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()
  const canvas = await rect(page, "#preview")
  // 画布比例随窗口变化，逐个点位试到选中一个按键为止
  for (const [fx, fy] of [[0.5, 0.6], [0.45, 0.45], [0.5, 0.85], [0.25, 0.65]]) {
    await page.mouse.click(canvas.x + canvas.width * fx, canvas.y + canvas.height * fy)
    await page.waitForTimeout(400)
    if (await page.locator("#quick-inspector .ui-field").count() > 0) break
  }
  // 数值行一定在可见分组里（未显示的皮肤信息分组里也有 .ui-field）
  await page.waitForSelector("#quick-inspector .ui-field:has(.ui-step)")
  assert.equal(await page.locator('.inspector-object-actions > button[data-key-action="copy"]').isVisible(), true, "desktop keeps the inline copy button")
  assert.equal(await page.locator("#inspector-actions-more").isVisible(), false, "desktop hides the mobile more menu")
  assert.equal(await page.locator("#quick-inspector .ui-step").first().isVisible(), false, "desktop has no step buttons")
}))

for (const { top, position } of [
  { top: 52, position: "top" }, { top: 52, position: "bottom" },
  { top: 59, position: "top" }, { top: 59, position: "bottom" },
]) {
  await check(`Dynamic Island ${top}px safe area with preview at ${position}`, () => withPage({ width: 393, height: 852 }, async (page) => {
    const session = await page.context().newCDPSession(page)
    // The application must read browser values; no device-specific inset
    // belongs in app code.
    await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top, bottom: 34 } })
    await openTemplate(page, "official-android-bds")
    await assertTitlebarClean(page, "Dynamic Island")
    const titlebar = await rect(page, ".titlebar")
    assert.equal(titlebar.height, top + 52, "toolbar reserves the browser safe area above its 52px control row")
    for (const selector of [".titlebar-left", ".titlebar-center", ".titlebar-right"]) {
      const controls = await rect(page, selector)
      assert.ok(controls.y >= top, `${selector} stays below the Dynamic Island safe area`)
      assert.ok(controls.bottom <= titlebar.bottom, `${selector} stays inside the toolbar`)
    }
    assert.equal((await rect(page, "main")).y, titlebar.bottom, "workspace starts after the full toolbar")
    await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, bottom: 0 } })
    assert.equal((await rect(page, ".titlebar")).height, 52, "removing the browser inset removes the reserved space")
  }, { colorScheme: "dark", storage: { "mobile-preview-position": position } }))
}

for (const colorScheme of ["light", "dark"]) {
  await check(`browser safe areas and split position (${colorScheme})`, () => withPage({ width: 390, height: 844 }, async (page) => {
    await openTemplate(page)
    const session = await page.context().newCDPSession(page)
    await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 24, bottom: 20 } })
    const background = await page.evaluate(() => ({
      root: getComputedStyle(document.documentElement).backgroundColor,
      toolbar: getComputedStyle(document.querySelector(".titlebar")).backgroundColor,
      browser: document.querySelector('meta[name="theme-color"]').content,
      toolbarToken: getComputedStyle(document.documentElement).getPropertyValue("--material-toolbar").trim(),
    }))
    assert.equal(background.root, background.toolbar, "top safe area continues the toolbar background")
    assert.equal(background.browser, background.toolbarToken, "browser chrome follows the app theme")

    const insets = () => page.evaluate(() => ({
      top: parseFloat(getComputedStyle(document.querySelector(".titlebar")).paddingTop),
      canvas: parseFloat(getComputedStyle(document.querySelector(".canvas-wrap")).paddingBottom),
      editor: parseFloat(getComputedStyle(document.querySelector("main > .source")).paddingBottom),
      controls: parseFloat(getComputedStyle(document.querySelector(".canvas-multi-toolbar")).bottom),
    }))
    assert.equal((await insets()).top, 24, "top inset comes from the browser safe area")
    assert.equal((await insets()).canvas, 28, "bottom canvas clears the system safe area")
    const editorPadding = (await insets()).editor

    const setViewport = async (top, bottom, scale = 1) => {
      await page.evaluate(({ top, bottom, scale }) => {
        Object.defineProperties(visualViewport, {
          height: { configurable: true, value: innerHeight - top - bottom },
          offsetTop: { configurable: true, value: top },
          scale: { configurable: true, value: scale },
        })
        visualViewport.dispatchEvent(new Event("resize"))
      }, { top, bottom, scale })
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    }
    await setViewport(32, 52)
    assert.equal((await insets()).top, 32, "top controls clear the visual viewport overlap")
    assert.equal((await insets()).canvas, 60, "bottom inset uses the reported overlap without adding it twice")
    assert.equal((await insets()).controls, 70, "floating canvas controls clear the bottom overlap")
    await setViewport(0, 36)
    assert.equal((await insets()).canvas, 44, "browser control height updates after resizing")

    await page.evaluate(() => {
      const select = document.querySelector("#mobile-preview-position")
      select.value = "top"
      select.dispatchEvent(new Event("change"))
    })
    assert.equal((await insets()).canvas, 8, "top canvas needs no bottom avoidance")
    assert.equal((await insets()).editor, editorPadding, "bottom editor gains no safe area padding")
    await page.locator("#mobile-split-handle").click()
    assert.equal((await insets()).editor, editorPadding, "collapsed canvas adds no editor padding")

    await setViewport(60, 200, 2)
    assert.equal((await insets()).top, 24, "pinch zoom is not browser chrome")
    await setViewport(0, 0)
    await page.evaluate(() => {
      const input = document.createElement("input")
      input.id = "keyboard-viewport-probe"
      document.body.append(input)
      input.focus()
    })
    await setViewport(0, 300)
    assert.equal(await page.locator("html").getAttribute("data-keyboard-open"), "true", "keyboard shrink is detected")
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--browser-occlusion-bottom")), "0px", "keyboard height is not a browser inset")
    await setViewport(0, 0)
    await page.locator("#keyboard-viewport-probe").evaluate((input) => input.remove())
  }, { colorScheme }))
}

await check("844×390 landscape phone keeps the canvas", () => withPage({ width: 844, height: 390 }, async (page) => {
  await assertNoPageOverflow(page, "landscape welcome")
  await openTemplate(page, "official-android-bds")
  await assertPreviewToggles(page)
  await assertTitlebarClean(page, "landscape")
  const workspace = await rect(page, "main > .workspace")
  const canvasWrap = await rect(page, "main > .workspace > .canvas-wrap")
  assert.ok(canvasWrap.height > workspace.height * 0.6, `canvas gets the workspace (${canvasWrap.height}/${workspace.height})`)
}))

await check("1280×800 desktop title bar is unchanged", () => withPage({ width: 1280, height: 800 }, async (page) => {
  await openTemplate(page)
  await assertTitlebarClean(page, "desktop")
  assert.equal(await page.locator('[data-mobile-choice]:visible').count(), 0, "mobile toggles hidden on desktop")
  assert.equal(await page.locator('.preview-choice button:visible').count(), 4, "desktop keeps both options")
  assert.equal((await rect(page, ".pen-file-menu")).visible, true, "desktop file menu")
  assert.equal((await rect(page, ".mobile-workspace-tabs")).visible, false, "phone dock hidden")
  assert.equal((await rect(page, "main > aside")).visible, true, "sidebar column")
}, { mobile: false }))

await browser.close()
await server.close()

for (const result of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok ? "" : `\n     ${result.error.message.split("\n")[0]}`}`)
}
const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
