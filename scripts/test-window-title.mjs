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
  assert.equal(await page.locator(".ui-app-brand, #app-brand-version").count(), 0)
  await page.evaluate(() => document.documentElement.classList.add("macos"))
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme })
    const top = await page.locator(".titlebar").evaluate(node => {
      const style = getComputedStyle(node)
      return parseFloat(style.paddingTop)
    })
    assert.equal(top, 32, "compact toolbar leaves room for the native window buttons")
    assert.equal(await page.locator(".titlebar").evaluate(node => node.getBoundingClientRect().height), 72)
    const surface = () => page.locator(".titlebar").evaluate(node => {
      const style = getComputedStyle(node)
      return { background: style.backgroundColor, blur: style.backdropFilter }
    })
    const glass = await surface()
    assert.equal(glass.background, await page.locator(".welcome-main").evaluate(node => getComputedStyle(node).backgroundColor), "titlebar uses the same background as the welcome page")
    assert.match(glass.blur, /blur\(24px\)/)
    await page.evaluate(() => document.documentElement.dataset.windowMaterial = "off")
    assert.doesNotMatch((await surface()).background, /rgba/, "disabling material restores an opaque titlebar")
    assert.equal((await surface()).background, await page.locator(".welcome-main").evaluate(node => getComputedStyle(node).backgroundColor))
    assert.equal((await surface()).blur, "none")
    const opaqueSurfaces = await page.evaluate(() => {
      const background = selector => getComputedStyle(document.querySelector(selector)).backgroundColor
      return {
        titlebar: background(".titlebar"), navigation: background("#workspace-navigation"),
        sidebar: background(".sidebar"), toolbar: background(".preview-toolbar"),
        control: background("#device-control"), fileActions: background("#source-file-toolbar"),
      }
    })
    assert.equal(opaqueSurfaces.navigation, opaqueSurfaces.titlebar, "opaque navigation follows the titlebar")
    assert.equal(opaqueSurfaces.sidebar, opaqueSurfaces.toolbar)
    assert.equal(opaqueSurfaces.control, opaqueSurfaces.fileActions)
    for (const [foreground, background] of [["control", "toolbar"]]) {
      const channels = value => value.match(/\d+/g).map(Number)
      const surface = channels(opaqueSurfaces[foreground])
      const underlay = channels(opaqueSurfaces[background])
      assert.ok(surface.every((channel, i) => Math.abs(channel - underlay[i]) >= 8), `${colorScheme}: ${foreground} remains distinct from ${background}`)
    }
    await page.evaluate(() => document.documentElement.dataset.windowMaterial = "on")
    assert.equal(await page.locator(".ui-app-brand, #app-brand-version").count(), 0)
  }
  assert.deepEqual(errors, [])
  console.log("window title: compact height, native button space, frosted surface and light/dark material toggle passed")
} finally {
  await browser.close()
  await server.close()
}
