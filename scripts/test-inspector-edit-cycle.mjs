import { dismissStartupDisclaimer } from "../tests/helpers/open-editor-template.mjs"
import assert from "node:assert/strict"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"
import { ssfFixture } from "../tests/helpers/ssf-fixture.mjs"
import { SkinArchive } from "../src/skin.ts"
import { readFileSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41943, strictPort: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
const baidu = bdsFixture()
async function open(format, bytes) {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator(".template-card").first().waitFor({ state: "attached" })
  await dismissStartupDisclaimer(page)
  await page.locator("#browser-open").setInputFiles({ name: `test.${format}`, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) })
  await page.waitForFunction(async format => (await import("/src/app/state.ts")).appState.archive?.format === format && !document.querySelector("#open").disabled, format)
  const close = page.locator("#file-operation-dialog[open] #file-operation-close")
  if (await close.isVisible()) await close.click()
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()
}
const selectKey = key => page.evaluate(async key => {
  const { appState } = await import("/src/app/state.ts")
  await (await import("/src/app/navigation.ts")).selectFile("light/skin/port/py_26.ini", "overview")
  appState.selectedKeySections = [key]
  ;(await import("/src/app/key-inspector.ts")).populateKeyInspector()
}, key)
try {
  await open("bds", baidu)
  await selectKey("KEY2")
  const width = page.locator('[data-key-field="width"]')
  const originalWidth = await width.inputValue()
  await width.fill(String(Number(originalWidth) + 1))
  await width.press("Enter")
  const widthRow = width.locator('xpath=ancestor::div[@class="ui-field"][1]')
  const history = action => page.evaluate(async action => (await import("/src/app/edit-history.ts"))[action](), action)
  await history("undo")
  assert.equal(await widthRow.getAttribute("data-modified"), null)
  await history("redo")
  assert.equal(await widthRow.getAttribute("data-modified"), "", "redo marks a static field as changed again")
  await page.locator(".inspector-reset").click()
  assert.equal(await width.inputValue(), originalWidth)
  const group = page.locator(".key-typography-fields")
  const add = group.getByRole("button", { name: "添加文字", exact: true })
  await add.click()
  assert.equal(await group.getByRole("spinbutton", { name: "字号", exact: true }).isVisible(), true, "section actions reveal the current rows after a redraw")
  await selectKey("KEY1")
  const show = page.locator("#primary-css-fields input").first()
  const before = await show.inputValue()
  // A second edit landed since this row was rendered. Neither changing SHOW nor resetting it may revert that edit.
  const css = await page.evaluate(async () => {
    const { appState } = await import("/src/app/state.ts")
    const path = (await import("/src/app/config-context.ts")).styleConfigPath()
    const original = appState.archive.getText(path)
    ;(await import("/src/app/edit-history.ts")).commitText(path, original, original + "\n; keep sibling edit\n")
    return path
  })
  const readCss = () => page.evaluate(async path => (await import("/src/app/state.ts")).appState.archive.getText(path), css)
  const expected = await readCss()
  await show.fill("新文字")
  await show.press("Tab")
  assert.match(await readCss(), /SHOW=新文字/)
  assert.ok((await readCss()).endsWith("; keep sibling edit\n"))
  await page.locator(".inspector-reset").click()
  assert.equal(await show.inputValue(), before)
  assert.equal(await readCss(), expected)
  await page.evaluate(async () => {
    const { appState } = await import("/src/app/state.ts")
    ;(await import("/src/app/navigation.ts")).selectFile("light/skin/port/cand1.cnd", "overview")
    appState.selectedCandidate = "parts"
    appState.selectedToolbarSections = ["ICON1"]
    ;(await import("/src/app/key-inspector.ts")).populateKeyInspector()
  })
  const iconWidth = page.locator('#document-fields [data-document-key="SIZE"] input[type="number"]:visible').first()
  const beforeIcon = await iconWidth.inputValue()
  await iconWidth.fill(String(Number(beforeIcon) + 2))
  await iconWidth.press("Tab")
  await history("undo")
  await history("redo")
  await page.locator(".inspector-reset").click()
  assert.equal(await iconWidth.inputValue(), beforeIcon, "history refresh keeps the toolbar selection and its reset baseline")
  const asset = path => readFileSync(new URL(`../public/${path}`, import.meta.url))
  for (const [format, bytes] of [["bds"], ["bdi", SkinArchive.open(baidu).toBytes("bdi")],
    ["bda", asset("default-template.bda")], ["sxi", asset("templates/palm-harmony.sxi")], ["ssf", ssfFixture()]]) {
    if (bytes) await open(format, bytes)
    const state = () => page.evaluate(async () => {
      const { appState } = await import("/src/app/state.ts")
      return [appState.archive.revision, appState.undoStack.length]
    })
    const initial = await state()
    const filterButton = page.locator(".inspector-filter-open")
    await filterButton.click()
    assert.equal(await filterButton.getAttribute("aria-expanded"), "true")
    const filter = page.locator("#inspector-filter")
    await filter.fill("未匹配的属性名")
    await page.locator(".inspector-filter-empty").waitFor()
    const rewrites = await page.locator(".inspector-filter-empty").evaluate(async el => {
      let count = 0
      const observer = new MutationObserver(() => count++)
      observer.observe(el, { childList: true })
      for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame)
      observer.disconnect()
      return count
    })
    assert.equal(rewrites, 0, "an idle filter must not trigger another decoration frame")
    await filter.press("Tab")
    await page.keyboard.press("Enter")
    assert.equal(await filter.inputValue(), "", "the clear button works from the keyboard")
    assert.equal(await filter.evaluate(el => el === document.activeElement), true)
    await filter.press("Escape")
    assert.equal(await filterButton.getAttribute("aria-expanded"), "false")
    assert.deepEqual(await state(), initial, `${format}: searching must not edit the skin`)
  }
  assert.deepEqual(errors, [])
  console.log("Inspector: redo/reset, rebuilt empty fields and idle/keyboard filtering passed")
} finally {
  await browser.close()
  await server.close()
}
