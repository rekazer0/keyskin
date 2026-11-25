import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41917, strictPort: false, hmr: false } })
await server.listen()
const url = `http://127.0.0.1:${server.httpServer.address().port}/`
const bytes = [...bdsFixture()]
const fontBytes = [...readFileSync(new URL("../public/fonts/inter-latin.woff2", import.meta.url))]
try {
  for (const [engine, native] of [[chromium, false], [webkit, false], [chromium, true]]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await page.addInitScript(({ bytes, native }) => {
        localStorage.setItem("keyskin-disclaimer-shown", "1")
        localStorage.setItem("onboarding-tour-v1", "done")
        localStorage.setItem("source-directory-enabled", "false")
        if (!native) return
        const callbacks = new Map()
        window.__TAURI_INTERNALS__ = {
          metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
          transformCallback(callback) {
            const id = callbacks.size + 1
            callbacks.set(id, callback)
            return id
          },
          invoke: async (command, args) => {
            if (command === "plugin:window|scale_factor") return 1
            if (command === "take_opened_files") return ["/test/current.bds"]
            if (command === "skin_file_size") return bytes.length
            if (command === "read_skin_file" || command === "read_file") return Uint8Array.from(bytes).buffer
            if (command === "plugin:event|listen" && args.event === "tauri://drag-drop") {
              window.nativeDrop = payload => callbacks.get(args.handler)({ payload })
            }
            return null
          },
        }
      }, { bytes, native })
      await page.goto(url)
      if (!native) await page.locator("#browser-open").setInputFiles({
        name: "current.bds", mimeType: "application/octet-stream", buffer: Buffer.from(bytes),
      })
      await page.waitForFunction(async () => {
        const { appState } = await import("/src/app/state.ts")
        return appState.currentPath.endsWith("current.bds") && !appState.fileOperationRunning
      })
      if (native) await page.waitForFunction(() => typeof window.nativeDrop === "function")
      await page.getByRole("button", { name: "编辑模式", exact: true }).click()
      await page.locator('[data-workspace-page="resources"]').click()
      await page.locator('[data-resource-page="image"]').click()
      const drop = () => page.locator("#resource-gallery .ui-image-card").first().evaluate((target, { bytes, native }) => {
        if (native) {
          const { x, y, width, height } = target.getBoundingClientRect()
          window.nativeDrop({ paths: ["/test/dropped.BDS"], position: { x: x + width / 2, y: y + height / 2 } })
        } else {
          const dataTransfer = new DataTransfer()
          dataTransfer.items.add(new File([Uint8Array.from(bytes)], "dropped.BDS"))
          target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }))
        }
      }, { bytes, native })
      const confirmation = page.getByRole("dialog").filter({ hasText: "是否导出当前皮肤？" })
      await drop()
      await confirmation.getByRole("button", { name: "取消", exact: true }).click()
      assert.ok(await page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        return appState.currentPath.endsWith("current.bds")
      }), "cancelling leaves the current skin open")
      await confirmation.waitFor({ state: "hidden" })
      if (!native) {
        const image = page.locator("#resource-gallery .ui-image-card").first()
        const png = await image.evaluate(async target => {
          const { appState } = await import("/src/app/state.ts")
          return [...appState.archive.getBytes(target.dataset.path)]
        })
        const dropResource = (target, name, bytes) => target.evaluate((el, { name, bytes }) => {
          const dataTransfer = new DataTransfer()
          dataTransfer.items.add(new File([Uint8Array.from(bytes)], name))
          el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }))
        }, { name, bytes })
        await dropResource(image, "dropped-font.TTF", fontBytes)
        const font = page.locator('#resource-catalog [data-catalog-id$="/dropped-font.ttf"]')
        await font.waitFor()
        await dropResource(font, "dropped-image.png", png)
        await page.locator('.ui-image-card[data-path$="/dropped-image.png"]').waitFor()
      }
      await drop()
      await confirmation.getByRole("button", { name: "不导出", exact: true }).click()
      await page.waitForFunction(async () => {
        const { appState } = await import("/src/app/state.ts")
        return appState.currentPath.endsWith("dropped.BDS") && !appState.fileOperationRunning
      })
      console.log(`${engine.name()} (${native ? "Tauri drop bridge" : "browser"}): skin dropped on resource gallery opens as a document`)
    } finally { await browser.close() }
  }
} finally { await server.close() }
