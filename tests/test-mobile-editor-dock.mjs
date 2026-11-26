import { dismissStartupDisclaimer } from "../tests/helpers/open-editor-template.mjs"
import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { mobilePenFixture } from "../tests/helpers/mobile-pen-fixture.mjs"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41769, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const viewport of [{ width: 320, height: 668 }, { width: 393, height: 852 }]) {
    const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true })
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await dismissStartupDisclaimer(page)
    await page.locator("#browser-open").setInputFiles({ name: "Dock.bds", mimeType: "application/octet-stream", buffer: Buffer.from(mobilePenFixture()) })
    await page.waitForFunction(() => !document.querySelector("#open").disabled && !document.querySelector("#save").disabled)
    const close = page.locator("#file-operation-dialog[open] #file-operation-close")
    if (await close.count()) await close.click()
    const toolbar = page.locator('.preview-toolbar')
    assert.equal(await toolbar.isVisible(), false, 'trial mode keeps the canvas toolbar hidden')
    await page.getByRole("button", { name: "开始编辑", exact: true }).tap()
    await page.locator("#mobile-project-toggle").tap()
    await page.locator("#mobile-project-dialog").getByText("拼音 26 键", { exact: true }).tap()
    await page.waitForFunction(() => document.documentElement.dataset.mobileDock === "true")
    await toolbar.waitFor()
    const guides = toolbar.getByRole('button', { name: '辅助线' })
    const guidesBefore = await guides.getAttribute('aria-pressed')
    await guides.tap()
    assert.notEqual(await guides.getAttribute('aria-pressed'), guidesBefore)
    await guides.tap()
    await toolbar.locator('#device').selectOption('canvas-white')
    assert.equal(await page.locator('.canvas-wrap').getAttribute('data-background'), 'white')
    await toolbar.locator('#device').selectOption('canvas-checkerboard')
    const handle = page.getByRole("slider", { name: "调整画布与属性高度" })
    const canvas = page.locator("#preview")
    const dock = page.locator("main > .source")
    async function verifyDetent(label) {
      await page.waitForFunction(text => document.querySelector("#mobile-inspector-resize").getAttribute("aria-valuetext") === text, label)
      await page.waitForFunction(() => {
        const stage = document.querySelector("main > .workspace").getBoundingClientRect()
        const keyboard = document.querySelector("#preview").getBoundingClientRect()
        return keyboard.height > 20 && keyboard.top >= stage.top - 1 && keyboard.bottom <= stage.bottom + 1
      }, null, { timeout: 3000 })
      const boxes = await page.evaluate(() => Object.fromEntries(["main > .workspace", "main > .source", "#preview", "#mobile-inspector-resize"].map(selector => [selector, document.querySelector(selector).getBoundingClientRect().toJSON()])))
      const stage = boxes["main > .workspace"]
      const real = boxes["#preview"]
      assert.equal(await canvas.isVisible(), true)
      assert.ok(real.width > 20 && real.height > 20 && real.top >= stage.top - 1 && real.bottom <= stage.bottom + 1, "real keyboard stays within the visible stage")
      assert.ok(Math.abs(stage.bottom - boxes["main > .source"].top) <= 1)
      assert.ok(boxes["#mobile-inspector-resize"].height >= 44)
      return (await dock.boundingBox()).height
    }
    const peek = await verifyDetent("探出")
    assert.ok(Math.abs(peek - 72) <= 1)
    assert.equal(await page.locator("#quick-inspector").isVisible(), false)
    await handle.tap()
    const half = await verifyDetent("半开")
    await handle.press("Home")
    const full = await verifyDetent("全开")
    assert.ok(peek < half && half < full)
    // Drag back down one detent, then tap a real key in document coordinates.
    const grip = await handle.boundingBox()
    const cdp = await page.context().newCDPSession(page)
    const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 50 }] })
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await verifyDetent("半开")
    const key = await page.evaluate(async () => {
      const { preview } = await import("/src/app/canvas-interaction.ts")
      const rect = preview.keys.find(item => item.editable && item.section.startsWith("KEY")).rect
      const box = preview.canvas.getBoundingClientRect(), size = preview.logicalSize()
      return { x: box.left + (rect.x + rect.width / 2) * box.width / size.width, y: box.top + (rect.y + rect.height / 2) * box.height / size.height }
    })
    await page.touchscreen.tap(key.x, key.y)
    const width = page.locator('#quick-inspector [data-key-field="width"]')
    await width.waitFor()
    const snapshot = () => page.evaluate(async () => {
      const { appState } = await import("/src/app/state.ts")
      return appState.archive.getText(appState.layoutPath)
    })
    const before = await snapshot()
    const value = Number(await width.inputValue())
    await width.fill(String(value + 1))
    await width.press("Tab")
    assert.notEqual(await snapshot(), before, "selected key writes back to the same layout document")
    await page.locator("#mobile-undo").tap()
    assert.equal(await width.inputValue(), String(value))
    assert.equal(await snapshot(), before, "one undo restores the original layout")
    await handle.dblclick()
    await verifyDetent("全开")
    await page.locator("#inspector-source-toggle").tap()
    await page.locator("#source-editor").waitFor()
    await verifyDetent("全开")
    await page.locator("#inspector-source-toggle").tap()
    const surface = await page.locator('.canvas-wrap').boundingBox()
    await page.touchscreen.tap(surface.x + 4, surface.y + surface.height / 2)
    await verifyDetent('探出')
    await page.getByRole('button', { name: '全选按键' }).tap()
    await verifyDetent('半开')
    await page.locator('#selected-key').filter({ hasText: /已选 \d+ 个按键/ }).waitFor()
    const header = await page.locator('.source .key-inspector-title').boundingBox()
    assert.ok(header.y + header.height - (await handle.boundingBox()).y <= 73, 'multi-select heading fits below the grip')
    await page.locator("#mobile-app-more > summary").tap()
    await page.locator('#mobile-app-more [data-mobile-action="mobile-source-view"]').tap()
    await page.locator("html[data-mobile-source]").waitFor({ state: "attached" })
    await handle.waitFor({ state: "hidden" })
    assert.equal(await canvas.isVisible(), false, "global source is not an object dock")
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log("PASS mobile three-detent dock, real touch canvas, key write-back and undo")
} finally {
  await browser.close()
  await server.close()
}
