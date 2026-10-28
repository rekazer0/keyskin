// A Palm `.sxi` opened in the editor must export to BDI, BDS and BDA through the real menu.
// The .sxi canvas is drawn from skin.json itself and the BDI/BDS from their exported INI, yet the
// two previews have to match pixel for pixel; the BDA package only gets a reopen smoke check.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"
import { SkinArchive } from "../src/skin.ts"
import { buildSxiZip } from "../src/palm/palm-export.ts"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"

const sxiBytes = buildSxiZip(SkinArchive.open(bdsFixture())).bytes
const server = await createServer({ root: new URL("..", import.meta.url).pathname, logLevel: "error", server: { port: 41819, strictPort: false, host: "127.0.0.1" } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true, bypassCSP: true })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
page.on("dialog", (dialog) => dialog.accept())

const closeDialog = async () => {
  await page.waitForFunction(() => {
    const dialog = document.querySelector("#file-operation-dialog")
    return !dialog?.open || !document.querySelector("#file-operation-close")?.disabled
  }, null, { timeout: 60000 })
  const close = page.locator("#file-operation-dialog[open] #file-operation-close")
  if (await close.isVisible().catch(() => false)) await close.click()
}
const open = async (name, bytes) => {
  await page.locator("#browser-open").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) })
  await page.waitForFunction(() => !document.querySelector("#open")?.disabled)
  await closeDialog()
}
const choose = async (theme, orientation, path) => {
  await page.evaluate(async ({ theme, orientation, path }) => {
    const { appState } = await import("/src/app/state.ts")
    const { theme: themeInput, orientation: orientationInput } = await import("/src/app/dom.ts")
    const { selectFile } = await import("/src/app/navigation.ts")
    themeInput.value = theme
    orientationInput.value = orientation
    // The .sxi board the exported layout file comes from is a part of skin.json.
    if (appState.archive.format === "sxi") {
      const { palmBoardTypes, sxiBoardAddress } = await import("/src/app/sxi-documents.ts")
      const { boardFileName } = await import("/src/palm/sxi-layout.ts")
      const type = palmBoardTypes().find((item) => path.endsWith(`/${boardFileName(item)}`))
      if (!type) throw new Error(`no Palm board exports as ${path}`)
      path = sxiBoardAddress(type)
    }
    appState.selectedPath = path
    selectFile(path)
  }, { theme, orientation, path })
  await page.waitForTimeout(300)
}
const snapshot = async () => {
  const state = await page.evaluate(async () => {
  const { preview, toolbarPreview, candidateBackgroundPreview } = await import("/src/app/canvas-interaction.ts")
  const previews = [preview, toolbarPreview, candidateBackgroundPreview]
  await Promise.all(previews.map((item) => item.resolver?.ready?.()))
  previews.forEach((item) => item.draw())
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await Promise.all(previews.map((item) => item.rendered()))
  const canvas = document.createElement("canvas")
  canvas.width = preview.canvas.width
  canvas.height = preview.canvas.height + toolbarPreview.canvas.height
  const context = canvas.getContext("2d")
  context.drawImage(candidateBackgroundPreview.canvas, 0, 0)
  context.drawImage(toolbarPreview.canvas, 0, 0)
  context.drawImage(preview.canvas, 0, toolbarPreview.canvas.height)
  return {
    png: canvas.toDataURL("image/png"),
    keys: preview.keys.map(({ center, rect }) => ({ center, rect })),
  }
  })
  return { hash: createHash("sha256").update(state.png).digest("hex"), keys: state.keys }
}
const openMenu = async () => {
  const menu = page.locator(".pen-file-menu")
  if (!(await menu.evaluate((node) => node.open))) await menu.locator("> summary").click()
}
const download = async (trigger) => {
  const pending = page.waitForEvent("download", { timeout: 180000 })
  pending.catch(() => {})
  await trigger()
  const tap = page.locator("#file-operation-dialog[open] button.primary", { hasText: "下载" })
  const tapped = tap.waitFor({ state: "visible", timeout: 180000 }).then(() => "tap")
  tapped.catch(() => {})
  const result = await Promise.race([pending, tapped])
  if (result === "tap") await tap.click()
  return pending
}

// The boards the .sxi has (full26Pinyin and selChinese), by the layout files they export as.
const views = [
  ["light", "port", "light/skin/port/py_26.ini"],
  ["light", "port", "light/skin/port/sel_ch.ini"],
]
try {
  await page.addInitScript(() => {
    delete window.showSaveFilePicker
    window.showSaveFilePicker = undefined
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await open("test.sxi", sxiBytes)

  const targets = await page.evaluate(() => [...document.querySelectorAll("[data-export-format]")]
    .map((button) => `${button.dataset.exportFormat}${button.dataset.bdaPlatform ? `-${button.dataset.bdaPlatform}` : ""}:${button.hidden ? "hidden" : "shown"}`))
  assert.deepEqual(targets, ["bdi:shown", "bds:shown", "bda-ios:shown", "bda-android:shown", "sxi:shown", "ssf:hidden"])

  const source = new Map()
  for (const [theme, orientation, path] of views) {
    await choose(theme, orientation, path)
    source.set(path, await snapshot())
    assert.ok(source.get(path).keys.length > 0, `${path}: the .sxi board draws its keys`)
  }

  const exported = {}
  for (const [format, platform] of [["bdi", ""], ["bds", ""], ["bda", "android"]]) {
    const file = await download(async () => {
      await openMenu()
      await page.locator(`.pen-file-menu [data-export-format="${format}"]${platform ? `[data-bda-platform="${platform}"]` : ""}`).click()
    })
    exported[format] = readFileSync(await file.path())
    await closeDialog()
  }

  for (const format of ["bdi", "bds"]) {
    await open(`converted.${format}`, exported[format])
    for (const [theme, orientation, path] of views) {
      await choose(theme, orientation, path)
      assert.deepEqual(await snapshot(), source.get(path), `${format} ${path}: geometry and every canvas pixel match the .sxi`)
    }
  }
  await open("converted.bda", exported.bda)
  const bda = await page.evaluate(async () => {
    const { preview } = await import("/src/app/canvas-interaction.ts")
    await preview.resolver?.ready?.()
    return { keys: preview.keys.length, size: [preview.panelWidth, preview.panelHeight] }
  })
  assert.match(await page.evaluate(() => document.querySelector("#panel-status")?.textContent ?? ""), /1080 × 641/)
  assert.ok(bda.keys > 10)
  assert.deepEqual(errors, [])
  console.log("SXI export: menu offers BDI/BDS/BDA, BDI and BDS previews match the .sxi pixel for pixel after download and reopen; BDA reopen smoke passed")
} catch (error) {
  await page.screenshot({ path: "/tmp/bdi-sxi-conversion-failure.png" }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await server.close()
}
