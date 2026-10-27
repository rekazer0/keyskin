// UI regression snapshots for the design-system refactor.
//   node scripts/ui-snapshot.mjs save      记录基线（.ui-baseline/）
//   node scripts/ui-snapshot.mjs compare   与基线比对，打印每个界面里变化的元素与属性
// 每个界面保存一张截图和一份“可见元素 → 位置 + 计算样式”的 JSON。元素按 DOM 位置（id 或 nth-of-type）
// 识别，不依赖类名，所以改类名、合并样式后仍能对上号。
import { chromium } from "playwright"
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { ssfFixture } from "../tests/helpers/ssf-fixture.mjs"
import { SkinArchive } from "../src/skin.ts"
import { convertBdaArchive } from "../src/bda-convert.ts"
import { bdaAnimatedSkinBytes, bdsBaseArchive } from "../tests/helpers/bda-animation-fixture.mjs"

const mode = process.argv[2] ?? "compare"
// 动效检查器的界面快照样例：一个带 animationConfig 的 BDA，以及它转换出的旧版 anim.ini。
const animatedBda = bdaAnimatedSkinBytes()
const animatedBds = await convertBdaArchive(SkinArchive.open(animatedBda, "bda"), bdsBaseArchive()).archive.platformBytesAsync("bds")
const only = process.argv[3]
const root = new URL("..", import.meta.url).pathname
const dir = join(root, ".ui-baseline")
const outDir = mode === "save" ? dir : join(root, ".ui-current")
mkdirSync(outDir, { recursive: true })

const { createServer } = await import("vite")
const server = await createServer({ root, logLevel: "error", server: { port: 41790, strictPort: false, host: "127.0.0.1" } })
await server.listen()
const baseURL = `http://127.0.0.1:${server.httpServer.address().port}/`
const browser = await chromium.launch()

const PROPS = ["display", "color", "backgroundColor", "backgroundImage", "borderTopColor", "borderTopWidth", "borderRadius", "boxShadow",
  "fontSize", "fontWeight", "fontFamily", "lineHeight", "opacity", "paddingTop", "paddingLeft", "gap", "outlineStyle", "cursor"]

async function capture(page, name) {
  if (only && !name.includes(only)) return
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(outDir, `${name}.png`) })
  const elements = await page.evaluate((props) => {
    const pathOf = (el) => {
      const parts = []
      for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
        if (node.id) { parts.unshift(`#${node.id}`); break }
        const same = [...(node.parentElement?.children ?? [])].filter((child) => child.localName === node.localName)
        parts.unshift(same.length > 1 ? `${node.localName}:${same.indexOf(node) + 1}` : node.localName)
      }
      return parts.join(">")
    }
    const out = {}
    for (const el of document.body.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      const style = getComputedStyle(el)
      if (style.visibility === "hidden" || style.display === "none") continue
      const entry = { box: [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(","), pane: el.closest("section.source") ? 1 : 0 }
      for (const prop of props) entry[prop] = style[prop]
      out[pathOf(el)] = entry
    }
    return out
  }, PROPS)
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(elements))
  console.log(`  captured ${name} (${Object.keys(elements).length} elements)`)
}

async function withPage(run, { viewport = { width: 1440, height: 900 }, colorScheme = "light", url = baseURL } = {}) {
  const context = await browser.newContext({ viewport, colorScheme, bypassCSP: true, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.clear())
  await page.goto(url)
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}" })
  try { await run(page) } finally { await context.close() }
  if (errors.length) console.log(`  page errors: ${errors.join(" | ")}`)
}

async function openTemplate(page, template) {
  await page.waitForSelector(".template-card")
  await page.locator(`.template-grid .template-card[data-template="${template}"]`).click()
  await page.waitForSelector(".canvas-wrap:not(.empty)")
  await page.waitForFunction(() => document.querySelector("#preview")?.getBoundingClientRect().height > 60)
  await page.waitForFunction(() => {
    const dialog = document.querySelector("#file-operation-dialog")
    return !dialog?.open || !document.querySelector("#file-operation-close")?.disabled
  }, null, { timeout: 60000 })
  const close = page.locator("#file-operation-dialog[open] #file-operation-close")
  if (await close.isVisible().catch(() => false)) await close.click()
}

async function editAndSelectKey(page) {
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()
  await page.waitForFunction(() => document.querySelector("#mode").value === "edit")
  const box = await page.locator("#preview").boundingBox()
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45)
  await page.waitForSelector('.key-layout-fields:not([hidden]), #document-fields [data-inspector-group-label="布局"], #bda-config-fields[data-bda-scope="key"]', { state: "visible" })
}

async function openSkinFile(page, name, bytes, path) {
  await page.locator("#browser-open").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) })
  await page.waitForFunction(() => !document.querySelector("#open")?.disabled)
  await page.waitForFunction(() => {
    const dialog = document.querySelector("#file-operation-dialog")
    return !dialog?.open || !document.querySelector("#file-operation-close")?.disabled
  }, null, { timeout: 60000 })
  const close = page.locator("#file-operation-dialog[open] #file-operation-close")
  if (await close.isVisible().catch(() => false)) await close.click()
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()
  await page.evaluate(async (path) => {
    const { selectFile } = await import("/src/app/navigation.ts")
    selectFile(path)
  }, path)
}

async function railTabs(page, prefix) {
  const buttons = page.locator("#mobile-inspector-groups button:visible")
  const count = await buttons.count()
  for (let i = 0; i < count; i += 1) {
    await buttons.nth(i).click()
    await capture(page, `${prefix}-rail${i + 1}`)
  }
}

console.log(`ui-snapshot ${mode}`)
for (const [name, colorScheme, viewport] of [
  ["file-operation", "light", { width: 1440, height: 900 }],
  ["file-operation-dark", "dark", { width: 1440, height: 900 }],
  ["file-operation-mobile", "light", { width: 390, height: 844 }],
]) await withPage(async (page) => {
  await page.waitForSelector(".template-card")
  await page.evaluate(async () => {
    const { runFileOperation, showFileOperationProgress } = await import("/src/app/file-operations.ts")
    await runFileOperation("保存", () => { showFileOperationProgress(); return true })
  })
  await capture(page, `${name}-success`)
  await page.locator("#file-operation-close").click()
  await page.evaluate(async () => {
    const { runFileOperation, showFileOperationProgress } = await import("/src/app/file-operations.ts")
    await runFileOperation("导出", () => { showFileOperationProgress(); throw new Error("无法写入所选位置，请重新选择保存位置。") })
  })
  await capture(page, `${name}-error`)
}, { colorScheme, viewport })
await withPage(async (page) => {
  await page.waitForSelector(".template-card")
  await capture(page, "welcome")
  await openTemplate(page, "official-android-bds")
  await capture(page, "bds-preview")
  await page.locator('[data-sidebar-view="source"]').click()
  await capture(page, "bds-source")
  await page.locator('[data-sidebar-view="overview"]').click()
  await editAndSelectKey(page)
  await capture(page, "bds-key")
  await railTabs(page, "bds-key")
  await page.locator(".titlebar-preferences").click()
  await capture(page, "settings")
  await page.keyboard.press("Escape")
  // 图片编辑：资源列表与切片工具栏会挪进画布工作区
  await page.locator(".sidebar-overview button[data-path]", { hasText: "图片资源" }).first().click()
  await capture(page, "bds-images")
  await page.locator("#resource-gallery > *").first().click()
  await capture(page, "bds-image")
})
await withPage(async (page) => {
  // 设备外框预览（浅色 / 深色系统主题）
  await openTemplate(page, "official-android-bds")
  await page.locator("#device").selectOption("iphone-17-pro")
  await capture(page, "device-iphone")
  await page.locator("#device").selectOption("pixel-10-pro")
  await capture(page, "device-pixel")
})
await withPage(async (page) => {
  await openTemplate(page, "default-android")
  await editAndSelectKey(page)
  await capture(page, "bda-key")
  await railTabs(page, "bda-key")
})
for (const colorScheme of ["light", "dark"]) await withPage(async (page) => {
  await openSkinFile(page, "动效.bda", animatedBda, "light/skin/port/animationConfig")
  await page.waitForSelector("#bda-config-fields .bda-animation-section")
  await capture(page, `${colorScheme}-bda-animation`)
}, { colorScheme })
await withPage(async (page) => {
  await openSkinFile(page, "动效.bds", animatedBds, "light/skin/port/res/anim.ini")
  await page.waitForSelector("#document-fields .legacy-animation-section")
  await capture(page, "legacy-animation")
})
await withPage(async (page) => {
  await openTemplate(page, "palm-harmony")
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()
  await capture(page, "palm-board")
  await editAndSelectKey(page)
  await capture(page, "palm-key")
  await railTabs(page, "palm-key")
})
for (const colorScheme of ["light", "dark"]) await withPage(async (page) => {
  await page.locator("#browser-open").setInputFiles({ name: "检查器.ssf", mimeType: "application/octet-stream", buffer: Buffer.from(ssfFixture()) })
  await page.waitForFunction(() => !document.querySelector("#open")?.disabled)
  const close = page.locator("#file-operation-dialog[open] #file-operation-close")
  if (await close.isVisible()) await close.click()
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()
  await page.locator('.sidebar-overview button[data-path="light/skin/port/py_26.ini"]').click()
  await capture(page, `${colorScheme}-ssf-board`)
  const box = await page.locator("#preview").boundingBox()
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4)
  await page.waitForSelector('#document-fields [data-inspector-group-label="背景"]')
  await capture(page, `${colorScheme}-ssf-key`)
  await railTabs(page, `${colorScheme}-ssf-key`)
}, { colorScheme })
await withPage(async (page) => {
  await openTemplate(page, "official-android-bds")
  await editAndSelectKey(page)
  await capture(page, "dark-bds-key")
}, { colorScheme: "dark" })
await withPage(async (page) => {
  await page.waitForSelector(".template-card")
  await capture(page, "mobile-welcome")
  await openTemplate(page, "official-android-bds")
  await capture(page, "mobile-bds")
}, { viewport: { width: 390, height: 844 } })
await withPage(async (page) => { await page.waitForTimeout(800); await capture(page, "new-project") }, { url: `${baseURL}new-project.html` })
await withPage(async (page) => { await page.waitForTimeout(800); await capture(page, "picker") }, { url: `${baseURL}picker.html` })

await browser.close()
await server.close()

// 右侧面板里的元素：快照里带 pane 标记；旧基线没有标记时按面板内的 id 和路径判断。
const indexHtml = readFileSync(join(root, "index.html"), "utf8")
const paneHtml = indexHtml.slice(indexHtml.indexOf('<section class="source">'), indexHtml.indexOf("</main>"))
const paneIDs = new Set([...paneHtml.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
const inPane = (key, entry) => entry?.pane === 1 || key.startsWith("body>main>section:2") || paneIDs.has(key.match(/^#([^>]+)/)?.[1])

if (mode === "compare") {
  let total = 0
  for (const file of (await import("node:fs")).readdirSync(outDir).filter((f) => f.endsWith(".json"))) {
    if (!existsSync(join(dir, file))) { console.log(`\n${file}: 基线中不存在`); continue }
    const before = JSON.parse(readFileSync(join(dir, file), "utf8"))
    const after = JSON.parse(readFileSync(join(outDir, file), "utf8"))
    const lines = []
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      // OUTSIDE_PANE=1：只看右侧面板以外的元素（重做检查器时确认其他区域不受影响）
      if (process.env.OUTSIDE_PANE && (inPane(key, after[key]) || inPane(key, before[key]))) continue
      if (!before[key]) { lines.push(`  + ${key}`); continue }
      if (!after[key]) { lines.push(`  - ${key}`); continue }
      const diff = Object.keys(before[key]).filter((p) => p !== "pane").filter((p) => before[key][p] !== after[key][p]).map((p) => `${p}: ${before[key][p]} → ${after[key][p]}`)
      if (diff.length) lines.push(`  ~ ${key}\n      ${diff.join("\n      ")}`)
    }
    total += lines.length
    if (lines.length) console.log(`\n${file.replace(".json", "")}: ${lines.length} 处变化\n${lines.slice(0, Number(process.env.LIMIT ?? 25)).join("\n")}`)
  }
  console.log(`\n共 ${total} 处变化`)
}
