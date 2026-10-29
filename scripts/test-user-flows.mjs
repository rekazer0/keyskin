// End-to-end user simulation: drives every editor feature the way a person would.
// Run: node scripts/test-user-flows.mjs
// Starts a Vite dev server (or uses BASE_URL) and drives Chromium through Playwright
// (set PLAYWRIGHT_MODULE / CHROMIUM_PATH like test-mobile-layout.mjs). Real skins from
// REAL_SKINS_DIR (default /Users/kaze/work/bd) are opened when that folder exists.
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { deflateSync } from "node:zlib"

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright"]
  try {
    candidates.push(join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright", "index.mjs"))
  } catch {}
  for (const candidate of candidates.filter(Boolean)) {
    try {
      return await import(candidate.startsWith("/") ? pathToFileURL(candidate).href : candidate)
    } catch {}
  }
  throw new Error("Playwright is not installed; install it or set PLAYWRIGHT_MODULE")
}

const { chromium } = await loadPlaywright()
let server
let baseURL = process.env.BASE_URL
if (!baseURL) {
  const { createServer } = await import("vite")
  const root = new URL("..", import.meta.url).pathname
  server = await createServer({ root, logLevel: "error", server: { port: 41731, strictPort: false, host: "127.0.0.1" } })
  await server.listen()
  baseURL = `http://127.0.0.1:${server.httpServer.address().port}/`
}
// Chromium on Linux names downloads through the system locale: without a UTF-8 one, a download
// attribute such as "未命名.bdi" falls back to "download". Containers often have no LANG set.
const browser = await chromium.launch({
  ...process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  ...process.platform === "linux" ? { env: { ...process.env, LC_ALL: "C.UTF-8" } } : {},
})
const results = []
const mod = process.platform === "darwin" ? "Meta" : "Control"

/** Opens a fresh window; collects page errors and fails the check if any occurred. */
async function withPage(run, { viewport = { width: 1440, height: 900 }, storage = {}, colorScheme = "light" } = {}) {
  // bypassCSP: Playwright polls predicates with new Function(), which the app's CSP forbids.
  const context = await browser.newContext({ viewport, colorScheme, acceptDownloads: true, bypassCSP: true })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("dialog", (dialog) => dialog.accept())
  await page.addInitScript((entries) => {
    // Browser downloads go through the <a download> fallback so Playwright can observe them.
    delete window.showSaveFilePicker
    window.showSaveFilePicker = undefined
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value)
  }, storage)
  await page.goto(baseURL)
  await page.waitForSelector(".template-card")
  try {
    await run(page)
    assert.deepEqual(errors, [], "page errors")
  } catch (error) {
    if (process.env.FLOW_SHOTS) await page.screenshot({ path: join(process.env.FLOW_SHOTS, `${Date.now()}.png`) }).catch(() => {})
    throw error
  } finally {
    await context.close()
  }
}

let check = async function check(name, run) {
  const started = Date.now()
  try {
    await run()
    results.push({ name, ok: true, ms: Date.now() - started })
  } catch (error) {
    results.push({ name, ok: false, error, ms: Date.now() - started })
  }
}

async function openTemplate(page, template = "official-android-bds") {
  await page.locator(`.template-grid .template-card[data-template="${template}"]`).click()
  await page.waitForSelector(".canvas-wrap:not(.empty)")
  await page.waitForFunction(() => document.querySelector("#preview")?.getBoundingClientRect().height > 60)
  await closeOperationDialog(page)
  await page.waitForFunction(() => !document.querySelector("#open")?.disabled)
}

async function closeOperationDialog(page) {
  // 成功打开时进度弹窗会自己关闭；其他操作完成后才启用「关闭」。
  await page.waitForFunction(() => {
    const dialog = document.querySelector("#file-operation-dialog")
    return !dialog?.open || !document.querySelector("#file-operation-close")?.disabled
  }, null, { timeout: 60000 })
  const close = page.locator("#file-operation-dialog[open] #file-operation-close")
  if (await close.isVisible().catch(() => false)) await close.click()
}

async function editMode(page) {
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()
  await page.waitForFunction(() => document.querySelector("#mode").value === "edit")
}

/** Clicks a point of the keyboard canvas, given as fractions of its size. */
async function clickCanvas(page, fx, fy, options) {
  const box = await page.locator("#preview").boundingBox()
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, options)
}

async function selectKey(page, { timeout = 30000 } = {}) {
  await clickCanvas(page, 0.45, 0.45)
  // BDS/BDI 显示布局分组；手心显示 skin.json 里按键的「布局」；BDA 的几何只读，检查器切到按键样式。
  await page.waitForSelector('.key-layout-fields:not([hidden]), #document-fields [data-inspector-group-label="布局"], #bda-config-fields[data-bda-scope="key"]', { state: "visible", timeout })
}

async function clickCanvasWith(page, key, fx, fy) {
  await page.keyboard.down(key)
  await clickCanvas(page, fx, fy)
  await page.keyboard.up(key)
}

async function railTab(page, name) {
  await page.locator("#mobile-inspector-groups").getByRole("button", { name, exact: true }).click()
}

async function openFileMenu(page) {
  const menu = page.locator(".pen-file-menu")
  if (!(await menu.evaluate((node) => node.open))) await menu.locator("> summary").click()
}

const sourceText = (page) => page.evaluate(() => document.querySelector("#source .cm-content")?.innerText ?? "")
const undoEnabled = (page) => page.locator("#desktop-undo").isEnabled()

/** Minimal valid RGBA PNG for upload flows. */
function pngBytes(width, height, rgba = [40, 120, 220, 255]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buffer) => {
    let c = 0xffffffff
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgba).flat())])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------------------------------------
 * 1 · Welcome screen
 * ---------------------------------------------------------------------------------------------- */
const only = process.env.FLOW_ONLY ? new RegExp(process.env.FLOW_ONLY) : undefined
const runCheck = check
// FLOW_ONLY=正则 只运行名称匹配的用例，便于单独复现。
check = async (name, run) => (!only || only.test(name) ? runCheck(name, run) : undefined)

await check("welcome: one recent section, templates, no document controls", () => withPage(async (page) => {
  assert.equal(await page.locator(".welcome-aside").count(), 0, "duplicate recent column removed")
  assert.equal(await page.locator(".template-grid .template-card").count(), 8)
  await page.waitForFunction(() => document.querySelectorAll(".template-grid .template-preview img, .template-grid .template-preview canvas").length >= 3, null, { timeout: 30000 })
  for (const selector of ["#desktop-undo", ".mode-control", "#recent-clear"]) {
    assert.equal(await page.locator(selector).isVisible(), false, `${selector} hidden without a skin`)
  }
  assert.equal(await page.getByRole("button", { name: /^打开皮肤/ }).filter({ visible: true }).count(), 1, "a single open button")
  await openFileMenu(page)
  for (const id of ["#new", "#open"]) assert.equal(await page.locator(id).isEnabled(), true, `${id} enabled`)
  for (const id of ["#save", "#panel-scale", "#replace-layout-image", "#adapt-ios26"]) assert.equal(await page.locator(id).isDisabled(), true, `${id} disabled`)
  await page.keyboard.press("Escape")
  assert.equal(await page.locator(".pen-file-menu").evaluate((node) => node.open), false, "Escape closes the menu")
}))

/* ------------------------------------------------------------------------------------------------
 * 2 · Every built-in template opens and renders in both modes
 * ---------------------------------------------------------------------------------------------- */
for (const template of ["default-android", "official-android-bds", "xiaomi-unified-rounded-blur", "oppo-dual-color", "iqoo-rounded-black", "huawei-swipe-symbols-1080", "oppo-swipe-down", "palm-harmony"]) {
  await check(`template ${template}: opens, previews and edits`, () => withPage(async (page) => {
    await openTemplate(page, template)
    assert.match(await page.locator("#document-name").textContent(), /\.(bds|bda|sxi)$/)
    await editMode(page)
    await selectKey(page)
    assert.ok(await page.locator("#mobile-inspector-groups button").count() >= 1, "inspector categories")
    const sidebarItems = await page.locator(".sidebar-overview button[data-path]:visible").count()
    assert.ok(sidebarItems > 0, `sidebar lists items (${sidebarItems})`)
  }))
}

/* ------------------------------------------------------------------------------------------------
 * 3 · New skin dialog
 * ---------------------------------------------------------------------------------------------- */
await check("new skin dialog: validation, cancel and create", () => withPage(async (page) => {
  await openFileMenu(page)
  await page.locator("#new").click()
  const dialog = page.locator("#new-project-dialog")
  await dialog.waitFor({ state: "visible" })
  const names = await dialog.locator("strong").allTextContents()
  for (const name of ["百度 BDA 默认", "百度 BDS 旧版", "OPPO 双色", "iQOO 圆角黑"]) assert.ok(names.some((text) => text.includes(name)), `dialog names match welcome cards: ${name}`)
  await dialog.locator("[name=project-name]").fill("../bad")
  await dialog.getByRole("button", { name: "创建皮肤", exact: true }).click()
  assert.equal(await dialog.isVisible(), true, "invalid name keeps the dialog open")
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await openFileMenu(page)
  await page.locator("#new").click()
  await dialog.locator("[name=project-name]").fill("用户流程测试")
  await dialog.locator("input[value=oppo-dual-color]").check()
  await dialog.getByRole("button", { name: "创建皮肤", exact: true }).click()
  await page.waitForFunction(() => document.querySelector("#document-name")?.textContent?.includes("用户流程测试"), null, { timeout: 30000 })
}))

/* ------------------------------------------------------------------------------------------------
 * 4 · Interactive preview and canvas toolbar
 * ---------------------------------------------------------------------------------------------- */
await check("preview: typing, devices, orientation, theme, guides, zoom, skin state", () => withPage(async (page) => {
  await openTemplate(page)
  // 手机设备下才显示模拟输入框；9 键拼音点按键后进入候选栏输入码。
  await page.selectOption("#device", "iphone-17-pro")
  await page.waitForFunction(() => document.querySelector("#preview").getBoundingClientRect().height > 40)
  await clickCanvas(page, 0.45, 0.45)
  await page.waitForFunction(() => /\S/.test(document.querySelector("#candidate-composition")?.textContent ?? ""))
  assert.match(await page.locator("#event-log").textContent(), /KEY\d+ · CENTER/, "status shows the pressed key")
  const devices = await page.locator("#device option").evaluateAll((options) => options.map((option) => option.value))
  for (const device of devices) {
    await page.selectOption("#device", device)
    await page.waitForFunction(() => document.querySelector("#preview").getBoundingClientRect().height > 40)
  }
  await page.locator('[data-orientation-choice="land"]').click()
  assert.equal(await page.locator("#orientation").inputValue(), "land")
  await page.locator('[data-orientation-choice="port"]').click()
  await page.locator('[data-theme-choice="dark"]').click()
  assert.equal(await page.locator("#theme").inputValue(), "dark")
  await page.locator('[data-theme-choice="light"]').click()
  await page.locator("#toggle-guides").click()
  assert.equal(await page.locator("#toggle-guides").getAttribute("aria-pressed"), "true")
  await page.locator("#toggle-guides").click()
  const zoom = () => page.locator("#panel-status").textContent()
  const before = await zoom()
  await page.locator("#preview-zoom-in").click()
  assert.notEqual(await zoom(), before, "zoom in changes scale")
  await page.locator("#preview-zoom-out").click()
  await page.locator("#preview-zoom-fit").click()
  assert.equal(await page.locator("#preview-zoom-fit").getAttribute("aria-pressed"), "true", "canvas view is locked by default")
  await page.locator("#preview-zoom-fit").dblclick()
  assert.equal(await page.locator("#preview-zoom-fit").getAttribute("aria-pressed"), "false")
  // 触控板 / Cmd+滚轮会连发很多小 delta 事件，应按滚动量缩放，不能每个事件跳一大步
  const fit = await page.locator("#preview").boundingBox()
  await page.mouse.move(fit.x + fit.width / 2, fit.y + fit.height / 2)
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -4)
  await page.waitForFunction((width) => document.querySelector("#preview").getBoundingClientRect().width > width + 1, fit.width)
  const wheeled = await page.locator("#preview").boundingBox()
  assert.ok(wheeled.width < fit.width * 1.2, "a burst of small wheel deltas zooms smoothly")
  await page.locator("#preview-zoom-fit").click()
  const states = await page.locator("#skin-state option").count()
  if (states > 1) await page.selectOption("#skin-state", { index: 1 })
}))

/* ------------------------------------------------------------------------------------------------
 * 5 · Key editing: geometry, nudging, undo/redo, multi-select, layout actions, text and gestures
 * ---------------------------------------------------------------------------------------------- */
await check("edit keys: geometry, keyboard nudge, undo/redo, multi-select, layout tools", () => withPage(async (page) => {
  await openTemplate(page)
  await editMode(page)
  await selectKey(page)
  const x = page.locator("[data-key-field=x]")
  const original = Number(await x.inputValue())
  await x.fill(String(original + 3))
  await x.press("Enter")
  await page.waitForFunction(() => !document.querySelector("#desktop-undo").disabled)
  assert.match(await page.locator(".inspector-changes").textContent(), /已改/)
  await page.locator("#desktop-undo").click()
  await page.waitForFunction((value) => document.querySelector("[data-key-field=x]").value === String(value), original)
  await page.locator("#desktop-redo").click()
  await page.waitForFunction((value) => document.querySelector("[data-key-field=x]").value === String(value), original + 3)
  await page.keyboard.press(`${mod}+z`)
  await page.waitForFunction((value) => document.querySelector("[data-key-field=x]").value === String(value), original)
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press("ArrowRight")
  await page.waitForFunction((value) => document.querySelector("[data-key-field=x]").value === String(value), original + 1)
  await page.keyboard.press("Shift+ArrowLeft")
  await page.waitForFunction((value) => document.querySelector("[data-key-field=x]").value === String(value), original - 9)
  // Multi-select reveals batch layout tools.
  await clickCanvasWith(page, mod, 0.65, 0.45)
  await page.waitForSelector("#inspector-multi-layout", { state: "visible" })
  await page.locator('#inspector-multi-layout [data-layout-action="same-width"]').click()
  await page.locator('#inspector-multi-layout [data-layout-action="same-height"]').click()
  assert.equal(await undoEnabled(page), true)
  // Esc 取消选择；再次单击唯一选中的键也取消选中。
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press("Escape")
  await page.locator("#inspector-multi-layout").waitFor({ state: "hidden" })
  await page.locator(".key-layout-fields").waitFor({ state: "hidden" })
  await selectKey(page)
  await clickCanvas(page, 0.45, 0.45)
  await page.locator(".key-layout-fields").waitFor({ state: "hidden" })
  // Text and gestures on a single key.
  await selectKey(page)
  await railTab(page, "文字")
  const show = page.locator("[data-key-field=SHOW]")
  await show.fill("测")
  await show.press("Enter")
  await page.locator('[data-inspector-tab="source"]').click()
  await page.waitForFunction(() => /SHOW=测/.test(document.querySelector("#source .cm-content")?.innerText ?? ""))
  await page.locator('[data-inspector-tab="properties"]').click()
  // The skin font applies to every key, so it sits in the whole layout's 文字 group.
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press("Escape")
  await page.locator(".text-style-fields #font-file-field").waitFor({ state: "visible" })
  // The font is picked from the skin's own font files; the system font is always offered.
  assert.equal(await page.locator("#font-file-select option").first().textContent(), "系统默认")
  // Import is available in edit mode; removing the system default is not possible.
  assert.equal(await page.locator("#font-import").isVisible(), true)
  assert.equal(await page.locator("#font-remove").isDisabled(), true)
  // A broken font file is rejected with a status error, not a crash or a silent no-op.
  await page.locator("#font-import-input").setInputFiles({
    name: "broken.ttf",
    mimeType: "font/ttf",
    buffer: Buffer.from("not a font file"),
  })
  await page.waitForFunction(() => document.querySelector("#event-log")?.dataset.kind === "error")
  assert.match(await page.locator("#event-log").textContent(), /导入字体/)
  await selectKey(page)
  await railTab(page, "手势")
  const up = page.locator("[data-key-field=UP]")
  await up.fill("F12")
  await up.press("Tab")
  assert.match(await page.locator('[data-gesture="UP"]').getAttribute("class"), /configured/)
  await railTab(page, "样式")
  await page.locator("[data-key-field=FORE_OFFSET]").waitFor({ state: "visible" })
  // Rows share one label column and fill the inspector.
  const rows = await page.locator(".appearance-property-grid > label:visible").evaluateAll((labels) => labels.map((label) => {
    const input = label.querySelector("input")
    return input ? Math.round(input.getBoundingClientRect().left) : 0
  }))
  assert.ok(rows.length && rows.every((left) => left === rows[0]), `advanced rows align (${rows})`)
}))

/* ------------------------------------------------------------------------------------------------
 * 6 · Styles: library, filters, search, apply, new style
 * ---------------------------------------------------------------------------------------------- */
await check("text: candidate bar and whole layout edit their text styles", () => withPage(async (page) => {
  const styleText = () => page.evaluate(async () => {
    const { appState } = await import("/src/app/state.ts")
    const { styleConfigPath } = await import("/src/app/config-context.ts")
    return appState.archive.getText(styleConfigPath())
  })
  await openTemplate(page, "xiaomi-unified-rounded-blur")
  await editMode(page)
  // The candidate bar: candidate words, the first candidate and the input code, without a font row.
  // Same as clicking the bar's background (the click handler opens the strip's .cnd); icons would select a toolbar item.
  await page.evaluate(async () => {
    const { selectFile } = await import("/src/app/navigation.ts")
    selectFile(document.querySelector("#toolbar-strip").dataset.path)
  })
  const group = page.locator(".text-style-fields")
  await group.waitFor({ state: "visible" })
  assert.equal(await group.locator("#font-file-field").isVisible(), false)
  assert.ok((await group.locator("#text-style-targets button").allTextContents()).includes("候选字"))
  assert.equal(await group.locator("input[aria-label='候选字字体名称']").count(), 0)
  const size = group.locator("input[aria-label='候选字字号']")
  await size.fill("41")
  await size.press("Enter")
  await page.waitForFunction(() => document.querySelector(".text-style-fields input[aria-label='候选字字号']")?.value === "41")
  assert.match(await styleText(), /FONT_SIZE\s*=\s*41/)
  assert.equal(await undoEnabled(page), true)
  // The whole layout writes every key's text style at once; mixed values say so.
  await page.keyboard.press("Escape")
  await page.evaluate(async () => {
    const { selectFile } = await import("/src/app/navigation.ts")
    const { appState } = await import("/src/app/state.ts")
    selectFile(appState.layoutPath)
  })
  await group.waitFor({ state: "visible" })
  const color = group.locator("input[aria-label='按键文字颜色值']")
  await color.fill("FF123456")
  await color.press("Enter")
  await page.waitForFunction(() => document.querySelector(".text-style-fields input[aria-label='按键文字颜色值']")?.value === "FF123456")
  assert.match(await styleText(), /NM_COLOR\s*=\s*FF123456/)
}))

await check("styles: library filters, search, preview, apply and new style", () => withPage(async (page) => {
  await openTemplate(page)
  await editMode(page)
  await selectKey(page)
  await railTab(page, "样式")
  const card = page.locator(".style-picker-state:visible").first()
  await card.click({ modifiers: ["Alt"] })
  // 网页端与桌面端共用 picker.html，样式库在页内弹窗的 iframe 里。
  const pickerDialog = page.locator("#picker-dialog")
  const library = page.frameLocator("#picker-frame")
  await pickerDialog.waitFor({ state: "visible" })
  await library.locator("#style-library-view:not([hidden])").waitFor()
  const kinds = await library.locator("[data-library-kind]:visible").evaluateAll((items) => items.map((item) => item.dataset.libraryKind))
  for (const kind of kinds) {
    const button = library.locator(`[data-library-kind="${kind}"]`)
    if (await button.isVisible()) await button.click()
  }
  for (const filter of ["panel", "key", "candidate", "foreground", "all"]) await library.locator(`[data-library-filter="${filter}"]`).click()
  await library.locator('[data-library-mode="images"]').click()
  await library.locator('[data-library-mode="styles"]').click()
  await library.locator("#resource-search").fill("zzzz-none")
  await library.locator("#style-library-empty").waitFor({ state: "visible" })
  await library.locator("#resource-search").fill("")
  await library.locator("#style-library-grid > *").first().click()
  await library.locator("#style-library-preview").waitFor({ state: "visible" })
  await library.locator("#style-library-apply").click()
  await pickerDialog.waitFor({ state: "hidden" })
  // Sidebar style list and the new-style dialog.
  await page.locator(".sidebar-overview button[data-path]", { hasText: "样式配置" }).first().click()
  await page.locator("#style-add").click()
  const dialog = page.locator("#new-style-dialog")
  await dialog.waitFor({ state: "visible" })
  assert.equal(await dialog.locator("header button").count(), 0, "no redundant header close button")
  await dialog.locator("#new-style-id").fill("9876")
  await dialog.locator("#new-style-submit").click()
  await dialog.waitFor({ state: "hidden" })
  await page.waitForFunction(() => /9876/.test(document.querySelector("#resource-name")?.textContent ?? "") || /STYLE9876/.test(document.querySelector("#source .cm-content")?.innerText ?? ""))
}))

/* ------------------------------------------------------------------------------------------------
 * 7 · Overview pages, images and slices, sounds, skin info
 * ---------------------------------------------------------------------------------------------- */
await check("overview: every sidebar item, image slices, sounds and info", () => withPage(async (page) => {
  await openTemplate(page)
  await editMode(page)
  const count = await page.locator(".sidebar-overview button[data-path]:visible").count()
  for (let index = 0; index < count; index += 1) {
    const item = page.locator(".sidebar-overview button[data-path]:visible").nth(index)
    await item.click()
    await page.waitForTimeout(120)
    // Image pages replace the overview list; come back to keep walking it.
    if (await page.locator("#atlas-back").isVisible()) await page.locator("#atlas-back").click()
    // So do 动效设计 / 粒子设计; without an anim.ini they first offer to create one.
    if (await page.locator("#create-animation-dialog[open]").isVisible()) await page.locator('#create-animation-dialog button[value="cancel"]').click()
    if (await page.locator("body.animation-workspace").count()) await page.locator('#animation-library button[aria-label="返回布局"]').click()
  }
  await page.locator(".sidebar-overview button[data-path]", { hasText: "图片资源" }).first().click()
  const image = page.locator("#resource-gallery > *").first()
  await image.click()
  await page.locator("#tile-inspector").waitFor({ state: "visible" })
  assert.equal(await page.locator("#tile-inspector .geometry-fields").first().isVisible(), false, "no empty slice fields before a slice is chosen")
  await page.locator("#new-tile").click()
  const atlas = await page.locator("#atlas-canvas:visible, #workspace-image:visible").first().boundingBox()
  await page.mouse.move(atlas.x + 4, atlas.y + 4)
  await page.mouse.down()
  await page.mouse.move(atlas.x + atlas.width / 3, atlas.y + atlas.height / 3, { steps: 6 })
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector("#tile-inspector")?.dataset.empty === "false", null, { timeout: 5000 }).catch(() => {})
  await page.locator("#atlas-zoom-in").click()
  // Like the main canvas: wheel zooms around the pointer, dragging pans.
  const zoomed = await page.locator("#atlas-canvas").boundingBox()
  const anchor = { x: zoomed.x + zoomed.width * 0.7, y: zoomed.y + zoomed.height * 0.6 }
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.wheel(0, -100)
  const wheeled = await page.locator("#atlas-canvas").boundingBox()
  assert.ok(wheeled.width > zoomed.width && wheeled.width < zoomed.width * 1.3, "one wheel notch zooms a modest step")
  assert.ok(Math.abs(wheeled.x + wheeled.width * 0.7 - anchor.x) < 3, "wheel zoom keeps the pointer anchor in place")
  await page.mouse.down()
  await page.mouse.move(anchor.x + 40, anchor.y + 30, { steps: 4 })
  await page.mouse.up()
  const panned = await page.locator("#atlas-canvas").boundingBox()
  assert.ok(Math.abs(panned.x - wheeled.x - 40) < 2 && Math.abs(panned.y - wheeled.y - 30) < 2, "dragging the image pans it")
  await page.locator("#atlas-zoom-fit").click()
  await page.locator("#atlas-back").click()
  await page.locator(".sidebar-overview button[data-path]", { hasText: "按键音效" }).first().click()
  await page.locator(".sidebar-overview button[data-path]", { hasText: "皮肤信息" }).first().click()
  const nameField = page.locator("#quick-inspector input:visible").first()
  await nameField.waitFor({ state: "visible" })
}))

/* ------------------------------------------------------------------------------------------------
 * 8 · Source files view and source editor
 * ---------------------------------------------------------------------------------------------- */
await check("source files: tree, editor, search, upload, copy/paste, delete and undo", () => withPage(async (page) => {
  await openTemplate(page)
  await editMode(page)
  await page.locator('[data-sidebar-view="source"]').click()
  await page.locator("#source-file-toolbar").waitFor({ state: "visible" })
  // 文件夹按需展开：逐层点开，直到出现 .ini 文件。
  // 访达式树：单击选中文件夹，点三角（或双击）展开。
  // 每次只展开第一个收起的文件夹：展开会插入子节点，提前取的列表会失效。
  for (let round = 0; round < 12 && !(await page.locator('.source-file-row[data-path$=".ini"]:visible').count()); round += 1) {
    const folder = page.locator('.source-folder-row[aria-expanded="false"]:visible').first()
    const path = await folder.getAttribute("data-folder-path")
    await folder.locator(".source-disclosure").click()
    await page.waitForFunction((value) => document.querySelector(`.source-folder-row[data-folder-path="${CSS.escape(value)}"]`)?.getAttribute("aria-expanded") === "true", path)
  }
  const file = page.locator('.source-file-row[data-path$=".ini"]:visible').first()
  await file.waitFor({ state: "visible" })
  await file.click()
  await page.locator('[data-inspector-tab="source"]').click()
  await page.waitForFunction(() => (document.querySelector("#source .cm-content")?.innerText ?? "").includes("["))
  await page.locator("#source-find-toggle").click()
  await page.locator("#source-search").fill("STYLE")
  await page.waitForFunction(() => /\d/.test(document.querySelector("#source-search-count")?.textContent ?? ""))
  await page.locator("#source-search-next").click()
  const before = await page.locator(".source-file-row").count()
  await page.locator("#source-upload-input").setInputFiles({ name: "flow-test.png", mimeType: "image/png", buffer: pngBytes(8, 8) })
  await page.waitForFunction((count) => document.querySelectorAll(".source-file-row").length > count, before)
  const uploaded = page.locator('.source-file-row[data-path$="flow-test.png"]')
  await uploaded.click()
  await page.locator("#source-copy").click()
  await page.locator("#source-paste").click()
  // 粘贴回原文件夹得到「flow-test 副本.png」，且保持展开、选中新文件。
  const copy = page.locator('.source-file-row[data-path$="flow-test 副本.png"]')
  await copy.waitFor({ state: "visible" })
  assert.match(await copy.getAttribute("class"), /selected|active/)
  await copy.click()
  await page.locator("#source-delete").click()
  await copy.waitFor({ state: "detached" })
  assert.equal(await uploaded.isVisible(), true, "the tree stays open after deleting")
  await page.locator("#desktop-undo").click()
  await page.waitForFunction(() => document.querySelectorAll('.source-file-row[data-path*="flow-test"]').length === 2)
  await page.locator('[data-sidebar-view="overview"]').click()
}))

/* ------------------------------------------------------------------------------------------------
 * 9 · Tool dialogs from the file menu: panel copy, replace keyboard style, iOS 26
 * ---------------------------------------------------------------------------------------------- */
await check("tools: panel copy, replace keyboard style and iOS 26 adaptation", () => withPage(async (page) => {
  await openTemplate(page)
  await openFileMenu(page)
  assert.equal(await page.locator("#panel-scale").isDisabled(), true, "tools need edit mode")
  await page.keyboard.press("Escape")
  await editMode(page)
  // Panel copy creates a new layout file.
  await openFileMenu(page)
  await page.locator("#panel-scale").click()
  const copy = page.locator("#panel-scale-dialog")
  await copy.waitFor({ state: "visible" })
  const target = await page.locator("#panel-copy-target").inputValue()
  assert.ok(target, "target path suggested")
  await page.locator("#panel-scale-enabled").check()
  await page.locator("#panel-scale-options").waitFor({ state: "visible" })
  await page.locator("#panel-scale-enabled").uncheck()
  await copy.getByRole("button", { name: "复制", exact: true }).click()
  await copy.waitFor({ state: "hidden" })
  await page.locator('[data-sidebar-view="source"]').click()
  assert.match(await page.locator("#event-log").textContent(), /复制面板完成/)
  assert.ok(await page.evaluate((path) => [...document.querySelectorAll("[data-path]")].some((row) => row.dataset.path === path), target), "copied layout listed")
  await page.locator('[data-sidebar-view="overview"]').click()
  // Replace keyboard style with an uploaded PNG, then undo it.
  await openFileMenu(page)
  await page.locator("#replace-layout-image").click()
  const replace = page.locator("#layout-image-dialog")
  await replace.waitFor({ state: "visible" })
  assert.equal(await replace.locator("header button").count(), 0, "no redundant header close button")
  await page.locator("#layout-image-open").setInputFiles({ name: "style.png", mimeType: "image/png", buffer: pngBytes(120, 60) })
  await page.waitForFunction(() => !document.querySelector("#layout-image-apply").disabled)
  for (const target of ["key-normal", "candidate", "panel"]) {
    await replace.locator(`label:has(input[value="${target}"])`).click()
    assert.equal(await replace.locator(`input[value="${target}"]`).isChecked(), true)
  }
  await page.locator("#layout-image-apply").click()
  await replace.waitFor({ state: "hidden" })
  await page.locator("#desktop-undo").click()
  // iOS 26 adaptation.
  await openFileMenu(page)
  await page.locator("#adapt-ios26").click()
  const ios = page.locator("#ios26-dialog")
  await ios.waitFor({ state: "visible" })
  await ios.getByRole("button", { name: "开始适配", exact: true }).click()
  await ios.waitFor({ state: "hidden" })
  await closeOperationDialog(page)
  assert.equal(await undoEnabled(page), true)
}))

/* ------------------------------------------------------------------------------------------------
 * 10 · Settings
 * ---------------------------------------------------------------------------------------------- */
await check("settings: every page, live preview, cancel restores and save persists", () => withPage(async (page) => {
  await openTemplate(page)
  await page.locator(".titlebar-preferences").click()
  const dialog = page.locator("#settings-dialog")
  await dialog.waitFor({ state: "visible" })
  for (const tab of await page.locator(".settings-nav-item:visible").all()) {
    await tab.click()
    assert.equal(await tab.getAttribute("aria-selected"), "true")
  }
  await page.locator('[data-settings-page="appearance"]').click()
  const accent = await page.locator('[data-settings-page="appearance"]').evaluate((node) => getComputedStyle(node).color)
  const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim())
  assert.ok(brand, "accent token resolves")
  assert.notEqual(accent, "rgb(255, 107, 44)", "selected settings tab uses the accent, not the selection orange")
  await page.locator('[data-setting-choice="app-theme"][data-value="dark"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.appTheme === "dark")
  await page.locator("#interface-accent").evaluate((input) => {
    input.value = "#12a150"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
  const applied = await page.evaluate(() => getComputedStyle(document.querySelector(".source")).getPropertyValue("--accent").trim())
  assert.equal(applied.toLowerCase(), "#12a150", "accent reaches the inspector")
  await page.locator("#settings-cancel").click()
  await dialog.waitFor({ state: "hidden" })
  await page.waitForFunction(() => document.documentElement.dataset.appTheme !== "dark")
  await page.locator(".titlebar-preferences").click()
  await page.locator('[data-setting-choice="interface-density"][data-value="compact"]').click()
  await page.locator("#settings-save").click()
  await dialog.waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => localStorage.getItem("interface-density")), "compact")
  await page.locator(".titlebar-preferences").click()
  await page.locator("#settings-close").click()
  await dialog.waitFor({ state: "hidden" })
}))

/* ------------------------------------------------------------------------------------------------
 * 11 · Rename, save, export, unsaved changes
 * ---------------------------------------------------------------------------------------------- */
await check("file: rename, save, export every format and unsaved prompt", () => withPage(async (page) => {
  await openTemplate(page)
  await page.locator("#document-name").click()
  await page.getByRole("textbox", { name: "皮肤名称" }).fill("导出测试.bds")
  await page.keyboard.press("Enter")
  assert.equal(await page.locator("#document-name").textContent(), "导出测试.bds")
  const download = async (trigger) => {
    const pending = page.waitForEvent("download", { timeout: 60000 })
    pending.catch(() => {})
    await trigger()
    const tap = page.locator("#file-operation-dialog[open] button.primary", { hasText: "下载" })
    const tapped = tap.waitFor({ state: "visible", timeout: 60000 }).then(() => "tap")
    tapped.catch(() => {})
    const result = await Promise.race([pending, tapped])
    if (result === "tap") {
      await tap.click()
      return pending
    }
    return result
  }
  // BDS 皮肤只能导出旧格式，BDA 导出项隐藏而不是置灰。
  assert.equal(await page.locator('.pen-file-menu [data-export-format="bda"]:not([hidden])').count(), 0, "BDA export hidden for BDS")
  const exportAll = async () => {
    const names = []
    const formats = await page.locator(".pen-file-menu [data-export-format]:not([hidden])").evaluateAll((items) => items.map((item) => [item.dataset.exportFormat, item.dataset.bdaPlatform ?? ""]))
    for (const [format, platform] of formats) {
      const item = page.locator(`.pen-file-menu [data-export-format="${format}"]${platform ? `[data-bda-platform="${platform}"]` : ""}`)
      const file = await download(async () => {
        await openFileMenu(page)
        await item.click()
      })
      names.push(file.suggestedFilename().split(".").pop())
      await page.locator('#file-operation-dialog[open][data-outcome="success"]').waitFor()
      assert.equal(await page.locator("#file-operation-title").textContent(), "导出成功")
      await closeOperationDialog(page)
    }
    return names
  }
  assert.deepEqual(await exportAll(), ["bdi", "bds", "sxi", "ssf"])
  // Edit, then try to start a new skin: the unsaved prompt appears.
  await editMode(page)
  await selectKey(page)
  const x = page.locator("[data-key-field=x]")
  await x.fill(String(Number(await x.inputValue()) + 1))
  await x.press("Enter")
  await page.locator("#dirty").waitFor({ state: "visible" })
  assert.equal(await page.locator("#dirty").textContent(), "未保存")
  const saved = await download(async () => {
    await openFileMenu(page)
    await page.locator("#save").click()
  })
  assert.match(saved.suggestedFilename(), /\.bds$/)
  await page.locator('#file-operation-dialog[open][data-outcome="success"]').waitFor()
  assert.equal(await page.locator("#file-operation-title").textContent(), "保存成功")
  await closeOperationDialog(page)
  await x.fill(String(Number(await x.inputValue()) + 1))
  await x.press("Enter")
  // 先选模板，替换当前皮肤前才提示未保存。
  await openFileMenu(page)
  await page.locator("#new").click()
  await page.locator("#new-project-dialog").getByRole("button", { name: "创建皮肤", exact: true }).click()
  const unsaved = page.locator("#unsaved-dialog")
  await unsaved.waitFor({ state: "visible" })
  await unsaved.getByRole("button", { name: "取消", exact: true }).click()
  await unsaved.waitFor({ state: "hidden" })
  assert.equal(await page.locator("#document-name").textContent(), "导出测试.bds", "cancel keeps the current skin")
}))

await check("file: a BDA skin exports to every format", () => withPage(async (page) => {
  await openTemplate(page, "default-android")
  const formats = []
  for (const item of await page.locator(".pen-file-menu [data-export-format]:not([hidden])").all()) {
    const pending = page.waitForEvent("download", { timeout: 60000 })
    pending.catch(() => {})
    await openFileMenu(page)
    await item.click()
    const tap = page.locator("#file-operation-dialog[open] button.primary", { hasText: "下载" })
    const tapped = tap.waitFor({ state: "visible", timeout: 60000 }).then(() => "tap")
    tapped.catch(() => {})
    if ((await Promise.race([pending, tapped])) === "tap") await tap.click()
    formats.push((await pending).suggestedFilename().split(".").pop())
    await page.locator('#file-operation-dialog[open][data-outcome="success"]').waitFor()
    assert.equal(await page.locator("#file-operation-title").textContent(), "导出成功")
    await closeOperationDialog(page)
  }
  assert.deepEqual(formats, ["bdi", "bds", "bda", "bda", "sxi", "ssf"])
}))

await check("file: a Sogou .ssf lists only its own files: preview switching, properties, key selection, AI design", () => withPage(async (page) => {
  const { ssfFixture } = await import("../tests/helpers/ssf-fixture.mjs")
  await page.locator("#browser-open").setInputFiles({ name: "搜狗测试.ssf", mimeType: "application/octet-stream", buffer: Buffer.from(ssfFixture()) })
  await page.waitForSelector(".canvas-wrap:not(.empty)")
  await closeOperationDialog(page)
  await page.waitForFunction(() => !document.querySelector("#open")?.disabled)
  assert.equal(await page.locator("#document-name").textContent(), "搜狗测试.ssf")
  // The source tree lists the Sogou files only; the converted Baidu tree behind the preview stays hidden.
  assert.equal(await page.locator('.raw-files [data-path^="light/"]').count(), 0)
  // Overview entries are SSF files, plus Sogou's keyboards drawn from the official skeleton.
  assert.equal(await page.locator('[data-sidebar-view="overview"]').isDisabled(), false)
  await page.locator('[data-sidebar-view="overview"]').click()
  const { unzipSync: unzipSsf } = await import("fflate")
  const ownPaths = new Set(Object.keys(unzipSsf(ssfFixture())))
  const overviewPaths = await page.locator('.sidebar-overview button[data-path]:not(.nav-layout)').evaluateAll((items) => items.map((item) => item.dataset.path))
  assert.ok(overviewPaths.length > 0)
  for (const path of overviewPaths) assert.ok(ownPaths.has(path), `Only real SSF files: ${path}`)
  assert.equal(await page.locator('.sidebar-overview button[data-path="phoneTheme.ini"]').count(), 1)
  assert.equal(await page.locator('.sidebar-overview button[data-path="1080/status1/phoneSkin.ini"]').count(), 1)
  assert.equal(await page.locator('.sidebar-overview button[data-path^="light/"]').count(), 31)
  for (const group of await page.locator('.sidebar-overview .nav-group').all()) {
    assert.equal(Number(await group.locator('.nav-section-count').textContent()), await group.locator('button[data-path]').count())
  }
  const images = page.locator('.sidebar-overview button.nav-resource', { hasText: '图片资源' })
  const imagePath = await images.getAttribute('data-path')
  assert.match(imagePath, /\.(png|webp|jpe?g)$/i, 'image gallery points at a real image, not phoneSkin.ini')
  assert.ok(ownPaths.has(imagePath))
  await images.click()
  await page.waitForFunction(() => document.querySelectorAll('#resource-gallery .resource-item').length > 0)
  await page.getByRole('button', { name: '返回布局', exact: true }).click()
  await page.locator('.sidebar-overview button[data-path="1080/status1/phoneSkin.ini"]').click()
  assert.equal(await page.locator('#source-name').textContent(), '1080/status1/phoneSkin.ini')
  await page.locator('.sidebar-overview button[data-path="light/skin/port/py_9.ini"]').click()
  await editMode(page)
  await page.locator('.sidebar-overview button[data-path="light/skin/port/py_9.ini"]').click()
  assert.equal(await page.locator("#selected-key").textContent(), "拼音 9 键")
  assert.equal(await page.locator("#selected-key-context").textContent(), "1080/status1/phoneSkin.ini")
  await page.locator('[data-orientation-choice="land"]').click()
  await page.waitForFunction(() => document.querySelector("#panel-status")?.textContent.includes("1920 × 570"))
  const landscapeGeometry = () => page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const box = document.querySelector('#preview').getBoundingClientRect()
    return { width: preview.panelWidth, height: preview.panelHeight, xScale: box.width / preview.panelWidth, yScale: box.height / preview.surfaceHeight }
  })
  const fitted = await landscapeGeometry()
  assert.deepEqual([fitted.width, fitted.height], [1920, 570])
  assert.ok(Math.abs(fitted.xScale - fitted.yScale) < 0.002, 'landscape preview keeps a uniform display scale')
  await page.locator('#preview-zoom-in').click()
  const zoomed = await landscapeGeometry()
  assert.ok(zoomed.xScale > fitted.xScale)
  assert.ok(Math.abs(zoomed.xScale - zoomed.yScale) < 0.002, 'zoom preserves landscape proportions')
  await page.locator('#preview-zoom-fit').click()
  assert.equal(await page.locator('.sidebar-overview button[data-path^="light/skin/port/"]').count(), 0)
  const landscapePaths = await page.locator('.sidebar-overview button.nav-layout').evaluateAll((items) => items.map((item) => item.dataset.path))
  assert.ok(landscapePaths.length > 0)
  for (const path of landscapePaths) assert.match(path, /^light\/skin\/land\//, 'landscape keeps only its own preview boards')
  assert.equal(await page.locator("#selected-key-context").textContent(), "1080/status1/phoneSkin.ini")
  await page.locator('[data-orientation-choice="port"]').click()
  await page.waitForFunction(() => document.querySelector("#panel-status")?.textContent.includes("1080 × 642"))
  const groups = await page.locator("#document-fields > [data-inspector-group-label]").evaluateAll((items) => items.map((item) => item.dataset.inspectorGroupLabel))
  for (const group of ["键盘背景", "候选栏", "候选字", "按键背景", "音效"]) assert.ok(groups.includes(group), group)
  const candidateColor = () => page.locator("#candidate-words").evaluate((node) => node.style.color)
  assert.equal(await candidateColor(), "rgb(1, 2, 3)")
  // A Sogou property is written to the skin's own INI and the canvas redraws from it.
  const colorValue = page.locator('#document-fields [data-inspector-group-label="候选字"] .color-control > input:not([type])').first()
  assert.equal(await colorValue.inputValue(), "0xFF010203")
  await colorValue.fill("0xFFFF0000")
  await colorValue.press("Enter")
  await page.waitForFunction(() => document.querySelector("#candidate-words")?.style.color === "rgb(255, 0, 0)", null, { timeout: 15000 })
  assert.equal(await page.locator("#dirty").isVisible(), true)
  // The board's source is its phoneSkin.ini, edited in place.
  await page.locator('[data-inspector-tab="source"]').click()
  await page.waitForFunction(() => (document.querySelector("#source .cm-content")?.innerText ?? "").includes("TextStyle_Candidate"))
  assert.equal(await page.locator("#source-name").textContent(), "1080/status1/phoneSkin.ini")
  await page.locator('[data-inspector-tab="properties"]').click()
  // Clicking a key selects it and shows the Sogou classes it is drawn from; it cannot be moved or deleted.
  await page.locator('.sidebar-overview button[data-path="light/skin/port/py_26.ini"]').click()
  await clickCanvas(page, 0.5, 0.4)
  await page.waitForSelector('#document-fields [data-inspector-group-label="背景"]')
  assert.match(await page.locator("#selected-key-context").textContent(), /^status1\/phoneSkin\.ini · Key_/)
  assert.equal(await page.locator("#document-fields [data-inspector-group-label=\"背景\"]").count(), 1)
  assert.equal(await page.locator('[data-key-action="delete"]').isHidden(), true)
  await page.keyboard.press("Delete")
  assert.equal(await page.locator("#document-fields [data-inspector-group-label=\"背景\"]").count(), 1)
  await page.locator("#desktop-undo").click()
  await page.waitForFunction(() => document.querySelector("#candidate-words")?.style.color === "rgb(1, 2, 3)", null, { timeout: 15000 })
  await page.locator("#desktop-redo").click()
  await page.waitForFunction(() => document.querySelector("#candidate-words")?.style.color === "rgb(255, 0, 0)", null, { timeout: 15000 })
  // Saving writes the .ssf; BDS and BDA exports go through the converter.
  const pending = page.waitForEvent("download", { timeout: 60000 })
  await openFileMenu(page)
  await page.locator("#save").click()
  const saved = await pending
  await closeOperationDialog(page)
  const { unzipSync, strFromU8 } = await import("fflate")
  const savedFiles = unzipSync(new Uint8Array(readFileSync(await saved.path())))
  assert.match(strFromU8(savedFiles["1080/status1/phoneSkin.ini"]), /TEXT_COLOR=0xFFFF0000/)
  assert.equal(Object.keys(savedFiles).length, Object.keys(unzipSync(ssfFixture())).length)
  assert.equal(await page.locator("#dirty").isVisible(), false)
  const visibleFormats = await page.locator(".pen-file-menu [data-export-format]:not([hidden])").evaluateAll((items) => items.map((item) => item.dataset.exportFormat))
  assert.deepEqual(visibleFormats, ["bdi", "bds", "bda", "bda", "ssf"])
  // A skin with one look has no night preview to switch to, and switching never adds Baidu files to it.
  await page.locator("#browser-open").setInputFiles({ name: "单外观.ssf", mimeType: "application/octet-stream", buffer: Buffer.from(ssfFixture({ single: true })) })
  await page.waitForFunction(() => document.querySelector("#document-name")?.textContent === "单外观.ssf", null, { timeout: 60000 })
  await closeOperationDialog(page)
  await page.locator('[data-theme-choice="dark"]').first().click()
  await page.waitForFunction(() => /没有这种外观/.test(document.querySelector("#event-log")?.textContent ?? ""))
  assert.equal(await page.locator("#theme").inputValue(), "light")
  assert.equal(await page.locator('#files [data-path^="dark/"]').count(), 0)
  assert.equal(await page.locator("#dirty").isVisible(), false)
}))

/* ------------------------------------------------------------------------------------------------
 * 12 · Web build hides desktop-only entries
 * ---------------------------------------------------------------------------------------------- */
await check("web: recent files and AI design are hidden; AI composer keeps keys off the canvas", () => withPage(async (page) => {
  assert.equal(await page.locator("#welcome-recent-open").isVisible(), true)
  for (const selector of [".welcome-recent h2", "#welcome-recent-empty"]) assert.equal(await page.locator(selector).isHidden(), true, selector)
  await openTemplate(page)
  for (const selector of ["#recent-files", '[data-inspector-tab="ai"]']) assert.equal(await page.locator(selector).isHidden(), true, selector)
  // 网页端隐藏了 AI 设计标签；面板本身与桌面端相同，在这里放出标签继续检查它。
  await page.locator('[data-inspector-tab="ai"]').evaluate((tab) => { tab.hidden = false })
  await editMode(page)
  await selectKey(page)
  await page.locator('[data-inspector-tab="ai"]').click()
  await page.locator("#ai-design-panel").waitFor({ state: "visible" })
  assert.match(await page.locator("#ai-context-key").textContent(), /KEY|按键/)
  // Keys typed into the composer (inside deep-chat's shadow root) edit the prompt, never the canvas selection.
  const composer = page.locator("#ai-design-chat #text-input")
  await composer.click()
  await page.keyboard.type("换成深色")
  await page.keyboard.press("Backspace")
  await page.keyboard.press("Backspace")
  assert.equal((await composer.textContent()).trim(), "换成")
  assert.equal(await undoEnabled(page), false, "Backspace in the composer must not delete the selected key")
  assert.equal(await page.locator("#ai-context-key").isVisible(), true, "the key stays selected")
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.press("Backspace")
  assert.equal(await composer.evaluate((input) => input.innerHTML), "", "an emptied composer shows its placeholder again")
  await page.locator("#ai-design-scope").click()
  assert.equal(await page.locator("#ai-design-scope").getAttribute("aria-pressed"), "true")
  assert.equal(await page.locator("#ai-design-scope").textContent(), "整个皮肤")
  await page.locator('[data-inspector-tab="properties"]').click()
}))

/* ------------------------------------------------------------------------------------------------
 * 13 · Real skins: open .bdi / .bds / .bda files from disk and inspect them
 * ---------------------------------------------------------------------------------------------- */
const skinDirectory = process.env.REAL_SKINS_DIR ?? "/Users/kaze/work/bd"
if (existsSync(skinDirectory)) {
  const skins = readdirSync(skinDirectory).filter((name) => /\.(bdi|bds|bda)$/i.test(name)).sort()
  const limit = Number(process.env.REAL_SKINS_LIMIT ?? skins.length)
  await check(`real skins: ${Math.min(limit, skins.length)} files open, render and inspect`, () => withPage(async (page) => {
    const failures = []
    for (const name of skins.slice(0, limit)) {
      try {
        await page.locator("#browser-open").setInputFiles({ name, mimeType: "application/octet-stream", buffer: readFileSync(join(skinDirectory, name)) })
        await page.waitForFunction((file) => document.querySelector("#document-name")?.textContent?.includes(file.replace(/\.[^.]+$/, "")), name, { timeout: 60000 })
        await closeOperationDialog(page)
        // 标题在加载中途就会更新；等「打开」重新可用，表示整个打开操作结束。
        await page.waitForFunction(() => !document.querySelector("#open")?.disabled, null, { timeout: 60000 })
        await page.waitForFunction(() => document.querySelector("#preview")?.getBoundingClientRect().height > 20, null, { timeout: 15000 })
        if ((await page.locator("#mode").inputValue()) !== "edit") await editMode(page)
        // 键位不一定落在画布 45% 处，选不中不算失败。
        await selectKey(page, { timeout: 3000 }).catch(() => {})
        // Leave edits behind so the next open goes through the unsaved prompt path cleanly.
        if (await page.locator("#unsaved-dialog").isVisible()) await page.locator("#unsaved-dialog").getByRole("button", { name: "不保存" }).click()
      } catch (error) {
        const status = await page.locator("#event-log").textContent().catch(() => "")
        failures.push(`${name}: ${error.message.split("\n")[0]} · 状态：${status} · 标题：${await page.locator("#document-name").textContent().catch(() => "")}`)
        await closeOperationDialog(page).catch(() => {})
      }
    }
    assert.equal(failures.length, 0, failures.join("\n"))
  }))
}

/* ------------------------------------------------------------------------------------------------
 * 14 · Dark theme renders the same layout
 * ---------------------------------------------------------------------------------------------- */
await check("dark theme: inspector, sidebar and dialogs share the dark palette", () => withPage(async (page) => {
  await openTemplate(page)
  await editMode(page)
  await selectKey(page)
  const colors = await page.evaluate(() => {
    const luma = (element) => {
      const [r, g, b] = (getComputedStyle(element).backgroundColor.match(/\d+/g) ?? []).map(Number)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    return { inspector: luma(document.querySelector("#quick-inspector")), sidebar: luma(document.querySelector("aside.sidebar")) }
  })
  assert.ok(colors.inspector < 60 && colors.sidebar < 60, `dark surfaces (${JSON.stringify(colors)})`)
}, { storage: { "app-theme": "dark" }, colorScheme: "dark" }))

await browser.close()
await server?.close()

for (const result of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name} (${(result.ms / 1000).toFixed(1)}s)${result.ok ? "" : `\n     ${String(result.error.message).split("\n").slice(0, 14).join("\n     ")}`}`)
}
const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
