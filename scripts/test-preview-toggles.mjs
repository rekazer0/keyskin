import { openEditorTemplate } from "../tests/helpers/open-editor-template.mjs"
import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true })
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem("onboarding-tour-v1", "done"))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await openEditorTemplate(page, 'official-android-bds')
  await page.waitForSelector(".canvas-wrap:not(.empty)")
  await page.waitForFunction(() => !document.querySelector("#file-operation-dialog").open || !document.querySelector("#file-operation-close").disabled)
  const close = page.locator("#file-operation-dialog[open] #file-operation-close")
  if (await close.isVisible()) await close.click()
  assert.equal(await page.locator(".preview-toolbar .preview-choice:visible").count(), 2, "one button per setting")

  for (const [choice, initial, next, initialIcon, nextIcon, property] of [
    ["orientation", "port", "land", "rectangle-vertical", "rectangle-horizontal", "transform"],
    ["theme", "light", "dark", "sun", "moon", "opacity"],
  ]) {
    const button = page.locator(`.preview-choice[data-mobile-choice="${choice}"]`)
    const icon = button.locator("[data-mobile-current-icon]")
    assert.equal(await page.locator(`#${choice}`).inputValue(), initial)
    await button.click()
    assert.equal(await page.locator(`#${choice}`).inputValue(), next)
    assert.equal(await icon.getAttribute("data-icon"), nextIcon)
    const motion = await icon.evaluateHandle(node => node.getAnimations()[0])
    assert.equal(await motion.evaluate((animation, property) => animation?.effect.getKeyframes().some(frame => property in frame), property), true, "state change animates")
    await page.evaluate(async () => (await import("/src/app/mobile-layout.ts")).syncSegmentedControls())
    assert.equal(await icon.evaluate((node, animation) => node.getAnimations().includes(animation), motion), true, "refresh preserves animation")
    await button.focus()
    await page.keyboard.press("Enter")
    assert.equal(await page.locator(`#${choice}`).inputValue(), initial, "keyboard toggles back")
    assert.equal(await icon.getAttribute("data-icon"), initialIcon)
    await button.evaluate(node => { node.click(); node.click() })
    assert.equal(await page.locator(`#${choice}`).inputValue(), initial, "rapid toggles preserve final state")
    await icon.evaluate(async node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))))
    assert.equal(await icon.evaluate(node => getComputedStyle(node).transform), "none", "rotation settles")
    await page.emulateMedia({ reducedMotion: "reduce" })
    await button.click()
    assert.equal(await page.locator(`#${choice}`).inputValue(), next)
    assert.equal(await icon.evaluate(node => node.getAnimations().length), 0, "reduced motion skips animation")
    await button.click()
    await page.emulateMedia({ reducedMotion: "no-preference" })
  }
  const toolbar = page.locator(".preview-toolbar")
  const guides = toolbar.locator("#toggle-guides")
  const guideState = await guides.getAttribute("aria-pressed")
  await guides.focus()
  await page.keyboard.press("Enter")
  assert.notEqual(await guides.getAttribute("aria-pressed"), guideState, "guides still toggle by keyboard")
  await page.keyboard.press("Enter")
  assert.equal(await guides.getAttribute("aria-pressed"), guideState)
  await page.locator("#device").selectOption("iphone-17-pro")
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    const { left, center, right, first } = await toolbar.evaluate(node => {
      const toolbar = node.getBoundingClientRect()
      const device = node.querySelector("#device-control").getBoundingClientRect()
      const start = node.querySelector(".preview-toolbar-start").getBoundingClientRect()
      const end = node.querySelector(".preview-toolbar-end").getBoundingClientRect()
      return {
        left: start.right <= device.left,
        center: device.left + device.width / 2 - (toolbar.left + toolbar.width / 2),
        right: device.right <= end.left,
        first: node.querySelector("#toggle-guides").getBoundingClientRect().left === start.left,
      }
    })
    assert.ok(left && right && first && Math.abs(center) < 1, `toolbar placement at ${width}px: ${JSON.stringify({ left, center, right, first })}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await toolbar.screenshot({ path: "/tmp/keyskin-preview-toggles.png" })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.locator(".preview-toolbar .preview-choice:visible").count(), 0, "phone keeps secondary controls in menu")
  const more = page.locator('#mobile-app-more > summary')
  await more.tap()
  await page.locator('[data-mobile-action="mobile-canvas-options"]').tap()
  const options = page.getByRole('dialog', { name: '画布选项' })
  for (const label of ['方向', '外观']) assert.ok(await options.getByRole('group', { name: label }).isVisible())
  await options.getByRole('button', { name: '关闭' }).tap()
  await options.waitFor({ state: 'detached' })
  const edit = page.locator('.mobile-preview-return')
  if (await edit.isVisible()) await edit.tap()
  const gesture = page.getByRole('menuitemcheckbox', { name: '双指缩放与平移' })
  const touch = await page.context().newCDPSession(page)
  const view = () => page.evaluate(async () => {
    const { appState: s } = await import('/src/app/state.ts')
    return [s.previewZoom, s.previewPanX, s.previewPanY, s.selectedKeySections]
  })
  const pinch = async () => {
    const box = await page.locator('#preview').boundingBox()
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x, y }), 'preview', '机型键盘应在属性面板上方可触达')
    const send = (type, ...xs) => touch.send('Input.dispatchTouchEvent', { type, touchPoints: xs.map((x, id) => ({ x, y, id })) })
    await send('touchStart', x - 12, x + 12)
    await send('touchMove', x - 22, x + 22)
    await send('touchEnd')
  }
  const initial = await view()
  await pinch()
  assert.deepEqual(await view(), initial, '锁定时双指不缩放，也不误选按键')
  await more.tap()
  assert.equal(await gesture.isChecked(), false)
  await gesture.tap()
  assert.equal(await page.locator('#preview-zoom-fit').getAttribute('aria-pressed'), 'false', '与桌面共用锁定状态')
  await pinch()
  const [zoom, , , selection] = await view()
  assert.ok(zoom > initial[0], '解锁后双指可放大')
  assert.deepEqual(selection, initial[3], '缩放不改选区')
  await more.tap()
  assert.equal(await gesture.isChecked(), true)
  await page.getByRole('menuitem', { name: '适配画布' }).tap()
  assert.deepEqual(await view(), [1, 0, 0, initial[3]], '适配恢复居中与默认倍率，保留选区')
  await page.screenshot({ path: "/tmp/keyskin-mobile-canvas-fit.png" })
  assert.deepEqual(errors, [])
  console.log("Preview toggles: single buttons, state icons, animation, keyboard, rapid switching, reduced motion and mobile menu passed")
} finally {
  await browser.close()
  await server.close()
}
