import assert from "node:assert/strict"
import { createServer } from "vite"
import { chromium } from "playwright"
import { unzipSync } from "fflate"
import { SkinArchive } from "../src/skin.ts"
import { convertBdaArchive } from "../src/bda-convert.ts"
import { bdaAnimatedSkinBytes, bdsBaseArchive } from "../tests/helpers/bda-animation-fixture.mjs"

// BDA → 旧版：先用转换器生成一个带 anim.ini 的 BDS，作为旧版检查器的输入。
const converted = convertBdaArchive(SkinArchive.open(bdaAnimatedSkinBytes(), "bda"), bdsBaseArchive())
const legacySkin = await converted.archive.platformBytesAsync("bds")

const server = await createServer({
  root: new URL("..", import.meta.url).pathname,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 41841, strictPort: false },
})
await server.listen()
const url = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch()
const errors = []
const openSkin = async (page, name, bytes) => {
  await page.goto(url)
  await page.locator("#browser-open").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) })
  await page.waitForFunction(() => !document.querySelector("#open")?.disabled)
  const close = page.locator("#file-operation-dialog[open] #file-operation-close")
  if (await close.isVisible()) await close.click()
  await page.getByRole("button", { name: "编辑模式", exact: true }).click()
}
const decodeAnimation = (page, path, effect) => page.evaluate(async ({ path, effect }) => {
  const { appState } = await import("/src/app/state.ts")
  const { decodeBdaAnimation } = await import("/src/bda-decode.ts")
  return decodeBdaAnimation(appState.archive.getBytes(path)).effects.get(effect).duration
}, { path, effect })
const undoRedo = (page, action) => page.evaluate(async (action) => {
  const history = await import("/src/app/edit-history.ts")
  history[action]()
}, action)

try {
  // —— 第一部分：BDA animationConfig 的可视化检查器 / 编辑 / 导出 ——
  const bda = await browser.newPage({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
  bda.on("pageerror", (error) => errors.push(`BDA: ${error.message}`))
  bda.on("dialog", (dialog) => dialog.accept())
  await openSkin(bda, "动效测试.bda", bdaAnimatedSkinBytes())
  await bda.evaluate(async () => {
    const { selectFile } = await import("/src/app/navigation.ts")
    selectFile("light/skin/port/animationConfig")
  })

  const bdaConfig = bda.locator("#bda-config-fields")
  await bdaConfig.locator(".bda-animation-section").first().waitFor()
  const groupLabels = await bdaConfig.locator(".bda-animation-section").evaluateAll((sections) =>
    sections.map((section) => section.dataset.inspectorGroupLabel))
  for (const label of ["概览", "目标绑定", "透明度", "位移", "粒子", "图片序列"]) {
    assert.ok(groupLabels.includes(label), `BDA 检查器缺少「${label}」分组：${groupLabels.join("、")}`)
  }
  const targetsText = await bdaConfig.locator('[data-inspector-group-label="目标绑定"]').innerText()
  for (const event of ["按键按下", "按键抬起", "元素显示", "元素隐藏"]) {
    assert.ok(targetsText.includes(event), `目标绑定缺少事件「${event}」`)
  }
  // 时间轴、预览、字段都在。
  assert.ok(await bdaConfig.locator(".bda-animation-player").count() > 0, "图片序列缺少播放器")
  assert.ok(await bdaConfig.locator('input[aria-label="时长（毫秒）"]').count() > 0)
  await bdaConfig.locator('input[aria-label="时长（毫秒）"]').first().fill("700")
  await bdaConfig.locator('input[aria-label="时长（毫秒）"]').first().press("Tab")
  await bda.waitForFunction(async () => {
    const { appState } = await import("/src/app/state.ts")
    const { decodeBdaAnimation } = await import("/src/bda-decode.ts")
    return decodeBdaAnimation(appState.archive.getBytes("light/skin/port/animationConfig"))
      .effects.get("alpha:press").duration === 700
  })
  assert.equal(await decodeAnimation(bda, "light/skin/port/animationConfig", "alpha:press"), 700)
  // 一步撤销只回退这次编辑。
  const undoCount = await bda.evaluate(async () => {
    const { appState } = await import("/src/app/state.ts")
    return appState.undoStack.length
  })
  assert.equal(undoCount, 1, `预期一步撤销，实际 ${undoCount} 步`)
  await undoRedo(bda, "undo")
  assert.equal(await decodeAnimation(bda, "light/skin/port/animationConfig", "alpha:press"), 240)
  await undoRedo(bda, "redo")
  assert.equal(await decodeAnimation(bda, "light/skin/port/animationConfig", "alpha:press"), 700)

  // 导出 Android 旧版皮肤：动效要变成 anim.ini + 样式引用，而不是丢掉。
  const bdsBytes = await bda.evaluate(async () => {
    const { exportArchive } = await import("/src/app/archive-io.ts")
    const result = await exportArchive("bds")
    return Array.from(result.bytes)
  })
  const bdsFiles = unzipSync(new Uint8Array(bdsBytes))
  assert.ok("light/port/res/anim.ini" in bdsFiles, "导出的 BDS 缺少 anim.ini")
  const animIni = new TextDecoder().decode(bdsFiles["light/port/res/anim.ini"])
  assert.match(animIni, /\[ANIM\d+\]/, "anim.ini 没有动画定义")
  assert.match(animIni, /DURATION=700/, "检查器改的动画时长没有写进导出动效")
  const css = new TextDecoder().decode(bdsFiles["light/res/default.css"])
  assert.match(css, /(PRESS_ANIM|SHOW_ANIM|HIDE_ANIM)=\d+/, "default.css 没有动效引用")
  const particle = animIni.match(/PARTICLE_IMAGE=(\d+)/)?.[1]
  assert.ok(particle && css.includes(`[STYLE${particle}]`), "粒子图片没有对应的图片样式")

  // 导出 BDA（Android 平台转换）时 animationConfig 的编辑要保留。
  const bdaBytes = await bda.evaluate(async () => {
    const { exportArchive } = await import("/src/app/archive-io.ts")
    const result = await exportArchive("bda", "android")
    return Array.from(result.bytes)
  })
  const bdaFiles = unzipSync(new Uint8Array(bdaBytes))
  const animationPath = Object.keys(bdaFiles).find((path) => /animationConfig$/.test(path))
  assert.ok(animationPath, "导出的 BDA 缺少 animationConfig")
  const redownloaded = SkinArchive.open(new Uint8Array(bdaBytes), "bda")
  const preserved = await bda.evaluate(async (json) => {
    const { decodeBdaAnimation } = await import("/src/bda-decode.ts")
    return decodeBdaAnimation(new Uint8Array(json)).effects.get("alpha:press").duration
  }, Array.from(redownloaded.getBytes("light/skin/port/animationConfig")))
  assert.equal(preserved, 700, "BDA 导出后动效参数丢失")

  // 源码面板 JSON 回写：改效果参数后仍能导出动效（不丢失其它效果）。
  const sourceText = await bda.evaluate(async () => {
    const { appState } = await import("/src/app/state.ts")
    const { decodedBdaSource } = await import("/src/bda-source.ts")
    return decodedBdaSource("light/skin/port/animationConfig", appState.archive.getBytes("light/skin/port/animationConfig"))
  })
  const desired = JSON.parse(sourceText)
  desired.effects["rotate:spin"].duration = 420
  const sourceBytes = await bda.evaluate(async ({ text }) => {
    const { appState } = await import("/src/app/state.ts")
    const { applyDecodedBdaSource } = await import("/src/bda-source.ts")
    return Array.from(applyDecodedBdaSource("light/skin/port/animationConfig", appState.archive.getBytes("light/skin/port/animationConfig"), text))
  }, { text: JSON.stringify(desired) })
  const sourceAnimation = await bda.evaluate(async (json) => {
    const { decodeBdaAnimation } = await import("/src/bda-decode.ts")
    const animation = decodeBdaAnimation(new Uint8Array(json))
    return { duration: animation.effects.get("rotate:spin").duration, count: animation.effects.size }
  }, sourceBytes)
  assert.equal(sourceAnimation.duration, 420)
  assert.equal(sourceAnimation.count, 11, "源码回写后其它动效丢失")

  // 修改源码后重新导出的旧版皮肤仍包含动画（覆盖“导入-编辑-导出”整条链路）。
  const roundTrip = await bda.evaluate(async (text) => {
    const { appState } = await import("/src/app/state.ts")
    const { applyDecodedBdaSource } = await import("/src/bda-source.ts")
    const path = "light/skin/port/animationConfig"
    appState.archive.setBytes(path, applyDecodedBdaSource(path, appState.archive.getBytes(path), text))
    const { exportArchive } = await import("/src/app/archive-io.ts")
    const result = await exportArchive("bds")
    return Array.from(result.bytes)
  }, JSON.stringify(desired))
  const roundTripFiles = unzipSync(new Uint8Array(roundTrip))
  const roundTripIni = new TextDecoder().decode(roundTripFiles["light/port/res/anim.ini"])
  assert.match(roundTripIni, /TYPE=1[\s\S]*?DURATION=420/, "旋转动效的源码修改没有进入导出的 anim.ini")

  // —— 第二部分：旧版 BDS 的 anim.ini 检查器 ——
  const legacy = await browser.newPage({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
  legacy.on("pageerror", (error) => errors.push(`BDS: ${error.message}`))
  await openSkin(legacy, "动效旧版.bds", legacySkin)
  await legacy.evaluate(async () => {
    const { selectFile } = await import("/src/app/navigation.ts")
    selectFile("light/skin/port/res/anim.ini")
  })
  const legacyFields = legacy.locator("#document-fields")
  await legacyFields.locator(".ui-section").first().waitFor()
  const legacyGroups = await legacyFields.locator(".ui-section, .document-property-section").evaluateAll((sections) =>
    sections.map((section) => section.dataset.inspectorGroupLabel).filter(Boolean))
  assert.ok(legacyGroups.some((label) => /动画概览/.test(label)), `旧版检查器缺少动画概览：${legacyGroups.join("、")}`)
  assert.ok(legacyGroups.some((label) => /动效/.test(label)), "旧版检查器没有列出动效")
  assert.ok(await legacyFields.locator('[aria-label$="时间轴"]').count() > 0, "旧版检查器缺少时间轴")
  assert.ok(await legacyFields.locator("canvas").count() > 0, "旧版检查器缺少内联预览")

  const duration = legacyFields.locator('[aria-label="ANIM1 时间轴"]').locator("xpath=ancestor::*[contains(@class,'ui-section')]").locator('input[aria-label="时长"]')
  await duration.first().fill("999")
  await duration.first().press("Tab")
  await legacy.waitForFunction(async () => {
    const { appState } = await import("/src/app/state.ts")
    return appState.selectedDocument.get("ANIM1", "DURATION") === "999"
  })
  await undoRedo(legacy, "undo")
  await legacy.waitForFunction(async () => {
    const { appState } = await import("/src/app/state.ts")
    return appState.selectedDocument.get("ANIM1", "DURATION") !== "999"
  })

  assert.deepEqual(errors, [], `页面报错：${errors.join("；")}`)
  console.log("baidu animation: BDA/BDS 检查器可编辑，动效在编辑/导出/源码回写链路中完整保留")
} finally {
  await browser.close()
  await server.close()
}
