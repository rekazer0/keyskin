// 使用教程（新手引导）端到端测试：电脑与手机竖屏各走一遍完整流程。
// Run: node scripts/test-onboarding.mjs
// Starts a Vite dev server and drives Chromium through Playwright (a local or global
// `playwright` install; set PLAYWRIGHT_MODULE to its path if it cannot be found).
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createServer } from "vite"

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
const root = new URL("..", import.meta.url).pathname
const server = await createServer({ root, logLevel: "error", server: { port: 41760, strictPort: false, host: "127.0.0.1" } })
await server.listen()
const address = server.httpServer.address()
const baseURL = `http://127.0.0.1:${address.port}/`
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})

const phoneUA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"
const results = []

async function check(name, run) {
  try {
    await run()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error })
  }
}

async function withPage(viewport, mobile, run) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? phoneUA : undefined })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(baseURL)
  await page.waitForSelector(".template-card")
  try {
    await run(page)
    assert.deepEqual(errors, [], "page errors")
  } finally {
    await context.close()
  }
}

const stepTitle = (page) => page.locator(".ui-tour-card h2").textContent()

async function expectStep(page, title) {
  await page.waitForFunction((text) => document.querySelector(".ui-tour:not([hidden]) .ui-tour-card h2")?.textContent === text, title)
}

const next = (page) => page.locator(".ui-tour-card footer .ui-button[data-variant=primary]").click()

/** The highlighted hole must line up with the element the step points at. */
async function assertRingOn(page, selector) {
  await page.waitForTimeout(100)
  const [ring, target] = await Promise.all([".ui-tour-ring", selector].map((item) => page.locator(item).first().boundingBox()))
  assert.ok(ring && target, `ring and ${selector} visible`)
  const viewport = page.viewportSize()
  const right = Math.min(target.x + target.width, viewport.width)
  const bottom = Math.min(target.y + target.height, viewport.height)
  assert.ok(ring.x <= Math.max(target.x, 0) && ring.y <= Math.max(target.y, 0), `ring starts at ${selector}`)
  assert.ok(ring.x + ring.width >= right - 1 && ring.y + ring.height >= bottom - 1, `ring covers ${selector}`)
}

async function walkTour(page, compact) {
  await page.locator(".welcome-note [data-start-tour]").click()
  await expectStep(page, "欢迎使用键设")
  assert.equal(await page.locator(".ui-tour-card footer .ui-button:visible").count(), 1, "first step only offers 开始")
  await next(page)
  await expectStep(page, "打开已有皮肤")
  await assertRingOn(page, "#welcome-recent-open")
  await next(page)

  await expectStep(page, "从模板新建皮肤")
  assert.equal(await page.locator(".ui-tour[data-action]").count(), 1, "template step waits for a click")
  // The page outside the highlighted card is blocked.
  await page.mouse.click(5, 300)
  assert.equal(await stepTitle(page), "从模板新建皮肤")
  await page.locator('.template-card[data-template="default-android"]').click()
  await expectStep(page, "画布：实时预览")
  assert.equal(await page.locator(".canvas-wrap.empty").count(), 0, "template opened")
  await next(page)
  await expectStep(page, "预览选项")
  await next(page)

  await expectStep(page, "切换到编辑模式")
  await page.locator(compact ? '[data-mobile-choice="mode"]' : '[data-mode-choice="edit"]').click()
  await expectStep(page, "选中一个按键")
  assert.equal(await page.inputValue("#mode"), "edit")
  const canvas = await page.locator("#preview").boundingBox()
  await page.mouse.click(canvas.x + canvas.width * 0.45, canvas.y + canvas.height * 0.45)
  await expectStep(page, "属性检查器")
  await assertRingOn(page, "section.source")
  await next(page)
  await expectStep(page, compact ? "切换编辑区域" : "概览与源文件")
  await next(page)
  await expectStep(page, "设置")
  await next(page)

  await expectStep(page, "保存与导出")
  const menu = ".pen-file-menu"
  await page.locator(`${menu} > summary`).click()
  await expectStep(page, "导出给输入法")
  await assertRingOn(page, `${menu}[open] .ui-menu`)
  // Going back skips the step that was completed by opening the menu, and the menu closes with its step.
  await page.locator(".ui-tour-card footer .ui-button[data-variant=quiet]").click()
  await expectStep(page, "设置")
  assert.equal(await page.locator(`${menu}[open]`).count(), 0, "menu closed when leaving its step")
  await next(page)
  await expectStep(page, "保存与导出")
  await page.locator(`${menu} > summary`).click()
  await expectStep(page, "导出给输入法")
  // Pressing the card's buttons must not close the menu being explained.
  await page.locator(".ui-tour-card").click({ position: { x: 20, y: 20 } })
  assert.equal(await page.locator(`${menu}[open]`).count(), 1, "menu stays open while explained")
  await next(page)
  await expectStep(page, "准备就绪")
  assert.equal(await page.locator(`${menu}[open]`).count(), 0, "menu closed after its step")
  await next(page)
  await page.waitForSelector(".ui-tour", { state: "detached" })
  assert.equal(await page.evaluate(() => localStorage.getItem("onboarding-tour-v1")), "done")
}

await check("desktop: the tutorial walks through creating, editing and exporting a skin", () =>
  withPage({ width: 1440, height: 900 }, false, (page) => walkTour(page, false)))

await check("phone portrait: the tutorial uses the phone layout", () =>
  withPage({ width: 390, height: 844 }, true, (page) => walkTour(page, true)))

await check("Esc leaves the tutorial and the menu entry restarts it with the skin already open", () =>
  withPage({ width: 1280, height: 800 }, false, async (page) => {
    await page.locator('.template-card[data-template="default-android"]').click()
    await page.waitForSelector(".canvas-wrap:not(.empty)")
    await page.locator(".pen-file-menu > summary").click()
    await page.locator(".pen-file-menu [data-start-tour]").click()
    await expectStep(page, "欢迎使用键设")
    await next(page)
    await expectStep(page, "画布：实时预览")
    assert.equal(await page.locator(".ui-tour-step").textContent(), "2 / 11", "welcome-page steps are left out")
    await page.keyboard.press("Escape")
    await page.waitForSelector(".ui-tour", { state: "detached" })
    assert.equal(await page.evaluate(() => localStorage.getItem("onboarding-tour-v1")), "done")
  }))

await browser.close()
await server.close()

for (const result of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok ? "" : `\n     ${result.error.message.split("\n")[0]}`}`)
}
const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
