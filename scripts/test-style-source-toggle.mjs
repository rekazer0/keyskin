import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"
import { SkinArchive } from "../src/skin.ts"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"
import { bdaAnimatedSkinBytes } from "../tests/helpers/bda-animation-fixture.mjs"
import { sxiAnimationFixture } from "../tests/helpers/sxi-animation-fixture.mjs"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41919, strictPort: false, hmr: false } })
await server.listen()
mkdirSync(".ui-current", { recursive: true })
const fixtures = { bds: bdsFixture(), bdi: SkinArchive.open(bdsFixture()).toBytes("bdi"), bda: bdaAnimatedSkinBytes(), sxi: sxiAnimationFixture() }
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      for (const [format, bytes] of Object.entries(fixtures)) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
        const errors = []
        page.on("pageerror", error => errors.push(error.message))
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
        await page.locator("#browser-open").setInputFiles({ name: `styles.${format}`, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) })
        await page.waitForFunction(() => !document.querySelector("#open").disabled && (!document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled))
        const close = page.locator("#file-operation-dialog[open] #file-operation-close")
        if (await close.isVisible()) await close.click()
        await page.locator('[data-workspace-page="resources"]').click()
        const cards = page.locator("#resource-gallery .ui-style-card")
        await cards.first().click()
        const toggle = page.locator("#resource-source-toggle")
        await toggle.waitFor()
        const initial = await page.evaluate(async () => [...(await import("/src/app/state.ts")).appState.archive.changed])
        await toggle.click()
        await page.locator("#source-editor .cm-source-selected").first().waitFor()
        assert.equal(await page.locator("#style-resource-detail").isVisible(), false)
        assert.equal(await toggle.getAttribute("aria-pressed"), "true")
        assert.equal(await page.locator('[data-workspace-page="resources"]').getAttribute("aria-current"), "page")
        assert.equal(await page.locator(".workspace #resource-list-view").isVisible(), true)
        const checkSource = () => page.evaluate(async () => {
          const { appState } = await import("/src/app/state.ts")
          const { source } = await import("/src/app/canvas-interaction.ts")
          const { selectedBdaSourceRange, sxiSourceRanges } = await import("/src/app/config-context.ts")
          const { iniSectionRanges } = await import("/src/highlight.ts")
          const range = appState.archive.format === "bda" ? selectedBdaSourceRange(source.value)
            : appState.archive.format === "sxi" ? sxiSourceRanges(source.value)[0]
            : iniSectionRanges(source.value, [`STYLE${appState.selectedStyleID}`])[0]
          const appearance = appState.archive.format === "bda" ? (await import("/src/app/bda-documents.ts")).currentBdaAppearance() : undefined
          const full = appearance ? (await import("/src/bda-source.ts")).decodedBdaEditorSource(appearance.path, appearance.bytes)
            : appState.archive.getText(appState.archive.format === "sxi" ? "skin.json" : appState.selectedPath)
          return { full: source.value === full, range, length: source.value.length, selected: appState.selectedStyleID }
        })
        let result = await checkSource()
        assert.equal(result.full, true, `${format}: 展示完整文件`)
        assert.ok(result.range && result.range[1] - result.range[0] < result.length, `${format}: 只高亮选中样式`)
        const first = result.selected
        await cards.last().click()
        await page.waitForFunction(() => document.querySelector("#source-editor .cm-source-selected"))
        result = await checkSource()
        assert.notEqual(result.selected, first)
        assert.equal(result.full, true)
        assert.ok(result.range)
        const highlight = page.locator("#source-editor .cm-source-selected").first()
        await page.waitForFunction(() => {
          const line = document.querySelector("#source-editor .cm-source-selected")?.getBoundingClientRect()
          const editor = document.querySelector("#source-editor").getBoundingClientRect()
          return line && line.top < editor.bottom && line.bottom > editor.top
        })
        assert.equal(await highlight.isVisible(), true)
        await page.screenshot({ path: `.ui-current/style-source-${format}-${engine.name()}.png` })
        await toggle.press("Enter")
        await page.locator("#style-resource-detail:not([hidden])").waitFor()
        assert.equal(await toggle.getAttribute("aria-pressed"), "false")
        assert.equal(await page.locator("#source-editor").isVisible(), false)
        assert.deepEqual(await page.evaluate(async () => [...(await import("/src/app/state.ts")).appState.archive.changed]), initial, "切换与定位不修改文件")
        await page.getByRole("button", { name: "编辑模式", exact: true }).click()
        await toggle.click()
        const edited = await page.evaluate(async () => {
          const { appState } = await import("/src/app/state.ts")
          const { source } = await import("/src/app/canvas-interaction.ts")
          const before = source.value
          let after
          if (appState.archive.format === "bda") {
            const value = JSON.parse(before)
            value.designWidth += 1
            after = JSON.stringify(value, null, 2)
          } else if (appState.archive.format === "sxi") {
            const value = JSON.parse(before)
            const { palmStylePointer } = await import("/src/app/sxi-styles.ts")
            const { sxiFragment } = await import("/src/palm/sxi-json.ts")
            const style = sxiFragment(value, palmStylePointer(appState.selectedStyleID))
            style.s_1 = { ...style.s_1, text: "源码切换测试" }
            after = JSON.stringify(value)
          } else after = `${before}\nINFO=源码切换测试\n`
          source.replaceRange(0, before.length, after)
          return { before, after }
        })
        await toggle.click()
        await page.locator("#style-resource-detail:not([hidden])").waitFor()
        assert.equal((await checkSource()).full, true, "返回属性前提交源码到原文件")
        assert.equal(await page.evaluate(async () => (await import("/src/app/canvas-interaction.ts")).source.value), edited.after)
        await page.locator("#desktop-undo").click()
        assert.equal(await page.evaluate(async () => (await import("/src/app/canvas-interaction.ts")).source.value), edited.before, "源码编辑可撤销")
        await page.setViewportSize({ width: 390, height: 844 })
        await toggle.waitFor()
        await toggle.click()
        await page.locator("#source-editor .cm-source-selected").first().waitFor()
        assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
        await toggle.click()
        await page.locator("#style-resource-detail:not([hidden])").waitFor()
        await page.setViewportSize({ width: 1440, height: 900 })
        await toggle.click()
        await page.locator('[data-workspace-page="overview"]').click()
        assert.equal(await page.locator(".source > #source-editor").count(), 1, "离开样式后编辑器回到原位置")
        assert.equal(await toggle.isVisible(), false)
        assert.deepEqual(errors, [])
        await page.close()
        console.log(`${engine.name()} ${format}: full file, selected range, list selection, return and navigation passed`)
      }
    } finally { await browser.close() }
  }
} finally { await server.close() }
