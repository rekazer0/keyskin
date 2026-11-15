import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"
import { mobilePenFixture } from "../tests/helpers/mobile-pen-fixture.mjs"

const root = new URL("..", import.meta.url).pathname
const output = `${root}.ui-current/mobile-reconstruction`
mkdirSync(output, { recursive: true })
const fixture = mobilePenFixture()
writeFileSync(`${output}/雾紫.bds`, fixture)
const server = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 41765, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const errors = []
try {
  for (const width of [320, 393, 430]) {
    const context = await browser.newContext({ viewport: { width, height: width === 320 ? 668 : 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme: "light" })
    const page = await context.newPage()
    page.on("pageerror", error => errors.push(`${width}: ${error.message}`))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.waitForSelector(".template-card", { state: "attached" })
    await page.locator("#browser-open").setInputFiles({ name: "雾紫.bds", mimeType: "application/octet-stream", buffer: Buffer.from(fixture) })
    await page.waitForFunction(() => !document.querySelector("#open").disabled && document.querySelector("#mobile-save").disabled === false)
    await page.waitForFunction(() => !document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled)
    if (await page.locator("#file-operation-dialog[open]").count()) await page.locator("#file-operation-close").click()
    assert.equal(await page.locator("#mode").inputValue(), "edit")
    await page.evaluate(async () => {
      const { selectFile } = await import("/src/app/navigation.ts")
      selectFile("light/skin/port/py_26.ini")
      const { appState } = await import("/src/app/state.ts")
      const { preview } = await import("/src/app/canvas-interaction.ts")
      appState.selectedKeySections = ["KEY11"]
      preview.setSelected(["KEY11"])
      ;(await import("/src/app/key-inspector.ts")).populateKeyInspector()
    })
    await page.waitForSelector(".mobile-background-states")
    await page.evaluate(() => document.fonts.ready)
    const shell = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON()
      return { workspace: box("main > .workspace"), inspector: box("main > .source"), viewport: innerWidth,
        overflow: document.documentElement.scrollWidth, accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() }
    })
    assert.equal(shell.accent, "#3a6df0")
    assert.ok(shell.overflow <= shell.viewport + 1, `no horizontal overflow: ${width}`)
    assert.ok(Math.abs(shell.workspace.bottom - shell.inspector.top) < 2, "canvas and inspector share the same split")
    assert.ok(shell.workspace.height >= 180 && shell.inspector.height >= 250)
    assert.deepEqual(await page.locator("#mobile-property-tabs > button").allTextContents(), ["样式", "文字", "动作"])
    const controls = await page.locator('#mobile-canvas-mode button:visible, #mobile-save:visible, #mobile-property-tabs:visible, .ui-property-link:visible').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))
    assert.ok(controls.every(height => height >= 44), "visible controls provide 44px touch targets")
    const canvasImage = async () => {
      await page.evaluate(async () => (await import("/src/app/canvas-interaction.ts")).preview.whenDrawn())
      return page.locator("#preview").evaluate(canvas => canvas.toDataURL())
    }
    const shot = async name => {
      await canvasImage()
      await page.screenshot({ path: `${output}/${width}-${name}.png`, animations: "disabled" })
    }
    const documentSnapshot = () => page.evaluate(async () => {
      const { appState } = await import("/src/app/state.ts")
      return { revision: appState.archive.revision, undo: appState.undoStack.length,
        layout: appState.layoutDocument.toString(), styles: appState.archive.getText("light/skin/res/default.css") }
    })
    await shot("appearance")
    const normalCanvas = await canvasImage()
    await page.locator('.mobile-background-states > button').filter({ hasText: "按下" }).click()
    await page.waitForTimeout(300)
    assert.notEqual(await page.locator("#preview").evaluate(canvas => canvas.toDataURL()), normalCanvas, "pressed appearance remains visible after the flash timeout")
    await shot("appearance-pressed")
    const pressedCanvas = await canvasImage()
    await page.locator('.mobile-property-details [data-mobile-category="geometry"]').click()
    await page.locator('#mobile-property-tabs [data-mobile-category="appearance"]').click()
    assert.equal(await canvasImage(), pressedCanvas, "returning to appearance restores the state shown by its segmented control")
    await page.locator('.mobile-background-states > button').filter({ hasText: "正常" }).click()
    const beforePickerCanvas = await canvasImage()
    const beforePicker = await documentSnapshot()
    await page.locator('.mobile-appearance [aria-label="更换背景"]').click()
    await page.waitForSelector("#picker-dialog[open]")
    const picker = page.frameLocator("#picker-frame")
    try {
      await picker.locator('#style-library-grid > [role="option"]').first().waitFor({ timeout: 10000 })
    } catch (error) {
      await shot("picker-error")
      console.error(errors, await page.locator('#picker-frame').evaluate(frame => frame.contentDocument?.body.innerText))
      throw error
    }
    const pickerBox = await page.locator("#picker-dialog").boundingBox()
    assert.ok(pickerBox.y >= shell.inspector.top - 1, "resource picker preserves the upper canvas")
    const tintCard = picker.locator('#style-library-grid > [data-path$="key_tint.png"]')
    await tintCard.click()
    await page.waitForFunction(async () => Boolean((await import("/src/app/canvas-interaction.ts")).preview.draftVisual))
    assert.deepEqual(await documentSnapshot(), beforePicker, "candidate preview does not write archive or undo")
    assert.notEqual(await canvasImage(), beforePickerCanvas, "candidate is painted on the upper keyboard")
    await shot("picker")
    await picker.locator("#style-library-cancel").click()
    await page.waitForSelector("#picker-dialog[open]", { state: "hidden" })
    assert.equal(await page.evaluate(async () => Boolean((await import("/src/app/canvas-interaction.ts")).preview.draftVisual)), false, "cancel clears the draft")
    assert.deepEqual(await documentSnapshot(), beforePicker, "cancel restores all document state")
    assert.equal(await canvasImage(), beforePickerCanvas, "cancel restores the original keyboard rendering")
    await page.locator('.mobile-appearance [aria-label="更换背景"]').click()
    await tintCard.click()
    await picker.locator("#style-library-apply").click()
    await page.waitForSelector("#picker-dialog[open]", { state: "hidden" })
    const appliedImage = await page.evaluate(async () => {
      const { appState } = await import("/src/app/state.ts")
      const id = appState.layoutDocument.get("KEY11", "BACK_STYLE")
      const { styleConfigDocument } = await import("/src/app/style-picker.ts")
      return { count: appState.undoStack.length, id, neighbor: appState.layoutDocument.get("KEY12", "BACK_STYLE"),
        image: styleConfigDocument().get(`STYLE${id}`, "NM_IMG"), pressed: styleConfigDocument().get(`STYLE${id}`, "HL_IMG") }
    })
    assert.equal(appliedImage.count, beforePicker.undo + 1, "image creation and reference replacement form one undo step")
    assert.equal(appliedImage.image, "key_tint,1")
    assert.equal(appliedImage.pressed, "key_tint,1", "the other appearance state is preserved")
    assert.equal(appliedImage.neighbor, "2", "candidate application does not modify shared neighbors")
    await page.locator("#mobile-undo").click()
    const undoneImage = await documentSnapshot()
    assert.equal(undoneImage.layout, beforePicker.layout)
    assert.equal(undoneImage.styles, beforePicker.styles)
    await page.evaluate(async () => {
      const { keyFields } = await import("/src/app/dom.ts")
      const input = keyFields.find(input => input.dataset.keyField === "FORE_STYLE")
      input.value = "41,42"
      ;(await import("/src/app/key-inspector.ts")).updateSelectedKey(input)
    })
    await page.getByRole("button", { name: "高级样式", exact: true }).click()
    await page.locator('.mobile-appearance [aria-label="更换前景"]').click()
    await tintCard.click()
    await picker.locator("#style-library-apply").click()
    await page.waitForSelector("#picker-dialog[open]", { state: "hidden" })
    const layers = await page.evaluate(async () => (await import("/src/app/state.ts")).appState.layoutDocument.get("KEY11", "FORE_STYLE").split(","))
    assert.equal(layers.length, 2, "replacing one foreground preserves the layer count")
    assert.equal(layers[1], "42", "the second foreground is unchanged")
    assert.notEqual(layers[0], "41")
    await page.locator("#mobile-undo").click()
    await page.locator("#mobile-undo").click()
    const before = await page.evaluate(async () => {
      const { appState } = await import("/src/app/state.ts")
      return { count: appState.undoStack.length, background: appState.layoutDocument.get("KEY11", "BACK_STYLE"), neighbor: appState.layoutDocument.get("KEY12", "BACK_STYLE") }
    })
    await page.getByRole("button", { name: "为选中按键创建独立背景样式", exact: true }).click()
    const isolated = await page.evaluate(async () => {
      const { appState } = await import("/src/app/state.ts")
      return { count: appState.undoStack.length, background: appState.layoutDocument.get("KEY11", "BACK_STYLE"), neighbor: appState.layoutDocument.get("KEY12", "BACK_STYLE") }
    })
    assert.equal(isolated.count, before.count + 1, "creating an independent background is one undo step")
    assert.notEqual(isolated.background, before.background)
    assert.equal(isolated.neighbor, before.neighbor, "shared neighbors keep their original reference")
    await page.locator("#mobile-undo").click()
    assert.equal(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.layoutDocument.get("KEY11", "BACK_STYLE")), before.background)
    for (const category of ["geometry", "actions", "sound", "animation"]) {
      await page.locator(`${category === "actions" ? "#mobile-property-tabs" : ".mobile-property-details"} [data-mobile-category="${category}"]`).click()
      await shot(category)
      const wrong = await page.locator(`#quick-inspector > .mobile-inspector-managed:not([data-mobile-category="${category}"]):visible`).count()
      assert.equal(wrong, 0, "categories show only the current properties")
    }
    const animationBefore = await documentSnapshot()
    assert.doesNotMatch(await page.locator('.mobile-key-animation').innerText(), /示例按键/, "the player describes the actual selected-key preview")
    const scrub = page.locator('.mobile-key-animation [aria-label="预览时间"]')
    await scrub.fill("90")
    await scrub.dispatchEvent("input")
    assert.equal(await page.evaluate(async () => (await import("/src/app/canvas-interaction.ts")).preview.playerParticles?.elapsed), 90, "timeline scrubbing drives the real canvas time")
    assert.deepEqual(await documentSnapshot(), animationBefore, "scrubbing is preview only")
    const duration = page.locator('.mobile-animation-parameters input[type="number"]')
    await duration.fill("240")
    await duration.dispatchEvent("change")
    await page.waitForFunction(async () => (await import("/src/app/state.ts")).appState.archive.getText("light/skin/res/anim.ini").includes("DURATION=240"))
    await page.locator('.mobile-animation-parameters select').selectOption("inf")
    assert.match(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.archive.getText("light/skin/res/anim.ini")), /REPEAT_CNT=inf/)
    await page.locator("#mobile-undo").click()
    await page.locator("#mobile-undo").click()
    assert.match(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.archive.getText("light/skin/res/anim.ini")), /DURATION=180/)
    const handle = page.locator("#mobile-inspector-resize")
    await handle.focus()
    await page.keyboard.press("Home")
    assert.equal(await handle.getAttribute("aria-valuenow"), "32")
    await page.keyboard.press("End")
    assert.equal(await handle.getAttribute("aria-valuenow"), "90")
    await page.locator('#mobile-navigation [data-mobile-page="project"]').click()
    await page.locator('#mobile-navigation [data-mobile-page="edit"]').click()
    await handle.press("ArrowUp")
    assert.equal(await page.locator("main > .source").evaluate(node => node.inert), false)
    await page.locator("#mobile-app-more > summary").click()
    await page.locator('[data-mobile-action="mobile-source-view"]').click()
    await page.locator("#source-editor").waitFor({ state: "visible" })
    await page.setViewportSize({ width: 1200, height: 850 })
    assert.equal(await page.locator(".titlebar-right > .mobile-quick-actions").count(), 1, "history nodes return to their desktop location")
    assert.ok(await page.locator(".source .inspector-tabs").isVisible(), "desktop inspector views are preserved")
    await context.close()
    console.log(`PASS ${width}px: same-screen workspace, picker, categories, independent style, undo, split, files, source and desktop`)
  }
  assert.deepEqual(errors, [], "no browser runtime errors")
} finally {
  await browser.close()
  await server.close()
}
