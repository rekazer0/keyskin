import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"
import { unzipSync, zipSync, strToU8 } from "fflate"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"

const files = unzipSync(bdsFixture())
const image = Object.entries(files).find(([path]) => path.endsWith(".png"))[1]
for (let index = 0; index < 600; index++) files[`light/res/asset_${String(index).padStart(4, "0")}.png`] = image
files["light/res/zzz_broken.png"] = strToU8("invalid image")
files["light/res/anim.ini"] = strToU8("[ANIM1]\nCATEGORY=0\nTYPE=1\nDURATION=2000\nFROM=0\nTO=1\nINFO=长预览\n")
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41913, strictPort: false, hmr: false } })
await server.listen()
const output = ".ui-current/workspace-polish"
mkdirSync(output, { recursive: true })
const results = []
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      await page.addInitScript(() => {
        window.previewUrls = new Set()
        window.previewCreated = 0
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
        URL.createObjectURL = blob => {
          const url = create(blob)
          window.previewUrls.add(url)
          window.previewCreated++
          return url
        }
        URL.revokeObjectURL = url => { window.previewUrls.delete(url); revoke(url) }
      })
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      await page.locator("#browser-open").setInputFiles({ name: "polish.bds", mimeType: "application/octet-stream", buffer: Buffer.from(zipSync(files)) })
      await page.waitForFunction(() => !document.querySelector("#open").disabled && !document.querySelector("#file-operation-dialog").open)
      const changed = () => page.evaluate(async () => [...(await import("/src/app/state.ts")).appState.archive.changed])
      const before = await changed()
      await page.locator('[data-workspace-page="resources"]').click()
      const filter = page.locator('#resource-list-view button[data-style-kind="image"]')
      await filter.evaluate(node => { window.originalFilter = node })
      await filter.click()
      assert.equal(await page.evaluate(() => window.originalFilter.isConnected), true, "filter changes retain the control node")
      await filter.focus()
      await page.keyboard.press("Home")
      assert.equal(await page.locator('#resource-list-view button[data-style-kind="all"]').evaluate(node => node === document.activeElement), true, "filter navigation preserves focus")
      await page.locator("#resource-search").fill("not-present")
      assert.equal(await page.locator("#resource-gallery > .ui-empty").isVisible(), true)
      await page.keyboard.press("Escape")
      await page.locator('[data-resource-page="style"]').focus()
      await page.keyboard.press("ArrowRight")
      await page.locator("#resource-gallery .ui-image-card-size:not([hidden])").first().waitFor()
      const opening = await page.evaluate(() => ({ cards: document.querySelectorAll("#resource-gallery .ui-image-card").length, created: window.previewCreated, alive: window.previewUrls.size }))
      assert.ok(opening.cards >= 600)
      assert.ok(opening.created < 100 && opening.alive < 100, JSON.stringify(opening))
      const last = page.locator('#resource-gallery [data-path$="/zzz_broken.png"]')
      await last.scrollIntoViewIfNeeded()
      await last.locator(".ui-empty:not([hidden])").waitFor()
      await page.locator("#resource-search").fill("asset_0001")
      await page.waitForFunction(() => document.querySelectorAll("#resource-gallery .ui-image-card").length === 1 && window.previewUrls.size < 15)
      assert.match(await page.locator("#resource-gallery .ui-image-card").getAttribute("data-path"), /\/asset_0001\.png$/)
      await page.keyboard.press("Escape")
      await page.locator('[data-workspace-page="overview"]').click()
      await page.getByRole("button", { name: "编辑模式", exact: true }).click()
      await page.locator('[data-workspace-page="tools"]').click()
      const tools = page.locator("#workspace-tools-dialog")
      assert.match(await tools.locator("#workspace-tools-context").textContent(), /BDS.*编辑模式/)
      assert.equal(await tools.locator(".ui-section:not([hidden])").count(), 2)
      await tools.locator('[data-workspace-tool="panel-scale"]').focus()
      await page.keyboard.press("End")
      assert.equal(await tools.locator('[data-workspace-tool="adapt-ios26"]').evaluate(node => node === document.activeElement), true)
      await page.screenshot({ path: `${output}/${engine.name()}-tools.png` })
      await tools.locator('[data-workspace-tool="panel-scale"]').click()
      await page.locator("#panel-scale-dialog").waitFor({ state: "visible" })
      await page.keyboard.press("Escape")
      await page.locator("#panel-scale-dialog").waitFor({ state: "hidden" })
      await page.locator('[data-workspace-page="animation"]').click()
      const library = page.locator("#animation-library")
      const search = library.getByRole("searchbox")
      await search.fill("no-such-animation")
      assert.equal(await library.locator('.ui-pane-header .ui-badge').textContent(), "0 / 1")
      assert.equal(await library.locator('.animation-library-pane:not([hidden]) [data-search-empty]:not([hidden])').isVisible(), true)
      assert.equal(await library.locator('[data-animation-id]').first().isVisible(), false, "hidden cards must disappear visually")
      await page.keyboard.press("Escape")
      assert.equal(await search.inputValue(), "")
      assert.equal(await library.locator('.ui-pane-header .ui-badge').textContent(), "1")
      assert.equal(await library.locator('[data-animation-id]:not([hidden])').first().getAttribute("tabindex"), "0")
      const handle = page.getByRole("slider", { name: "调整动画预览高度" })
      await page.waitForFunction(() => Number(document.querySelector('.animation-stage-resize-handle').getAttribute("aria-valuenow")) > 0)
      await handle.focus()
      await page.keyboard.press("End")
      assert.equal(await handle.getAttribute("aria-valuenow"), await handle.getAttribute("aria-valuemax"))
      await handle.dblclick()
      const player = page.locator("#animation-stage .ui-animation-player")
      const play = player.getByRole("button", { name: "播放预览", exact: true })
      await play.waitFor({ state: "visible" })
      await page.waitForFunction(() => !document.querySelector('#animation-stage [aria-label="播放预览"]').disabled)
      await player.getByRole("button", { name: "循环预览", exact: true }).click()
      await play.click()
      await player.evaluate(root => {
        window.staticMutations = 0
        window.observedFrames = 0
        const observer = new MutationObserver(records => { window.staticMutations += records.length })
        for (const target of root.querySelectorAll(".ui-animation-note, .ui-animation-transport button")) observer.observe(target, { childList: true, subtree: true, attributes: true })
        window.playbackObserver = observer
        const frame = () => { window.observedFrames++; if (window.observedFrames < 15) requestAnimationFrame(frame) }
        requestAnimationFrame(frame)
      })
      await page.waitForFunction(() => window.observedFrames >= 15)
      const playback = await page.evaluate(() => ({ frames: window.observedFrames, staticMutations: window.staticMutations }))
      assert.equal(playback.staticMutations, 0, "playback never rebuilds static controls or notes")
      await player.getByRole("button", { name: "暂停预览", exact: true }).click()
      for (const width of [1440, 812]) for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ colorScheme: theme })
        assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
        assert.ok(await page.locator('.workspace').evaluate(node => node.clientWidth) >= 260, "narrow desktop keeps a usable canvas and player")
        const overflowing = await page.locator('#document-fields .ui-field').evaluateAll(rows => rows.filter(row => row.clientWidth && row.scrollWidth > row.clientWidth + 1).map(row => row.textContent))
        assert.deepEqual(overflowing, [], "animation fields fit the inspector at every desktop width")
        await page.screenshot({ path: `${output}/${engine.name()}-${width}-${theme}-animation.png` })
      }
      assert.deepEqual(await changed(), before, "browsing, resizing and playback never modify the skin")
      assert.deepEqual(errors, [])
      results.push({ engine: engine.name(), opening, playback })
      console.log(JSON.stringify(results.at(-1)))
    } finally { await browser.close() }
  }
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2))
} finally { await server.close() }
