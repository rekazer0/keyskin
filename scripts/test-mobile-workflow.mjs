// A real mobile edit → undo / redo → save round trip through the new shell.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { createServer } from "vite"
import { SkinArchive } from "../src/skin.ts"
import { IniDocument } from "../src/ini.ts"

const server = await createServer({ root: new URL("..", import.meta.url).pathname, logLevel: "error", server: { port: 41731, strictPort: false, host: "127.0.0.1" } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.addInitScript(() => { Object.defineProperty(window, "showSaveFilePicker", { value: undefined }) })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('.template-card[data-template="official-android-bds"]').click()
  await page.waitForSelector(".canvas-wrap:not(.empty)")
  await page.locator('[data-mobile-pane="inspector"]').tap()
  await page.locator("#mobile-select-object").tap()
  const box = await page.locator("#preview").boundingBox()
  await page.locator("#preview").tap({ position: { x: box.width * 0.45, y: box.height * 0.45 } })
  await page.waitForFunction(async () => (await import("/src/app/state.ts")).appState.selectedKeySections.length === 1)
  const selection = await page.evaluate(async () => {
    const { appState } = await import("/src/app/state.ts")
    return { path: appState.layoutPath, key: appState.selectedKeySections[0], before: appState.archive.getText(appState.layoutPath) }
  })
  const x = page.locator('[data-key-field="x"]')
  const beforeX = await x.inputValue()
  const afterX = String(Number(beforeX) + 4)
  await page.locator("#mobile-preview-toggle").tap()
  assert.equal(await page.locator(".workspace").isVisible(), true)
  assert.equal(await page.locator("#device-shell").getAttribute("data-mode"), "preview")
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const beforePixels = await page.locator("#preview").evaluate((canvas) => canvas.toDataURL())
  await x.fill(afterX)
  await x.press("Tab")
  await page.waitForFunction(async () => (await import("/src/app/state.ts")).appState.undoStack.length === 1)
  assert.equal(await x.inputValue(), afterX)
  await page.waitForFunction((before) => document.querySelector("#preview").toDataURL() !== before, beforePixels)
  assert.equal(await page.locator("#quick-inspector").isVisible(), true, "properties remain on screen while the live canvas updates")
  await page.locator("#mobile-undo").click()
  assert.equal(await x.inputValue(), beforeX)
  await page.locator(".pen-file-menu summary").click()
  await page.locator("#redo").click()
  assert.equal(await x.inputValue(), afterX)
  await page.locator("#mobile-property-search").click()
  await page.locator("#inspector-filter").fill("位置")
  assert.equal(await x.isVisible(), true, "property filter keeps the matching coordinate row")
  await page.locator("#inspector-filter").press("Escape")
  assert.equal(await page.locator("#inspector-filter").inputValue(), "")
  await page.locator("#inspector-filter").press("Escape")
  assert.equal(await x.inputValue(), afterX, "filtering does not change document values")
  const expected = await page.evaluate(async (path) => (await import("/src/app/state.ts")).appState.archive.getText(path), selection.path)
  assert.notEqual(expected, selection.before, "editing changed the actual layout document")

  const downloadPromise = page.waitForEvent("download")
  await page.locator("#mobile-save").click()
  await Promise.race([
    downloadPromise,
    page.getByRole("button", { name: "下载", exact: true }).waitFor({ state: "visible" }).then(() => page.getByRole("button", { name: "下载", exact: true }).click()),
  ])
  const download = await downloadPromise
  const saved = SkinArchive.open(new Uint8Array(await readFile(await download.path())), "bds")
  assert.equal(IniDocument.parse(saved.getText(selection.path)).get(selection.key, "VIEW_RECT"), IniDocument.parse(expected).get(selection.key, "VIEW_RECT"), "saved skin contains the edited key geometry")
  await page.waitForFunction(() => !document.querySelector("#file-operation-close").disabled)
  await page.locator("#file-operation-close").click()
  await page.locator('[data-inspector-tab="source"]').click()
  await page.waitForSelector("#source-editor:not([hidden]) .cm-editor")
  assert.equal(await page.locator("#mode").inputValue(), "edit")
  await page.locator('[data-inspector-tab="properties"]').click()
  assert.equal(await x.inputValue(), afterX)
  await page.locator('[data-mobile-pane="layout"]').tap()
  await page.locator('[data-sidebar-view="source"]').click()
  assert.equal(await page.locator(".raw-files").isVisible(), true, "source tree is available on the project page")
  await page.locator('[data-mobile-pane="preview"]').tap()
  assert.equal(await page.locator("#mode").inputValue(), "preview")
  assert.deepEqual(errors, [])
  console.log("PASS: simultaneous property editing and canvas repaint, undo, redo, save round trip and source browsing")
} finally {
  await browser.close()
  await server.close()
}
