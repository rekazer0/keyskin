import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"
import { ssfFixture } from "../tests/helpers/ssf-fixture.mjs"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41819, strictPort: false } })
await server.listen()
const browser = await chromium.launch()

async function checkResourceTiles(page) {
  const geometry = await page.locator('.nav-group-body:has(> [data-layout="tile"])').evaluate((grid) => {
    const bounds = grid.getBoundingClientRect()
    const nodes = Array.from(grid.children)
    const rects = nodes.map((node) => node.getBoundingClientRect())
    const gap = parseFloat(getComputedStyle(grid).columnGap)
    const columns = rects.filter((rect) => Math.abs(rect.top - rects[0].top) < 1).length
    return {
      columns,
      expectedColumns: Math.min(nodes.length, Math.max(1, Math.floor((bounds.width + gap) / (80 + gap)))),
      fixedSize: rects.every((rect) => Math.abs(rect.width - 80) < 1 && Math.abs(rect.height - 64) < 1),
      plainGrid: getComputedStyle(grid).backgroundColor === "rgba(0, 0, 0, 0)",
      fits: rects.every((rect) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1),
      startsLeft: Math.abs(rects[0].left - bounds.left) < 1,
      iconsFit: nodes.every((node) => {
        const icon = node.querySelector(".ui-icon").getBoundingClientRect()
        const tile = node.getBoundingClientRect()
        return icon.left >= tile.left && icon.right <= tile.right && icon.top >= tile.top && icon.bottom <= tile.bottom
      }),
      labelsVisible: nodes.every((node) => {
        const label = node.querySelector(".nav-label")
        const bounds = label.getBoundingClientRect()
        const tile = node.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0 && label.scrollWidth <= label.clientWidth && bounds.top >= node.querySelector(".ui-icon").getBoundingClientRect().bottom && bounds.bottom <= tile.bottom
      }),
      namesAccessible: nodes.every((node) => node.getAttribute("aria-label") === node.querySelector(".nav-label").textContent && node.title.startsWith(node.getAttribute("aria-label"))),
    }
  })
  assert.equal(geometry.columns, geometry.expectedColumns, "resource columns follow available sidebar width")
  assert.ok(geometry.fixedSize && geometry.plainGrid && geometry.fits && geometry.startsLeft && geometry.iconsFit && geometry.labelsVisible && geometry.namesAccessible, JSON.stringify(geometry))
  assert.ok(await page.locator('[data-layout="tile"] > .nav-label').evaluateAll((labels) => labels.every((label) => /^[\u4e00-\u9fff]{4}$/.test(label.textContent))), "all resource tile labels have four Chinese characters")
}

try {
  for (const [width, colorScheme] of [[1440, "light"], [390, "light"], [320, "dark"]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    if (width >= 760) {
      await page.locator('.template-card[data-template="official-android-bds"]').click()
      await page.locator(".canvas-wrap:not(.empty)").waitFor()
      await page.waitForFunction(() => !document.querySelector("#open").disabled)
      const close = page.locator("#file-operation-dialog[open] #file-operation-close")
      if (await close.isVisible()) await close.click()
      assert.equal(await page.locator('.sidebar-overview [data-layout="tile"]').count(), 6)
      assert.deepEqual(await page.locator('[data-layout="tile"] > .nav-label').allTextContents(), ["通用配置", "图片资源", "按键样式", "音效资源", "动效设计", "粒子设计"])
      for (const sidebarWidth of [180, 248, 320, 480, 700, 248]) {
        const sidebar = page.locator(".sidebar")
        const initialWidth = await sidebar.evaluate((node) => node.getBoundingClientRect().width)
        const handle = await page.locator("#sidebar-resize-handle").boundingBox()
        const x = handle.x + handle.width / 2
        const y = handle.y + handle.height / 2
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x + sidebarWidth - initialWidth, y, { steps: 8 })
        await page.mouse.up()
        await page.evaluate(() => new Promise(requestAnimationFrame))
        assert.ok(Math.abs(await sidebar.evaluate((node) => node.getBoundingClientRect().width) - sidebarWidth) < 1)
        await checkResourceTiles(page)
        await sidebar.screenshot({ path: `/tmp/keyskin-resource-tiles-${sidebarWidth}.png` })
        await page.locator('.nav-group-body:has(> [data-layout="tile"])').screenshot({ path: `/tmp/keyskin-resource-grid-${sidebarWidth}.png` })
      }
      await page.reload()
    }
    await page.locator("#browser-open").setInputFiles({ name: "分类.bda", mimeType: "application/octet-stream", buffer: readFileSync(new URL("../public/default-template.bda", import.meta.url)) })
    await page.waitForFunction(() => !document.querySelector("#open").disabled)
    const bdaClose = page.locator("#file-operation-dialog[open] #file-operation-close")
    if (await bdaClose.isVisible()) await bdaClose.click()
    if (width < 760) await page.locator('[data-mobile-pane="layout"]').click()
    const categories = {
      "键盘布局": ["py_9", "py_26", "en_26", "en_26s", "en_9", "en_9s", "bh", "def_26", "def_9", "net", "net_shifts"],
      "数字与符号": ["num_9", "symbol", "sym_26_cn", "sym_26_en", "sym_26_cn_h", "sym_26_en_h", "symbol_h"],
      "手写与选择": ["hw_grid", "hw_full", "sel_ch", "sel_en", "sel_ch_h", "sel_en_h"],
      "键盘组件": ["voice"],
      "扩展布局": ["cj", "template", "zy"],
    }
    for (const [title, names] of Object.entries(categories)) {
      const category = page.locator(`[data-overview-group="${title}"]`)
      assert.deepEqual(await category.locator("button.nav-item").evaluateAll((nodes) => nodes.map((node) => node.dataset.path.split("/").pop().replace(/\.ini$/, "")).sort()), [...names].sort(), `BDA panels retain their ${title} category`)
      if (["键盘布局", "数字与符号", "手写与选择"].includes(title)) {
        assert.equal(await category.evaluate((node) => node.open), true)
        assert.equal(await category.getByRole("button", { name: "添加布局（面板复制）" }).count(), 1)
      }
    }
    assert.equal(await page.locator('[data-overview-group="面板样式"], .sidebar-overview .ui-search, .sidebar-overview input').count(), 0, "BDA overview has categories without layout search")
    const symbols = page.locator('[data-overview-group="数字与符号"]')
    await symbols.locator('button[data-path$="/num_9.ini"]').click()
    if (width < 760) await page.locator('[data-mobile-pane="layout"]').click()
    assert.equal(await symbols.locator('button[data-path$="/num_9.ini"]').getAttribute("aria-current"), "true")
    assert.equal(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.archive.changed.size), 0, "BDA category navigation does not change skin files")
    await page.locator("#files").evaluate((node) => node.scrollTo({ top: 0, behavior: "instant" }))
    await page.locator(".sidebar").screenshot({ path: `/tmp/keyskin-bda-categories-${width}-${colorScheme}.png` })
    console.log(`PASS BDA categories ${width}px ${colorScheme}`)
    await page.reload()
    await page.locator("#browser-open").setInputFiles({ name: "侧栏.ssf", mimeType: "application/octet-stream", buffer: Buffer.from(ssfFixture()) })
    await page.waitForFunction(() => !document.querySelector("#open").disabled)
    const close = page.locator("#file-operation-dialog[open] #file-operation-close")
    if (await close.isVisible()) await close.click()
    if (width < 760) await page.locator('[data-mobile-pane="layout"]').click()
    const group = page.locator('[data-overview-group="键盘布局"]')
    const rows = group.locator("button.nav-item")
    assert.equal(await rows.count(), 20)
    assert.equal(await rows.filter({ visible: true }).count(), 20, "all layouts are listed directly")
    assert.equal(await page.locator(".sidebar-overview .nav-layout-more, .sidebar-overview .nav-section-count").count(), 0, "overview has no group counts or extra-layout disclosure")
    assert.ok(await page.locator(".nav-group:not(:first-of-type) > .nav-section").evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).marginTop === "12px")), "group spacing is compact")
    assert.equal(await page.locator(".sidebar-overview .ui-search, .sidebar-overview input").count(), 0, "overview groups have no search boxes")
    await rows.last().click()
    if (width < 760) await page.locator('[data-mobile-pane="layout"]').click()
    assert.equal(await rows.last().getAttribute("aria-current"), "true")
    assert.equal(await rows.last().isVisible(), true)
    assert.equal(await page.locator(".mobile-overview-groups").count(), 0)
    assert.equal(await page.locator(".skin-card-info").isVisible(), true)
    await checkResourceTiles(page)
    for (const title of ["数字与符号", "手写与语音"]) {
      const other = page.locator(`[data-overview-group="${title}"]`)
      assert.equal(await other.evaluate((node) => node.open), true, `${title} shows the same expanded group structure`)
      assert.equal(await other.getByRole("button", { name: "添加布局（面板复制）" }).count(), 1)
      assert.equal(await other.locator(".nav-section > .source-disclosure").count(), 0)

    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow")
    assert.deepEqual(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.archive.changed.size), 0, "navigation does not change skin files")
    await group.getByRole("button", { name: "添加布局（面板复制）" }).click()
    await page.getByRole("button", { name: "切换至编辑模式", exact: true }).click()
    await page.getByRole("dialog", { name: "交互预览中无法编辑" }).waitFor({ state: "detached" })
    await group.getByRole("button", { name: "添加布局（面板复制）" }).click()
    await page.locator("#panel-scale-dialog").waitFor({ state: "visible" })
    assert.equal(await group.evaluate((node) => node.open), true, "add does not collapse group")
    await page.keyboard.press("Escape")
    await page.locator("#panel-scale-dialog").waitFor({ state: "hidden" })
    await page.locator("#files").evaluate((node) => node.scrollTo({ top: 0, behavior: "instant" }))
    await page.mouse.move(0, 0)
    const geometry = await page.locator("#files").evaluate((node) => {
      const bounds = node.getBoundingClientRect()
      const card = node.querySelector(".skin-card").getBoundingClientRect()
      return { fits: card.top >= bounds.top && card.right <= bounds.right, bounds: bounds.toJSON(), card: card.toJSON() }
    })
    await page.locator(".sidebar").screenshot({ path: `/tmp/keyskin-sidebar-${width}-${colorScheme}.png` })
    assert.ok(geometry.fits, `skin card stays inside the scroll area: ${JSON.stringify(geometry)}`)
    assert.ok(await page.locator(".sidebar, .skin-card, .sidebar-overview .nav-item, .sidebar-overview .ui-search").evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).backgroundImage === "none")), "overview uses solid backgrounds")
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS sidebar overview ${width}px ${colorScheme}`)
  }
} finally {
  await browser.close()
  await server.close()
}
