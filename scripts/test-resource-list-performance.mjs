import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"
import { wav } from "../tests/helpers/ssf-fixture.mjs"

const files = unzipSync(bdsFixture())
files["light/res/btn.til"] = strToU8("[IMG0]\nSOURCE_RECT=0,0,2,2\n[IMG1]\nSOURCE_RECT=0,0,2,2\n")
files["light/res/default.css"] = strToU8(strFromU8(files["light/res/default.css"]) + Array.from({ length: 6240 }, (_, i) =>
  `\n[STYLE${i + 1000}]\nNM_IMG=btn,0\nHL_IMG=btn,1\nINFO=样式 ${i}\n`).join(""))
for (let i = 0; i < 12; i++) files[`light/res/sound_${i}.wav`] = wav(8000)
const fixture = Buffer.from(zipSync(files))
const output = ".ui-current/resource-list-performance"
mkdirSync(output, { recursive: true })
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41977, strictPort: false, hmr: false } })
await server.listen()
const results = []
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" })
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      await page.addInitScript(() => {
        window.allocations = new Set()
        const context = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function (...args) {
          window.allocations.add(this)
          return context.apply(this, args)
        }
        window.offsetReads = 0
        const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop")
        Object.defineProperty(HTMLElement.prototype, "offsetTop", { ...offset, get() {
          if (this.matches("#resource-gallery .ui-style-card")) window.offsetReads++
          return offset.get.call(this)
        } })
      })
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      assert.equal(await page.evaluate(async () => {
        const { createIcon } = await import("/src/icons.ts")
        const first = createIcon("palette", 14)
        first.classList.add("changed")
        first.firstElementChild.remove()
        const second = createIcon("palette", 14)
        return first !== second && !second.classList.contains("changed") && second.childElementCount > first.childElementCount
      }), true, "cached icons return independent clones")
      await page.locator("#browser-open").setInputFiles({ name: "large.bds", mimeType: "application/octet-stream", buffer: fixture })
      await page.waitForFunction(() => !document.querySelector("#open").disabled && !document.querySelector("#file-operation-dialog").open)
      await page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        window.reads = 0
        const getText = appState.archive.getText.bind(appState.archive)
        appState.archive.getText = path => { if (path.endsWith("default.css")) window.reads++; return getText(path) }
        const { visualResolver } = await import("/src/app/bda-documents.ts")
        const resolver = visualResolver()
        const imagePath = resolver.imagePath.bind(resolver)
        window.imageChecks = 0
        resolver.imagePath = (...args) => { window.imageChecks++; return imagePath(...args) }
      })
      const styles = await page.evaluate(async () => {
        window.allocations.clear()
        const start = performance.now()
        document.querySelector('[data-workspace-page="resources"]').click()
        const result = { open: performance.now() - start, reads: window.reads }
        await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
        result.painted = performance.now() - start
        result.allocations = window.allocations.size
        return result
      })
      const cards = page.locator("#resource-gallery .ui-style-card")
      assert.equal(await cards.first().getAttribute("aria-setsize"), "6246", "all filtered styles remain available")
      assert.ok(await cards.count() < 150, "opening a large gallery mounts only nearby rows")
      assert.ok(styles.reads < 10, "opening styles must not decode a stylesheet for every card")
      assert.ok(styles.allocations < 100, "offscreen cards must not allocate canvas contexts")
      const gallery = page.locator("#resource-gallery")
      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        await gallery.evaluate((grid, fraction) => { grid.scrollTop = fraction * (grid.scrollHeight - grid.clientHeight) }, fraction)
        await page.waitForFunction(() => {
          const grid = document.querySelector("#resource-gallery")
          const rect = grid.getBoundingClientRect()
          return [...grid.querySelectorAll(".ui-style-card")].some(card => {
            const bounds = card.getBoundingClientRect()
            return bounds.top >= rect.top && bounds.bottom <= rect.bottom
          })
        })
        assert.ok(await cards.count() < 150, "scrolling releases distant pages instead of accumulating cards")
      }
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#resource-gallery [data-style-id="7239"] canvas')
        return canvas?.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((value, at) => at % 4 === 3 && value)
      })
      const keyboard = await page.evaluate(() => {
        const card = document.querySelector('#resource-gallery .ui-style-card')
        window.offsetReads = 0
        card.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }))
        const unrelated = window.offsetReads
        card.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }))
        document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))
        const columns = getComputedStyle(document.querySelector('#resource-gallery')).gridTemplateColumns.split(' ').length
        const down = { reads: window.offsetReads, selected: document.querySelector('#resource-gallery [aria-selected="true"]').dataset.styleId,
          expected: document.querySelector(`#resource-gallery [aria-posinset="${columns + 1}"]`).dataset.styleId }
        window.offsetReads = 0
        const start = performance.now()
        document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }))
        return { milliseconds: performance.now() - start, reads: window.offsetReads, unrelated, down }
      })
      assert.equal(keyboard.unrelated, 0, "unrelated keys must not measure thousands of cards")
      assert.ok(keyboard.reads < 20, "keyboard navigation measures only the first grid row")
      assert.equal(keyboard.down.selected, keyboard.down.expected, "ArrowDown selects the next row")
      assert.ok(keyboard.down.reads < 20, "ArrowDown must not measure offscreen rows")
      assert.equal(await cards.last().getAttribute("aria-selected"), "true", "End selects the last style")
      await page.screenshot({ path: `${output}/${engine.name()}-styles.png` })
      await page.keyboard.press("Shift+Home")
      assert.equal(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.selectedResourceGalleryPaths.length), 6246, "range selection includes unmounted styles")
      await page.keyboard.press("Escape")
      await page.keyboard.press("Control+a")
      assert.equal(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.selectedResourceGalleryPaths.length), 6246, "select all includes unmounted styles")
      await page.keyboard.press("Escape")
      await gallery.evaluate(grid => { grid.scrollTop = grid.scrollHeight })
      await page.waitForFunction(() => document.querySelector('#resource-gallery [data-style-id="7239"]'))
      assert.ok(await cards.count() < 150, "grid stays windowed after jumping to the end")
      const search = await page.evaluate(() => {
        window.reads = 0
        const input = document.querySelector("#resource-search")
        const start = performance.now()
        input.value = "样式 6239"
        input.dispatchEvent(new Event("input", { bubbles: true }))
        return { milliseconds: performance.now() - start, reads: window.reads }
      })
      assert.equal(await cards.count(), 1)
      assert.equal(await cards.first().getAttribute("data-style-id"), "7239")
      assert.equal(search.reads, 0, "search reuses the parsed document")
      await page.locator('[data-workspace-page="overview"]').click()
      await page.locator('[data-workspace-page="resources"]').click()
      assert.equal(await cards.first().getAttribute("aria-setsize"), "6246", "reopening restores the full collection")
      assert.ok(await cards.count() < 150, "reopening does not rebuild all cards")
      const inventory = await page.evaluate(async () => {
        const { openResourceInventory } = await import("/src/app/resource-inventory.ts")
        window.reads = 0
        const start = performance.now()
        openResourceInventory()
        const list = document.querySelector('dialog[open] [role="listbox"]')
        window.firstRow = list.firstElementChild
        window.rebuilds = 0
        window.observer = new MutationObserver(records => window.rebuilds += records.filter(record => record.target === list).length)
        window.observer.observe(list, { childList: true })
        list.scrollTop = 1000
        return { milliseconds: performance.now() - start, reads: window.reads, checks: window.imageChecks, rows: list.childElementCount, rendered: list.querySelectorAll(".ui-list-item-text").length, scroll: list.scrollTop }
      })
      const dialog = page.getByRole("dialog", { name: "资源清单", exact: true })
      const list = dialog.getByRole("listbox")
      assert.ok(inventory.rendered < 100, "offscreen resource rows defer their contents")
      await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] [data-inventory-id$=".wav"] small')].filter(node => node.textContent.includes("1.00 s")).length === 12)
      const metadata = await list.evaluate(list => ({ rebuilds: window.rebuilds, reads: window.reads, checks: window.imageChecks, same: list.firstElementChild === window.firstRow, scroll: list.scrollTop }))
      assert.equal(metadata.rebuilds, 0, "audio metadata must not rebuild the list")
      assert.equal(metadata.checks, inventory.checks, "audio metadata must not rescan dependencies")
      assert.equal(metadata.reads, inventory.reads)
      assert.equal(metadata.same, true)
      assert.equal(metadata.scroll, inventory.scroll, "metadata preserves scroll position")
      const selectionChanges = await list.evaluate(async list => {
        const observer = new MutationObserver(() => {})
        observer.observe(list, { attributes: true, subtree: true, attributeFilter: ["aria-selected", "tabindex"] })
        list.children[20].click()
        const changes = observer.takeRecords().length
        observer.disconnect()
        return changes
      })
      assert.ok(selectionChanges <= 4, "selection updates only the old and new rows")
      await list.getByRole("option").last().scrollIntoViewIfNeeded()
      await page.waitForFunction(() => document.querySelector('dialog[open] [data-inventory-id="style:7239"] small')?.textContent.includes("未使用"))
      assert.ok(await list.locator(".ui-list-item-text").count() < 150, "scrolling renders the visible rows")
      await dialog.getByRole("button", { name: "未用", exact: true }).click()
      await dialog.getByRole("searchbox").fill("7239")
      assert.match(await list.innerText(), /样式 7239/)
      assert.equal(await page.evaluate(() => window.imageChecks), inventory.checks, "filters must not rescan dependencies")
      await dialog.getByRole("button", { name: "全部", exact: true }).click()
      await dialog.getByRole("searchbox").fill("1.00 s")
      assert.equal(await list.getByRole("option").count(), 12, "metadata remains searchable")
      await page.screenshot({ path: `${output}/${engine.name()}-inventory.png` })
      await dialog.getByRole("button", { name: "关闭", exact: true }).last().click()
      assert.deepEqual(errors, [])
      results.push({ engine: engine.name(), styles, keyboard, search, inventory, metadata })
      console.log(JSON.stringify(results.at(-1)))
    } finally { await browser.close() }
  }
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2))
} finally { await server.close() }
