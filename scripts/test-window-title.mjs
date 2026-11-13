import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"

const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"))
assert.equal(config.app.windows[0].hiddenTitle, true)
assert.equal(config.app.windows[0].titleBarStyle, "Overlay")
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41822, strictPort: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.waitForSelector(".template-card")
  const brand = page.locator(".ui-app-brand")
  assert.equal(await brand.isVisible(), false, "browser keeps the existing toolbar")
  for (const [version, display] of [
    ["2.0.0-beta9", "v2.0 beta 9"],
    ["2.0.0-beta10", "v2.0 beta 10"],
    ["2.0.0", "v2.0"],
    ["2.1.3", "v2.1.3"],
    ["2.1.3-rc2", "v2.1.3 rc 2"],
  ]) {
    await page.evaluate(async version => {
      document.querySelector("#about-update").dataset.currentVersion = version
      const { wireWindowControls } = await import("/src/app/window-controls.ts")
      wireWindowControls()
    }, version)
    assert.equal(await page.locator("#app-brand-version").textContent(), display)
  }
  await page.evaluate(() => document.documentElement.classList.add("macos"))
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme })
    const style = await brand.evaluate(node => {
      const name = getComputedStyle(node.querySelector("strong"))
      const version = getComputedStyle(node.querySelector("span"))
      const bar = node.closest("header").getBoundingClientRect()
      const box = node.getBoundingClientRect()
      return { nameColor: name.color, versionColor: version.color, nameWeight: name.fontWeight, versionWeight: version.fontWeight,
        font: version.fontFamily, alignment: getComputedStyle(node).alignItems, height: box.height,
        left: box.left, bottom: box.bottom, toolbarTop: bar.bottom - bar.height + parseFloat(getComputedStyle(node.closest("header")).paddingTop) }
    })
    assert.equal(await brand.isVisible(), true)
    assert.notEqual(style.nameColor, style.versionColor)
    assert.equal(style.nameWeight, "600")
    assert.equal(style.versionWeight, "400")
    assert.match(style.font, /JetBrains Mono/)
    assert.equal(style.alignment, "baseline", "name and version share a text baseline")
    assert.equal(style.height, 32, "title centers on the native window buttons at 16px")
    assert.ok(style.left >= 80, "title leaves room for the native window buttons")
    assert.ok(style.bottom <= style.toolbarTop, "title stays above the editor toolbar")
  }
  assert.equal(await brand.locator("[data-tauri-drag-region]").count(), 2)
  assert.deepEqual(errors, [])
  console.log("window title: version format, macOS layout, light/dark styles and browser visibility passed")
} finally {
  await browser.close()
  await server.close()
}
