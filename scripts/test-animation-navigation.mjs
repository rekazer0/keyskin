// Real Playwright navigation: shared source files, independent animation views, undo/tree rebuilds.
import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { sxiAnimationFixture } from "../tests/helpers/sxi-animation-fixture.mjs"
import { bdaAnimatedSkinBytes, bdsBaseArchive } from "../tests/helpers/bda-animation-fixture.mjs"
import { SkinArchive } from "../src/skin.ts"
import { convertBdaArchive } from "../src/bda-convert.ts"
import { acceptAskDialogs } from "../tests/helpers/ask-dialogs.mjs"

const bda = bdaAnimatedSkinBytes()
const bds = await convertBdaArchive(SkinArchive.open(bda, "bda"), bdsBaseArchive()).archive.platformBytesAsync("bds")
const fixtures = [
  // A Palm skin's animation table is a part of skin.json, addressed by its pointer.
  { format: "sxi", bytes: sxiAnimationFixture(), paths: ["skin.json/default/s_info/ss_2"], files: ["skin.json"] },
  { format: "bds", bytes: bds, paths: ["light/skin/port/res/anim.ini"], files: ["light/skin/port/res/anim.ini"] },
  { format: "bda", bytes: bda, paths: ["light/skin/port/animationConfig"], files: ["light/skin/port/animationConfig"] },
]
const server = await createServer({ root: new URL("..", import.meta.url).pathname, logLevel: "error", server: { port: 41839, strictPort: false, host: "127.0.0.1", hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
await acceptAskDialogs(page)
const baseURL = `http://127.0.0.1:${server.httpServer.address().port}/`
const entry = (path, mode) => page.locator(`.sidebar-overview button[data-path="${path}"][data-nav-mode="${mode}"]`)
// 桌面从左导航的动画进入，分类在工作区内直接切换。
const back = async () => {
  if (await page.locator("body.animation-workspace").count()) await page.locator('#animation-library .ui-pane-header button[aria-label="返回"]').click()
}
const open = async (path, mode) => {
  if (!await page.locator("body.animation-workspace").count()) await page.locator('[data-workspace-page="animation"]').click()
  await page.locator(`#animation-library [data-animation-mode="${mode}"]`).click()
  assert.equal((await state()).path, path)
}
const state = () => page.evaluate(async () => {
  const { appState } = await import("/src/app/state.ts")
  return {
    path: appState.selectedPath,
    mode: appState.animationDesignMode,
    resource: appState.resourceConfigActive,
    imageHidden: document.querySelector("#workspace-image-figure").hidden,
    selectedMode: appState.selectedFileButton?.dataset.navMode ?? null,
    selectedPath: appState.selectedFileButton?.dataset.path ?? null,
    selectedConnected: appState.selectedFileButton?.isConnected ?? false,
  }
})
async function check(path, mode, source = false) {
  const value = await state()
  assert.equal(value.path, path)
  assert.equal(value.mode, mode)
  assert.equal(value.resource, false, "animation views use the document inspector, not image resources")
  assert.equal(value.imageHidden, true)
  assert.equal(value.selectedConnected, true)
  assert.equal(value.selectedPath, path)
  if (!source) {
    assert.equal(value.selectedMode, mode)
    assert.equal(await entry(path, mode).evaluate((node) => node.getAttribute("aria-current")), "true")
    assert.equal(await page.locator('.sidebar-overview button[aria-current="true"]').count(), 1)
  }
}

try {
  for (const fixture of fixtures) {
    await page.goto(baseURL)
    await page.locator("#browser-open").setInputFiles({ name: `navigation.${fixture.format}`, mimeType: "application/octet-stream", buffer: Buffer.from(fixture.bytes) })
    await page.waitForFunction(() => !document.querySelector("#open").disabled)
    const close = page.locator("#file-operation-dialog[open] #file-operation-close")
    if (await close.isVisible()) await close.click()
    await page.getByRole("button", { name: "编辑模式", exact: true }).click()
    assert.equal((await state()).mode, "all")
    assert.equal(await page.locator('.nav-group[data-overview-group="动画效果"], .nav-group[data-overview-group="轻量动画"]').count(), 0)
    const archiveBefore = await page.evaluate(async (paths) => {
      const { appState } = await import("/src/app/state.ts")
      return { names: appState.archive.names(), bytes: paths.map((path) => Array.from(appState.archive.getBytes(path))) }
    }, fixture.files)

    for (const path of fixture.paths) {
      assert.equal(await page.locator(`.sidebar-overview button[data-path="${path}"]`).count(), 2)
      for (const mode of ["motion", "particle"]) {
        const button = entry(path, mode)
        assert.equal(await button.count(), 1)
        assert.equal(await button.isVisible(), false, "桌面概览不重复显示动画入口")
        assert.equal(await button.locator(".nav-label").textContent(), mode === "motion" ? "动效设计" : "粒子设计")
        if (fixture.paths.length > 1) assert.ok((await button.getAttribute("title")).includes(path.split("/").pop()), "file names remain available in tooltips")
        assert.equal(await button.evaluate((node) => node.closest(".nav-group").dataset.overviewGroup), "资源配置")
        if (fixture.format === "sxi") assert.equal(await button.locator(".nav-meta").textContent(), "skin.json")
        await open(path, mode)
        await check(path, mode)
        assert.equal(await page.locator(`#animation-library [data-animation-mode="${mode}"]`).getAttribute("aria-pressed"), "true")
        assert.equal(await page.locator('[data-workspace-page="animation"]').getAttribute("aria-current"), "page")
        assert.equal(await page.locator('#animation-library .ui-pane-header h2').textContent(), "动画")
        assert.equal(await page.locator("body.animation-workspace #animation-library .ui-listbox:has([data-animation-id])").count(), 1, "动画列表在左侧栏")
        assert.equal(await page.locator('body.animation-workspace #animation-library .ui-listbox[data-size="fill"]').count(), 2, "动画与样式两份列表都在左侧栏")
        assert.equal(await page.locator("body.animation-workspace #animation-library .animation-library-tabs > button").count(), 2, "左侧栏用分段开关切换动画与样式")
        assert.equal(await page.locator("#animation-stage .ui-animation-player").count(), 1, "播放器在画布上")
        // 播放条默认停在内容高度，拖动上边缘改高，双击恢复。
        const stageHeight = () => page.locator("#animation-stage").evaluate((node) => Math.round(node.getBoundingClientRect().height))
        const autoHeight = await stageHeight()
        const sizing = await page.locator("#animation-stage").evaluate((node) => {
          const stage = node.querySelector(".ui-animation-stage").getBoundingClientRect()
          return { width: stage.width, height: stage.height, overflow: node.scrollHeight - node.clientHeight }
        })
        assert.ok(sizing.width <= 320 && sizing.height <= 160, "横排舞台保持紧凑尺寸，不随工作区宽度放大")
        assert.ok(Math.abs(sizing.width / sizing.height - 2) < 0.01, "舞台与直操手柄保持 2:1 坐标比例")
        assert.ok(sizing.overflow <= 1, "默认高度完整容纳播放条内容")
        const resize = page.locator(".animation-stage-resize-handle")
        const grab = await resize.boundingBox()
        assert.ok(grab, "播放条上边缘有拖动手柄")
        await page.mouse.move(grab.x + grab.width / 2, grab.y + 2)
        await page.mouse.down()
        await page.mouse.move(grab.x + grab.width / 2, grab.y - 64, { steps: 6 })
        await page.mouse.up()
        await page.waitForTimeout(120)
        assert.ok(await stageHeight() >= autoHeight + 60, "向上拖动加高播放条")
        const resized = await resize.boundingBox()
        await page.mouse.dblclick(resized.x + resized.width / 2, resized.y + 2)
        await page.waitForTimeout(120)
        assert.equal(await stageHeight(), autoHeight, "双击恢复默认高度")
        assert.equal(await page.evaluate(() => localStorage.getItem("animationStageHeightV1")), null)
        // Tree rebuilding alone must restore both the mode and its connected selected button.
        await page.evaluate(async () => (await import("/src/app/file-tree.ts")).renderFiles())
        await check(path, mode)
        // Document refresh is what history/source-sync callers use, with no animation argument.
        await page.evaluate(async (path) => (await import("/src/app/navigation.ts")).selectFile(path, "overview", "document"), path)
        await check(path, mode)
      }
    }
    assert.deepEqual(await page.evaluate(async (paths) => {
      const { appState } = await import("/src/app/state.ts")
      return { names: appState.archive.names(), bytes: paths.map((path) => Array.from(appState.archive.getBytes(path))) }
    }, fixture.files), archiveBefore, "navigation never rewrites or relocates source data")

    const path = fixture.paths[0]
    for (const mode of ["motion", "particle"]) {
      await open(path, mode)
      // A real history entry, then real undo/redo (including renderFiles + document reselection).
      await page.evaluate(async (format) => {
        const { appState } = await import("/src/app/state.ts")
        const { commitText } = await import("/src/app/edit-history.ts")
        const historyPath = format === "sxi" ? "skin.json" : appState.archive.names().find((name) => /Info\.txt$/.test(name))
        const before = appState.archive.getText(historyPath)
        commitText(historyPath, before, `${before}\n`)
      }, fixture.format)
      for (const action of ["undo", "redo", "undo"]) {
        await page.evaluate(async (action) => (await import("/src/app/edit-history.ts"))[action](), action)
        await check(path, mode)
      }
    }

    // Raw-source entry explicitly opts into the unfiltered view, including on the same path.
    const rawPath = fixture.format === "sxi" ? "skin.json" : path
    await back()
    await page.locator('[data-workspace-page="source"]').click()
    await page.evaluate(async (path) => (await import("/src/app/source-files.ts")).ensureSourcePathRendered(path), rawPath)
    await page.locator(`.raw-files button[data-path="${rawPath}"]`).click()
    await check(rawPath, "all", true)
    await page.locator('[data-workspace-page="overview"]').click()
    await open(path, "particle")
    await back()
    // A different ordinary document resets to all rather than carrying the animation filter.
    const documentGroup = page.locator('.nav-group').filter({ has: page.locator('button[data-nav-mode="document"]') }).first()
    if (!await documentGroup.evaluate((node) => node.open)) await documentGroup.locator(':scope > summary').click()
    await page.locator('.sidebar-overview button[data-nav-mode="document"]').first().click()
    assert.equal((await state()).mode, "all")
    assert.equal((await state()).resource, false)
    await page.evaluate(async (path) => (await import("/src/app/navigation.ts")).selectFile(path, "overview"), path)
    assert.equal((await state()).mode, "all")
    // The same file under two entries remembers one animation per entry.
    await page.locator('[data-inspector-tab="properties"]').dispatchEvent("click")
    await open(path, "motion")
    const motionItems = await page.locator("[data-animation-id]").evaluateAll((nodes) => nodes.map((node) => node.dataset.animationId))
    await page.locator(`[data-animation-id="${motionItems[1]}"]`).click()
    await open(path, "particle")
    const particleItems = await page.locator("[data-animation-id]").evaluateAll((nodes) => nodes.map((node) => node.dataset.animationId))
    assert.ok(particleItems.length >= 1 && particleItems.every((id) => !motionItems.includes(id)), "动效与粒子互不重叠")
    await open(path, "motion")
    assert.equal(await page.locator('[data-animation-id][aria-selected="true"]').getAttribute("data-animation-id"), motionItems[1])
    assert.equal(await page.locator("#selected-key").textContent(), "动效设计")
    const search = page.locator('#animation-library input[role="searchbox"]')
    await search.fill("不存在的动画")
    await page.locator('.animation-library-tabs button').nth(1).click()
    const motionTab = page.locator('[data-animation-mode="motion"]')
    await motionTab.focus()
    await page.keyboard.press("End")
    await check(path, "particle")
    assert.equal(await search.inputValue(), "", "切换分类清除搜索，避免新分类看似为空")
    assert.equal(await page.locator('.animation-library-tabs button').first().getAttribute("aria-pressed"), "true")
    await page.locator('[data-workspace-page="overview"]').click()
    await page.locator('[data-workspace-page="animation"]').click()
    await check(path, "particle")
    assert.equal(await page.locator('[data-animation-mode="all"]').getAttribute("aria-pressed"), "true", "动画导航进入全部分类")
    assert.deepEqual(new Set(await page.locator("[data-animation-id]").evaluateAll(nodes => nodes.map(node => node.dataset.animationId))), new Set([...motionItems, ...particleItems]))
    assert.equal(await page.locator('#animation-stage .ui-animation-ruler > span').count(), 5)
    assert.ok(await page.locator('.animation-object-header .animation-object-path').textContent())
    const layouts = page.getByRole('combobox', { name: '动画预览布局' })
    if (await layouts.isVisible() && await layouts.locator('option').count() > 1) {
      const previous = await layouts.inputValue()
      const next = await layouts.locator('option').evaluateAll(options => options.find(option => !option.selected).value)
      await layouts.selectOption(next)
      assert.equal(await layouts.inputValue(), next)
      await check(path, "particle")
      assert.equal(await page.locator('[data-animation-mode="all"]').getAttribute("aria-pressed"), "true")
      await layouts.selectOption(previous)
    }
    await page.locator('[data-animation-mode="particle"]').focus()
    await page.keyboard.press("Home")
    await check(path, "particle")
    assert.equal(await page.locator('[data-animation-mode="all"]').getAttribute("aria-pressed"), "true")
    assert.deepEqual(new Set(await page.locator("[data-animation-id]").evaluateAll(nodes => nodes.map(node => node.dataset.animationId))), new Set([...motionItems, ...particleItems]), "全部同时显示动效与粒子")
    await open(path, "motion")
    await check(path, "motion")
    assert.equal(await page.locator('[data-animation-id][aria-selected="true"]').getAttribute("data-animation-id"), motionItems[1])
    await page.setViewportSize({ width: 900, height: 800 })
    assert.equal(await page.locator('#animation-library').isVisible(), true, "窄桌面同样可以直接切换分类")
    await page.locator('[data-animation-mode="particle"]').click()
    await check(path, "particle")
    assert.equal(await page.locator('#animation-stage').evaluate(node => node.scrollWidth > node.clientWidth), false, "窄桌面的播放器自动换行，不横向溢出")
    await back()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#mobile-project-toggle').click()
    assert.equal(await entry(path, "particle").isVisible(), true, "手机保留概览里的分类入口")
    await entry(path, "particle").click()
    assert.equal(await page.locator('#animation-library').isVisible(), false)
    assert.equal((await state()).mode, "particle")
    await page.setViewportSize({ width: 1600, height: 1000 })
    console.log(`${fixture.format}: resource grouping, two shared-path entries, selection, mode, rebuild, undo/redo, raw source and no image workspace passed`)
  }
  assert.deepEqual(errors, [])
  console.log("Animation navigation: SXI/BDS/BDI/BDA passed; pageerrors=0")
} finally {
  await browser.close()
  await server.close()
}
