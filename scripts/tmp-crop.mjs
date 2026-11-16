import { chromium } from "playwright"
import { createServer } from "vite"
import { openEditorTemplate } from "/Users/kaze/work/bdi-main-sound/tests/helpers/open-editor-template.mjs"
const root = "/Users/kaze/work/bdi-main-sound/"
const server = await createServer({ root, logLevel: "error", server: { port: 41798, strictPort: false, host: "127.0.0.1" } })
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}/`
const browser = await chromium.launch()
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 })
  await page.addInitScript(() => localStorage.clear())
  await page.goto(base)
  await page.waitForSelector(".template-card", { state: "attached" })
  await openEditorTemplate(page, "official-android-bds")
  await page.waitForTimeout(600)
  await page.screenshot({ path: `/tmp/keyskin-ui/${scheme}-sidebar.png`, clip: { x: 0, y: 0, width: 300, height: 900 } })
  await page.screenshot({ path: `/tmp/keyskin-ui/${scheme}-inspector.png`, clip: { x: 1090, y: 0, width: 350, height: 900 } })
  await page.screenshot({ path: `/tmp/keyskin-ui/${scheme}-topbar.png`, clip: { x: 0, y: 0, width: 1440, height: 110 } })
  await browser.newPage // noop
  await page.close()
}
await browser.close()
await server.close()
