import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { unzipSync, zipSync, strToU8 } from "fflate"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { dismissStartupDisclaimer } from "./helpers/open-editor-template.mjs"
import { encodePng } from "../src/ssf/ssf-png.ts"
import { wav } from "./helpers/ssf-fixture.mjs"


const png = value => encodePng({ width: 2, height: 2, data: new Uint8Array(16).fill(value) })
const font = name => readFileSync(`public/fonts/${name}.woff2`)
const files = unzipSync(bdsFixture())
files["light/res/tap.wav"] = wav(800)
files["light/res/Shared.ttf"] = font("inter-latin")
files["dark/res/Shared.ttf"] = font("inter-latin")
files["light/res/default.css"] = strToU8("[GLOBAL]\nFONT_PATH=Shared.ttf\n[STYLE2]\nNM_IMG=btn,0\nPRESS_SOUND_PATH=tap.wav\n")
const skin = Buffer.from(zipSync(files))
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 0, hmr: false } })
await server.listen()

try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      for (const mobile of [false, true]) {
        const page = await browser.newPage({ hasTouch: mobile, isMobile: mobile, viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, reducedMotion: "reduce" })
        const errors = []
        page.on("pageerror", error => errors.push(error.message))
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
        await dismissStartupDisclaimer(page)
        await page.locator("#browser-open").setInputFiles({ name: "replacement.bds", mimeType: "application/octet-stream", buffer: skin })
        if (mobile) {
          await page.getByRole("button", { name: "开始编辑", exact: true }).tap()
          await page.locator('#mobile-navigation [data-mobile-page="resources"]').tap()
        } else {
          await page.getByRole("button", { name: "编辑模式", exact: true }).click()
          await page.locator('[data-workspace-page="resources"]').click()
        }
        const menu = page.getByRole("menu", { name: "资源操作" })
        const replace = menu.getByRole("menuitem", { name: "上传并替换" })
        const snapshot = path => page.evaluate(async path => {
          const { appState } = await import("/src/app/state.ts")
          const { archive, undoStack } = appState
          return {
            names: archive.names(), bytes: [...archive.getBytes(path)], undo: undoStack.length,
            config: archive.getText("light/skin/res/default.css"), tiles: archive.getText("light/skin/res/btn.til"),
            darkFont: archive.getBytes("dark/skin/res/Shared.ttf")?.length,
          }
        }, path)
        for (const [category, filename, bytes] of [
          ["image", "btn.png", png(0xff)],
          ["sound", "tap.wav", wav(1600)],
          ["font", "Shared.ttf", font("ibm-plex-mono-400")],
        ]) {
          if (mobile) await page.locator("#mobile-resource-category").selectOption(category === "font" ? "catalog:font" : category)
          else await page.locator(`[data-resource-${category === "font" ? "catalog" : "page"}="${category}"]`).click()
          const row = page.locator(`[role="option"][data-path$="/${filename}"], [role="option"][data-catalog-id$="/${filename}"]`)
          const path = (await row.getAttribute("data-path") ?? await row.getAttribute("data-catalog-id")).replace(/^file:/, "")
          const before = await snapshot(path)
          const more = category === "image" ? row.locator("[data-resource-more]") : page.locator("#resource-more")
          const openMenu = () => mobile ? more.tap() : category === "image" ? row.press("Shift+F10") : row.click({ button: "right" })
          if (mobile && category !== "image") await row.tap()
          await openMenu()
          if (mobile) assert.ok((await replace.boundingBox()).height >= 44)
          await page.keyboard.press("Escape")
          await menu.waitFor({ state: "hidden" })
          assert.equal(await (mobile ? more : row).evaluate(node => node === document.activeElement), true)
          const pick = async (name, buffer) => {
            await openMenu()
            const picker = page.waitForEvent("filechooser")
            await (mobile ? replace.tap() : replace.press("Enter"))
            const chooser = await picker
            assert.equal(await chooser.element().getAttribute("accept"), `.${filename.split(".").at(-1)}`)
            await chooser.setFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(buffer) })
          }
          if (category === "image") {
            await pick("invalid.png", [1, 2, 3])
            await page.locator('#event-log[data-kind="error"]').waitFor({ state: "attached" })
            assert.deepEqual(await snapshot(path), before)
            await page.locator("#file-operation-close").click()
          }
          await pick(`replacement.${filename.split(".").at(-1)}`, bytes)
          await page.waitForFunction(() => document.querySelector("#event-log").textContent === "替换资源完成")
          assert.deepEqual(await snapshot(path), { ...before, bytes: [...bytes], undo: before.undo + 1 })
          assert.equal(await row.getAttribute("aria-selected"), "true")
          await page.evaluate(async () => (await import("/src/app/edit-history.ts")).undo())
          assert.deepEqual(await snapshot(path), before)
        }
        assert.deepEqual(errors, [])
        console.log(`${engine.name()} ${mobile ? "touch" : "desktop"}: resource replacement, validation, selection and undo passed`)
        await page.close()
      }
    } finally { await browser.close() }
  }
} finally { await server.close() }
