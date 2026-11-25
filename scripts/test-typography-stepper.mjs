import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"
import { mobilePenFixture } from "../tests/helpers/mobile-pen-fixture.mjs"

const output = new URL("../.ui-current/typography-stepper/", import.meta.url).pathname
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41959, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const errors = []
try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width < 760 ? 844 : 1100 }, hasTouch: width < 760, colorScheme: width === 390 ? "dark" : "light" })
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.getByRole("dialog", { name: "免责声明" }).getByRole("button", { name: "我知道了" }).click()
    await page.locator("#browser-open").setInputFiles({ name: "文字.bds", mimeType: "application/octet-stream", buffer: Buffer.from(mobilePenFixture()) })
    await page.waitForFunction(() => !document.querySelector("#open").disabled && (!document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled))
    if (await page.locator("#file-operation-dialog[open]").count()) await page.locator("#file-operation-close").click()
    if (await page.locator("#mode").inputValue() !== "edit") await page.getByRole("button", { name: width < 760 ? "开始编辑" : "编辑模式", exact: true }).click()
    await page.evaluate(async () => {
      const { appState } = await import("/src/app/state.ts")
      await (await import("/src/app/navigation.ts")).selectFile("light/skin/port/py_26.ini")
      const { IniDocument } = await import("/src/ini.ts")
      const styles = IniDocument.parse(appState.archive.getText("light/skin/res/default.css"))
      styles.set("STYLE41", "BORDER_SIZE", "2")
      appState.archive.setText("light/skin/res/default.css", styles.toString())
      appState.selectedKeySections = ["KEY11"]
      ;(await import("/src/app/canvas-interaction.ts")).preview.setSelected(["KEY11"])
      ;(await import("/src/app/key-inspector.ts")).populateKeyInspector()
    })
    const group = page.locator(".key-typography-fields")
    await page.locator('#mobile-inspector-groups').getByRole("button", { name: "文字", exact: true }).click()
    const snapshot = () => page.evaluate(async () => {
      const { appState } = await import("/src/app/state.ts")
      return { css: appState.archive.getText("light/skin/res/default.css"), undo: appState.undoStack.length }
    })
    const before = await snapshot()
    for (const [field, label, initial] of [["FONT_SIZE", "字号", 36], ["BORDER_SIZE", "阴影大小", 2]]) {
      const row = group.locator(`.ui-field[data-document-key="${field}"]`)
      const input = row.locator(`[data-style-field="${field}"]`)
      const minus = row.getByRole("button", { name: `减小${label}`, exact: true })
      const plus = row.getByRole("button", { name: `增大${label}`, exact: true })
      assert.equal(await row.locator('input[type="range"]').count(), 0)
      const [left, middle, right] = await Promise.all([minus, input, plus].map(control => control.boundingBox()))
      assert.ok(left.x + left.width <= middle.x && middle.x + middle.width <= right.x)
      if (width < 760) assert.ok(left.height >= 44 && right.height >= 44)
      await minus.click()
      assert.equal(await input.inputValue(), String(initial - 1))
      await plus.press("Enter")
      assert.equal(await input.inputValue(), String(initial))
      await input.fill(String(initial + 3))
      await input.press("Tab")
      assert.equal(await input.inputValue(), String(initial + 3))
      assert.equal((await snapshot()).undo, before.undo + 3)
      for (let i = 0; i < 3; i++) await page.evaluate(async () => (await import("/src/app/edit-history.ts")).undo())
      assert.deepEqual(await snapshot(), before)
    }
    assert.equal(await group.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, "text controls fit the inspector")
    await group.locator('[data-style-field="FONT_SIZE"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}${width}.png`, animations: "disabled" })
    await page.close()
    console.log(`PASS ${width}px: font and shadow steppers, direct input and undo`)
  }
  assert.deepEqual(errors, [])
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages()).at(-1)
  if (page) await page.screenshot({ path: `${output}failure.png`, animations: "disabled" })
  throw error
} finally {
  await browser.close()
  await server.close()
}
