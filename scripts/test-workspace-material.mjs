import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41908, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const colorScheme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    const open = () => page.locator('#workspace-navigation [data-settings-entry="settings"]').click()
    const fill = async (id, value) => {
      const field = page.locator(`#${id}`)
      await field.fill(value)
      await field.dispatchEvent("input")
      await field.dispatchEvent("change")
    }
    const surfaces = () => page.evaluate(() => Object.fromEntries(["navigation", "titlebar"].map(name => [name, getComputedStyle(document.querySelector(name === "navigation" ? "#workspace-navigation" : ".titlebar")).backgroundColor])))
    await open()
    assert.equal(await page.locator("#window-material").isChecked(), true)
    const materialSlider = page.getByRole("slider", { name: "材质不透明度" })
    const navigationSlider = page.getByRole("slider", { name: "左导航栏不透明度" })
    assert.equal(await materialSlider.inputValue(), "93")
    assert.equal(await navigationSlider.inputValue(), "64")
    assert.equal(await materialSlider.evaluate(slider => getComputedStyle(slider).appearance), "none")
    const before = await surfaces()
    await navigationSlider.press("ArrowRight")
    assert.equal(await navigationSlider.getAttribute("aria-valuetext"), "65%")
    await fill("workspace-navigation-opacity", "40")
    const changed = await surfaces()
    assert.notEqual(changed.navigation, before.navigation)
    assert.equal(changed.titlebar, before.titlebar, "navigation opacity is independent of the titlebar")
    assert.equal(await page.locator("#workspace-navigation-opacity-value").textContent(), "40%")
    await fill("window-material-opacity", "30")
    const globalChanged = await surfaces()
    assert.equal(globalChanged.navigation, changed.navigation, "global opacity does not change navigation opacity")
    assert.notEqual(globalChanged.titlebar, changed.titlebar)
    await page.locator("#settings-cancel").click()
    await page.locator("#settings-workspace").waitFor({ state: "hidden" })
    assert.deepEqual(await surfaces(), before, "cancel restores both surfaces")
    await open()
    await fill("workspace-navigation-opacity", "72")
    await page.locator("#settings-save").click()
    await page.locator("#settings-workspace").waitFor({ state: "hidden" })
    await page.reload()
    await page.waitForFunction(() => document.querySelector("#workspace-navigation-opacity").value === "72")
    assert.equal(await page.evaluate(() => localStorage.getItem("workspace-navigation-opacity")), "72")
    await open()
    await page.locator("#window-material").uncheck()
    assert.equal(await page.locator("#workspace-navigation-opacity").isDisabled(), true)
    await page.locator("#settings-cancel").click()
    await page.locator("#settings-workspace").waitFor({ state: "hidden" })
    assert.equal(await page.locator("#workspace-navigation-opacity").isDisabled(), false)
    await page.locator("html").evaluate(root => root.classList.add("macos"))
    await open()
    const settingsSurfaces = () => page.evaluate(() => Object.fromEntries(
      [".titlebar", ".settings-header", "main", "#settings-workspace", ".settings-layout", ".settings-footer", "#workspace-navigation"].map(selector => [selector, getComputedStyle(document.querySelector(selector)).backgroundColor]),
    ))
    const backdrop = selector => page.locator(selector).evaluate(node => getComputedStyle(node).backdropFilter)
    const transparent = "rgba(0, 0, 0, 0)"
    const glass = await settingsSurfaces()
    for (const selector of [".titlebar", ".settings-header"]) {
      assert.equal(await backdrop(selector), "none", `${selector} has no extra blur`)
    }
    assert.match(await backdrop("#workspace-navigation"), /blur\(/, "navigation retains its blur")
    assert.equal(glass.main, transparent)
    assert.equal(glass["#settings-workspace"], glass.main, "the titlebar has no underlying web fill")
    for (const opacity of ["20", "60", "100"]) {
      await fill("window-material-opacity", opacity)
      const adjusted = await settingsSurfaces()
      for (const selector of [".titlebar", ".settings-header", ".settings-footer"]) {
        assert.equal(adjusted[selector], adjusted[".settings-layout"], `${selector} matches content at ${opacity}%`)
      }
      if (opacity === "100") assert.match(adjusted[".settings-header"], /^rgb\(/)
      else assert.ok(adjusted[".settings-header"].endsWith(`, ${Number(opacity) / 100})`), `titlebar has ${opacity}% opacity`)
      assert.equal(adjusted["#workspace-navigation"], glass["#workspace-navigation"], "navigation remains independent of content opacity")
    }
    await page.locator("#window-material").uncheck()
    const materialOff = await settingsSurfaces()
    assert.match(materialOff[".titlebar"], /^rgb\(/, "turning off the material keeps the titlebar opaque")
    assert.equal(materialOff[".settings-header"], materialOff[".titlebar"])
    await page.locator("#settings-cancel").click()
    await page.close()
    console.log(`workspace material ${colorScheme}: independent opacity, macOS titlebar, cancel, save and reload passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
