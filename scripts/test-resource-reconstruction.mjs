import assert from "node:assert/strict"
import { readFileSync, mkdirSync } from "node:fs"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"
import { confirmDeletion } from "../tests/helpers/ask-dialogs.mjs"

const files = unzipSync(bdsFixture())
files["light/res/default.css"] = strToU8(strFromU8(files["light/res/default.css"]) + "\n[STYLE900]\nINFO=未使用样式\nNM_COLOR=FF101010\n")
files["light/res/sample.ttf"] = readFileSync("public/fonts/inter-latin.woff2")
const fixture = Buffer.from(zipSync(files))
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41921, strictPort: false, hmr: false } })
await server.listen()
mkdirSync(".ui-current", { recursive: true })
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce" })
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      await page.locator("#browser-open").setInputFiles({ name: "资源重构.bds", mimeType: "application/octet-stream", buffer: fixture })
      await page.waitForFunction(() => !document.querySelector("#open").disabled && (!document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled))
      const close = page.locator("#file-operation-dialog[open] #file-operation-close")
      if (await close.isVisible()) await close.click()
      await page.getByRole("button", { name: "编辑模式", exact: true }).click()
      await page.locator('[data-workspace-page="resources"]').click()
      await page.locator('#resource-gallery [data-style-id="900"]').waitFor()
      assert.equal(await page.locator("#resource-theme").isVisible(), false, "single-look skins do not show a theme switch")
      const usage = page.getByRole("combobox", { name: "使用情况" })
      assert.equal(await page.locator(".workspace .resource-filters").getByRole("combobox", { name: "使用情况" }).count(), 1)
      assert.equal(await page.locator("#resource-page-sidebar").getByRole("combobox", { name: "使用情况" }).count(), 0)
      const original = await page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        return { revision: appState.archive.revision, undo: appState.undoStack.length }
      })
      assert.equal(await page.locator('[data-resource-count="style"]').textContent(), "7")
      assert.equal(await page.locator('[data-resource-count="font"]').textContent(), "1")
      for (const type of ["anim", "text", "image", "color", "sound", "empty"]) {
        await page.locator(`[data-resource-style-type="${type}"]`).click()
        assert.equal(await page.locator('#resource-gallery [role="option"]').count(), Number(await page.locator(`[data-resource-style-count="${type}"]`).textContent()), `${type} category shows its real style count`)
        assert.equal(await page.locator('#resource-page-tabs [aria-pressed="true"]').count(), 1)
        assert.equal(await page.locator('[data-resource-page="style"]').getAttribute("aria-pressed"), "false")
      }
      await page.locator('[data-resource-style-type="text"]').focus()
      await page.keyboard.press("ArrowDown")
      assert.equal(await page.locator('[data-resource-style-type="image"]').getAttribute("aria-pressed"), "true", "keyboard moves between nested categories")
      assert.match(await page.locator("#resource-unused-summary").textContent(), /1 个样式/)
      await page.locator("#resource-show-unused").click()
      assert.equal(await page.locator('#resource-gallery [role="option"]').count(), 1)
      assert.equal(await page.locator('#resource-gallery [role="option"]').getAttribute("data-style-id"), "900")
      assert.equal(await usage.inputValue(), "unused", "查看与中间栏筛选同步")
      await usage.selectOption("used")
      assert.equal(await page.locator('#resource-gallery [role="option"]').count(), 6)
      await page.locator('#resource-search').fill('900')
      assert.equal(await page.locator('#resource-gallery [role="option"]').count(), 0, "搜索与使用情况取交集")
      await page.keyboard.press("Escape")
      await usage.selectOption("all")
      await page.locator("#resource-sort").selectOption("descending")
      assert.equal(await page.locator('#resource-gallery [role="option"]').first().getAttribute("data-style-id"), "900")
      assert.equal(await page.locator('#resource-view-switch').count(), 0, '资源保持网格，不再显示视图切换')
      assert.equal(await page.locator('#resource-list-view [data-list-action="remove"]').count(), 0, '删除入口不在资源列表内')
      await page.locator('[data-resource-catalog="all"]').click()
      assert.equal(await page.locator('#resource-page-tabs [aria-pressed="true"]').count(), 1, "catalog clears the nested style highlight")
      assert.equal(await page.locator("#resource-gallery").isVisible(), false)
      assert.equal(await usage.isVisible(), false, "文件清单不显示样式使用情况")
      assert.equal(await page.locator('#resource-catalog [role="option"]').count(), 4, "文件资源与样式分别统计")
      assert.equal(await page.locator("#resource-total").textContent(), "11 项")
      await page.locator("#resource-search").fill("sample.ttf")
      assert.equal(await page.locator('#resource-catalog [role="option"]').count(), 1)
      await page.keyboard.press("Escape")
      assert.equal(await page.locator('#resource-catalog [role="option"]').count(), 4, "Esc clears search within the catalog")
      await page.locator('[data-resource-catalog="font"]').click()
      await page.locator('#resource-catalog [role="option"]').click()
      await page.waitForFunction(() => document.querySelector('#resource-catalog canvas')?.dataset.fontFamily)
      assert.equal(await page.locator("#resource-detail").isVisible(), true)
      assert.match(await page.locator("#resource-meta").textContent(), /sample.ttf$/)
      await page.locator('[data-resource-page="style"]').click()
      for (const width of [1600, 1024, 812]) {
        await page.setViewportSize({ width, height: 1000 })
        assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
        assert.equal(await page.locator("#resource-page-sidebar").isVisible(), true)
        const searchBox = await page.locator("#resource-search").boundingBox()
        const dropdowns = await page.locator(".resource-filter-options select:visible").evaluateAll(items => items.map(item => item.getBoundingClientRect().toJSON()))
        assert.equal(dropdowns.length, 3)
        assert.ok(dropdowns.every(box => box.y === dropdowns[0].y && box.height === searchBox.height), `三个下拉控件等高且不拆行: ${JSON.stringify({ width, searchBox, dropdowns })}`)
        if (width === 1600) assert.equal(dropdowns[0].y, searchBox.y, "宽窗口搜索与下拉同排")
        if (width === 812) {
          assert.ok(dropdowns[0].y > searchBox.y, "窄窗口搜索独占一行")
          await page.screenshot({ path: `.ui-current/resource-reconstruction-narrow-${engine.name()}.png` })
        }
      }
      assert.deepEqual(await page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        return { revision: appState.archive.revision, undo: appState.undoStack.length }
      }), original, "browse, filter, sort and view changes do not edit the skin")
      await page.setViewportSize({ width: 1600, height: 1000 })
      await page.screenshot({ path: `.ui-current/resource-reconstruction-${engine.name()}.png` })
      await page.locator('[data-resource-style-type="image"]').click()
      await usage.selectOption("unused")
      await page.locator('[data-resource-catalog="font"]').click()
      await page.locator("#browser-open").setInputFiles({ name: "另一皮肤.bds", mimeType: "application/octet-stream", buffer: fixture })
      await page.getByRole("button", { name: "不导出", exact: true }).click()
      await page.waitForFunction(() => !document.querySelector("#open").disabled && (!document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled))
      if (await close.isVisible()) await close.click()
      await page.locator('[data-workspace-page="resources"]').click()
      assert.equal(await page.locator('[data-resource-page="style"]').getAttribute("aria-pressed"), "true")
      assert.equal(await usage.inputValue(), "all", "新皮肤不继承上一皮肤的筛选")
      await page.locator("#resource-create-style").click()
      assert.equal(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.undoStack.length), original.undo + 1, "header create uses the existing undoable style action")
      const unused = page.locator('#resource-gallery [data-style-id="900"]')
      await unused.press("Shift+F10")
      await page.getByRole("menu", { name: "资源操作" }).getByRole("menuitem", { name: "删除样式" }).click()
      const confirmation = page.locator('dialog[open][data-delete-confirmation]')
      await confirmation.getByRole("button", { name: "取消", exact: true }).click()
      await confirmation.waitFor({ state: "detached" })
      await unused.waitFor()
      await page.locator('.resource-detail-heading').getByRole("button", { name: "删除样式", exact: true }).click()
      await confirmDeletion(page)
      await unused.waitFor({ state: "detached" })
      await page.keyboard.press("ControlOrMeta+z")
      await unused.waitFor()
      assert.deepEqual(errors, [])
      console.log(`${engine.name()}: resource counts, usage, catalog, fonts, sorting, responsive layout, creation and confirmed deletion passed`)
    } finally { await browser.close() }
  }
} finally { await server.close() }
