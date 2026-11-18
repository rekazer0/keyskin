import assert from "node:assert/strict"
import { mkdirSync, readFileSync } from "node:fs"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"
import { strToU8, unzipSync, zipSync } from "fflate"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"

const files = unzipSync(bdsFixture())
const lightFont = readFileSync("public/fonts/inter-latin.woff2")
const darkFont = readFileSync("public/fonts/ibm-plex-mono-400.woff2")
for (const mode of ["light", "dark"]) {
  files[`${mode}/res/default.css`] = strToU8("[GLOBAL]\nFONT_PATH=Shared.ttf\n[STYLE1]\nFONT_NAME=Shared\nFONT_SIZE=40\n")
  files[`${mode}/res/Shared.ttf`] = mode === "light" ? lightFont : darkFont
}
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41924, strictPort: false, hmr: false } })
await server.listen()
mkdirSync(".ui-current", { recursive: true })
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce" })
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      const finish = async () => {
        await page.waitForFunction(() => !document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled)
        const close = page.locator("#file-operation-dialog[open] #file-operation-close")
        if (await close.isVisible()) await close.click()
      }
      const snapshot = () => page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        return {
          undo: appState.undoStack.length,
          fonts: appState.archive.names().filter(path => /\.(ttf|otf|ttc)$/i.test(path)),
          light: appState.archive.getText("light/skin/res/default.css"),
          dark: appState.archive.getText("dark/skin/res/default.css"),
        }
      })
      const undo = () => page.evaluate(async () => (await import("/src/app/edit-history.ts")).undo())
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      await page.locator("#browser-open").setInputFiles({ name: "字体.bds", mimeType: "application/octet-stream", buffer: Buffer.from(zipSync(files)) })
      await page.waitForFunction(() => !document.querySelector("#open").disabled)
      await finish()
      await page.locator('[data-workspace-page="resources"]').click()
      await page.locator('[data-resource-catalog="font"]').click()
      const cards = page.locator('#resource-catalog [role="option"]')
      const selected = page.locator('#resource-catalog [aria-selected="true"]')
      assert.equal(await cards.count(), 1)
      assert.match(await cards.first().textContent(), /浅色/)
      assert.equal(await page.locator("#resource-upload").isVisible(), true)
      assert.equal(await page.locator("#resource-upload").isDisabled(), true)
      await cards.first().click()
      assert.equal(await page.locator("#resource-download").isDisabled(), false)
      assert.equal(await page.locator("#resource-delete").isDisabled(), true)
      await page.getByRole("button", { name: "编辑模式", exact: true }).click()
      assert.equal(await cards.count(), 1, "changing mode preserves the font catalog")
      await cards.first().click()
      await page.waitForFunction(() => document.querySelector('#style-detail-fields canvas[data-size="lg"]')?.dataset.fontFamily)
      const preview = await page.locator('#style-detail-fields canvas[data-size="lg"]').evaluate(canvas => canvas.toDataURL())
      const before = await snapshot()
      await page.locator('[data-font-theme="dark"]').click()
      assert.equal(await page.locator("#resource-download").isDisabled(), true)
      assert.equal(await page.locator("#resource-detail").isVisible(), false)
      await cards.first().click()
      assert.match(await selected.textContent(), /深色/)
      assert.match(await page.locator("#resource-meta").textContent(), /^dark\//)
      await page.waitForFunction(() => document.querySelector('#style-detail-fields canvas[data-size="lg"]')?.dataset.fontFamily)
      assert.notEqual(await page.locator('#style-detail-fields canvas[data-size="lg"]').evaluate(canvas => canvas.toDataURL()), preview, "mode previews use their own actual font bytes")
      assert.deepEqual(await snapshot(), before, "browsing mode does not write the archive")
      await page.evaluate(() => { window.showSaveFilePicker = undefined })
      const downloadEvent = page.waitForEvent("download")
      await page.locator("#resource-download").click()
      const download = await downloadEvent
      assert.equal(download.suggestedFilename(), "Shared.ttf")
      assert.deepEqual(readFileSync(await download.path()), darkFont)
      await finish()

      // The same filename in another mode is a different resource.
      await page.locator("#resource-delete").click()
      let state = await snapshot()
      assert.deepEqual(state.fonts, ["light/skin/res/Shared.ttf"])
      assert.equal(state.light, before.light)
      assert.doesNotMatch(state.dark, /FONT_(PATH|NAME)/)
      assert.equal(state.undo, before.undo + 1)
      await undo()
      assert.deepEqual(await snapshot(), before)
      assert.equal(await cards.count(), 1)

      await page.locator("#resource-upload-input").setInputFiles({ name: "Added.ttf", mimeType: "font/ttf", buffer: lightFont })
      await finish()
      state = await snapshot()
      assert.ok(state.fonts.includes("dark/skin/res/Added.ttf"))
      assert.ok(!state.fonts.includes("light/skin/res/Added.ttf"))
      assert.match(await page.locator("#resource-meta").textContent(), /dark\/skin\/res\/Added.ttf$/)
      assert.equal(state.undo, before.undo + 1)
      await undo()
      assert.deepEqual(await snapshot(), before)

      await page.locator('[data-font-theme="light"]').click()
      await page.locator("#resource-list-view").evaluate((host, data) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([Uint8Array.from(data)], "Dropped.otf", { type: "font/otf" }))
        host.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }))
      }, [...darkFont])
      await finish()
      state = await snapshot()
      assert.ok(state.fonts.includes("light/skin/res/Dropped.otf"))
      assert.ok(!state.fonts.includes("dark/skin/res/Dropped.otf"))
      assert.equal(state.undo, before.undo + 1)
      await cards.filter({ hasText: "Dropped.otf" }).click()
      await page.locator("#resource-search").fill("no-match")
      assert.equal(await page.locator("#resource-download").isDisabled(), true)
      assert.equal(await page.locator("#resource-delete").isDisabled(), true)
      await page.locator("#resource-search").fill("")
      await undo()
      assert.deepEqual(await snapshot(), before)
      const rejected = await page.evaluate(async () => {
        const { uploadResourceFiles } = await import("/src/app/resource-transfer.ts")
        try {
          await uploadResourceFiles([new File([new Uint8Array([0, 1, 2])], "Broken.ttf")])
          return false
        } catch { return true }
      })
      assert.equal(rejected, true)
      assert.deepEqual(await snapshot(), before, "a broken font never commits")

      // The inspector import and default picker use the catalog's mode too.
      await page.locator('[data-font-theme="dark"]').click()
      await cards.first().click()
      await page.locator("#font-file-picker").click()
      const picker = page.getByRole("dialog", { name: "选择皮肤字体", exact: true })
      await picker.locator('[data-font-value=""]').click()
      await picker.getByRole("button", { name: "应用", exact: true }).click()
      assert.equal((await snapshot()).light, before.light)
      assert.doesNotMatch((await snapshot()).dark, /FONT_PATH/)
      await undo()
      await cards.first().click()
      await page.locator("#font-import").click({ noWaitAfter: true })
      await page.locator("#font-import-input").setInputFiles({ name: "Inspector.ttf", mimeType: "font/ttf", buffer: lightFont })
      await page.waitForFunction(async () => (await import("/src/app/state.ts")).appState.archive.names().includes("dark/skin/res/Inspector.ttf"))
      state = await snapshot()
      assert.equal(state.light, before.light)
      assert.match(state.dark, /FONT_PATH=Inspector.ttf/)
      await undo()
      assert.deepEqual(await snapshot(), before)
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        for (const width of [1600, 812]) {
          await page.setViewportSize({ width, height: 1000 })
          await cards.first().click()
          await page.waitForFunction(() => document.querySelector('#style-detail-fields canvas[data-size="lg"]')?.dataset.fontFamily)
          assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
          assert.equal(await page.locator("#resource-upload").isVisible(), true)
          assert.equal(await page.locator("#resource-download").isVisible(), true)
          assert.equal(await page.locator("#resource-delete").isVisible(), true)
          await page.screenshot({ path: `.ui-current/fonts-${engine.name()}-${colorScheme}-${width}.png` })
        }
      }
      assert.deepEqual(errors, [])
      console.log(`${engine.name()}: font modes, upload, drop, preview, download, delete, reference isolation and undo passed`)
    } finally { await browser.close() }
  }
} finally { await server.close() }
