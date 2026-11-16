import { chromium } from "playwright"
import { createServer } from "vite"
import { openEditorTemplate } from "../tests/helpers/open-editor-template.mjs"
const root = new URL("..", import.meta.url).pathname
const server = await createServer({ root, logLevel: "error", server: { port: 41796, strictPort: false, host: "127.0.0.1" } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" })
await page.addInitScript(() => localStorage.clear())
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
await page.waitForSelector(".template-card", { state: "attached" })
await openEditorTemplate(page, "official-android-bds")
console.log(JSON.stringify(await page.evaluate(() => {
  const label = [...document.querySelectorAll("*")].find(e => e.textContent.trim() === "精确输入" && e.children.length === 0)
  const field = label?.closest(".ui-field")
  const input = field?.querySelector("input")
  if (!input) return "none"
  const cs = getComputedStyle(input)
  const after = getComputedStyle(input, "::after")
  return { html: field.outerHTML.slice(0, 800), disabled: input.disabled, cls: input.className, type: input.type, inForm: !!input.closest(".ui-form"), appearance: cs.appearance, bg: cs.backgroundColor, opacity: cs.opacity, w: cs.width, h: cs.height, radius: cs.borderRadius, afterBg: after.backgroundColor, afterW: after.width, rect: input.getBoundingClientRect().toJSON() }
}), null, 1))
await browser.close(); await server.close()
