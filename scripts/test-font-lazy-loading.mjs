import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"

const fixture = bdsFixture()
const files = unzipSync(fixture)
const font = readFileSync("public/fonts/inter-latin.woff2")
const css = "light/res/default.css"
const rows = 180
let styles = `[GLOBAL]\nFONT_PATH=Font-000.ttf\n${strFromU8(files[css])}`
for (let i = 0; i < rows; i++) {
  const name = `Font-${String(i).padStart(3, "0")}.ttf`
  files[`light/res/${name}`] = font
  if (i) styles += `\n[STYLE${2000 + i}]\nFONT_NAME=${name}\nFONT_SIZE=36\nSHOW=Sample\n`
}
files[css] = strToU8(styles)
const many = Buffer.from(zipSync(files))
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 0, hmr: false } })
await server.listen()
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      for (const width of [1440, 393]) {
        const mobile = width < 500
        const page = await browser.newPage({ viewport: { width, height: 850 }, hasTouch: mobile, reducedMotion: "reduce" })
        const errors = []
        page.on("pageerror", error => errors.push(error.message))
        await page.addInitScript(() => {
          localStorage.setItem("onboarding-tour-v1", "done")
          localStorage.setItem("keyskin-disclaimer-shown", "1")
          window.embeddedLoads = 0
          const load = FontFace.prototype.load
          FontFace.prototype.load = function () {
            if (this.family.startsWith("BdiEmbeddedFont")) window.embeddedLoads++
            return load.call(this)
          }
        })
        const open = async (name, buffer, replace = false) => {
          await page.locator("#browser-open").setInputFiles({ name, buffer, mimeType: "application/octet-stream" })
          if (replace) await page.getByRole("button", { name: "不导出", exact: true }).click()
          await page.waitForFunction(name => document.querySelector("#document-name").textContent === name && !document.querySelector("#open").disabled, name)
          const close = page.locator("#file-operation-dialog[open] #file-operation-close")
          if (await close.isVisible()) await close.click()
        }
        const counts = () => page.evaluate(() => ({
          loads: window.embeddedLoads,
          faces: Array.from(document.fonts).filter(face => face.family.startsWith("BdiEmbeddedFont")).length,
          canvases: document.querySelectorAll("#resource-catalog canvas.ui-font-sample").length,
        }))
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
        await open("ManyFonts.bds", many)
        const before = await counts()
        assert.ok(before.loads <= 1, `opening the keyboard loaded ${before.loads} faces for ${rows} fonts`)
        if (mobile) {
          await page.locator(".mobile-preview-return").click()
          await page.locator('#mobile-navigation [data-mobile-page="resources"]').click()
          await page.locator("#mobile-resource-category").selectOption("catalog:font")
        } else {
          await page.getByRole("button", { name: "编辑模式", exact: true }).click()
          await page.locator('[data-workspace-page="resources"]').click()
          await page.locator('[data-resource-catalog="font"]').click()
        }
        const list = page.locator("#resource-catalog")
        const fonts = list.getByRole("option")
        assert.equal(await fonts.count(), rows)
        await list.locator("canvas[data-font-family]").first().waitFor()
        const initial = await counts()
        assert.ok(initial.canvases < rows / 2 && initial.loads < rows / 2, JSON.stringify(initial))
        await fonts.last().scrollIntoViewIfNeeded()
        await fonts.last().locator("canvas[data-font-family]").waitFor()
        await fonts.first().locator("canvas").waitFor({ state: "detached" })
        const scrolled = await counts()
        assert.ok(scrolled.canvases < rows / 2 && scrolled.faces < rows / 2 && scrolled.loads > initial.loads, JSON.stringify(scrolled))
        assert.ok(await fonts.last().evaluate(card => {
          const preview = card.querySelector(".ui-font-sample").getBoundingClientRect()
          const caption = card.querySelector("strong").getBoundingClientRect()
          return preview.bottom <= caption.top && caption.bottom <= card.getBoundingClientRect().bottom
        }), "font preview and filename fit inside the same card")
        if (mobile) {
          const toggle = page.getByRole("button", { name: "筛选和排序" })
          const search = page.getByRole("searchbox", { name: "搜索字体" })
          assert.equal((await toggle.boundingBox()).y, (await search.boundingBox()).y)
          await toggle.tap()
          await page.locator("#resource-sort").selectOption("descending")
          assert.equal(await fonts.first().locator("strong").textContent(), "Font-179.ttf")
          await toggle.tap()
          assert.equal(await page.locator("#resource-sort").isVisible(), false)
        }
        await page.locator("#resource-search").fill("Font-179")
        assert.equal(await fonts.count(), 1)
        await fonts.first().click()
        await page.locator('#style-detail-fields canvas[data-size="lg"][data-font-family]').waitFor()
        // Opening the picker may paint its visible choices, not all 180.
        const pickerButton = page.locator("#font-file-picker")
        {
          const prev = await counts()
          await pickerButton.click()
          const picker = page.getByRole("dialog", { name: "选择皮肤字体", exact: true })
          assert.equal(await picker.getByRole("option").count(), rows + 1)
          await picker.locator("canvas[data-font-family]").first().waitFor()
          assert.ok(await picker.locator("canvas").count() < rows / 2)
          assert.ok((await counts()).loads - prev.loads < rows / 2)
          await picker.getByRole("button", { name: "取消", exact: true }).click()
        }
        await open("Replacement.bds", Buffer.from(fixture), true)
        await page.waitForFunction(() => !Array.from(document.fonts).some(face => face.family.startsWith("BdiEmbeddedFont")))
        assert.deepEqual(errors, [])
        console.log(`${engine.name()} ${width}px: open ${before.loads}, list ${initial.canvases}/${rows} canvases, scroll ${scrolled.canvases}/${rows} canvases, replacement released faces`)
        await page.close()
      }
    } finally { await browser.close() }
  }
} finally { await server.close() }
