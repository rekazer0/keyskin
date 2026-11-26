import { createServer } from "vite"
import { chromium } from "playwright"
import { openEditorTemplate } from "/Users/kaze/work/bdi-edit/tests/helpers/open-editor-template.mjs"

const server = await createServer({ root: "/Users/kaze/work/bdi-edit", logLevel: "error", server: { host: "127.0.0.1", port: 41831, strictPort: false } })
await server.listen()
const port = server.httpServer.address().port
const browser = await chromium.launch({ channel: "chrome" })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
await page.goto(`http://127.0.0.1:${port}/`)
await openEditorTemplate(page, "xiaomi-unified-rounded-blur")
await page.locator(".skin-card").waitFor()
const info = await page.locator(".skin-card").evaluate((node) => {
  const preview = node.querySelector(".skin-card-preview")
  const img = preview.querySelector("img")
  const label = node.querySelector(".skin-card-info .nav-label")
  const ps = getComputedStyle(preview)
  const is = img ? getComputedStyle(img) : null
  const pr = preview.getBoundingClientRect()
  const ir = img?.getBoundingClientRect()
  return {
    name: label.textContent,
    lines: label.getClientRects().length,
    clamped: label.scrollHeight > label.clientHeight + 1,
    previewBg: ps.backgroundColor,
    fit: is?.objectFit,
    preview: [Math.round(pr.width), Math.round(pr.height)],
    image: ir ? [Math.round(ir.width), Math.round(ir.height)] : null,
    imageFills: ir ? ir.width >= pr.width - 1 && ir.height >= pr.height - 1 : false,
  }
})
console.log(JSON.stringify(info, null, 2))
await page.locator(".skin-card").screenshot({ path: "/tmp/skin-card-xiaomi.png" })
await browser.close()
await server.close()
