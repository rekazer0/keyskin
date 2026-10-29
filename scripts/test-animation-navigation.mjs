// Real Playwright navigation: shared source files, independent animation views, undo/tree rebuilds.
import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { sxiAnimationFixture } from "../tests/helpers/sxi-animation-fixture.mjs"
import { bdaAnimatedSkinBytes, bdsBaseArchive } from "../tests/helpers/bda-animation-fixture.mjs"
import { SkinArchive } from "../src/skin.ts"
import { convertBdaArchive } from "../src/bda-convert.ts"

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
page.on("dialog", (dialog) => dialog.accept())
const baseURL = `http://127.0.0.1:${server.httpServer.address().port}/`
const entry = (path, mode) => page.locator(`.sidebar-overview button[data-path="${path}"][data-nav-mode="${mode}"]`)
// 动效设计 / 粒子设计占用左侧栏（动画列表）；回到概览要先点列表顶部的返回。
const back = async () => {
  if (await page.locator("body.animation-workspace").count()) await page.locator('#animation-library button[aria-label="返回布局"]').click()
}
const open = async (path, mode) => {
  await back()
  await entry(path, mode).click()
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
    assert.equal(await entry(path, mode).evaluate((node) => node.classList.contains("selected")), true)
    assert.equal(await page.locator(".sidebar-overview button.selected").count(), 1)
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
        assert.equal(await button.locator(".nav-label").textContent(), `${mode === "motion" ? "动效设计" : "粒子设计"}${fixture.paths.length > 1 ? ` · ${path.split("/").pop()}` : ""}`)
        assert.equal(await button.evaluate((node) => node.closest(".nav-group").dataset.overviewGroup), "资源配置")
        if (fixture.format === "sxi") assert.equal(await button.locator(".nav-meta").textContent(), "skin.json")
        await back()
        await button.click()
        await check(path, mode)
        assert.equal(await page.locator("body.animation-workspace #animation-library .ui-listbox").count(), 1, "动画列表在左侧栏")
        assert.equal(await page.locator("#animation-stage .ui-animation-player").count(), 1, "播放器在画布上")
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
    await page.locator('[data-sidebar-view="source"]').click()
    await page.evaluate(async (path) => (await import("/src/app/source-files.ts")).ensureSourcePathRendered(path), rawPath)
    await page.locator(`.raw-files button[data-path="${rawPath}"]`).click()
    await check(rawPath, "all", true)
    await page.locator('[data-sidebar-view="overview"]').click()
    await entry(path, "particle").click()
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
    await page.locator('[data-inspector-tab="properties"]').click()
    await open(path, "motion")
    const motionItems = await page.locator("[data-animation-id]").evaluateAll((nodes) => nodes.map((node) => node.dataset.animationId))
    await page.locator(`[data-animation-id="${motionItems[1]}"]`).click()
    await open(path, "particle")
    const particleItems = await page.locator("[data-animation-id]").evaluateAll((nodes) => nodes.map((node) => node.dataset.animationId))
    assert.ok(particleItems.length >= 1 && particleItems.every((id) => !motionItems.includes(id)), "动效与粒子互不重叠")
    await open(path, "motion")
    assert.equal(await page.locator('[data-animation-id][aria-selected="true"]').getAttribute("data-animation-id"), motionItems[1])
    assert.equal(await page.locator("#selected-key").textContent(), "动效设计")
    console.log(`${fixture.format}: resource grouping, two shared-path entries, selection, mode, rebuild, undo/redo, raw source and no image workspace passed`)
  }
  assert.deepEqual(errors, [])
  console.log("Animation navigation: SXI/BDS/BDI/BDA passed; pageerrors=0")
} finally {
  await browser.close()
  await server.close()
}
