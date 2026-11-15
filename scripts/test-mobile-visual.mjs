import { openEditorTemplate } from "../tests/helpers/open-editor-template.mjs"
// Mobile Figma implementation: real screenshots plus clipping and reachability checks.
// Run: node scripts/test-mobile-visual.mjs (screenshots: .ui-current/mobile-visual/)
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"
import { bdaAnimatedSkinBytes } from "../tests/helpers/bda-animation-fixture.mjs"
import { acceptAskDialogs } from "../tests/helpers/ask-dialogs.mjs"
import { wav } from "../tests/helpers/ssf-fixture.mjs"

const root = new URL("..", import.meta.url).pathname
const output = join(root, ".ui-current/mobile-visual")
mkdirSync(output, { recursive: true })
const server = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 41760, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const captures = []
const errors = []

async function capture(page, name, region) {
  await page.evaluate(async () => {
    await document.fonts.ready
    for (const animation of document.getAnimations()) {
      if (animation.playState === "running" && Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish()
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const { preview } = await import("/src/app/canvas-interaction.ts")
    if (preview.keys.length && preview.canvas.getBoundingClientRect().height) await preview.whenDrawn()
  })
  if (name.endsWith("-canvas")) {
    const painted = await page.locator("#preview").evaluate(canvas => {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data
      let opaque = 0
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) opaque++
      return opaque
    })
    assert.ok(painted > 100, `${name}: keyboard bitmap is empty ${JSON.stringify(await page.evaluate(async () => {
      const { preview } = await import("/src/app/canvas-interaction.ts")
      return { keys: preview.keys.length, theme: preview.theme, draw: preview.drawID, last: preview.lastDrawnID, size: [preview.canvas.width, preview.canvas.height] }
    }))}`)
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal page overflow`)
  if (region) {
    const bounds = await page.locator(region).evaluate(node => {
      const box = node.getBoundingClientRect()
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: innerWidth, height: innerHeight }
    })
    assert.ok(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= bounds.width + 1 && bounds.bottom <= bounds.height + 1, `${name}: panel leaves viewport ${JSON.stringify(bounds)}`)
  }
  const file = `${name}.png`
  await page.screenshot({ path: join(output, file), animations: "disabled" })
  captures.push(file)
  console.log(`PASS ${name}`)
}

async function openFiles(page) {
  await page.locator('#mobile-navigation [data-mobile-page=project]').click()
}

try {
  for (const width of [320, 393, 430]) for (const colorScheme of ["light", "dark"]) {
    const height = width === 320 ? 568 : width === 430 ? 932 : 852
    const prefix = `${width}-${colorScheme}`
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme })
    const page = await context.newPage()
    await acceptAskDialogs(page)
    page.on("pageerror", error => errors.push(`${prefix}: ${error.message}`))
    try {
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      await page.waitForSelector(".template-card", { state: "attached" })
      await capture(page, `${prefix}-welcome`, ".canvas-wrap.empty .empty-state")
      const welcome = page.locator(".canvas-wrap.empty .empty-state")
      await welcome.evaluate(node => { node.scrollTop = node.scrollHeight })
      await capture(page, `${prefix}-welcome-bottom`)
      await welcome.evaluate(node => { node.scrollTop = 0 })
      await openEditorTemplate(page, 'official-android-bds')
      await page.waitForFunction(() => !document.querySelector("#open").disabled && !document.querySelector(".canvas-wrap").classList.contains("empty"))
      await page.waitForFunction(() => document.querySelector("#preview")?.getBoundingClientRect().height > 60)
      await page.waitForFunction(() => !document.querySelector("#file-operation-dialog")?.open || !document.querySelector("#file-operation-close")?.disabled)
      const close = page.locator("#file-operation-dialog[open] #file-operation-close")
      if (await close.isVisible()) await close.click()
      await capture(page, `${prefix}-canvas`, "main > .workspace")
      await page.locator("#mobile-app-more > summary").click()
      await capture(page, `${prefix}-more`, "#mobile-app-more > .ui-menu")
      await page.locator('#mobile-app-more [data-mobile-action="mobile-export-open"]').click()
      await page.waitForSelector("#mobile-export-dialog[open]")
      await capture(page, `${prefix}-export`, "#mobile-export-dialog")
      await page.locator('#mobile-export-dialog button[value="cancel"]').click()
      await page.waitForSelector("#mobile-export-dialog[open]", { state: "hidden" })
      await page.waitForFunction(() => document.querySelector("#mode").value === "edit")
      const keyboard = await page.locator("#preview").boundingBox()
      await page.mouse.click(keyboard.x + keyboard.width * 0.45, keyboard.y + keyboard.height * 0.45)
      await page.waitForSelector("#mobile-property-tabs:not([hidden])")
      await page.waitForFunction(() => document.querySelector("#mobile-key-canvas").width > 1)
      await page.evaluate(async () => { (await import("/src/app/preview-render.ts")).setGuidesVisible(true) })
      const measurement = page.getByRole("group", { name: "尺寸标注", exact: true })
      await measurement.getByRole("button", { name: /^宽度/ }).click()
      const widthInput = page.locator('[data-key-field="width"]')
      assert.equal(await widthInput.evaluate(node => node === document.activeElement), true)
      const originalWidth = await widthInput.inputValue()
      await widthInput.fill(String(Number(originalWidth) + 1))
      await widthInput.dispatchEvent("input")
      await page.locator("#mobile-undo").click()
      assert.equal(await widthInput.inputValue(), originalWidth, "measurement edit shares the real geometry undo")
      await capture(page, `${prefix}-measurements`)
      await page.evaluate(async () => { (await import("/src/app/preview-render.ts")).setGuidesVisible(false) })
      for (const category of ["appearance", "geometry", "actions", "sound", "animation"]) {
        await page.locator(`${["geometry", "sound", "animation"].includes(category) ? ".mobile-property-details" : "#mobile-property-tabs"} [data-mobile-category="${category}"]`).click()
        await capture(page, `${prefix}-properties-${category}`, "main > .source")
        const content = page.locator("#quick-inspector")
        assert.ok(await content.evaluate(node => node.clientHeight >= 44), `${prefix}: properties leave no room for a control`)
        await content.evaluate(node => { node.scrollTop = node.scrollHeight })
        await capture(page, `${prefix}-properties-${category}-bottom`)
        if (category === "actions") {
          const before = await page.locator('.inspector-gesture > input[data-key-field="UP"]').inputValue()
          await page.locator(".mobile-action-library").click()
          const library = page.getByRole("dialog", { name: "手势与动作", exact: true })
          await library.getByLabel("手势", { exact: true }).selectOption("UP")
          await library.getByRole("searchbox", { name: "搜索动作" }).fill("撤销")
          await capture(page, `${prefix}-gesture-library`, 'dialog[aria-label="手势与动作"]')
          await library.locator('[data-action-code="F67"]').click()
          await library.getByRole("button", { name: "应用", exact: true }).click()
          await library.waitFor({ state: "hidden" })
          assert.equal(await page.locator('.inspector-gesture > input[data-key-field="UP"]').inputValue(), "F67", "action selection commits through the existing field")
          await page.locator("#mobile-undo").click()
          assert.equal(await page.locator('.inspector-gesture > input[data-key-field="UP"]').inputValue(), before, "gesture binding is undoable")
          await page.locator(".mobile-action-library").click()
          await library.getByRole("searchbox", { name: "搜索动作" }).fill("no-such-action")
          assert.equal(await library.getByRole("listbox", { name: "动作库" }).getByRole("option").count(), 0)
          await page.keyboard.press("Escape")
          assert.equal(await library.getByRole("searchbox", { name: "搜索动作" }).inputValue(), "")
          await page.keyboard.press("Escape")
          await library.waitFor({ state: "hidden" })
          assert.equal(await page.locator('.inspector-gesture > input[data-key-field="UP"]').inputValue(), before, "cancelling does not change the binding")
        }
      }
      await page.locator('#mobile-property-tabs [data-mobile-category="appearance"]').click()
      await page.locator('#quick-inspector').evaluate(node => { node.scrollTop = 0 })
      await page.locator('#mobile-inspector-resize').focus()
      await page.keyboard.press('Home')
      await capture(page, `${prefix}-properties-expanded`, 'main > .source')
      await page.locator('#mobile-inspector-resize').dblclick()
      await page.locator('#mobile-app-more > summary').click()
      await page.locator('[data-mobile-action="mobile-ai-view"]').click()
      await page.locator('#ai-design-panel').waitFor({ state: 'visible' })
      await capture(page, `${prefix}-ai`, '#ai-design-panel')
      const manual = page.getByRole('button', {name:'继续手动编辑', exact:true})
      assert.ok(await manual.evaluate(node => node.getBoundingClientRect().height >= 44))
      await manual.scrollIntoViewIfNeeded()
      await manual.click()
      await page.locator('#quick-inspector').waitFor({state:'visible'})
      await page.locator('#mobile-app-more > summary').click()
      await page.locator('[data-mobile-action="mobile-source-view"]').click()
      await capture(page, `${prefix}-source`, "#source-editor")
      await openFiles(page)
      await capture(page, `${prefix}-files`, "main > aside")
      for (const [mode, label] of [["style", "styles"], ["sound", "sounds"], ["resource", "images"]]) {
        if (mode === "sound") await page.evaluate(async bytes => {
          (await import("/src/app/state.ts")).appState.archive.setBytes("light/skin/res/mobile_preview.wav", new Uint8Array(bytes))
        }, Array.from(wav(8000)))
        await page.locator(`.sidebar-overview [data-nav-mode="${mode}"]`).first().click()
        assert.equal(await page.locator('[data-inspector-tab="properties"]').getAttribute("aria-selected"), "true")
        if (mode === "resource" && await page.locator("#resource-detail").isVisible()) {
          const headingFits = await page.locator(".resource-detail-heading").evaluate(node => {
            const box = node.getBoundingClientRect(), pane = node.closest("#resource-inspector").getBoundingClientRect()
            return box.top >= pane.top && box.left >= pane.left && box.right <= pane.right
          })
          assert.ok(headingFits, "image title and return control remain fully visible")
          await capture(page, `${prefix}-image-detail`, "main > .source")
          await page.locator("#resource-back").click()
        }
        await capture(page, `${prefix}-${label}`, "main > .source")
        if (mode !== 'sound') {
          assert.equal(await page.locator('main > .workspace').evaluate(n => getComputedStyle(n).visibility), 'hidden', 'resource browser gives the preview space to the list')
          const visible = await page.locator('#resource-gallery .ui-style-card, #resource-gallery .ui-image-card').evaluateAll(nodes => {
            const list = document.querySelector('#resource-gallery').getBoundingClientRect()
            return nodes.map(n => n.getBoundingClientRect()).filter(r => r.top >= list.top && r.bottom <= list.bottom)
              .map(r => ({x:r.x, y:r.y}))
          })
          assert.ok(visible.length >= (width === 320 ? 2 : 4), 'resource browser shows a complete row on 320px and two rows on larger screens')
          assert.ok(new Set(visible.map(r => r.x)).size >= 2, 'narrow phone retains two columns')
        }
        if (mode === "style") {
          await page.locator('#resource-gallery .ui-style-card').first().scrollIntoViewIfNeeded()
          await capture(page, `${prefix}-styles-detail`, "main > .source")
        }
        await openFiles(page)
      }
      await page.locator('#mobile-navigation [data-mobile-page=edit]').click()
      await page.locator('#mobile-app-more > summary').click()
      await capture(page, `${prefix}-drawer`, '#mobile-app-more > .ui-menu')
      await page.keyboard.press("Escape")
      await page.locator("#mobile-app-more > summary").click()
      await page.locator('#mobile-app-more [data-app-dialog="settings"]').click()
      await page.waitForSelector("#settings-dialog[open]")
      await capture(page, `${prefix}-settings`, "#settings-dialog")
      await page.keyboard.press("Escape")
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      await page.waitForSelector(".template-card", { state: "attached" })
      await page.locator("#browser-open").setInputFiles({ name: "移动端动效.bda", mimeType: "application/octet-stream", buffer: Buffer.from(bdaAnimatedSkinBytes()) })
      await page.waitForFunction(() => !document.querySelector("#open").disabled && !document.querySelector("#file-operation-dialog").open)
      for (const mode of ["motion", "particle"]) {
        await openFiles(page)
        await page.locator(`.sidebar-overview [data-nav-mode="${mode}"]`).first().click()
        const player = page.locator('#quick-inspector .ui-animation-player:not([data-variant="thumbnail"])').first()
        await player.waitFor()
        await player.scrollIntoViewIfNeeded()
        await capture(page, `${prefix}-${mode}-timeline`, "main > .source")
        const slow = player.getByRole("button", { name: "慢放 ¼×", exact: true })
        const beforeSlow = await slow.getAttribute("aria-pressed")
        await slow.click()
        assert.notEqual(await slow.getAttribute("aria-pressed"), beforeSlow)
        await player.getByRole("button", { name: "播放预览", exact: true }).click()
        await page.waitForFunction(() => Number(document.querySelector('#quick-inspector .ui-animation-player:not([data-variant="thumbnail"]) .ui-slider')?.value) > 0)
        await player.getByRole("button", { name: "暂停预览", exact: true }).click()
        const content = page.locator("#quick-inspector")
        await content.evaluate(node => { node.scrollTop = node.scrollHeight })
        await capture(page, `${prefix}-${mode}-parameters`, "main > .source")
      }
    } finally {
      await context.close()
    }
  }
  assert.deepEqual(errors, [], "browser errors")
  writeFileSync(join(output, "screenshots.json"), JSON.stringify(captures, null, 2))
  console.log(`${captures.length} mobile visual captures checked; no browser errors`)
} finally {
  await browser.close()
  await server.close()
}
