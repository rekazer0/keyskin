import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41912, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
mkdirSync(".ui-current", { recursive: true })
try {
  for (const colorScheme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme })
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.addInitScript(() => {
      localStorage.setItem("sidebar-view-visible", "off")
      localStorage.setItem("inspector-tabs-visible", "on")
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#new-project-form [data-template="official-android-bds"]').click()
    await page.locator(".canvas-wrap:not(.empty)").waitFor()
    const close = page.locator("#file-operation-dialog[open] #file-operation-close")
    await page.waitForFunction(() => !document.querySelector("#open").disabled)
    if (await close.isVisible()) await close.click()
    const rail = page.locator("#workspace-navigation")
    assert.equal(await page.locator(".sidebar > .pane-heading").isVisible(), false)
    assert.equal(await page.locator(".inspector-tabs").isVisible(), false)
    assert.equal(await page.locator("#sidebar-view-visible, #inspector-tabs-visible").count(), 0)
    const changes = () => page.evaluate(async () => [...(await import("/src/app/state.ts")).appState.archive.changed])
    const before = await changes()
    await rail.getByRole("button", { name: "源代码", exact: true }).click()
    await page.locator("#source-editor").waitFor({ state: "visible" })
    assert.equal(await page.locator(".raw-files").isVisible(), true)
    assert.equal(await page.locator(".source > .pane-heading").isVisible(), false)
    await rail.getByRole("button", { name: "概览", exact: true }).click()
    assert.equal(await page.locator(".sidebar-overview").isVisible(), true)
    assert.equal(await page.locator("#quick-inspector").isVisible(), true)
    assert.deepEqual(await changes(), before, "switching views preserves skin files")
    await page.screenshot({ path: `.ui-current/removed-panel-tabs-${colorScheme}.png` })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator("#mobile-project-toggle").click()
    await page.locator('[data-sidebar-view="source"]').click()
    assert.equal(await page.locator("#source-file-toolbar").isVisible(), true)
    await page.locator('[data-sidebar-view="overview"]').click()
    await page.locator("#mobile-files-close").click()
    await page.locator('#mobile-navigation [data-mobile-page="ai"]').click()
    await page.locator("#ai-design-panel").waitFor({ state: "visible" })
    await page.locator('#mobile-navigation [data-mobile-page="edit"]').click()
    await page.setViewportSize({ width: 844, height: 390 })
    assert.equal(await page.locator(".sidebar > .pane-heading").isVisible(), true)
    await page.locator('[data-sidebar-view="source"]').click()
    assert.equal(await page.locator("#source-file-toolbar").isVisible(), true)
    await page.setViewportSize({ width: 1440, height: 900 })
    assert.equal(await page.locator(".sidebar > .pane-heading").isVisible(), false)
    assert.equal(await page.locator(".inspector-tabs").isVisible(), false)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`panel switch removal ${colorScheme}: passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
