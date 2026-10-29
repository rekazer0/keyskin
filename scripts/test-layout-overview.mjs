// Real Playwright flow: the overview grid snapshots every layout, the selected cell is the live canvas in
// interactive preview, ⌘/Ctrl + arrows or a click move it, Space enters the layout and Esc comes back.
import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { bdaAnimatedSkinBytes, bdsBaseArchive } from "../tests/helpers/bda-animation-fixture.mjs"
import { SkinArchive } from "../src/skin.ts"
import { convertBdaArchive } from "../src/bda-convert.ts"

const bds = await convertBdaArchive(SkinArchive.open(bdaAnimatedSkinBytes(), "bda"), bdsBaseArchive()).archive.platformBytesAsync("bds")
const server = await createServer({ root: new URL("..", import.meta.url).pathname, logLevel: "error", server: { port: 41841, strictPort: false, host: "127.0.0.1", hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
const layoutPath = () => page.evaluate(async () => (await import("/src/app/state.ts")).appState.layoutPath)
const selectedCell = () => page.locator('.layout-overview-cell[aria-selected="true"]').getAttribute("data-path")
const liveAt = (path) => page.waitForFunction(async (path) =>
  (await import("/src/app/state.ts")).appState.layoutPath === path &&
  document.querySelector('.layout-overview-frame[data-live="ready"]')?.closest(".layout-overview-cell")?.dataset.path === path &&
  document.querySelector("#device-shell").closest(".layout-overview-frame") !== null, path)
const closed = () => page.waitForFunction(() => document.querySelector("#layout-overview").hidden && document.querySelector("#device-shell").parentElement.classList.contains("canvas-wrap"))
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator("#browser-open").setInputFiles({ name: "overview.bds", mimeType: "application/octet-stream", buffer: Buffer.from(bds) })
  await page.waitForFunction(() => !document.querySelector("#open").disabled)
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()
  const layouts = await page.locator('.sidebar-overview :is(.nav-layout, [data-overview-group="数字与符号"] .nav-item)').evaluateAll((nodes) => nodes.map((node) => node.dataset.path))
  assert.ok(layouts.length > 3, "the fixture has several layouts")
  const origin = await layoutPath()
  const at = (offset) => layouts[layouts.indexOf(origin) + offset]

  await page.locator("#layout-overview-toggle").click()
  await page.waitForFunction((count) => document.querySelectorAll(".layout-overview-frame > canvas").length === count, layouts.length)
  const columns = Math.ceil(Math.sqrt(layouts.length))
  const grid = await page.locator("#layout-overview-grid").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length)
  assert.equal(grid, columns, "a square grid of ceil(√n) columns")
  await liveAt(origin)
  assert.equal(await page.locator("#mode").inputValue(), "preview", "the live cell answers clicks like the interactive preview")
  if (process.env.OVERVIEW_SCREENSHOT) {
    await page.waitForTimeout(600)
    await page.screenshot({ path: process.env.OVERVIEW_SCREENSHOT })
  }

  await page.keyboard.press("ControlOrMeta+ArrowRight")
  assert.equal(await selectedCell(), at(1), "⌘/Ctrl + → moves to the next cell")
  await liveAt(at(1))
  await page.locator(".layout-overview-cell").nth(layouts.indexOf(at(2))).locator(".layout-overview-label").click()
  await liveAt(at(2))
  await page.locator("#preview").click()
  assert.equal(await page.locator("#layout-overview").isHidden(), false, "clicking the live canvas stays in the overview")

  await page.keyboard.press("Space")
  await closed()
  assert.equal(await layoutPath(), at(2), "Space enters the selected layout")
  assert.equal(await page.locator("#mode").inputValue(), "edit", "entering restores the editing mode")
  assert.equal(await page.locator("#layout-overview-toggle").getAttribute("aria-pressed"), "false")

  // Esc 回到全局预览；皮肤没改动，截图直接复用，不再逐个切换布局。
  await page.keyboard.press("Escape")
  await page.waitForFunction(() => !document.querySelector("#layout-overview").hidden)
  assert.equal(await page.locator(".layout-overview-frame > canvas").count(), layouts.length, "an unchanged skin reopens from cached snapshots")
  await liveAt(at(2))
  await page.keyboard.press("Space")
  await closed()

  await page.keyboard.press("ControlOrMeta+ArrowLeft")
  await page.waitForFunction(async (path) => (await import("/src/app/state.ts")).appState.layoutPath === path, at(1))
  assert.deepEqual(errors, [])
  console.log(`layout overview: ${layouts.length} layouts in a ${columns}×${columns} grid`)
} finally {
  await browser.close()
  await server.close()
}
