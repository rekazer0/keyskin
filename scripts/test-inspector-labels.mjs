import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 41942, strictPort: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, bypassCSP: true })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('.template-card[data-template="xiaomi-unified-rounded-blur"]').click()
  await page.waitForFunction(() => !document.querySelector("#open").disabled)
  await page.waitForFunction(() => !document.querySelector("#file-operation-dialog").open)
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()
  await page.evaluate(async () => {
    const { appState } = await import("/src/app/state.ts")
    await (await import("/src/app/navigation.ts")).selectFile(appState.layoutPath)
  })
  // 分类栏完整显示名称；长文字自动换行，重绘不重建未变化的按钮。
  const railLabels = [
    ["时间与循环", "时间与循环"], ["工具栏图标", "工具栏图标"], ["候选栏动画", "候选栏动画"],
    ["输入区动画", "输入区动画"], ["位置与层级", "位置与层级"], ["资源与位置", "资源与位置"],
    ["布局与节奏", "布局与节奏"], ["前景样式 12", "前景样式 12"], ["自定义扩展分组", "自定义扩展分组"],
    ["时间与循环", "时间与循环 2"], ["工具按钮 7", "工具按钮 7"], ["工具按钮 7动画", "工具按钮 7动画"],
    ["CustomInspectorGroup123456789", "CustomInspectorGroup123456789"],
  ]
  await page.evaluate(async (labels) => {
    const { section } = await import("/src/app/property-rows.ts")
    const { syncMobileInspectorGroups } = await import("/src/app/mobile-layout.ts")
    document.querySelector("#document-fields").append(...labels.map(([label]) => {
      const node = section(label)
      node.dataset.railLabelTest = "true"
      return node
    }))
    syncMobileInspectorGroups()
  }, railLabels)
  for (const [index, [label, name]] of railLabels.entries()) {
    const section = page.locator('[data-rail-label-test="true"]').nth(index)
    const id = await section.getAttribute("data-mobile-inspector-group")
    const button = page.locator(`#mobile-inspector-groups button[data-mobile-inspector-group="${id}"]`)
    assert.equal(await button.textContent(), name)
    assert.ok((await button.getAttribute("title")).startsWith(label))
    assert.equal(await section.locator(".document-section-title").textContent(), label)
    await button.click()
    assert.equal(await button.getAttribute("aria-pressed"), "true")
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => { document.documentElement.dataset.mobilePane = "inspector" })
    assert.equal(await page.locator("#mobile-inspector-groups .inspector-group-label").evaluateAll(nodes => nodes.every(node =>
      node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1)), true, "完整名称不溢出或裁切")
    assert.equal(await page.getByRole("button", { name: "工具按钮 7动画", exact: true }).locator(".inspector-group-label").evaluate(node => {
      const range = document.createRange()
      range.selectNodeContents(node)
      return range.getClientRects().length > 1
    }), true, "工具按钮动画名称自动换行")
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  assert.equal(await page.evaluate(async () => {
    const { syncMobileInspectorGroups } = await import("/src/app/mobile-layout.ts")
    const button = document.querySelector("#mobile-inspector-groups button")
    syncMobileInspectorGroups()
    return button === document.querySelector("#mobile-inspector-groups button")
  }), true)
  await page.evaluate(async () => {
    document.querySelectorAll('[data-rail-label-test="true"]').forEach(node => node.remove())
    await (await import("/src/app/mobile-layout.ts")).syncMobileInspectorGroups()
  })
  assert.deepEqual(errors, [])
  console.log("Inspector labels: full names, duplicate numbers, desktop/mobile wrapping, no clipping, navigation and stable refresh passed")
} finally {
  await browser.close()
  await server.close()
}
