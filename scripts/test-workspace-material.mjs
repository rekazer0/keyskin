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
    const open = () => page.locator('#workspace-navigation [data-app-dialog="settings"]').click()
    const fill = async (id, value) => {
      const field = page.locator(`#${id}`)
      await field.fill(value)
      await field.dispatchEvent("input")
      await field.dispatchEvent("change")
    }
    const surfaces = () => page.evaluate(() => Object.fromEntries(["navigation", "titlebar"].map(name => [name, getComputedStyle(document.querySelector(name === "navigation" ? "#workspace-navigation" : ".titlebar")).backgroundColor])))
    await open()
    const before = await surfaces()
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
    await page.locator("#settings-dialog").waitFor({ state: "hidden" })
    assert.deepEqual(await surfaces(), before, "cancel restores both surfaces")
    await open()
    await fill("workspace-navigation-opacity", "64")
    await page.locator("#settings-save").click()
    await page.locator("#settings-dialog").waitFor({ state: "hidden" })
    await page.reload()
    await page.waitForFunction(() => document.querySelector("#workspace-navigation-opacity").value === "64")
    assert.equal(await page.evaluate(() => localStorage.getItem("workspace-navigation-opacity")), "64")
    await open()
    await page.locator("#window-material").uncheck()
    assert.equal(await page.locator("#workspace-navigation-opacity").isDisabled(), true)
    await page.locator("#settings-cancel").click()
    await page.locator("#settings-dialog").waitFor({ state: "hidden" })
    assert.equal(await page.locator("#workspace-navigation-opacity").isDisabled(), false)
    await page.close()
    console.log(`workspace material ${colorScheme}: independent opacity, cancel, save and reload passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
