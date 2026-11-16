import { chromium } from "playwright"
import { createServer } from "vite"
import { openEditorTemplate } from "../tests/helpers/open-editor-template.mjs"
const root = new URL("..", import.meta.url).pathname
const server = await createServer({ root, logLevel: "error", server: { port: 41794, strictPort: false, host: "127.0.0.1" } })
await server.listen()
const browser = await chromium.launch()
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })
  await page.addInitScript(() => localStorage.clear())
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.waitForSelector(".template-card", { state: "attached" })
  await openEditorTemplate(page, "official-android-bds")
  await page.evaluate(async () => {
    const { selectFile } = await import("/src/app/navigation.ts")
    selectFile("light/skin/port/py_9.ini")
  })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `/tmp/keyskin-ui/${scheme}-source-file.png` })
  await page.close()
}
await browser.close(); await server.close()
