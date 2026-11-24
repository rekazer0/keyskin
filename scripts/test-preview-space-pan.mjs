import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { dismissStartupDisclaimer } from "../tests/helpers/open-editor-template.mjs"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.addInitScript(() => localStorage.setItem("onboarding-tour-v1", "done"))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await dismissStartupDisclaimer(page)
  await page.locator("#browser-open").setInputFiles({ name: "space-pan.bds", mimeType: "application/octet-stream", buffer: Buffer.from(bdsFixture()) })
  await page.waitForFunction(() => !document.querySelector("#open").disabled && !document.querySelector("#file-operation-dialog").open)
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()
  await page.locator('.sidebar-overview button[data-path$="/py_26.ini"]').click()
  const canvas = page.locator("#preview")
  const point = (index) => canvas.evaluate(async (node, index) => {
    const { preview } = await import("/src/app/canvas-interaction.ts")
    await preview.rendered()
    const { rect } = preview.keys[index]
    const size = preview.logicalSize()
    const bounds = node.getBoundingClientRect()
    return [bounds.x + (rect.x + rect.width / 2) * bounds.width / size.width,
      bounds.y + (rect.y + rect.height / 2) * bounds.height / size.height]
  }, index)
  const state = () => page.evaluate(async () => {
    const { appState } = await import("/src/app/state.ts")
    return { selected: appState.selectedKeySections, revision: appState.archive.revision, locked: appState.previewPanLocked }
  })
  const first = await point(0)
  await page.mouse.click(...first)
  const before = await state()
  assert.deepEqual(before.selected, ["KEY1"])
  assert.equal(before.locked, true, "canvas gestures are locked by default")

  for (const tool of ["select", "move"]) {
    await page.locator(`button[data-key-mode="${tool}"]:visible`).click()
    const [x, y] = await point(1)
    const initial = await canvas.boundingBox()
    await page.mouse.move(x, y)
    await page.keyboard.down("Space")
    const cursor = (atX = x, atY = y) => page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [atX, atY])
    assert.equal(await cursor(), "grab")
    await page.mouse.down()
    await page.mouse.move(x + 48, y + 25, { steps: 5 })
    assert.equal(await cursor(x + 48, y + 25), "grabbing")
    await page.mouse.up()
    assert.equal(await cursor(), "grab", "holding Space allows another drag")
    await page.keyboard.up("Space")
    const panned = await canvas.boundingBox()
    assert.equal(panned.x - initial.x, 48)
    assert.equal(panned.y - initial.y, 25)
    assert.deepEqual(await state(), before, `${tool}: pan neither selects nor edits the key, nor unlocks gestures`)
  }

  await page.mouse.click(...await point(1))
  assert.deepEqual((await state()).selected, ["KEY2"], "ordinary key selection resumes after Space is released")
  await page.locator("#document-name").click()
  const nameInput = page.getByRole("textbox", { name: "皮肤名称" })
  await nameInput.fill("键设")
  await nameInput.press("End")
  await nameInput.press("Space")
  assert.equal(await nameInput.inputValue(), "键设 ", "text input retains a normal Space")
  console.log("Space pans the preview in both editor tools without changing the document")
} finally {
  await browser.close()
  await server.close()
}
