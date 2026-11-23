import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { dismissStartupDisclaimer } from "../tests/helpers/open-editor-template.mjs"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const colorScheme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme })
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem("onboarding-tour-v1", "done"))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await dismissStartupDisclaimer(page)
    await page.locator("#browser-open").setInputFiles({ name: "source-selection.bds", mimeType: "application/octet-stream", buffer: Buffer.from(bdsFixture()) })
    await page.waitForFunction(() => !document.querySelector("#open").disabled && !document.querySelector("#file-operation-dialog").open)
    await page.getByRole("button", { name: "编辑模式", exact: true }).click()
    await page.locator('.sidebar-overview button[data-path$="/py_26.ini"]').click()
    const entry = name => page.locator("#workspace-navigation").getByRole("button", { name, exact: true })
    await entry("源代码").click()
    const before = await page.evaluate(async () => [...(await import("/src/app/state.ts")).appState.archive.changed])
    for (const canvasName of ["preview", "toolbarPreview"]) {
      const target = await page.evaluate(async canvasName => {
        const { appState } = await import("/src/app/state.ts")
        const { selectFile } = await import("/src/app/navigation.ts")
        const canvases = await import("/src/app/canvas-interaction.ts")
        selectFile(appState.archive.names().find(path => path.endsWith("/anim.ini")), "source")
        const canvas = canvases[canvasName]
        await canvas.rendered()
        const key = canvas.keys[0]
        const bounds = canvas.canvas.getBoundingClientRect()
        const size = canvas.logicalSize()
        return {
          x: bounds.left + (key.rect.x + key.rect.width / 2) / size.width * bounds.width,
          y: bounds.top + (key.rect.y + key.rect.height / 2) / size.height * bounds.height,
          path: canvasName === "preview" ? appState.layoutPath : document.querySelector("#toolbar-strip").dataset.path,
          section: key.section,
        }
      }, canvasName)
      for (let click = 0; click < 2; click++) {
        await page.mouse.click(target.x, target.y)
        await page.waitForFunction(async () => !(await import("/src/app/state.ts")).appState.selectionInspectorSyncPending)
        const selection = await page.evaluate(async () => {
          const { appState } = await import("/src/app/state.ts")
          return { path: appState.selectedPath, sections: [...appState.selectedKeySections, ...appState.selectedToolbarSections], candidate: appState.selectedCandidate }
        })
        assert.equal(selection.path, target.path, `${canvasName} opens the selected key's source`)
        if (!click) assert.deepEqual(selection.sections, canvasName === "preview" ? [target.section] : [])
        if (canvasName === "toolbarPreview") assert.equal(selection.candidate, true)
        assert.equal(await page.locator(".raw-files").isVisible(), true, "canvas selection keeps the source tree")
        assert.equal(await page.locator("#source-editor").isVisible(), true)
        assert.equal(await entry("源代码").getAttribute("aria-current"), "page")
      }
      if (canvasName === "preview") {
        const start = await page.evaluate(async () => {
          const { preview } = await import("/src/app/canvas-interaction.ts")
          const bounds = preview.canvas.getBoundingClientRect()
          const size = preview.logicalSize()
          return { x: bounds.x + 260 / size.width * bounds.width, y: bounds.y + 160 / size.height * bounds.height }
        })
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        await page.mouse.move(target.x, target.y, { steps: 5 })
        await page.mouse.up()
        assert.deepEqual(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.selectedKeySections), ["KEY1", "KEY2"], "reverse drag from empty space selects both keys instead of panning")
      } else {
        await page.locator('.canvas-wrap').click({ position: { x: 8, y: 8 } })
        assert.equal(await page.locator('#candidate-area').getAttribute('aria-selected'), 'false', 'clicking outside the keyboard clears the candidate outline')
        assert.equal(await page.evaluate(async () => {
          const { appState } = await import('/src/app/state.ts')
          return appState.selectedPath === appState.layoutPath && !appState.selectedCandidate
        }), true, 'clearing the candidate returns to the panel source')
        assert.equal(await page.locator('#source-editor').isVisible(), true)
      }
    }
    assert.deepEqual(await page.evaluate(async () => [...(await import("/src/app/state.ts")).appState.archive.changed]), before, "canvas selection does not edit files")
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`source canvas selection ${colorScheme}: passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
