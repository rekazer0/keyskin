import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41909, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.waitForSelector('#pinned-toolbar[data-editing="false"]', { state: "attached" })
  await page.evaluate(() => document.documentElement.classList.add("macos"))
  // Tauri 的 deep 区域覆盖非交互子节点；子节点上的 bare 区域会截断这份继承。
  for (const selector of [".titlebar-left", ".titlebar-center", ".titlebar-right", "#pinned-toolbar", ".document-icon svg", "#dirty", ".ui-workspace-navigation-brand img", ".ui-workspace-navigation-pages", ".ui-workspace-navigation-actions"]) {
    assert.equal(await page.locator(selector).evaluate(node => node.closest("[data-tauri-drag-region]")?.getAttribute("data-tauri-drag-region")), "deep", `${selector} inherits the native drag region`)
  }
  assert.equal(await page.locator(".titlebar .ui-menu").getAttribute("data-tauri-drag-region"), "false")
  // 按钮及其图标不能显式覆盖 Tauri 对交互控件的保护。
  for (const selector of [".titlebar button", "#document-name", "#workspace-navigation button"]) {
    assert.equal(await page.locator(selector).evaluateAll(nodes => nodes.some(node => node.hasAttribute("data-tauri-drag-region") || node.querySelector("[data-tauri-drag-region]"))), false)
  }
  await page.locator("#workspace-navigation [data-app-dialog='settings']").click()
  await page.locator("#settings-dialog").waitFor({ state: "visible" })
  await page.keyboard.press("Escape")
  await page.locator("#settings-dialog").waitFor({ state: "hidden" })
  await page.locator("#workspace-navigation [data-app-dialog='settings']").focus()
  await page.keyboard.press("Alt+Enter")
  await page.locator("#browser-open").setInputFiles({ name: "拖动.bds", mimeType: "application/octet-stream", buffer: Buffer.from(bdsFixture()) })
  await page.waitForFunction(() => !document.querySelector("#open").disabled && !document.querySelector("#file-operation-dialog").open)
  await page.locator("#pinned-toolbar .ui-pinned-tool > button").first().click()
  await page.locator("#settings-dialog").waitFor({ state: "visible" })
  await page.keyboard.press("Escape")
  await page.locator("#settings-dialog").waitFor({ state: "hidden" })
  assert.equal(await page.locator("#document-name").isVisible(), true, "desktop editor shows the document name")
  assert.equal(await page.locator("#document-name").textContent(), "拖动.bds")
  const title = await page.locator(".document-title").boundingBox()
  const titlebar = await page.locator(".titlebar").boundingBox()
  assert.ok(Math.abs(title.x + title.width / 2 - titlebar.x - titlebar.width / 2) < 1, "document title is centered in the titlebar")
  const navigation = await page.locator("#workspace-navigation").boundingBox()
  assert.equal(titlebar.x, navigation.x + navigation.width, "titlebar excludes the left navigation")
  assert.ok(Math.abs(title.x + title.width / 2 - (navigation.width + (page.viewportSize().width - navigation.width) / 2)) < 1, "document title is centered after excluding the navigation width")

  await page.evaluate(() => {
    window.dragCommands = []
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      invoke: async (command, args) => {
        window.dragCommands.push(command === "move_macos_window" ? [command, args] : command)
      },
    }
  })
  const press = (selector, options = {}) => page.locator(selector).evaluate((node, options) => {
    const event = new MouseEvent("mousedown", { button: 0, buttons: 1, detail: 1, bubbles: true, cancelable: true, ...options })
    node.dispatchEvent(event)
    return event.defaultPrevented
  }, options)
  // macOS 单击拖动走 AppKit，Windows 材质拖动沿用原有流程。两者都不拦截控件或双击。
  for (const platform of ["macos", "windows"]) {
    await page.evaluate(platform => {
      document.documentElement.classList.toggle("macos", platform === "macos")
      document.documentElement.classList.toggle("windows", platform === "windows")
      document.querySelector("#window-material").checked = platform === "windows"
      window.dragCommands.length = 0
    }, platform)
    for (const selector of [".titlebar .ui-menu", "#workspace-navigation [data-app-dialog='settings'] svg", "#document-name", "#pinned-toolbar .ui-pinned-tool > button:first-child", '#workspace-navigation [data-workspace-page="files"] svg']) {
      assert.equal(await press(selector), false, `${platform}: ${selector} does not start a drag`)
    }
    assert.equal(await press(".titlebar-right", { button: 2, buttons: 2 }), false)
    assert.equal(await press(".titlebar-right", { detail: 2 }), false, "native double-click remains available")
    assert.deepEqual(await page.evaluate(() => window.dragCommands), [])
    if (platform === "macos") {
      assert.equal(await press(".titlebar-left"), true)
      assert.equal(await press(".document-icon svg"), true)
      assert.deepEqual(await page.evaluate(() => window.dragCommands), [], "clicking without moving leaves the window in place")
      const { x, y, width, height } = await page.locator(".titlebar-left").boundingBox()
      await page.mouse.move(x + width / 2, y + height / 2)
      await page.mouse.down()
      await page.mouse.move(x + width / 2 + 80, y + height / 2 + 100, { steps: 4 })
      await page.mouse.up()
      await page.mouse.move(x + width / 2 + 160, y + height / 2 + 200)
      assert.deepEqual(await page.evaluate(() => window.dragCommands), Array(4).fill(["move_macos_window", { dx: 20, dy: 25 }]))
    }
  }
  assert.equal(await press(".titlebar-right"), true)
  await page.waitForFunction(() => window.dragCommands.filter(command => command === "set_window_material").length === 2)
  assert.deepEqual(await page.evaluate(() => window.dragCommands), ["set_window_material", "wait_for_left_mouse_release", "plugin:window|start_dragging", "set_window_material"])
  assert.deepEqual(errors, [])
  console.log("window drag: inherited native regions, controls, centered document title, pinned actions, macOS drag and Windows material drag passed")
} finally {
  await browser.close()
  await server.close()
}
