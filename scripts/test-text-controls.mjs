import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { createServer } from "vite"
import { chromium } from "playwright"
import { ssfFixture } from "../tests/helpers/ssf-fixture.mjs"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"
import { SkinArchive } from "../src/skin.ts"
import { buildSxiZip } from "../src/palm/palm-export.ts"

const output = new URL("../.ui-current/typography/", import.meta.url).pathname
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41967, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const errors = []
try {
  for (const [format, bytes, path] of [
    ["ssf", ssfFixture(), "light/skin/port/py_26.ini"],
    ["sxi", buildSxiZip(SkinArchive.open(bdsFixture())).bytes, "skin.json/default/port_layout/b/full26Pinyin"],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator("#browser-open").setInputFiles({ name: `文字.${format}`, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) })
    await page.waitForFunction(() => !document.querySelector("#open").disabled && (!document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled))
    if (await page.locator("#file-operation-dialog[open]").count()) await page.locator("#file-operation-close").click()
    if (await page.locator("#mode").inputValue() !== "edit") await page.getByRole("button", { name: "编辑模式", exact: true }).click()
    await page.evaluate(async ({ path, format }) => {
      const { appState } = await import("/src/app/state.ts")
      await (await import("/src/app/navigation.ts")).selectFile(path, "overview")
      const { preview } = await import("/src/app/canvas-interaction.ts")
      const key = format === "sxi" ? preview.keys.find(key => key.section === "KEY1") : preview.keys.find(key => key.center === "q")
      if (!key) throw new Error("文字测试缺少按键")
      appState.selectedKeySections = [key.section]
      preview.setSelected([key.section])
      ;(await import("/src/app/key-inspector.ts")).populateKeyInspector()
    }, { path, format })
    const group = page.locator('#document-fields [data-inspector-group-label="文字"]')
    await group.waitFor()
    const font = group.locator('[data-typography="font"] .ui-font-control').first()
    assert.equal(await font.locator("input").count(), 1)
    assert.equal(await font.locator("canvas").count(), 1)
    assert.equal(await group.locator('[data-typography="color"] .ui-color-caption').allTextContents().then(labels => labels.join("/")), "正常/按下")
    const before = await page.evaluate(async () => (await import("/src/app/state.ts")).appState.undoStack.length)
    await font.getByRole("button").click()
    const dialog = page.getByRole("dialog", { name: "选择字体", exact: true })
    await dialog.getByRole("option").first().click()
    await dialog.getByRole("button", { name: "取消", exact: true }).click()
    await dialog.waitFor({ state: "hidden" })
    assert.equal(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.undoStack.length), before)
    const size = group.locator('[data-typography="size"] input:not([type=range])').first()
    const original = await size.inputValue()
    await size.fill(format === "ssf" ? "0.051" : "47")
    await size.press("Enter")
    assert.equal(await size.inputValue(), format === "ssf" ? "0.051" : "47")
    await page.evaluate(async () => (await import("/src/app/edit-history.ts")).undo())
    assert.equal(await size.inputValue(), original)
    await group.locator('[data-typography="font"]').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}${format}-desktop.png` })
    await page.setViewportSize({ width: 320, height: 844 })
    await page.evaluate(() => document.querySelector('#mobile-property-tabs [data-mobile-category="typography"]').click())
    await font.scrollIntoViewIfNeeded()
    assert.equal(await group.evaluate(group => group.scrollWidth <= group.clientWidth + 1), true)
    assert.equal(await font.evaluate(control => control.scrollWidth <= control.clientWidth + 1), true)
    await page.screenshot({ path: `${output}${format}-mobile.png` })
    await page.close()
    console.log(`PASS ${format}: shared font, state colors, native size units, cancel, undo and 320px layout`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
}
