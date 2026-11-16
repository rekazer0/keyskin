import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"
import { mobilePenFixture } from "../tests/helpers/mobile-pen-fixture.mjs"

const output = new URL("../.ui-current/typography/", import.meta.url).pathname
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41959, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const errors = []
try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width < 760 ? 844 : 1100 }, colorScheme: width === 390 ? "dark" : "light" })
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator("#browser-open").setInputFiles({ name: "文字.bds", mimeType: "application/octet-stream", buffer: Buffer.from(mobilePenFixture()) })
    await page.waitForFunction(() => !document.querySelector("#open").disabled && (!document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled))
    if (await page.locator("#file-operation-dialog[open]").count()) await page.locator("#file-operation-close").click()
    if (await page.locator("#mode").inputValue() !== "edit") await page.getByRole("button", { name: "编辑模式", exact: true }).click()
    await page.evaluate(async () => {
      const { appState } = await import("/src/app/state.ts")
      await (await import("/src/app/navigation.ts")).selectFile("light/skin/port/py_26.ini")
      // 字形测试复用仓库内浏览器字体字节，不导出这份合成皮肤。
      for (const [name, source] of [["Inter.ttf", "inter-latin"], ["Mono.ttf", "ibm-plex-mono-400"]]) {
        appState.archive.setBytes(`light/skin/res/${name}`, new Uint8Array(await (await fetch(`/fonts/${source}.woff2`)).arrayBuffer()))
      }
      appState.archive.setBytes("light/skin/res/Broken.ttf", new Uint8Array([0, 1, 2]))
      appState.selectedKeySections = ["KEY11"]
      ;(await import("/src/app/canvas-interaction.ts")).preview.setSelected(["KEY11"])
      ;(await import("/src/app/key-inspector.ts")).populateKeyInspector()
    })
    const group = page.locator(".key-typography-fields")
    if (width < 760) await page.locator('#mobile-property-tabs [data-mobile-category="typography"]').click()
    else await page.locator('#mobile-inspector-groups button').filter({ hasText: /^文字$/ }).click()
    assert.equal(await group.locator(".mobile-typography-more").count(), 0)
    assert.equal(await group.locator("#typography-font-weight button").count(), 9)
    assert.equal(await group.locator("#key-text-color").isVisible(), true)
    assert.equal(await group.locator('[data-style-field="FONT_NAME"]').isVisible(), true)
    assert.equal(await group.locator("#key-text-shadow").isVisible(), true)
    assert.equal(await group.locator('[data-supported="false"] input').evaluateAll(inputs => inputs.every(input => input.disabled)), true)
    const snapshot = () => page.evaluate(async () => {
      const { appState } = await import("/src/app/state.ts")
      return { css: appState.archive.getText("light/skin/res/default.css"), undo: appState.undoStack.length }
    })
    const before = await snapshot()
    const picker = page.getByRole("dialog", { name: "选择皮肤字体", exact: true })
    await page.locator("#font-file-picker").click()
    const inter = picker.locator('[role="option"][data-font-value="Inter.ttf"]')
    const mono = picker.locator('[role="option"][data-font-value="Mono.ttf"]')
    await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] canvas')].every(canvas => canvas.getAttribute("aria-busy") === "false"))
    assert.match(await inter.locator("canvas").getAttribute("data-font-family"), /^BdiEmbeddedFont/)
    assert.notEqual(await inter.locator("canvas").evaluate(canvas => canvas.toDataURL()), await mono.locator("canvas").evaluate(canvas => canvas.toDataURL()), "font samples use different real glyphs")
    assert.match(await picker.locator('[data-font-value$="Broken.ttf"] canvas').getAttribute("aria-label"), /无法预览/)
    assert.equal(await picker.getByRole("option").evaluateAll(rows => rows.every(row => [...row.children].every(child => child.getBoundingClientRect().bottom <= row.getBoundingClientRect().bottom + 1))), true, "font samples, names and paths do not overlap neighboring rows")
    await picker.getByRole("searchbox", { name: "搜索字体" }).fill("Mono")
    assert.equal(await picker.getByRole("option").count(), 1)
    await mono.click()
    assert.deepEqual(await snapshot(), before, "browsing never writes the archive")
    await picker.getByRole("button", { name: "取消", exact: true }).click()
    await picker.waitFor({ state: "hidden" })
    assert.deepEqual(await snapshot(), before)
    await page.locator("#font-file-picker").click()
    await inter.focus()
    await page.keyboard.press("End")
    assert.equal(await mono.getAttribute("aria-selected"), "true", "keyboard navigation selects a font without writing")
    assert.deepEqual(await snapshot(), before)
    await inter.click()
    await inter.press("Enter")
    await picker.waitFor({ state: "hidden" })
    assert.match((await snapshot()).css, /FONT_PATH=Inter\.ttf/)
    assert.equal((await snapshot()).undo, before.undo + 1)
    await page.waitForFunction(() => document.querySelector("#font-file-picker canvas")?.dataset.fontFamily?.startsWith("BdiEmbeddedFont"))
    const font = await page.locator("#font-file-picker canvas").getAttribute("data-font-family")
    assert.equal(await page.locator("#font-name-picker canvas").getAttribute("data-font-family"), font, "unset style font inherits the selected skin font")
    await page.locator("#font-name-picker").click()
    const stylePicker = page.getByRole("dialog", { name: "选择字体", exact: true })
    await stylePicker.locator('[data-font-value="Mono.ttf"]').click()
    await stylePicker.getByRole("button", { name: "应用", exact: true }).click()
    await stylePicker.waitFor({ state: "hidden" })
    assert.equal(await group.locator('[data-style-field="FONT_NAME"]').inputValue(), "Mono.ttf")
    assert.match((await snapshot()).css, /FONT_NAME=Mono\.ttf/)
    assert.equal((await snapshot()).undo, before.undo + 2)
    await page.evaluate(async () => (await import("/src/app/edit-history.ts")).undo())
    assert.equal(await group.locator('[data-style-field="FONT_NAME"]').inputValue(), "")
    assert.equal(await page.locator("#font-name-picker canvas").getAttribute("data-font-family"), font)
    await page.locator("#font-remove").click()
    assert.doesNotMatch((await snapshot()).css, /FONT_PATH=Inter\.ttf/)
    await page.evaluate(async () => (await import("/src/app/edit-history.ts")).undo())
    assert.match((await snapshot()).css, /FONT_PATH=Inter\.ttf/)
    assert.equal(await group.locator('[data-style-field="FONT_SIZE"]').locator("..").locator(".ui-input-affix").textContent(), "px")
    assert.equal(await group.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, "text controls fit the inspector")
    await page.locator("#font-file-picker").scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}${width}-text.png`, animations: "disabled" })
    await page.locator("#font-file-picker").click()
    await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] canvas')].every(canvas => canvas.getAttribute("aria-busy") === "false"))
    await page.screenshot({ path: `${output}${width}-fonts.png`, animations: "disabled" })
    if (width === 320) {
      await picker.getByRole("button", { name: "取消", exact: true }).click()
      await picker.waitFor({ state: "hidden" })
      await page.setViewportSize({ width: 430, height: 844 })
      await page.waitForFunction(() => {
        const canvas = document.querySelector("#font-file-picker canvas")
        return canvas.width === Math.round(canvas.clientWidth * devicePixelRatio)
      })
      await page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        const { IniDocument } = await import("/src/ini.ts")
        const styles = IniDocument.parse(appState.archive.getText("light/skin/res/default.css"))
        styles.set("STYLE42", "FONT_NAME", "Mono.ttf")
        styles.set("GLOBAL", "FONT_PATH", "Missing.ttf")
        appState.archive.setText("light/skin/res/default.css", styles.toString())
        appState.selectedKeySections = ["KEY11", "KEY12"]
        ;(await import("/src/app/key-inspector.ts")).populateKeyInspector()
      })
      await page.waitForFunction(() => document.querySelector("#font-name-picker canvas")?.getAttribute("aria-label")?.endsWith("：混合"))
      assert.match(await page.locator("#font-file-picker canvas").getAttribute("aria-label"), /无法预览/)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.locator('#mobile-inspector-groups button').filter({ hasText: /^文字$/ }).click()
      await page.locator("#font-name-picker").click()
      assert.equal(await stylePicker.locator('[role="option"][aria-selected="true"]').count(), 0, "mixed fonts do not pretend to be inherited")
      assert.equal(await stylePicker.getByRole("button", { name: "应用", exact: true }).isDisabled(), true)
    }
    await page.close()
    console.log(`PASS ${width}px: all typography fields, actual font glyphs, search, cancel, apply, inheritance, remove, undo and layout`)
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
