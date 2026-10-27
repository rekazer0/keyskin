// Real editor UI + a BDS ZIP fixture. Exercises the native anim.ini inspector integration.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"
import { unzipSync, zipSync, strToU8 } from "fflate"

const animationPath = "light/skin/res/anim.ini"
const original = [
  "; unknown comments and formatting survive edits", "ANIM_NUM=7", "VENDOR_GLOBAL = keep-global", "",
  "[ANIM1]", "CATEGORY=0", "TYPE=0", "DURATION=160", "DELAY=10", "REPEAT_CNT=2", "REPEAT_MODE=0", "REMOVE=0", "INTPOL=0", "FROM=255", "TO=0", "VENDOR_TEXT = odd,value=keep", "",
  "[ANIM2]", "CATEGORY=0", "TYPE=2", "DURATION=200", "FROM_PX=1,2", "TO_PX=30,40", "PIVOT=50,50", "INTPOL=2,3", "",
  "[ANIM3]", "CATEGORY=1", "BUILD_NUM=2", "BUILD_LIST=1,2", "BUILD_METHOD=0", "VENDOR_COMBO=keep-combo", "",
  "[ANIM4]", "CATEGORY=3", "DURATION=500", "PARTICLE_IMAGE=1", "LIFE=500,1000", "EMIT_REGION=0,0,1,1", "TOTAL_NUMBER=12", "BIRTH_RATE=4", "EMIT_TYPE=7", "VELOCITY=1,2", "INIT_ALPHA=120,255", "",
  "[ANIM5]", "CATEGORY=0", "TYPE=3", "FROM=80,90", "TO=100,110", "DURATION=100", "",
  "[ANIM6]", "CATEGORY=2", "SOURCE_FILE=frames.webp", "MODIFY=1", "DURATION=600", "OFFSET=2,3", "",
  "[ANIM7]", "CATEGORY=77", "TYPE=88", "FROM=custom,tuple,keep", "DURATION=unchanged-unit", "UNKNOWN_ANIMATION=keep-unknown", "",
  "[VENDOR_SECTION]", "MixedCaseKey = preserve=exact", "",
].join("\r\n")
const files = unzipSync(readFileSync(new URL("../public/default-template.bds", import.meta.url)))
files["res/anim.ini"] = strToU8(original)
const fixture = Buffer.from(zipSync(files, { level: 1 }))
let browser
let server
const errors = []

try {
  server = await createServer({
    root: new URL("..", import.meta.url).pathname,
    logLevel: "error",
    server: { port: 41836, strictPort: false, host: "127.0.0.1", hmr: false },
  })
  await server.listen()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("dialog", (dialog) => dialog.accept())
  const baseURL = `http://127.0.0.1:${server.httpServer.address().port}/`
  const section = (id) => page.locator(`#document-fields > [data-animation-section="ANIM${id}"]`)
  const row = (id, key) => section(id).locator(`[data-document-key="${key}"]`)
  const input = (id, key) => row(id, key).locator("input").first()
  const read = () => page.evaluate(async (path) => {
    const { appState } = await import("/src/app/state.ts")
    return appState.archive.getText(path)
  }, animationPath)
  const value = (id, key) => page.evaluate(async ({ path, id, key }) => {
    const { appState } = await import("/src/app/state.ts")
    const { IniDocument } = await import("/src/ini.ts")
    return IniDocument.parse(appState.archive.getText(path)).get(`ANIM${id}`, key) ?? null
  }, { path: animationPath, id, key })
  const waitValue = (id, key, expected) => page.waitForFunction(async ({ path, id, key, expected }) => {
    const { appState } = await import("/src/app/state.ts")
    const { IniDocument } = await import("/src/ini.ts")
    return (IniDocument.parse(appState.archive.getText(path)).get(`ANIM${id}`, key) ?? null) === expected
  }, { path: animationPath, id, key, expected })
  const change = async (field, text) => {
    await field.fill(text)
    await field.press("Enter")
  }
  const history = async (action) => {
    await page.evaluate(async (action) => { const history = await import("/src/app/edit-history.ts"); history[action]() }, action)
  }
  const open = async (buffer = fixture, name = "animation.bds", editing = true) => {
    await page.goto(baseURL)
    await page.locator("#browser-open").setInputFiles({ name, mimeType: "application/octet-stream", buffer })
    await page.waitForFunction(() => !document.querySelector("#open").disabled)
    const close = page.locator("#file-operation-dialog[open] #file-operation-close")
    if (await close.isVisible().catch(() => false)) await close.click()
    if (editing) await page.getByRole("button", { name: "编辑模式", exact: true }).click()
    await page.evaluate(async (path) => { const { selectFile } = await import("/src/app/navigation.ts"); selectFile(path) }, animationPath)
    await section(1).waitFor({ state: "visible" })
    await page.waitForTimeout(100)
  }

  await open()
  assert.equal(await read(), original, "rendering never rewrites the INI")
  assert.equal(await page.locator("#document-fields > [data-animation-section^='ANIM']").count(), 7)
  assert.ok((await page.locator("#mobile-inspector-groups button").allTextContents()).includes("动画 1"))
  assert.equal(await input(2, "FROM_PX").inputValue(), "1")
  assert.equal(await row(2, "FROM_PX").locator(".ui-field-pair input").count(), 2)
  assert.equal(await row(5, "FROM").locator(".ui-field-pair input").count(), 2)
  assert.equal(await row(4, "EMIT_REGION").locator(".ui-field-pair input").count(), 4)
  assert.equal(await input(7, "FROM").inputValue(), "custom,tuple,keep")
  assert.equal(await input(7, "DURATION").getAttribute("type"), null)
  assert.equal(await row(4, "EMIT_TYPE").locator("select").inputValue(), "7")
  assert.equal(await row(2, "INTPOL").locator("select").inputValue(), "2,3")

  // The entry point rejects wrong basenames and non-Baidu formats without touching the container.
  assert.deepEqual(await page.evaluate(async () => {
    const { appState } = await import("/src/app/state.ts")
    const { populateBaiduAnimationInspector } = await import("/src/app/baidu-animation-inspector.ts")
    const path = appState.selectedPath
    const archive = appState.archive
    const container = document.createElement("div")
    container.textContent = "untouched"
    try {
      appState.selectedPath = "light/skin/res/not-anim.ini"
      const wrongPath = populateBaiduAnimationInspector(container)
      appState.selectedPath = path
      appState.archive = { format: "sxi" }
      const wrongFormat = populateBaiduAnimationInspector(container)
      return [wrongPath, wrongFormat, container.textContent]
    } finally {
      appState.selectedPath = path
      appState.archive = archive
    }
  }), [false, false, "untouched"])

  await change(input(1, "DURATION"), "320")
  await waitValue(1, "DURATION", "320")
  assert.equal(await page.locator(".inspector-changes").textContent(), "已改 1")
  assert.equal(await section(1).locator("h3[data-modified]").count(), 1)
  await history("undo")
  await waitValue(1, "DURATION", "160")
  assert.equal(await input(1, "DURATION").inputValue(), "160")
  await history("redo")
  await waitValue(1, "DURATION", "320")

  // Continuous wheel writes stay on the same DOM input and coalesce into exactly one undo step.
  const beforeWheel = await page.evaluate(async () => (await import("/src/app/state.ts")).appState.undoStack.length)
  await input(1, "DURATION").focus()
  await input(1, "DURATION").evaluate((field) => { window.__baiduWheelField = field })
  for (let index = 0; index < 3; index++) {
    await input(1, "DURATION").dispatchEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true })
    await page.waitForTimeout(45)
    assert.equal(await input(1, "DURATION").evaluate((field) => field === window.__baiduWheelField), true)
  }
  await page.waitForTimeout(450)
  await waitValue(1, "DURATION", "323")
  assert.equal(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.undoStack.length), beforeWheel + 1)
  await history("undo")
  await waitValue(1, "DURATION", "320")

  // Latest archive text wins, even if an external source edit happens after rendering this pair.
  await page.evaluate(async (path) => {
    const { appState } = await import("/src/app/state.ts")
    const { IniDocument } = await import("/src/ini.ts")
    const { commitText } = await import("/src/app/edit-history.ts")
    const before = appState.archive.getText(path)
    const document = IniDocument.parse(before)
    document.set("ANIM2", "FROM_PX", "1,77")
    document.set("ANIM2", "CONCURRENT_UNKNOWN", "survives")
    commitText(path, before, document.toString())
  }, animationPath)
  await change(input(2, "FROM_PX"), "9")
  assert.equal(await value(2, "FROM_PX"), "9,77")
  assert.equal(await value(2, "CONCURRENT_UNKNOWN"), "survives")
  await change(row(2, "TO_PX").locator("input").nth(1), "44")
  await waitValue(2, "TO_PX", "30,44")
  await row(1, "REMOVE").locator("input").check()
  await waitValue(1, "REMOVE", "1")
  await row(1, "REPEAT_MODE").locator("select").selectOption("1")
  await row(1, "INTPOL").locator("select").selectOption("4")
  await change(input(2, "DELAY"), "15")
  await waitValue(2, "DELAY", "15")
  await row(3, "BUILD_METHOD").locator("select").selectOption("1")
  await change(input(3, "BUILD_LIST"), "2,1,5")
  await waitValue(3, "BUILD_NUM", "3")
  await change(input(4, "LIFE"), "600")
  await waitValue(4, "LIFE", "600,1000")
  await change(row(4, "EMIT_REGION").locator("input").nth(2), "0.8")
  await waitValue(4, "EMIT_REGION", "0,0,0.8,1")
  await section(4).getByRole("button", { name: "重新播放", exact: true }).click()
  await change(input(1, "VENDOR_TEXT"), "edited=raw,value")
  await waitValue(1, "VENDOR_TEXT", "edited=raw,value")
  await change(input(7, "FROM"), "other,opaque,payload")
  await waitValue(7, "FROM", "other,opaque,payload")
  await row(1, "TYPE").locator("select").selectOption("1")
  assert.match(await row(1, "FROM").textContent(), /旋转/)
  assert.equal(await value(1, "FROM"), "255")
  await row(1, "CATEGORY").locator("select").selectOption("3")
  assert.equal(await row(1, "PARTICLE_IMAGE").count(), 1)
  assert.equal(await value(1, "FROM"), "255", "category switches don't destroy existing fields")

  const filter = page.locator("#inspector-filter")
  await page.locator(".inspector-filter-open").click()
  await filter.fill("VENDOR_COMBO")
  await page.waitForFunction(() => !document.querySelector('[data-animation-section="ANIM3"]').hasAttribute("data-filter-miss"))
  assert.equal(await section(2).getAttribute("data-filter-miss"), "")
  await filter.fill("粒子寿命")
  await page.waitForFunction(() => !document.querySelector('[data-animation-section="ANIM4"]').hasAttribute("data-filter-miss"))
  await filter.fill("动画 5")
  await page.waitForFunction(() => !document.querySelector('[data-animation-section="ANIM5"]').hasAttribute("data-filter-miss"))
  await filter.press("Escape")
  await filter.press("Escape")

  await page.locator(".inspector-reset").click()
  await waitValue(1, "DURATION", "160")
  assert.equal(await value(1, "TYPE"), "0")
  assert.equal(await value(1, "CATEGORY"), "0")
  assert.equal(await value(1, "VENDOR_TEXT"), "odd,value=keep")
  assert.equal(await value(2, "FROM_PX"), "1,2")
  assert.equal(await value(3, "BUILD_LIST"), "1,2")
  assert.equal(await value(2, "DELAY"), null, "reset removes a previously absent field")
  assert.equal(await value(3, "BUILD_NUM"), "2")
  assert.equal(await value(4, "LIFE"), "500,1000")
  assert.equal(await value(7, "FROM"), "custom,tuple,keep")
  assert.equal(await page.locator(".inspector-reset").isHidden(), true)

  await change(input(1, "DURATION"), "444")
  const expected = await read()
  const exported = Buffer.from(await page.evaluate(async () => Array.from((await import("/src/app/state.ts")).appState.archive.toBytes())))
  await open(exported, "reopened.bds")
  assert.equal(await read(), expected, "export/reopen preserves every animation, unknown section, key, comment and CRLF")
  assert.equal(await value(1, "DURATION"), "444")
  assert.match(await read(), /VENDOR_GLOBAL = keep-global\r\n/)
  assert.match(await read(), /MixedCaseKey = preserve=exact\r\n/)
  assert.equal(await value(2, "CONCURRENT_UNKNOWN"), "survives")

  // BDI uses the same canonical paths; export through the real archive converter and open in UI.
  const bdi = Buffer.from(await page.evaluate(async () => Array.from((await import("/src/app/state.ts")).appState.archive.toBytes("bdi"))))
  await open(bdi, "animation.bdi")
  await change(input(1, "DELAY"), "25")
  await waitValue(1, "DELAY", "25")
  await history("undo")
  await waitValue(1, "DELAY", "10")

  await open(fixture, "readonly.bds", false)
  assert.equal(await input(1, "DURATION").isDisabled(), true)
  assert.equal(await row(1, "CATEGORY").locator("select").isDisabled(), true)
  assert.equal(await row(1, "REMOVE").locator("input").isDisabled(), true)
  assert.equal(await row(2, "FROM_PX").locator("input").nth(1).isDisabled(), true)
  assert.equal(await page.locator(".inspector-reset").isHidden(), true)
  // The handler itself also rejects programmatic changes while in interaction-preview mode.
  await input(1, "DURATION").evaluate((field) => { field.value = "999"; field.dispatchEvent(new Event("change", { bubbles: true })) })
  assert.equal(await read(), original)

  assert.deepEqual(errors, [])
  console.log("BDI/BDS animation inspector: edits, latest-text pair writes, wheel coalescing, undo/redo, filter, reset, read-only and ZIP export/reopen passed; pageerrors=0")
} finally {
  await browser?.close()
  await server?.close()
}
