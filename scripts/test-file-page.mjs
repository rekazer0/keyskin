import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41908, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
mkdirSync(".ui-current/file-page", { recursive: true })
try {
  for (const colorScheme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme })
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    const fileEntry = page.locator('[data-workspace-page="files"]')
    const form = page.locator("#file-project-chooser #new-project-form")
    const create = form.locator('button[value="create"]')
    assert.equal(await fileEntry.getAttribute("aria-current"), "page")
    assert.equal(await form.locator(".project-template-card").count(), 8)
    assert.equal(await page.locator("#new-project-dialog").isVisible(), false)

    // 单击模板只选择，文件名校验通过并点击新建后才替换文档。
    await form.locator('input[value="official-android-bds"]').check()
    assert.equal(await form.locator("output").textContent(), ".bds")
    await form.locator('[name="project-name"]').fill("无效/名称")
    await form.locator('[name="project-name"]').press("Enter")
    assert.equal(await page.locator(".canvas-wrap.empty").count(), 1)
    await create.click()
    assert.equal(await page.locator(".canvas-wrap.empty").count(), 1)
    assert.equal(await form.locator('[name="project-name"]').evaluate(node => node.validity.valid), false)
    await form.locator('[name="project-name"]').fill("合并页测试")
    await create.click()
    await page.locator(".canvas-wrap:not(.empty)").waitFor()
    await page.waitForFunction(() => !document.querySelector("#open").disabled)
    assert.equal(await page.locator("#document-name").textContent(), "合并页测试.bds")
    await page.evaluate(async () => { window.filePageArchive = (await import("/src/app/state.ts")).appState.archive })

    // 返回文件页再回概览，保留同一份未保存文档。
    await fileEntry.click()
    assert.equal(await form.isVisible(), true)
    await page.locator('[data-workspace-page="overview"]').click()
    assert.equal(await page.locator(".canvas-wrap:not(.empty)").count(), 1)
    assert.equal(await page.evaluate(async () => window.filePageArchive === (await import("/src/app/state.ts")).appState.archive), true)
    await fileEntry.click()
    await form.locator('input[value="default-android"]').check()
    await create.click()
    const confirmation = page.locator('dialog[data-variant="ask"][open]')
    await confirmation.waitFor()
    await confirmation.getByRole("button", { name: "取消", exact: true }).click()
    await confirmation.waitFor({ state: "hidden" })
    await page.waitForFunction(() => !document.querySelector("#open").disabled)
    assert.equal(await page.evaluate(async () => window.filePageArchive === (await import("/src/app/state.ts")).appState.archive), true)

    // 旧的新建菜单定位到同一页面，不再弹出独立窗口。
    await page.locator(".pen-file-menu > summary").click()
    await page.locator("#new").click()
    assert.equal(await page.locator("#new-project-dialog").isVisible(), false)
    assert.equal(await form.isVisible(), true)
    assert.equal(page.context().pages().length, 1)
    await page.evaluate(async () => {
      const { recordRecentFile } = await import("/src/app/recent-files.ts")
      document.querySelector(".welcome-recent").removeAttribute("data-platform-hidden")
      recordRecentFile("/tmp/合并页测试.bds", "合并页测试.bds")
    })
    assert.equal(await page.locator("#welcome-recent-grid .recent-card").count(), 1)
    assert.equal(await form.isVisible(), true, "recent files and creation share one page")
    await page.locator("#recent-clear").click()
    assert.equal(await page.locator("#welcome-recent-empty").isVisible(), true)
    assert.equal(await form.locator('[name="project-name"]').inputValue(), "合并页测试")
    for (const width of [1440, 1024, 800]) {
      await page.setViewportSize({ width, height: 1000 })
      await create.scrollIntoViewIfNeeded()
      assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
      const geometry = await form.evaluate(node => {
        const rect = node.getBoundingClientRect()
        return { width: rect.width, scroll: node.scrollWidth }
      })
      assert.ok(geometry.scroll <= geometry.width + 1, JSON.stringify(geometry))
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.locator(".welcome-main").evaluate(node => { node.scrollTop = 0 })
    await page.screenshot({ path: `.ui-current/file-page/${colorScheme}.png` })
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport)
      assert.equal(await page.locator("#new-project-dialog #new-project-form").count(), 1)
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    assert.equal(await form.count(), 1)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`file page ${colorScheme}: passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
