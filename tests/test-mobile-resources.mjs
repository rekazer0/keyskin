import { confirmDeletion } from "../tests/helpers/ask-dialogs.mjs"
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"
import { SkinArchive } from "../src/skin.ts"
import { convertBdaArchive } from "../src/bda-convert.ts"
import { bdaAnimatedSkinBytes, bdsBaseArchive } from "../tests/helpers/bda-animation-fixture.mjs"
import { sxiAnimationFixture } from "../tests/helpers/sxi-animation-fixture.mjs"
import { acceptAskDialogs } from "../tests/helpers/ask-dialogs.mjs"
import { wav } from "../tests/helpers/ssf-fixture.mjs"

const bda = bdaAnimatedSkinBytes()
const legacy = convertBdaArchive(SkinArchive.open(bda, "bda"), bdsBaseArchive()).archive
const fixtures = { bds: await legacy.platformBytesAsync("bds"), sxi: sxiAnimationFixture(), bda }
mkdirSync(".ui-current/mobile-visual", { recursive: true })
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41869, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const errors = []
const undo = page => page.evaluate(async () => { (await import("/src/app/edit-history.ts")).undo() })
async function capture(page, name) {
  await page.evaluate(async () => { await document.fonts.ready })
  for (const selector of ['dialog[open]', 'dialog[open] .ui-dialog-footer']) {
    for (const node of await page.locator(selector).all()) {
      const box = await node.boundingBox()
      const { width, height } = page.viewportSize()
      assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `${name}: clipped ${selector}`)
    }
  }
  for (const node of await page.locator('dialog[open] .ui-dialog-body').all()) assert.ok(await node.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${name}: dialog body overflow`)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: overflow`)
  await page.screenshot({ path: `.ui-current/mobile-visual/${name}.png`, animations: "disabled" })
}
try {
  for (const width of [320, 393, 430]) for (const theme of ["light", "dark"]) for (const format of ["bds", "sxi", "bda"]) {
    const page = await browser.newPage({ viewport: { width, height: width === 320 ? 568 : width === 430 ? 932 : 852 }, colorScheme: theme, isMobile: true, hasTouch: true, reducedMotion: "reduce" })
    const prefix = `${width}-${theme}-${format}`
    page.on("pageerror", error => errors.push(`${prefix}: ${error.message}`))
    await acceptAskDialogs(page)
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator("#browser-open").setInputFiles({ name: `mobile.${format}`, mimeType: "application/octet-stream", buffer: Buffer.from(fixtures[format]) })
    await page.waitForFunction(() => !document.querySelector("#open").disabled && !document.querySelector("#file-operation-dialog").open)
    await page.evaluate(async () => {
      const mode = document.querySelector("#mode")
      mode.value = "edit"
      mode.dispatchEvent(new Event("change", { bubbles: true }))
      ;(await import("/src/app/mobile-layout.ts")).setMobilePane("layout")
    })
    if (format === "bds") {
      const project = page.getByRole("dialog", { name: "项目侧栏" })
      await project.getByRole("button", { name: "源文件", exact: true }).click()
      await project.getByRole("button", { name: "关闭项目侧栏" }).click()
      await project.waitFor({ state: "hidden" })
      await page.locator("#mobile-project-toggle").click()
      assert.equal(await project.getByRole("button", { name: "源文件", exact: true }).getAttribute("aria-pressed"), "true")
      await project.getByRole("button", { name: "概览", exact: true }).click()
      await page.evaluate(async bytes => {
        (await import("/src/app/state.ts")).appState.archive.setBytes("light/skin/res/mobile_duration.wav", new Uint8Array(bytes))
      }, Array.from(wav(8000)))
      const before = await page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        const { styleConfigPath } = await import("/src/app/config-context.ts")
        const { IniDocument } = await import("/src/ini.ts")
        const path = styleConfigPath()
        appState.archive.setText(path, appState.archive.getText(path) + "\n[STYLE98765]\nNM_COLOR=ffffffff\n[STYLE98766]\nNM_COLOR=ff000000\n[STYLE98768]\nNM_IMG=missing_mobile_image,0\nPRESS_SOUND_PATH=missing_mobile_sound.wav\n")
        const layout = IniDocument.parse(appState.archive.getText(appState.layoutPath))
        layout.set("KEY1", "BACK_STYLE", "98766")
        layout.set("KEY1", "FORE_STYLE", "98767")
        appState.archive.setText(appState.layoutPath, layout.toString())
        appState.layoutDocument = layout
        return { path, text: appState.archive.getText(path), undo: appState.undoStack.length }
      })
      await page.getByRole("button", { name: "资源清单", exact: true }).click()
      const inventory = page.getByRole("dialog", { name: "资源清单", exact: true })
      await page.waitForFunction(() => document.querySelector('[data-inventory-id="light/skin/res/mobile_duration.wav"]')?.textContent.includes("1.00 s"))
      await capture(page, `${prefix}-inventory`)
      await inventory.getByRole("button", { name: "缺失", exact: true }).click()
      assert.match(await inventory.getByRole("listbox").innerText(), /缺失样式 98767/)
      assert.match(await inventory.getByRole("listbox").innerText(), /missing_mobile_image/)
      assert.match(await inventory.getByRole("listbox").innerText(), /missing_mobile_sound/)
      await inventory.getByRole("button", { name: "未用", exact: true }).click()
      await inventory.getByRole("searchbox").fill("98765")
      assert.match(await inventory.getByRole("listbox").innerText(), /样式 98765/)
      await inventory.getByRole("button", { name: "清理未使用样式", exact: true }).click()
      await confirmDeletion(page)
      const after = await page.evaluate(async path => {
        const { appState } = await import("/src/app/state.ts")
        return { text: appState.archive.getText(path), undo: appState.undoStack.length }
      }, before.path)
      assert.ok(!after.text.includes("[STYLE98765]"))
      assert.ok(after.text.includes("[STYLE98766]"), "used style must survive cleanup")
      assert.equal(after.undo, before.undo + 1)
      await inventory.getByRole("button", { name: "关闭", exact: true }).last().click()
      await undo(page)
      assert.equal(await page.evaluate(async path => (await import("/src/app/state.ts")).appState.archive.getText(path), before.path), before.text)
      await page.locator("#mobile-files-close").click()
      await page.locator("#mobile-project-dialog").waitFor({ state: "hidden" })
      const resources = page.locator("#mobile-navigation [data-mobile-page=resources]")
      await resources.click()
      await page.locator("#mobile-resource-category").selectOption("image")
      await page.locator("#resource-search").fill("mobile")
      await resources.click()
      assert.equal(await page.locator("#mobile-resource-category").inputValue(), "image")
      assert.equal(await page.locator("#resource-search").inputValue(), "mobile")
      await page.locator("#mobile-navigation [data-mobile-page=edit]").click()
      await page.locator("#mobile-app-more > summary").click()
      await page.locator('#mobile-app-more [data-mobile-action="mobile-export-open"]').click()
      const exporting = page.getByRole("dialog", { name: "分享与导出", exact: true })
      assert.match(await exporting.innerText(), /资源检查 · \d+ 项缺失引用/)
      await exporting.locator('summary', { hasText: '查看缺失引用' }).click()
      assert.match(await exporting.locator('ul').innerText(), /missing_mobile_image/)
      assert.match(await exporting.locator('ul').innerText(), /missing_mobile_sound/)
      await exporting.locator('.ui-dialog-body').evaluate(node => { node.scrollTop = node.scrollHeight })
      await capture(page, `${prefix}-preflight`)
      await exporting.getByRole("button", { name: "查看资源清单", exact: true }).click()
      await capture(page, `${prefix}-preflight-inventory`)
      await inventory.getByRole("button", { name: "关闭", exact: true }).last().click()
      assert.equal(await exporting.isVisible(), true, "closing inventory returns to format selection")
      await exporting.getByRole("button", { name: "关闭", exact: true }).click()
    }
    if (format === "sxi") {
      const beforeGeometry = await page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        const { preview } = await import("/src/app/canvas-interaction.ts")
        const key = preview.keys.find(key => key.editable && /^KEY\d+$/.test(key.section))
        preview.setSelected([key.section])
        preview.onSelect([key.section])
        ;(await import("/src/app/preview-render.ts")).setGuidesVisible(true)
        return appState.archive.getText("skin.json")
      })
      await page.locator('.preview-guides:not([hidden]) g.selected').first().waitFor({ state: "attached" })
      assert.equal(await page.locator('.ui-measurements').count(), 0)
      await page.locator('#mobile-inspector-groups').getByRole("button", { name: "布局", exact: true }).click()
      const size = page.locator('[data-document-key="rect.size"] input[type="number"]').first()
      await size.fill(String(Number(await size.inputValue()) + 1))
      await size.blur()
      assert.notEqual(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.archive.getText("skin.json")), beforeGeometry)
      await undo(page)
      assert.equal(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.archive.getText("skin.json")), beforeGeometry)
      await page.evaluate(async () => { (await import("/src/app/preview-render.ts")).setGuidesVisible(false) })
    }
    if (!(await page.locator('#mobile-project-dialog').evaluate(dialog => dialog.open))) await page.locator('#mobile-project-toggle').click()
    await page.locator('.sidebar-overview [data-nav-mode="motion"]').first().click()
    if (format === "bda") {
      await page.locator('.mobile-animation-library > summary').click()
      await page.locator('#bda-config-fields [data-animation-id="alpha:press"]').click()
    }
    else await page.evaluate(async () => {
      const { preview } = await import("/src/app/canvas-interaction.ts")
      const keys = preview.keys.filter(key => key.editable && /^KEY\d+$/.test(key.section)).slice(0, 2).map(key => key.section)
      if (keys.length !== 2) throw new Error("Fixture needs two editable keys")
      window.presetKeys = keys
      ;(await import("/src/app/animation-resource.ts")).pickAnimationKeys(keys)
    })
    const before = await page.evaluate(async () => {
      const { appState } = await import("/src/app/state.ts")
      const path = appState.archive.format === "sxi" ? "skin.json" : appState.selectedPath
      return { path, bytes: Array.from(appState.archive.getBytes(path)), undo: appState.undoStack.length }
    })
    if (await page.locator(".mobile-animation-library:not([open]) > summary").isVisible()) await page.locator(".mobile-animation-library > summary").click()
    await page.getByRole("button", { name: "动效预设", exact: true }).click()
    const presets = page.getByRole("dialog", { name: "动效预设", exact: true })
    await presets.getByRole("option", { name: "按下淡入", exact: true }).click()
    await capture(page, `${prefix}-presets`)
    await presets.getByRole("button", { name: format === "bda" ? "应用" : "应用到 2 个按键", exact: true }).click()
    assert.equal(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.undoStack.length), before.undo + 1)
    if (format === "bda") {
      assert.equal(await page.evaluate(async path => {
        const { appState } = await import("/src/app/state.ts")
        return (await import("/src/bda-decode.ts")).decodeBdaAnimation(appState.archive.getBytes(path)).effects.get("alpha:press").duration
      }, before.path), 180)
    } else if (format === "sxi") {
      assert.equal(await page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        const { sxiValue } = await import("/src/app/sxi-fields.ts")
        const table = sxiValue(JSON.parse(appState.archive.getText("skin.json")), ["default", "s_info", "ss_2"])
        return Object.values(table).some(wrap => wrap.a1?.duration === 180 && wrap.a1.from === 0 && wrap.a1.to === 255)
      }), true)
    } else assert.match(await page.evaluate(async path => (await import("/src/app/state.ts")).appState.archive.getText(path), before.path), /按下淡入/)
    if (format !== "bda") assert.equal(await page.evaluate(async () => {
      const { appState } = await import("/src/app/state.ts")
      if (appState.archive.format === "sxi") {
        const { sxiValue } = await import("/src/app/sxi-fields.ts")
        const { sxiPointer } = await import("/src/app/sxi-documents.ts")
        const skin = JSON.parse(appState.archive.getText("skin.json"))
        const keys = sxiValue(skin, sxiPointer(appState.layoutPath)).keys.filter(key => window.presetKeys.includes(`KEY${key.id}`))
        const style = keys[0].b.asi
        return keys.length === 2 && keys.every(key => key.b.asi === style) && Boolean(skin.default.s_info.ss_1[style].s_5["1"])
      }
      const { styleConfigDocument } = await import("/src/app/style-picker.ts")
      const refs = window.presetKeys.map(key => appState.layoutDocument.get(key, "ANIM_STYLE"))
      return refs.every(ref => ref === refs[0]) && Boolean(styleConfigDocument().get(`STYLE${refs[0]}`, "PRESS_ANIM"))
    }), true, "preset binds both selected keys through one animation style")
    await undo(page)
    assert.deepEqual(await page.evaluate(async path => Array.from((await import("/src/app/state.ts")).appState.archive.getBytes(path)), before.path), before.bytes)
    await page.locator('#mobile-project-toggle').click()
    await page.locator('.sidebar-overview [data-nav-mode="particle"]').first().click()
    if (format === "bda") {
      await page.locator('.mobile-animation-library > summary').click()
      await page.locator('#bda-config-fields [data-animation-id="emitter:spark"]').click()
    }
    if (await page.locator(".mobile-animation-library:not([open]) > summary").isVisible()) await page.locator(".mobile-animation-library > summary").click()
    await page.getByRole("button", { name: "动效预设", exact: true }).click()
    await presets.getByRole("option", { name: "触点迸发", exact: true }).click()
    assert.ok(await presets.locator('.ui-animation-player input[type="range"]').count() > 0, "particle preset has a playable timeline")
    await capture(page, `${prefix}-particle-presets`)
    await presets.locator('.ui-dialog-body').evaluate(node => { node.scrollTop = node.scrollHeight })
    await capture(page, `${prefix}-particle-presets-bottom`)
    await presets.getByRole("button", { name: "取消", exact: true }).click()
    assert.deepEqual(await page.evaluate(async path => Array.from((await import("/src/app/state.ts")).appState.archive.getBytes(path)), before.path), before.bytes)
    console.log(`PASS ${prefix}: presets, cancellation, native write and undo${format === "bds" ? ", inventory, missing refs and safe cleanup" : ""}`)
    await page.close()
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
}
