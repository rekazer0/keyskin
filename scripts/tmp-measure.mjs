import { chromium } from "playwright"
import { createServer } from "vite"
import { openEditorTemplate } from "../tests/helpers/open-editor-template.mjs"
const root = new URL("..", import.meta.url).pathname
const server = await createServer({ root, logLevel: "error", server: { port: 41797, strictPort: false, host: "127.0.0.1" } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" })
await page.addInitScript(() => localStorage.clear())
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
await page.waitForSelector(".template-card", { state: "attached" })
await openEditorTemplate(page, "official-android-bds")
const out = await page.evaluate(() => {
  const sel = [".sidebar", ".sidebar > .pane-heading", ".sidebar-view-control", "#files", ".sidebar-overview", ".nav-section", ".skin-card", ".sidebar-resource-tiles", ".nav-item[data-layout=tile]", ".nav-group-body", ".inspector", "#inspector-shell", ".inspector-body", ".ui-card", ".ui-card-heading", ".ui-property-link"]
  const rows = []
  for (const s of sel) for (const el of document.querySelectorAll(s)) {
    const r = el.getBoundingClientRect()
    if (!r.width) continue
    const cs = getComputedStyle(el)
    rows.push([s, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), cs.padding, cs.gap])
  }
  return rows.slice(0, 60)
})
console.log(out.map(r => r.join(" | ")).join("\n"))
await browser.close(); await server.close()
