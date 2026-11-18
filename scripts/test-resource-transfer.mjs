import { confirmDeletion } from "../tests/helpers/ask-dialogs.mjs"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"
import { unzipSync } from "fflate"
import { bdsFixture } from "../tests/helpers/baidu-fixture.mjs"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41916, strictPort: false, hmr: false } })
await server.listen()
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      const finish = async () => {
        await page.waitForFunction(() => !document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled)
        const close = page.locator("#file-operation-dialog[open] #file-operation-close")
        if (await close.isVisible()) await close.click()
      }
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      await page.locator("#browser-open").setInputFiles({ name: "resources.bds", mimeType: "application/octet-stream", buffer: Buffer.from(bdsFixture()) })
      await page.waitForFunction(() => !document.querySelector("#open").disabled)
      await finish()
      await page.getByRole("button", { name: "编辑模式", exact: true }).click()
      await page.locator('[data-workspace-page="resources"]').click()
      await page.locator('[data-resource-page="image"]').click()
      const cards = page.locator("#resource-gallery .ui-image-card")
      const selected = page.locator('#resource-gallery [aria-selected="true"]')
      const original = await page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        const png = appState.archive.getBytes(document.querySelector(".ui-image-card").dataset.path)
        for (let i = 0; i < 4; i++) appState.archive.setBytes(`light/skin/res/select-${i}.png`, png)
        ;(await import("/src/app/resource-inspector.ts")).renderResourceInspector()
        return { undo: appState.undoStack.length, revision: appState.archive.revision }
      })
      await cards.nth(0).click()
      assert.equal(await selected.count(), 1)
      assert.equal(await page.locator("body.atlas-workspace").count(), 0, "single click keeps the grid")
      await cards.nth(1).click({ modifiers: ["ControlOrMeta"] })
      assert.equal(await selected.count(), 2)
      assert.equal(await page.locator("#resource-rename").isDisabled(), true)
      await cards.nth(0).click({ modifiers: ["ControlOrMeta"] })
      assert.equal(await selected.count(), 1, "modifier click toggles selection")
      await cards.nth(0).click()
      await cards.nth(3).click({ modifiers: ["Shift"] })
      assert.equal(await selected.count(), 4)
      await page.keyboard.press("Shift+ArrowLeft")
      assert.equal(await selected.count(), 3, "Shift arrows extend from the anchor using focused card")
      await page.keyboard.press("ControlOrMeta+a")
      assert.equal(await selected.count(), await cards.count())
      await page.keyboard.press("Escape")
      assert.equal(await selected.count(), 0)
      assert.equal(await page.locator("#resource-download").isDisabled(), true)
      await cards.nth(0).click()
      await page.keyboard.press("Enter")
      await page.locator("#atlas-editor-dialog[open]").waitFor()
      await page.locator('#atlas-editor-dialog').getByRole("button", { name: "关闭", exact: true }).click()
      await cards.nth(1).dblclick()
      await page.locator("#atlas-editor-dialog[open]").waitFor()
      await page.locator('#atlas-editor-dialog').getByRole("button", { name: "关闭", exact: true }).click()
      assert.deepEqual(await page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        return { undo: appState.undoStack.length, revision: appState.archive.revision }
      }), original, "selection and opening do not edit resources")

      await cards.nth(0).click()
      await cards.nth(1).click({ modifiers: ["ControlOrMeta"] })
      const paths = await selected.evaluateAll(items => items.map(item => item.dataset.path))
      const transfer = await cards.nth(0).evaluate(async card => {
        const dataTransfer = new DataTransfer()
        const create = URL.createObjectURL
        let blob
        URL.createObjectURL = value => { blob = value; return create(value) }
        try { card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer })) }
        finally { URL.createObjectURL = create }
        const payload = dataTransfer.getData("DownloadURL")
        const bytes = [...new Uint8Array(await blob.arrayBuffer())]
        card.dispatchEvent(new DragEvent("dragend", { bubbles: true }))
        return { payload, bytes }
      })
      assert.match(transfer.payload, /^application\/zip:资源.zip:blob:/)
      assert.deepEqual(Object.keys(unzipSync(Uint8Array.from(transfer.bytes))), paths)
      await page.evaluate(() => { window.showSaveFilePicker = undefined })
      const downloadEvent = page.waitForEvent("download")
      await page.locator("#resource-download").click()
      const download = await downloadEvent
      assert.equal(download.suggestedFilename(), "资源.zip")
      assert.deepEqual(Object.keys(unzipSync(readFileSync(await download.path()))), paths)
      await finish()

      const drop = async invalid => page.evaluate(async invalid => {
        const { appState } = await import("/src/app/state.ts")
        const before = appState.undoStack.length
        const png = appState.archive.getBytes(document.querySelector(".ui-image-card").dataset.path)
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(new File([png], "drop-a.png", { type: "image/png" }))
        dataTransfer.items.add(new File([invalid ? new Uint8Array([1, 2, 3]) : png], "drop-b.png", { type: "image/png" }))
        document.querySelector("#resource-gallery").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }))
        return before
      }, invalid)
      const beforeInvalid = await drop(true)
      await page.waitForFunction(() => document.querySelector("#event-log").dataset.kind === "error")
      assert.equal(await page.evaluate(async () => {
        const { appState } = await import("/src/app/state.ts")
        return appState.archive.names().some(path => /drop-[ab]\.png$/.test(path))
      }), false, "invalid batch leaves every file untouched")
      await finish()
      const beforeUpload = await drop(false)
      assert.equal(beforeUpload, beforeInvalid)
      await page.locator('.ui-image-card[data-path$="/drop-b.png"]').waitFor()
      await finish()
      assert.equal(await selected.count(), 2)
      assert.equal(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.undoStack.length), beforeUpload + 1)
      await page.keyboard.press("ControlOrMeta+z")
      assert.equal(await page.locator('.ui-image-card[data-path$="/drop-a.png"], .ui-image-card[data-path$="/drop-b.png"]').count(), 0, "one undo removes the full upload")
      await page.keyboard.press("ControlOrMeta+Shift+z")
      await page.locator('.ui-image-card[data-path$="/drop-b.png"]').waitFor()
      await page.locator('.ui-image-card[data-path$="/drop-a.png"]').click()
      await page.locator('.ui-image-card[data-path$="/drop-b.png"]').click({ modifiers: ["ControlOrMeta"] })
      const group = page.locator('.ui-image-card[data-path$="/drop-b.png"]')
      await group.focus()
      await group.press('Backspace')
      const confirmation = page.locator('dialog[open][data-delete-confirmation]')
      assert.equal(await confirmation.count(), 0, 'Backspace never deletes resources')
      await group.press('Delete')
      assert.equal(await confirmation.getByRole('button', { name: '取消', exact: true }).evaluate(node => node === document.activeElement), true)
      await page.keyboard.press('Escape')
      await confirmation.waitFor({ state: 'detached' })
      assert.equal(await selected.count(), 2, 'cancel leaves the selected files untouched')
      await group.click({ button: 'right' })
      await page.getByRole('menu', { name: '资源操作' }).getByRole('menuitem', { name: '删除选中图片' }).click()
      await confirmDeletion(page)
      assert.equal(await page.locator('.ui-image-card[data-path$="/drop-a.png"], .ui-image-card[data-path$="/drop-b.png"]').count(), 0)
      await page.keyboard.press("ControlOrMeta+z")
      await page.locator('.ui-image-card[data-path$="/drop-b.png"]').waitFor()
      await cards.nth(0).click()
      await cards.nth(1).click({ modifiers: ["ControlOrMeta"] })
      const query = await cards.nth(0).getAttribute("data-path")
      await page.locator("#resource-search").fill(query)
      assert.equal(await selected.count(), 1, "filtering drops hidden selections")
      await page.locator("#resource-search").fill("no-resource")
      assert.equal(await page.locator("#resource-delete").isDisabled(), true)
      await page.locator("#resource-search").fill("")
      await page.locator('[data-resource-page="style"]').click()
      const styles = page.locator("#resource-gallery .ui-style-card")
      await styles.nth(0).click()
      await styles.nth(1).click({ modifiers: ["ControlOrMeta"] })
      assert.equal(await selected.count(), 2, "style cards share additive selection")
      const created = await page.evaluate(async () => {
        const { addStyle } = await import("/src/app/style-picker.ts")
        const ids = [addStyle(), addStyle()]
        ;(await import("/src/app/resource-inspector.ts")).renderResourceInspector()
        return ids
      })
      await page.locator(`.ui-style-card[data-path="STYLE${created[0]}"]`).click()
      await page.locator(`.ui-style-card[data-path="STYLE${created[1]}"]`).click({ modifiers: ["ControlOrMeta"] })
      await page.locator('#resource-selection-actions .ui-list-toolbar [data-list-action="remove"]').click()
      await confirmDeletion(page)
      assert.equal(await page.locator(`.ui-style-card[data-path="STYLE${created[0]}"]`).count(), 0)
      await page.keyboard.press("ControlOrMeta+z")
      assert.equal(await page.locator(`.ui-style-card[data-path="STYLE${created[0]}"]`).count(), 1)
      assert.equal(await page.locator(`.ui-style-card[data-path="STYLE${created[1]}"]`).count(), 1, "one undo restores both deleted styles")
      await page.locator('[data-resource-page="image"]').click()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.locator('#mobile-navigation [data-mobile-page="resources"]').click()
      await page.locator('#mobile-resource-category').selectOption('image')
      await cards.nth(0).click()
      assert.equal(await page.locator("#resource-list-view").isVisible(), true)
      await cards.nth(0).dblclick()
      assert.equal(await page.locator("#resource-list-view").isVisible(), false)
      assert.deepEqual(errors, [])
      console.log(`${engine.name()}: selection, range keys, opening, drag ZIP, download, atomic upload, delete and undo passed`)
    } finally { await browser.close() }
  }
} finally { await server.close() }
