import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem("onboarding-tour-v1", "done"))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('.template-card[data-template="official-android-bds"]').click()
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
  await page.locator(".preview-toolbar-end").screenshot({ path: "/tmp/keyskin-preview-toggles.png" })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.locator(".preview-toolbar .preview-choice:visible").count(), 0, "phone keeps secondary controls in menu")
  await page.locator("#mobile-preview-more > summary").click()
  assert.equal(await page.locator("#mobile-preview-orientation").isVisible(), true)
  assert.equal(await page.locator("#mobile-preview-theme").isVisible(), true)
  assert.deepEqual(errors, [])
  console.log("Preview toggles: single buttons, state icons, animation, keyboard, rapid switching, reduced motion and mobile menu passed")
} finally {
  await browser.close()
  await server.close()
}
