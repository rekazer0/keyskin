import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41868, strictPort: false } })
await server.listen()
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ bypassCSP: true })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.waitForSelector(".template-card")
  await page.locator('.template-card[data-template="official-android-bds"]').click()
  await page.waitForFunction(() => !document.querySelector("#open").disabled)
  const dialog = page.locator("#file-operation-dialog")
  const close = page.locator("#file-operation-close")
  if (await dialog.isVisible()) await close.click()

  const progressSamples = await page.evaluate(async () => {
    const progress = document.querySelector("#file-operation-progress")
    progress.value = 0
    const { updateFileOperationProgress } = await import("/src/app/file-operations.ts")
    updateFileOperationProgress(80, "测试进度")
    const samples = []
    for (let index = 0; index < 5; index += 1) {
      await new Promise(requestAnimationFrame)
      samples.push(progress.value)
    }
    return samples
  })
  assert.ok(progressSamples[0] > 0 && progressSamples[0] < 100, "progress animates between reported values")
  assert.ok(progressSamples.every((value, index) => index === 0 || value >= progressSamples[index - 1]), "progress moves monotonically")
  await page.evaluate(async () => {
    const { updateFileOperationProgress } = await import("/src/app/file-operations.ts")
    updateFileOperationProgress(100, "测试完成")
  })
  await page.waitForFunction(() => document.querySelector("#file-operation-progress").value === 100)

  // Keep the real archive writer; control when the browser confirms the write.
  await page.evaluate(() => {
    window.showSaveFilePicker = async () => ({
      name: "保存反馈.bds",
      createWritable: async () => ({
        write: async (bytes) => { window.writtenSize = bytes.byteLength },
        close: () => new Promise((resolve, reject) => { window.finishWrite = resolve; window.failWrite = reject }),
      }),
    })
  })
  await page.evaluate(async () => {
    const { runFileOperation } = await import("/src/app/file-operations.ts")
    const { saveArchive } = await import("/src/app/archive-io.ts")
    window.pendingSave = runFileOperation("保存", () => saveArchive(false, "bds"))
  })
  await page.waitForFunction(() => typeof window.finishWrite === "function")
  assert.equal(await dialog.isVisible(), true, "show progress until writable.close resolves")
  await page.waitForFunction(() => document.querySelector("#file-operation-progress").value === 90)
  assert.equal(await page.locator("#file-operation-progress").evaluate((meter) => meter.value), 90)
  assert.equal(await page.locator("#file-operation-detail").textContent(), "正在写入文件…")
  assert.ok(await page.evaluate(() => window.writtenSize > 0))
  await page.evaluate(async () => { window.finishWrite(); await window.pendingSave })
  await dialog.waitFor({ state: "visible" })
  assert.equal(await page.locator("#file-operation-progress").evaluate((meter) => meter.value), 100)
  assert.equal(await page.locator("#file-operation-title").textContent(), "保存完成")
  assert.equal(await page.locator("#file-operation-result").textContent(), "文件：保存反馈.bds\n保存位置：浏览器中选择的文件夹")
  assert.equal(await page.locator("#file-operation-result").isVisible(), true)
  assert.equal(await page.locator("#event-log").textContent(), "保存完成")
  await close.click()
  await dialog.waitFor({ state: "hidden" })

  for (const outcome of ["cancel", "error"]) {
    await page.evaluate(async (outcome) => {
      window.showSaveFilePicker = async () => {
        if (outcome === "cancel") throw new DOMException("已取消", "AbortError")
        return { name: "失败.bds", createWritable: async () => ({
          write: async () => {}, close: async () => { throw new Error("磁盘已满") },
        }) }
      }
      const { runFileOperation } = await import("/src/app/file-operations.ts")
      const { saveArchive } = await import("/src/app/archive-io.ts")
      await runFileOperation("导出", () => saveArchive(true, "bds"))
    }, outcome)
    if (outcome === "error") {
      assert.equal(await dialog.getAttribute("data-outcome"), "error")
      assert.equal(await dialog.isVisible(), true, "write failure stays visible")
      await close.click()
    }
    await dialog.waitFor({ state: "hidden" })
    assert.match(await page.locator("#event-log").textContent(), outcome === "cancel" ? /已取消/ : /磁盘已满/)
  }

  for (const action of ["保存", "导出", "导出日志", "下载文件", "下载图片", "下载按键音效"]) {
    for (const progress of [false, true]) {
      await page.evaluate(async ({ action, progress }) => {
        const { runFileOperation, showFileOperationProgress } = await import("/src/app/file-operations.ts")
        await runFileOperation(action, () => { if (progress) showFileOperationProgress(); return true })
      }, { action, progress })
      if (action === "保存" || action === "导出") {
        assert.equal(await dialog.isVisible(), true, `${action} keeps its completion dialog`)
        assert.equal(await page.locator("#file-operation-title").textContent(), `${action}完成`)
        assert.equal(await page.locator("#file-operation-progress").evaluate(meter => meter.value), 100)
        assert.equal(await page.locator("#file-operation-result").isVisible(), false, 'a new operation clears the previous path')
        await close.click()
      }
      await dialog.waitFor({ state: "hidden" })
      assert.equal(await page.locator("#event-log").textContent(), `${action}完成`, `${action} with progress=${progress}`)
    }
  }
  console.log("PASS: save/export retain 100% progress and destination after confirmed writes; cancellation and failure remain separate")
} finally {
  await browser?.close()
  await server.close()
}
