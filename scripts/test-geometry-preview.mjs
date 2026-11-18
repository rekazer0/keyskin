import assert from "node:assert/strict"
import { readFileSync, mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"
import { mobilePenFixture } from "../tests/helpers/mobile-pen-fixture.mjs"
import { ssfFixture, wav } from "../tests/helpers/ssf-fixture.mjs"
import { SkinArchive } from "../src/skin.ts"
import { buildSxiZip } from "../src/palm/palm-export.ts"

const output = new URL("../.ui-current/geometry-preview/", import.meta.url).pathname
mkdirSync(output, { recursive: true })
const bds = mobilePenFixture()
const bdi = await SkinArchive.open(bds).platformBytesAsync("bdi")
const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41968, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const errors = []
const fixture = [
  ["bds", bds, "light/skin/port/py_26.ini"],
  ["bdi", bdi, "light/skin/port/py_26.ini"],
  ["bda", readFileSync(new URL("../public/default-template.bda", import.meta.url)), "light/skin/port/py_9.ini"],
  ["ssf", ssfFixture(), "light/skin/port/py_26.ini"],
  ["sxi", buildSxiZip(SkinArchive.open(bds)).bytes, "skin.json/default/port_layout/b/full26Pinyin"],
]
const undo = page => page.evaluate(async () => (await import("/src/app/edit-history.ts")).undo())
const snapshot = page => page.evaluate(async () => {
  const { appState } = await import("/src/app/state.ts")
  return { undo: appState.undoStack.length, files: appState.archive.names().map(path => [path, [...appState.archive.getBytes(path)]]) }
})
try {
  for (const [format, bytes, path] of fixture.filter(item => !process.env.FORMAT || item[0] === process.env.FORMAT)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce", deviceScaleFactor: 2 })
    page.on("pageerror", error => errors.push(`${format}: ${error.message}`))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator("#browser-open").setInputFiles({ name: `检查器.${format}`, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) })
    await page.waitForFunction(() => !document.querySelector("#open").disabled && (!document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled))
    if (await page.locator("#file-operation-dialog[open]").count()) await page.locator("#file-operation-close").click()
    if (await page.locator("#mode").inputValue() !== "edit") await page.getByRole("button", { name: "编辑模式", exact: true }).click()
    await page.evaluate(async ({ path, format, sound }) => {
      const { appState } = await import("/src/app/state.ts")
      await (await import("/src/app/navigation.ts")).selectFile(path, "overview")
      const { preview } = await import("/src/app/canvas-interaction.ts")
      const key = format === "ssf" ? preview.keys.find(key => key.center === "q") : preview.keys.find(key => /^KEY/.test(key.section) && (key.foreStyle || key.foreStyles.length))
      if (!key) throw new Error(`没有测试按键 ${format}`)
      appState.selectedKeySections = [key.section]
      preview.setSelected([key.section])
      for (const name of ["first.wav", "second.wav"]) appState.archive.setBytes(`light/skin/res/${name}`, Uint8Array.from(sound))
      ;(await import("/src/app/key-inspector.ts")).populateKeyInspector()
    }, { path, format, sound: [...wav()] })
    const geometry = page.locator('#quick-inspector .ui-geometry-preview').filter({ visible: true }).first()
    await geometry.scrollIntoViewIfNeeded()
    const before = await snapshot(page)
    assert.equal(await geometry.locator(':scope > small').count(), 0)
    const editable = !["bda", "ssf"].includes(format)
    assert.equal(await geometry.locator('.ui-geometry-handle').count(), editable ? 4 : 0)
    if (editable) {
      const handle = geometry.locator('[data-corner="se"]')
      const box = await handle.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 8, { steps: 5 })
      const drawing = await geometry.locator('canvas').evaluate(canvas => {
        const context = canvas.getContext('2d'), transform = context.getTransform()
        return { x: transform.a, y: transform.d, expectedX: canvas.width / canvas.clientWidth, expectedY: canvas.height / canvas.clientHeight }
      })
      assert.equal(drawing.x, drawing.expectedX, `${format}: drag must not accumulate horizontal canvas scaling`)
      assert.equal(drawing.y, drawing.expectedY, `${format}: drag must not accumulate vertical canvas scaling`)
      await page.screenshot({ path: `${output}${format}-dragging.png` })
      assert.deepEqual(await snapshot(page), before, `${format}: dragging is temporary`)
      await page.mouse.up()
      assert.equal((await snapshot(page)).undo, before.undo + 1)
      assert.notDeepEqual((await snapshot(page)).files, before.files)
      await undo(page)
      assert.deepEqual(await snapshot(page), before, `${format}: resize undo restores bytes`)
      await geometry.locator('[data-corner="se"]').focus()
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      assert.equal((await snapshot(page)).undo, before.undo + 2)
      await undo(page)
      await undo(page)
      assert.deepEqual(await snapshot(page), before)
    }
    if (["bds", "bdi"].includes(format)) {
      const input = geometry.locator('[data-key-field="PADDING.1"]')
      assert.equal(await input.count(), 1)
      const positions = await Promise.all([1, 2, 3, 0].map(side => geometry.locator(`[data-key-field="PADDING.${side}"]`).boundingBox()))
      assert.ok(positions[0].y < positions[1].y && positions[1].y < positions[2].y, 'padding follows top/right/bottom')
      assert.ok(positions[3].x < positions[0].x && positions[0].x < positions[1].x, 'padding follows left/top/right')
      await input.fill('12')
      await input.press('Enter')
      assert.equal(await geometry.locator('[data-key-field="PADDING.1"]').inputValue(), '12')
      assert.equal((await snapshot(page)).undo, before.undo + 1)
      await undo(page)
      assert.deepEqual(await snapshot(page), before)
    }
    await geometry.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}${format}-desktop.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    if (await page.locator('.mobile-geometry-detail > summary').isVisible()) await page.locator('.mobile-geometry-detail > summary').click()
    await geometry.scrollIntoViewIfNeeded()
    assert.equal(await geometry.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
    await page.screenshot({ path: `${output}${format}-mobile.png` })
    await page.close()
    console.log(`${format}: geometry drag, padding and undo passed`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
}
