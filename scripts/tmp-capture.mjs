// ponytail: throwaway visual capture, delete after use
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"
import { openEditorTemplate } from "../tests/helpers/open-editor-template.mjs"

const root = new URL("..", import.meta.url).pathname
const out = "/tmp/keyskin-ui"
mkdirSync(out, { recursive: true })
const server = await createServer({ root, logLevel: "error", server: { port: 41799, strictPort: false, host: "127.0.0.1" } })
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}/`
const browser = await chromium.launch()
const scheme = process.argv[2] ?? "light"

async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(out, `${scheme}-${name}.png`) })
  console.log("shot", name)
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 })
page.on("pageerror", (e) => console.log("ERR", e.message))
await page.addInitScript(() => localStorage.clear())
await page.goto(base)
await page.waitForSelector(".template-card", { state: "attached" })
await shot(page, "welcome")
await openEditorTemplate(page, "official-android-bds")
await shot(page, "editor")
if (await page.locator("#mode").inputValue() !== "edit") await page.getByRole("button", { name: "编辑模式", exact: true }).click()
const box = await page.locator("#preview").boundingBox()
await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45)
await shot(page, "key")
await browser.close()
await server.close()
