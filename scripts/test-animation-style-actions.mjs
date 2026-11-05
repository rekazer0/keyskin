// 动画工作区「样式」页底部的新建 / 复制 / 删除，以及列表短时工具条仍贴底。
import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { bdaAnimatedSkinBytes, bdsBaseArchive } from "../tests/helpers/bda-animation-fixture.mjs"
import { SkinArchive } from "../src/skin.ts"
import { convertBdaArchive } from "../src/bda-convert.ts"
import { acceptAskDialogs } from "../tests/helpers/ask-dialogs.mjs"
const bda = bdaAnimatedSkinBytes()
const bds = await convertBdaArchive(SkinArchive.open(bda, "bda"), bdsBaseArchive()).archive.platformBytesAsync("bds")
const server = await createServer({ root: new URL("..", import.meta.url).pathname, logLevel: "error", server: { port: 41851, strictPort: false, host: "127.0.0.1", hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await acceptAskDialogs(page)
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
await page.locator("#browser-open").setInputFiles({ name: "p.bds", mimeType: "application/octet-stream", buffer: Buffer.from(bds) })
await page.waitForFunction(() => !document.querySelector("#open").disabled)
const close = page.locator("#file-operation-dialog[open] #file-operation-close")
if (await close.isVisible()) await close.click()
await page.getByRole("button", { name: "编辑模式", exact: true }).click()
const styleCount = () => page.locator('.animation-library-pane:not([hidden]) [data-style-id]').count()
const action = (name) => page.locator(`.animation-library-pane:not([hidden]) [data-list-action="${name}"]`)
try {
  await page.locator('.sidebar-overview button[data-path="light/skin/port/res/anim.ini"][data-nav-mode="particle"]').click()
  const bottom = await page.evaluate(() => [document.querySelector(".sidebar").getBoundingClientRect().bottom, document.querySelector(".animation-library-pane:not([hidden]) > .ui-list-toolbar").getBoundingClientRect().bottom])
  assert.ok(bottom[0] - bottom[1] < 40, `粒子列表短时工具条也贴底：${bottom}`)
  await page.locator(".animation-library-tabs button").nth(1).click()
  const before = await styleCount()
  await action("create").click()
  await page.waitForFunction((n) => document.querySelectorAll('.animation-library-pane:not([hidden]) [data-style-id]').length === n + 1, before)
  const created = await page.locator('.animation-library-pane:not([hidden]) [data-style-id][aria-selected="true"]').getAttribute("data-style-id")
  assert.ok(created, "新建的样式被选中")
  await action("duplicate").click()
  await page.waitForFunction((n) => document.querySelectorAll('.animation-library-pane:not([hidden]) [data-style-id]').length === n + 2, before)
  assert.notEqual(await page.locator('.animation-library-pane:not([hidden]) [data-style-id][aria-selected="true"]').getAttribute("data-style-id"), created, "复制出的样式被选中")
  assert.equal(await action("remove").isDisabled(), false, "未被引用的样式可删除")
  await action("remove").click()
  await page.waitForFunction((n) => document.querySelectorAll('.animation-library-pane:not([hidden]) [data-style-id]').length === n + 1, before)
  await page.locator(`.animation-library-pane:not([hidden]) [data-style-id]:not([data-style-id="${created}"])`).first().click()
  // 测试皮肤里原有的样式都挂在按键上
  assert.equal(await action("remove").isDisabled(), true, "被引用的样式不能删")
  console.log("animation style actions ok")
} finally {
  await browser.close()
  await server.close()
}
