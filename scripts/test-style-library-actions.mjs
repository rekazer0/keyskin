import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"
import { mobilePenFixture } from "../tests/helpers/mobile-pen-fixture.mjs"

const output = new URL("../.ui-current/style-library-actions/", import.meta.url).pathname
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41969, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
const errors = []
page.on("pageerror", error => errors.push(error.message))
const snapshot = () => page.evaluate(async () => {
  const { appState } = await import("/src/app/state.ts")
  return appState.archive.names().map(path => [path, [...appState.archive.getBytes(path)]])
})
const undo = () => page.evaluate(async () => (await import("/src/app/edit-history.ts")).undo())
const open = () => page.evaluate(async () => {
  const input = document.createElement("input")
  input.dataset.keyField = "BACK_STYLE"
  input.value = "1"
  ;(await import("/src/app/style-picker.ts")).openStylePicker(input)
})
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator("#browser-open").setInputFiles({ name: "样式库.bds", mimeType: "application/octet-stream", buffer: Buffer.from(mobilePenFixture()) })
  await page.waitForFunction(() => !document.querySelector("#open").disabled && (!document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled))
  if (await page.locator("#file-operation-dialog[open]").count()) await page.locator("#file-operation-close").click()
  if (await page.locator("#mode").inputValue() !== "edit") await page.getByRole("button", { name: "编辑模式", exact: true }).click()
  const before = await snapshot()
  const png = await page.evaluate(async () => {
    const { appState } = await import("/src/app/state.ts")
    const path = appState.archive.names().find(path => path.endsWith(".png"))
    return [...appState.archive.getBytes(path)]
  })
  await open()
  const library = page.frameLocator("#picker-frame")
  await library.locator("#style-library-new").waitFor()
  for (const width of [320, 390, 1100]) {
    await page.setViewportSize({ width, height: 844 })
    assert.equal(await library.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px: library fits`)
    assert.equal(await library.locator("#style-library-new").isEnabled(), true)
    assert.equal(await library.locator("#style-library-import").isEnabled(), true)
    await page.screenshot({ path: `${output}${width}.png` })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(async () => {
    const { uploadResourceImage } = await import("/src/app/resource-inspector.ts")
    try { await uploadResourceImage(new File(["invalid"], "invalid.png")); throw new Error("Accepted invalid image") }
    catch (error) { if (error.message === "Accepted invalid image") throw error }
  })
  assert.deepEqual(await snapshot(), before, "Invalid PNG does not change the archive")
  const chooser = page.waitForEvent("filechooser")
  await library.locator("#style-library-import").click()
  await (await chooser).setFiles({ name: "pen-import.png", mimeType: "image/png", buffer: Buffer.from(png) })
  await page.waitForFunction(() => !document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled)
  if (await page.locator("#file-operation-dialog[open]").count()) await page.locator("#file-operation-close").click()
  await library.locator('.ui-image-card[aria-selected="true"]').waitFor()
  assert.match(await library.locator("#style-library-preview-title").textContent(), /pen-import/)
  const after = await snapshot()
  assert.equal(after.length, before.length + 1)
  assert.deepEqual(after.find(([path]) => path.endsWith("/pen-import.png"))[1], png)
  assert.deepEqual(after.filter(([path]) => !path.endsWith("/pen-import.png")), before)
  await library.locator("#picker-close").click()
  await page.locator("#picker-dialog").waitFor({ state: "hidden" })
  await undo()
  assert.deepEqual(await snapshot(), before, "Import undo restores exact bytes")
  await open()
  await library.locator("#style-library-new").click()
  await page.locator("#picker-dialog").waitFor({ state: "hidden" })
  assert.notDeepEqual(await snapshot(), before, "New creates a real style")
  await undo()
  assert.deepEqual(await snapshot(), before, "New undo restores exact bytes")
  assert.deepEqual(errors, [])
  console.log("PASS style library actions: real PNG import, validation, selection, new style, exact undo, 320/390/1100px")
} catch (error) {
  await page.screenshot({ path: `${output}failure.png` })
  console.error(errors)
  throw error
} finally {
  await browser.close()
  await server.close()
}
