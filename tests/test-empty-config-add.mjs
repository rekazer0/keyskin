import { dismissStartupDisclaimer, expandMobileInspector } from "../tests/helpers/open-editor-template.mjs"
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"
import { SkinArchive } from "../src/skin.ts"
import { IniDocument } from "../src/ini.ts"
import { mobilePenFixture } from "../tests/helpers/mobile-pen-fixture.mjs"

const archive = SkinArchive.open(mobilePenFixture())
const path = "light/skin/port/py_26.ini"
const document = IniDocument.parse(archive.getText(path))
for (const key of ["FIX_SIZE", "NO_BLUR", "POS", "SIZE", "ANIM_LEVEL"]) document.set("PANEL", key, "")
archive.setText(path, document.toString())
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41981, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
const errors = []
page.on("pageerror", error => errors.push(error.message))
const fields = page.locator("#document-fields")
const row = key => fields.locator(`[data-document-key="${key}"]`).first()
const state = (sourcePath = path) => page.evaluate(async path => {
  const { appState } = await import("/src/app/state.ts")
  return { source: appState.archive.getText(path), undo: appState.undoStack.length }
}, sourcePath)
const undo = () => page.evaluate(async () => (await import("/src/app/edit-history.ts")).undo())
const pending = async key => {
  await row(key).locator("[data-config-add]").waitFor()
  assert.equal(await row(key).getAttribute("data-config-pending"), "", `${key} uses + when empty`)
  assert.equal(await row(key).locator("input:visible, select:visible, .ui-segmented:visible").count(), 0)
}
const reveal = async key => {
  const before = await state()
  const add = row(key).locator("[data-config-add]")
  await add.focus()
  await page.keyboard.press("Enter")
  assert.equal(await row(key).getAttribute("data-config-pending"), null)
  assert.deepEqual(await state(), before, "revealing an empty control never writes defaults or history")
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator(".template-card").first().waitFor({ state: "attached" })
  await dismissStartupDisclaimer(page)
  await page.locator("#browser-open").setInputFiles({ name: "empty.bds", mimeType: "application/octet-stream", buffer: Buffer.from(archive.toBytes("bds")) })
  await page.waitForFunction(() => !document.querySelector("#open").disabled && (!document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled))
  if (await page.locator("#file-operation-dialog[open]").count()) await page.locator("#file-operation-close").click()
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()
  await page.evaluate(async path => (await import("/src/app/navigation.ts")).selectFile(path, "overview"), path)
  const before = await state()
  for (const key of ["FIX_SIZE", "NO_BLUR", "POS", "SIZE", "ANIM_LEVEL"]) await pending(key)
  await reveal("FIX_SIZE")
  const width = row("FIX_SIZE").locator("input").first()
  assert.equal(await width.evaluate(input => input === document.activeElement), true)
  await width.fill("32")
  await width.press("Enter")
  assert.match((await state()).source, /FIX_SIZE=32,0/)
  assert.equal((await state()).undo, before.undo + 1)
  await undo()
  await pending("FIX_SIZE")
  assert.deepEqual(await state(), before)
  await reveal("NO_BLUR")
  const toggle = row("NO_BLUR").getByRole("switch")
  assert.equal(await toggle.isChecked(), false)
  await toggle.press("Space")
  assert.match((await state()).source, /NO_BLUR=1/)
  await undo()
  await pending("NO_BLUR")
  await reveal("ANIM_LEVEL")
  await row("ANIM_LEVEL").getByRole("button", { name: "按键下方", exact: true }).click()
  assert.match((await state()).source, /ANIM_LEVEL=0/)
  assert.equal(await row("ANIM_LEVEL").getAttribute("data-config-pending"), null, "explicit zero remains configured")
  await page.locator(".inspector-reset").click()
  await pending("ANIM_LEVEL")
  assert.equal((await state()).source, before.source, "reset restores the empty source")
  await page.getByRole("button", { name: "交互预览", exact: true }).click()
  await pending("FIX_SIZE")
  assert.equal(await row("FIX_SIZE").locator("[data-config-add]").isDisabled(), true)
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()

  // Exercise shared fields and native reset shapes in the same inspector shell.
  await page.evaluate(async () => {
    const { field, section } = await import("/src/app/property-rows.ts")
    const rows = [
      field({ key: "text", label: "空文本", spec: { kind: "text", value: "" }, editable: true, commit() {} }),
      field({ key: "color", label: "空颜色", spec: { kind: "color", value: "", codec: "argb" }, editable: true, commit() {} }),
      field({ key: "choice", label: "空选项", spec: { kind: "choice", value: "", options: [["0", "零"], ["1", "一"]] }, editable: true, commit() {} }),
      field({ key: "false", label: "已关闭", spec: { kind: "switch", checked: false }, editable: true, commit() {} }),
      field({ key: "missing-switch", label: "空开关", empty: true, spec: { kind: "switch", checked: false }, editable: true, commit() {} }),
      field({ key: "mixed", label: "混合文本", spec: { kind: "text", value: "" }, mixed: true, editable: true, commit() {} }),
    ]
    for (const [key, saved] of [["sxi-null", [null]], ["sxi-false", [false]]]) {
      const row = field({ key, label: key, spec: { kind: "switch", checked: false }, editable: true, commit() {} })
      row.dataset.inspectorValue = JSON.stringify(saved)
      rows.push(row)
    }
    document.querySelector("#document-fields").append(section("空配置验证", rows))
    ;(await import("/src/inspector-shell.ts")).syncInspectorRows("empty-config-test")
  })
  for (const key of ["text", "color", "choice", "sxi-null", "missing-switch"]) await pending(key)
  for (const key of ["false", "mixed", "sxi-false"]) assert.equal(await row(key).getAttribute("data-config-pending"), null, `${key} is not an empty configuration`)
  await reveal("color")
  assert.equal(await row("color").getByLabel("空颜色取色", { exact: true }).isVisible(), true)
  mkdirSync(new URL("../.ui-current/empty-config/", import.meta.url), { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 390) await expandMobileInspector(page)
    await row("FIX_SIZE").scrollIntoViewIfNeeded()
    assert.equal(await fields.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
    await page.screenshot({ path: new URL(`../.ui-current/empty-config/${width}.png`, import.meta.url).pathname })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const animationPath = "light/skin/res/anim.ini"
  await page.evaluate(async path => (await import("/src/app/navigation.ts")).selectFile(path, "overview"), animationPath)
  await pending("INTPOL")
  const animationBefore = await state(animationPath)
  await reveal("INTPOL")
  assert.deepEqual(await state(animationPath), animationBefore, "revealing an inferred animation default preserves its missing source field")
  await row("INTPOL").locator("select").first().selectOption("0")
  assert.match((await state(animationPath)).source, /INTPOL=0/)
  await undo()
  await pending("INTPOL")
  assert.deepEqual(await state(animationPath), animationBefore)
  assert.deepEqual(errors, [])
  console.log("Empty configuration +: typed fields, native null/false, mixed values, keyboard, no-write reveal, edit, undo, reset, read-only and narrow layout passed")
} finally {
  await browser.close()
  await server.close()
}
