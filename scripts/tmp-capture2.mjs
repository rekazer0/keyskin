import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"
import { openEditorTemplate } from "../tests/helpers/open-editor-template.mjs"
const root = new URL("..", import.meta.url).pathname
const out = "/tmp/keyskin-ui"
mkdirSync(out, { recursive: true })
const server = await createServer({ root, logLevel: "error", server: { port: 41795, strictPort: false, host: "127.0.0.1" } })
await server.listen()
const browser = await chromium.launch()
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })
  await page.addInitScript(() => localStorage.clear())
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.waitForSelector(".template-card", { state: "attached" })
  await page.screenshot({ path: join(out, `${scheme}-welcome.png`) })
  await openEditorTemplate(page, "official-android-bds")
  await page.waitForTimeout(400)
  await page.locator('[data-sidebar-view="source"]').click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(out, `${scheme}-source.png`) })
  await page.locator('[data-sidebar-view="overview"]').click()
  await page.getByText("资源清单", { exact: true }).first().click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${scheme}-resources.png`) })
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
  await page.locator(".titlebar-preferences").click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${scheme}-settings.png`) })
  await page.keyboard.press("Escape")
  await page.close()
}
await browser.close(); await server.close()
