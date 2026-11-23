import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"
import { SkinArchive } from "../src/skin.ts"
import { encodePng } from "../src/ssf/ssf-png.ts"
import { bdaAnimatedSkinBytes } from "../tests/helpers/bda-animation-fixture.mjs"
import { sxiAnimationFixture } from "../tests/helpers/sxi-animation-fixture.mjs"
import { ssfFixture } from "../tests/helpers/ssf-fixture.mjs"
import { confirmDeletion } from "../tests/helpers/ask-dialogs.mjs"
import { dismissStartupDisclaimer } from "../tests/helpers/open-editor-template.mjs"

const archive = SkinArchive.open(bdsFixture())
for (const path of archive.names().filter(path => archive.isImage(path))) {
  archive.setBytes(path, encodePng({ width: 32, height: 16, data: new Uint8Array(32 * 16 * 4).fill(0x80) }))
}

const grid = { width: 35, height: 25, data: new Uint8Array(35 * 25 * 4) }
for (let y = 0; y < grid.height; y++) {
  for (let x = 0; x < grid.width; x++) {
    if (x % 5 < 4 && y % 5 < 4) grid.data[(y * grid.width + x) * 4 + 3] = 255
  }
}

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41924, strictPort: false, hmr: false } })
await server.listen()
mkdirSync(".ui-current", { recursive: true })
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      await dismissStartupDisclaimer(page)
      await page.locator("#browser-open").setInputFiles({ name: "切片.bds", mimeType: "application/octet-stream", buffer: Buffer.from(archive.toBytes("bds")) })
      await page.waitForFunction(() => !document.querySelector("#open").disabled && (!document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled))
      const close = page.locator("#file-operation-dialog[open] #file-operation-close")
      if (await close.isVisible()) await close.click()
      await page.getByRole("button", { name: "编辑模式", exact: true }).click()
      await page.locator('[data-workspace-page="resources"]').click()
      await page.locator('[data-resource-style-type="image"]').click()
      await page.locator('#resource-gallery .ui-style-card').first().click()
      await page.waitForFunction(() => !document.querySelector("#style-detail-previews").hidden && document.querySelector("#style-detail-normal").getContext("2d").getImageData(0, 0, 128, 88).data.some(value => value))
      await page.locator('[data-resource-page="image"]').click()
      const card = page.locator('#resource-gallery .ui-image-card[data-path$="/btn.png"]')
      await card.click()
      await page.locator('#image-resource-slices [role="option"]').first().waitFor()
      assert.equal(await page.locator('#image-resource-slices [role="option"]').count(), 2)
      assert.equal(await page.locator('#image-resource-preview-frame img').isVisible(), true)
      assert.equal(await page.locator('#resource-list-view :is(#resource-rename, #resource-delete)').count(), 0)
      for (const id of ['resource-rename', 'resource-delete', 'atlas-copy-image', 'atlas-create-image', 'atlas-import-folder']) {
        assert.equal(await page.locator(`.resource-detail-heading #${id}`).isVisible(), true, id)
      }
      const savedState = () => page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        return { undo: appState.undoStack.length, til: appState.archive.getText("light/res/btn.til") }
      })
      const before = await savedState()
      await card.dblclick()
      const dialog = page.locator('#atlas-editor-dialog[open]')
      const cancel = dialog.getByRole('button', { name: '取消', exact: true })
      const save = dialog.getByRole('button', { name: '保存', exact: true })
      const width = dialog.locator('[data-tile-source="2"]')
      await dialog.waitFor()
      assert.equal(await dialog.locator('#atlas-canvas').isVisible(), true)
      assert.equal(await dialog.locator('#tile-inspector').isVisible(), true)
      assert.equal(await dialog.getByText('引用', { exact: true }).count(), 0)
      assert.equal(await dialog.locator('#atlas-copy-image').count(), 0)
      assert.equal(await cancel.evaluate(button => button === document.activeElement), true)
      assert.equal(await page.locator('.workspace #resource-gallery').isVisible(), true)
      await page.screenshot({ path: `.ui-current/image-slice-editor-${engine.name()}.png` })
      await dialog.getByRole('button', { name: '关闭', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      const slice = page.locator('#image-resource-slices [data-slice-index="1"]')
      for (const discard of [() => cancel.click(), () => page.keyboard.press('Escape'),
        () => dialog.getByRole('button', { name: '关闭', exact: true }).click(), () => page.mouse.click(5, 5)]) {
        await slice.dblclick()
        assert.equal(await width.inputValue(), '10')
        await width.fill('9')
        await width.press('Tab')
        assert.equal(await width.inputValue(), '9')
        assert.equal(await dialog.getByRole('status').textContent(), '有未保存的切片修改')
        assert.deepEqual(await savedState(), before)
        await discard()
        await dialog.waitFor({ state: 'hidden' })
        assert.equal(await card.getAttribute('aria-selected'), 'true')
        assert.equal(await slice.getAttribute('title'), '10, 0, 10, 10')
        assert.deepEqual(await savedState(), before)
      }
      await slice.dblclick()
      await dialog.getByRole('switch', { name: '按九宫格拉伸' }).click()
      await width.fill('9')
      await save.click()
      await dialog.waitFor({ state: 'hidden' })
      const saved = await savedState()
      await page.waitForFunction(() => document.querySelector('#image-resource-slices [data-slice-index="1"]')?.title === '10, 0, 9, 10')
      assert.equal(saved.undo, before.undo + 1)
      assert.match(saved.til, /\[IMG1\]\nSOURCE_RECT=10,0,9,10\nSCALE=1,1,1,1,1\nINNER_RECT=12,2,5,6/)
      await page.keyboard.press('ControlOrMeta+z')
      await page.waitForFunction(() => document.querySelector('#image-resource-slices [data-slice-index="1"]')?.title === '10, 0, 10, 10')
      assert.deepEqual(await savedState(), before)
      await slice.dblclick()
      const deleteTile = dialog.getByRole('button', { name: '删除选中切片', exact: true })
      await deleteTile.click()
      const deleteDialog = page.locator('dialog[open][data-delete-confirmation]')
      await deleteDialog.getByRole('button', { name: '取消', exact: true }).click()
      await deleteDialog.waitFor({ state: 'detached' })
      assert.equal(await width.inputValue(), '10')
      assert.deepEqual(await savedState(), before)
      await dialog.locator('h2').click()
      await page.keyboard.press('Delete')
      await confirmDeletion(page)
      await dialog.getByText('有未保存的切片修改').waitFor()
      assert.deepEqual(await savedState(), before, 'confirmed deletion stays in the draft until saved')
      await save.click()
      await dialog.waitFor({ state: 'hidden' })
      await slice.waitFor({ state: 'detached' })
      assert.doesNotMatch((await savedState()).til, /\[IMG1\]/)
      await page.keyboard.press('ControlOrMeta+z')
      await slice.waitFor()
      assert.deepEqual(await savedState(), before)
      await page.setViewportSize({ width: 812, height: 700 })
      await card.focus()
      await page.keyboard.press('Enter')
      await dialog.waitFor()
      assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth), false)
      assert.equal(await save.isVisible(), true)
      await page.screenshot({ path: `.ui-current/image-slice-editor-compact-${engine.name()}.png` })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
      await page.screenshot({ path: `.ui-current/image-slice-inspector-${engine.name()}.png` })
      await page.locator('#resource-upload-input').setInputFiles({ name: 'grid.png', mimeType: 'image/png', buffer: Buffer.from(encodePng(grid)) })
      const gridCard = page.locator('#resource-gallery .ui-image-card[data-path$="/grid.png"]')
      await gridCard.dblclick()
      await dialog.locator('#atlas-auto-slice').click()
      await dialog.getByText('有未保存的切片修改').waitFor()
      await save.click()
      await dialog.waitFor({ state: 'hidden' })
      const gridPath = await gridCard.getAttribute('data-path')
      const readGridTil = () => page.evaluate(async (path) => {
        const { appState } = await import('/src/app/state.ts')
        return appState.archive.getText(path.replace(/\.png$/, '.til'))
      }, gridPath)
      const til = await readGridTil()
      assert.match(til, /^\[GLOBAL\]\nUSE_ALPHA=1\nTILE_NUM=35\n/)
      assert.match(til, /\[IMG35\]\nSOURCE_RECT=30,20,4,4/)

      await gridCard.dblclick()
      await dialog.locator('#new-tile').click()
      const { x, y, width: w, height: h } = await dialog.locator('#atlas-canvas').boundingBox()
      await page.mouse.move(x + w / 5, y + h / 5)
      await page.mouse.down()
      await page.mouse.move(x + w * 2 / 5, y + h * 2 / 5)
      await page.mouse.up()
      await dialog.getByText('有未保存的切片修改').waitFor()
      assert.equal(await readGridTil(), til, 'new slice and count stay in the draft until saved')
      await save.click()
      await dialog.waitFor({ state: 'hidden' })
      const added = await readGridTil()
      assert.match(added, /^\[GLOBAL\]\nUSE_ALPHA=1\nTILE_NUM=36\n/)
      assert.match(added, /\[IMG36\]\nSOURCE_RECT=7,5,7,5/)

      await page.locator('#image-resource-slices [data-slice-index="36"]').dblclick()
      await dialog.locator('#duplicate-tile').click()
      await save.click()
      await dialog.waitFor({ state: 'hidden' })
      const duplicated = await readGridTil()
      assert.match(duplicated, /^\[GLOBAL\]\nUSE_ALPHA=1\nTILE_NUM=37\n/)
      assert.match(duplicated, /\[IMG37\]\nSOURCE_RECT=7,5,7,5/)
      await page.keyboard.press('ControlOrMeta+z')
      assert.equal(await readGridTil(), added, 'undo restores the slice and count together')
      for (const [format, bytes] of Object.entries({ bdi: archive.toBytes("bdi"), bda: bdaAnimatedSkinBytes(), sxi: sxiAnimationFixture(), ssf: ssfFixture() })) {
        const other = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
        other.on("pageerror", error => errors.push(`${format}: ${error.message}`))
        await other.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
        await dismissStartupDisclaimer(other)
        await other.locator("#browser-open").setInputFiles({ name: `切片.${format}`, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) })
        await other.waitForFunction(() => !document.querySelector("#open").disabled && (!document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled))
        const operationClose = other.locator("#file-operation-dialog[open] #file-operation-close")
        if (await operationClose.isVisible()) await operationClose.click()
        await other.locator('[data-workspace-page="resources"]').click()
        await other.locator('[data-resource-page="image"]').click()
        const imageCard = other.locator('#resource-gallery .ui-image-card').first()
        await imageCard.click()
        await other.waitForFunction(() => document.querySelector('#image-resource-preview-frame img')?.naturalWidth > 0)
        await imageCard.dblclick()
        await other.locator('#atlas-editor-dialog[open] #atlas-canvas').waitFor()
        await other.keyboard.press('Escape')
        await other.locator('#atlas-editor-dialog[open]').waitFor({ state: 'hidden' })
        assert.equal(await imageCard.getAttribute('aria-selected'), 'true', `${format} retains its image selection`)
        if (format === "bda" || format === "sxi") {
          await other.getByRole("button", { name: "编辑模式", exact: true }).click()
          const { path, index, value, file } = await other.evaluate(async format => {
            const { resourceImageSlices } = await import("/src/app/tile-editing.ts")
            const { currentBdaAppearance } = await import("/src/app/bda-documents.ts")
            for (const card of document.querySelectorAll("#resource-gallery .ui-image-card")) {
              const path = card.dataset.path
              for (const slice of resourceImageSlices(path)) {
                if (slice.source[2] < 2) continue
                if (format === "sxi" && !slice.inner) return { path, index: slice.index, value: slice.source[2] - 1, file: "skin.json" }
                if (format === "bda" && slice.inner && slice.inner[2] > 1) {
                  return { path, index: slice.index, value: slice.inner[2] - 1, file: currentBdaAppearance().path }
                }
              }
            }
            throw new Error(`No editable ${format} fixture slice`)
          }, format)
          await other.locator(`#resource-gallery .ui-image-card[data-path="${path}"]`).click()
          const read = () => other.evaluate(async file => Array.from((await import("/src/app/state.ts")).appState.archive.getBytes(file)), file)
          const original = await read()
          const editor = other.locator("#atlas-editor-dialog[open]")
          const field = editor.locator(format === "bda" ? '[data-tile-inner="2"]' : '[data-tile-source="2"]')
          const open = () => other.locator(`#image-resource-slices [data-slice-index="${index}"]`).dblclick()
          await open()
          await field.fill(String(value))
          await field.press("Tab")
          assert.deepEqual(await read(), original, `${format} does not write the draft`)
          await editor.getByRole("button", { name: "取消", exact: true }).click()
          await editor.waitFor({ state: "hidden" })
          assert.deepEqual(await read(), original, `${format} cancel discards the draft`)
          await open()
          await field.fill(String(value))
          await editor.getByRole("button", { name: "保存", exact: true }).click()
          await editor.waitFor({ state: "hidden" })
          assert.notDeepEqual(await read(), original, `${format} save writes the draft`)
          await other.keyboard.press("ControlOrMeta+z")
          assert.deepEqual(await read(), original, `${format} save is reversible`)
        }
        await other.close()
      }
      assert.deepEqual(errors, [])
      console.log(`${engine.name()}: selected thumbnails, slices, resource actions, modal editing, close, undo and keyboard passed`)
    } finally { await browser.close() }
  }
} finally { await server.close() }
