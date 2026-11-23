import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"
import { bdaAnimatedSkinBytes } from "../tests/helpers/bda-animation-fixture.mjs"
import { sxiAnimationFixture } from "../tests/helpers/sxi-animation-fixture.mjs"
import { ssfFixture, wav } from "../tests/helpers/ssf-fixture.mjs"
import { SkinArchive } from "../src/skin.ts"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41909, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
mkdirSync(".ui-current", { recursive: true })
const baidu = SkinArchive.open(bdsFixture())
const stylesPath = "light/res/default.css"
baidu.setText(stylesPath, `${baidu.getText(stylesPath)}\n[STYLE7]\nNM_IMG=btn,0\nHL_IMG=btn, 0\nPRESS_SOUND_PATH=click.wav\n[STYLE8]\nPRESS_SOUND_PATH=soft.wav\n`)
baidu.setBytes("light/skin/res/click.wav", wav(8000))
baidu.setBytes("light/skin/res/soft.wav", wav(8000))
const fixtures = { bds: baidu.toBytes("bds"), bdi: baidu.toBytes("bdi"), bda: bdaAnimatedSkinBytes(), sxi: sxiAnimationFixture(), ssf: ssfFixture() }
const optionCount = cards => cards.evaluateAll(options => Number(options[0]?.getAttribute("aria-setsize") ?? options.length))
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
    assert.equal(await page.locator("#mobile-resource-tabs").isVisible(), false, "电脑资源页不显示手机分类栏")
    assert.equal(await page.locator('[data-workspace-page="resources"]').getAttribute("aria-current"), "page")
    assert.equal(await page.locator('[data-resource-page="style"]').isDisabled(), format === "ssf")
    if (["bds", "bdi"].includes(format)) {
      await page.locator('[data-resource-page="sound"]').click()
      const files = page.getByRole("listbox", { name: "音效文件" })
      assert.deepEqual(await files.getByRole("option").locator("strong").allTextContents(), ["click.wav", "soft.wav"])
      assert.ok(await files.evaluate(list => list.clientWidth === list.closest("#resource-gallery").clientWidth), "音效列表撑满资源栏，不因容器查询而收缩")
      await files.getByRole("option", { name: /click.wav/ }).click()
      const preview = page.locator("#sound-resource-detail")
      await preview.getByRole("img", { name: /click.wav 波形，时长/ }).waitFor()
      await preview.getByRole("button", { name: "试听音效" }).click()
      await preview.getByRole("button", { name: "停止试听" }).waitFor()
      await preview.getByRole("button", { name: "停止试听" }).click()
      await files.getByRole("option", { name: /click.wav/ }).press("ArrowDown")
      assert.equal(await files.getByRole("option", { name: /soft.wav/ }).getAttribute("aria-selected"), "true")
      if (format === "bdi") await page.screenshot({ path: `.ui-current/resource-audio-${colorScheme}.png` })

      await page.getByRole("button", { name: /^音效样式/ }).click()
      const cards = page.locator('#resource-gallery [role="option"]')
      assert.equal(await optionCount(cards), 2)
      assert.equal(await page.locator('[data-resource-style-count="sound"]').textContent(), "2")
      for (const [id, file] of [[7, "click.wav"], [8, "soft.wav"]]) {
        const card = page.locator(`#resource-gallery [data-style-id="${id}"]`)
        assert.equal(await card.getAttribute("data-style-kind"), "sound")
        assert.equal(await card.locator(".ui-style-sound-info > strong").textContent(), file)
        assert.equal(await card.getByRole("button", { name: "试听", exact: true }).isEnabled(), true)
      }
      if (format === "bdi") await page.screenshot({ path: `.ui-current/resource-sound-styles-${colorScheme}.png` })
      await page.locator("#resource-search").fill("click.wav")
      assert.equal(await optionCount(cards), 1)
      await page.locator("#resource-search").fill("")
      await page.locator('[data-resource-page="style"]').click()
    }
    if (format !== "ssf") {
      await page.locator('#resource-gallery [role="option"]').first().waitFor()
      assert.equal(await optionCount(page.locator('#resource-gallery [role="option"]')), Number(await page.locator('[data-resource-count="style"]').textContent()), "全部样式展示所有类型")
      for (const type of ["image", "text", "color"]) {
        await page.locator(`[data-resource-style-type="${type}"]`).click()
        const cards = page.locator('#resource-gallery [role="option"]')
        assert.equal(await optionCount(cards), Number(await page.locator(`[data-resource-style-count="${type}"]`).textContent()))
        if (type === "image" && ["bds", "bdi"].includes(format)) {
          for (const [id, count] of [[2, 2], [6, 1], [7, 1]]) {
            const states = page.locator(`#resource-gallery [data-style-id="${id}"]`).locator(".ui-style-state")
            await states.last().waitFor()
            const layout = await states.evaluateAll(items => {
              const preview = items[0].parentElement
              const style = getComputedStyle(preview)
              return { count: items.length, gap: style.gap, checker: style.backgroundImage !== "none",
                width: items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0), previewWidth: preview.getBoundingClientRect().width,
                seamless: items.every(item => getComputedStyle(item.firstElementChild).backgroundImage === "none" && getComputedStyle(item.firstElementChild).borderRadius === "0px") }
            })
            assert.equal(layout.count, count, `STYLE${id} 只合并相同切片（包括回退）`)
            assert.ok(layout.checker && layout.seamless && layout.gap === "0px" && Math.abs(layout.width - layout.previewWidth) < 1)
          }
          await page.locator('#resource-gallery [data-style-id="7"]').click()
          for (const state of ["normal", "highlighted"]) assert.equal(await page.locator(`#style-detail-${state}`).isVisible(), true)
          await page.screenshot({ path: `.ui-current/resource-style-states-${format}-${colorScheme}.png` })
        }
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
    await page.setViewportSize({ width: format === "bds" ? 320 : 390, height: 844 })
    await page.locator('#mobile-navigation [data-mobile-page="resources"]').click()
    const mobileCategory = page.getByRole("combobox", { name: "资源分类" })
    assert.ok((await mobileCategory.boundingBox()).height >= 44, "分类保留 44px 触控高度")
    assert.equal(await mobileCategory.locator('option[value="style"]').isDisabled(), format === "ssf")
    if (format !== "ssf") {
      await mobileCategory.selectOption("style:image")
      await page.locator('#resource-gallery .ui-style-card[data-style-kind="image"]').first().waitFor()
      assert.equal(await page.locator('#resource-gallery .ui-style-card:not([data-style-kind="image"])').count(), 0)
      assert.equal(await page.locator('[data-resource-style-type="image"]').getAttribute("aria-pressed"), "true")
      const toggle = page.getByRole("button", { name: "筛选和排序" })
      const filters = page.locator('.resource-filter-options select:visible')
      assert.equal(await filters.count(), 0, "手机默认折叠次要筛选")
      const compactTop = (await page.locator("#resource-gallery").boundingBox()).y
      await toggle.click()
      assert.equal(await toggle.getAttribute("aria-expanded"), "true")
      assert.ok(await filters.evaluateAll(selects => selects.length >= 2 && selects.every(select => select.getBoundingClientRect().height >= 44)), "用途、状态和排序使用可触控的原生下拉")
      assert.ok((await page.locator("#resource-gallery").boundingBox()).y >= compactTop + 44)
      await page.locator("#resource-sort").selectOption("descending")
      await toggle.click()
      assert.equal(await filters.count(), 0)
      assert.equal(await page.locator("#resource-sort").inputValue(), "descending", "收起不清除筛选条件")
      await toggle.click()
      await page.locator("#resource-sort").selectOption("name")
      await toggle.click()
      if (format === "bds") await page.screenshot({ path: `.ui-current/resource-page-mobile-${colorScheme}.png` })
    }
    await mobileCategory.selectOption("catalog:all")
    await page.locator('#resource-catalog[aria-label="全部资源"]').waitFor()
    await mobileCategory.selectOption("catalog:font")
    await page.locator('#resource-catalog[aria-label="字体"]').waitFor()
    assert.equal(await page.getByRole("combobox", { name: "样式用途" }).isVisible(), false)
    await mobileCategory.selectOption("image")
    await page.locator(".source #resource-gallery .ui-image-card").first().waitFor()
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
    assert.deepEqual(await page.evaluate(async () => [...(await import("/src/app/state.ts")).appState.archive.changed]), initial, "浏览和切换资源不修改文件")
    if (format === "bds") {
      const dark = page.locator('[data-resource-theme="dark"]')
      const light = page.locator('[data-resource-theme="light"]')
      const confirm = page.getByRole("dialog", { name: "创建深色目录？" })
      const snapshot = () => page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        const { archive, undoStack } = appState
        const paths = archive.names().filter(path => path.startsWith("light/skin/") && !path.endsWith("/"))
        return {
          undo: undoStack.length,
          dark: archive.names().filter(path => path.startsWith("dark/skin/") && !path.endsWith("/")).length,
          copied: paths.every(path => archive.getBytes(path)?.toString() === archive.getBytes(path.replace(/^light\//, "dark/"))?.toString()),
        }
      })
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.locator('[data-resource-page="style"]').click()
      await page.locator("#resource-search").fill("STYLE2")
      await dark.click()
      await confirm.waitFor()
      await page.screenshot({ path: `.ui-current/resource-theme-confirm-${colorScheme}.png`, animations: "disabled" })
      assert.equal(await light.getAttribute("aria-pressed"), "true")
      assert.deepEqual(await snapshot(), { undo: 0, dark: 0, copied: false })
      await page.keyboard.press("Escape")
      await confirm.waitFor({ state: "detached" })
      assert.equal(await page.locator("#theme").inputValue(), "light")
      assert.equal(await page.locator("#resource-search").inputValue(), "STYLE2")
      assert.deepEqual(await snapshot(), { undo: 0, dark: 0, copied: false })
      await dark.click()
      await confirm.getByRole("button", { name: "创建并切换" }).click()
      await page.waitForFunction(() => document.querySelector('[data-resource-theme="dark"]').ariaPressed === "true")
      const created = await snapshot()
      assert.equal(await page.locator("#resource-search").inputValue(), "STYLE2")
      assert.equal(created.undo, 1)
      assert.ok(created.dark > 0 && created.copied, "新目录包含当前外观的原始文件")
      await light.click()
      await dark.click()
      assert.equal(await confirm.count(), 0, "已有目录直接切换，无需再确认")
      assert.deepEqual(await snapshot(), created)
      await page.locator("#desktop-undo").click()
      assert.equal(await light.getAttribute("aria-pressed"), "true", "撤销后回到仍存在的外观")
      assert.deepEqual(await snapshot(), { undo: 0, dark: 0, copied: false })

      await page.setViewportSize({ width: 390, height: 844 })
      await page.locator('#mobile-navigation [data-mobile-page="edit"]').click()
      await page.locator("#mobile-app-more > summary").click()
      await page.locator('[data-mobile-action="mobile-canvas-options"]').click()
      const options = page.getByRole("group", { name: "外观", exact: true })
      await options.getByRole("button", { name: "深色" }).click()
      await confirm.getByRole("button", { name: "取消" }).click()
      await confirm.waitFor({ state: "detached" })
      assert.equal(await options.getByRole("button", { name: "浅色" }).getAttribute("aria-pressed"), "true")
      await options.getByRole("button", { name: "深色" }).click()
      await confirm.getByRole("button", { name: "创建并切换" }).click()
      await page.waitForFunction(() => document.querySelector('[aria-label="外观"] button[aria-pressed="true"]').textContent === "深色")
      assert.deepEqual(await snapshot(), created)
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`resource page ${format} ${colorScheme}: desktop, narrow, mobile and image editing passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
