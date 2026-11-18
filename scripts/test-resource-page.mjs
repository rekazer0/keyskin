import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"
import { bdaAnimatedSkinBytes } from "../tests/helpers/bda-animation-fixture.mjs"
import { sxiAnimationFixture } from "../tests/helpers/sxi-animation-fixture.mjs"
import { ssfFixture } from "../tests/helpers/ssf-fixture.mjs"
import { SkinArchive } from "../src/skin.ts"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41909, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
mkdirSync(".ui-current", { recursive: true })
const fixtures = { bds: bdsFixture(), bdi: SkinArchive.open(bdsFixture()).toBytes("bdi"), bda: bdaAnimatedSkinBytes(), sxi: sxiAnimationFixture(), ssf: ssfFixture() }
try {
  for (const colorScheme of ["light", "dark"]) for (const [format, bytes] of Object.entries(fixtures)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme })
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator("#browser-open").setInputFiles({ name: `资源.${format}`, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) })
    await page.waitForFunction(() => !document.querySelector("#open").disabled && (!document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled))
    const close = page.locator("#file-operation-dialog[open] #file-operation-close")
    if (await close.isVisible()) await close.click()
    assert.equal(await page.locator('.sidebar-overview [data-nav-mode="style"], .sidebar-overview [data-nav-mode="resource"]').count(), 0, "重复资源磁贴已移除")
    assert.equal(await page.getByRole("button", { name: "按键样式", exact: true }).count(), 0)
    assert.equal(await page.getByRole("button", { name: "音效资源", exact: true }).count(), 0)
    const initial = await page.evaluate(async () => [...(await import("/src/app/state.ts")).appState.archive.changed])
    await page.locator('[data-workspace-page="resources"]').click()
    await page.locator(".workspace #resource-list-view").waitFor()
    assert.equal(await page.locator('[data-workspace-page="resources"]').getAttribute("aria-current"), "page")
    assert.equal(await page.locator('[data-resource-page="style"]').isDisabled(), format === "ssf")
    if (format !== "ssf") {
      await page.locator('#resource-gallery [role="option"]').first().waitFor()
      assert.equal(await page.locator('#resource-gallery [role="option"]').count(), Number(await page.locator('[data-resource-count="style"]').textContent()), "全部样式展示所有类型")
      for (const type of ["image", "text", "color"]) {
        await page.locator(`[data-resource-style-type="${type}"]`).click()
        const cards = page.locator('#resource-gallery [role="option"]')
        assert.equal(await cards.count(), Number(await page.locator(`[data-resource-style-count="${type}"]`).textContent()))
        if (format === "bda" && await cards.count()) {
          await cards.first().click()
          assert.equal(await page.locator("#resource-detail").isVisible(), true)
          assert.equal(await cards.first().getAttribute("aria-selected"), "true", "BDA 类型选择保留正确的样式标识")
        }
      }
      await page.locator('[data-resource-page="style"]').click()
      await page.locator("#resource-search").fill("no-matching-resource")
      await page.keyboard.press("Escape")
      assert.equal(await page.locator("#resource-search").inputValue(), "")
    }
    await page.screenshot({ path: `.ui-current/resource-page-${format}-${colorScheme}.png` })
    const total = Number((await page.locator('[data-resource-count="all"]').textContent()).replace(/\D/g, ""))
    await page.locator('[data-resource-catalog="all"]').click()
    assert.equal(await page.locator('#resource-catalog [role="option"]').count(), total, "全部资源与分类总数使用相同范围")
    await page.locator('[data-resource-catalog="font"]').click()
    assert.equal(await page.locator('#resource-catalog [role="option"]').count(), Number(await page.locator('[data-resource-count="font"]').textContent()))
    await page.locator('[data-resource-page="image"]').click()
    await page.locator(".workspace #resource-gallery .ui-image-card").first().waitFor()
    assert.equal(await page.locator("#resource-create-style").textContent(), "上传")
    assert.equal(await page.locator("#resource-list-title").textContent(), "图片")
    await page.setViewportSize({ width: 812, height: 1000 })
    assert.equal(await page.locator("#resource-page-tabs").isVisible(), true)
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
    await page.screenshot({ path: `.ui-current/resource-page-images-${format}-${colorScheme}.png` })
    await page.locator("#resource-gallery .ui-image-card").first().dblclick()
    await page.locator("#atlas-editor-dialog[open]").waitFor()
    assert.equal(await page.locator("#atlas-canvas").isVisible(), true)
    assert.equal(await page.locator(".workspace #resource-list-view").isVisible(), true, "弹窗编辑保留资源列表")
    await page.locator('#atlas-editor-dialog').getByRole("button", { name: "关闭", exact: true }).click()
    await page.locator(".workspace #resource-list-view").waitFor()
    await page.locator('[data-workspace-page="overview"]').click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#mobile-navigation [data-mobile-page="resources"]').click()
    await page.locator('#mobile-resource-tabs [data-mobile-resource="resource"]').click()
    await page.locator(".source #resource-gallery .ui-image-card").first().waitFor()
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
    assert.deepEqual(await page.evaluate(async () => [...(await import("/src/app/state.ts")).appState.archive.changed]), initial, "浏览和切换资源不修改文件")
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`resource page ${format} ${colorScheme}: desktop, narrow, mobile and image editing passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
