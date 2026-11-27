import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { SkinArchive } from "../src/skin.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { dismissStartupDisclaimer } from "./helpers/open-editor-template.mjs"

const skin = SkinArchive.open(bdsFixture())
const light = "light/skin/res/"
const dark = "dark/skin/res/"
for (const path of skin.names().filter(path => path.startsWith("light/skin/") && !path.endsWith("/"))) {
  skin.setBytes(path.replace(/^light\//, "dark/"), skin.getBytes(path))
}
const png = skin.getBytes(`${light}btn.png`)
for (const file of ["badge.png", "brand.png", "1.0/brand.png", "1.0/deeper/icon.png", "其他 [图标]/menu.png"]) {
  skin.setBytes(`${light}logo/${file}`, png)
}
skin.setBytes(`${dark}logo/dark-brand.png`, png)
const bytes = Buffer.from(skin.toBytes("bds"))

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 320, height: 844 } : { width: 812, height: 900 }, hasTouch: mobile })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await dismissStartupDisclaimer(page)
    await page.locator("#browser-open").setInputFiles({ name: "资源.bds", mimeType: "application/octet-stream", buffer: bytes })
    const entry = mobile ? page.locator('#mobile-navigation [data-mobile-page="resources"]') : page.locator('[data-workspace-page="resources"]')
    if (mobile) await entry.tap()
    else await entry.click()
    const paths = () => page.locator("#resource-gallery .ui-image-card").evaluateAll(cards => cards.map(card => card.dataset.path))
    const category = page.locator("#mobile-resource-category")
    const folders = page.getByRole("group", { name: "图片子分类" })
    if (mobile) {
      await category.selectOption("image:logo/其他 [图标]")
      assert.deepEqual(await paths(), [`${light}logo/其他 [图标]/menu.png`])
      await category.selectOption("catalog:font")
      assert.equal(await category.inputValue(), "catalog:font")
      await category.selectOption("image:logo")
    } else {
      const logo = folders.getByRole("button", { name: "logo 2", exact: true })
      await logo.click()
      assert.deepEqual(await paths(), [`${light}logo/badge.png`, `${light}logo/brand.png`])
      await page.locator("#resource-search").fill("brand")
      assert.deepEqual(await paths(), [`${light}logo/brand.png`], "搜索只在选中的图片子分类内进行")
      await logo.press("ArrowDown")
      assert.equal(await folders.getByRole("button", { name: "1.0 2", exact: true }).getAttribute("aria-pressed"), "true")
      assert.deepEqual(await paths(), [`${light}logo/1.0/brand.png`, `${light}logo/1.0/deeper/icon.png`])
      await logo.click()
      await page.screenshot({ path: ".ui-current/resource-image-folders.png", animations: "disabled" })
    }
    assert.deepEqual(await paths(), [`${light}logo/badge.png`, `${light}logo/brand.png`])
    await page.locator('[data-resource-theme="dark"]').click()
    await page.locator(`#resource-gallery [data-path="${dark}logo/dark-brand.png"]`).waitFor()
    assert.deepEqual(await paths(), [`${dark}logo/dark-brand.png`], "切换明暗外观保留可用的图片子分类")
    if (mobile) await category.selectOption("image")
    else await page.locator('[data-resource-page="image"]').click()
    assert.ok((await paths()).includes(`${dark}btn.png`), "图片父分类仍展示全部图片")
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
    console.log(`${mobile ? "mobile" : "desktop"}: logo image folders passed`)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
