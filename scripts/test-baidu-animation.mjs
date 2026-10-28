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
  await bdaConfig.locator(".ui-listbox").waitFor()
  // 原始文件视图列出全部效果；选中一个后是 预览 → 参数 → 引用。
  const listed = await bdaConfig.locator("[data-animation-id]").evaluateAll((nodes) => nodes.map((node) => node.dataset.animationId))
  for (const id of ["group:combo", "alpha:press", "shift:slide", "emitter:spark", "image:seq", "lottie:lottie", "video:video"]) {
    assert.ok(listed.includes(id), `BDA 列表缺少 ${id}：${listed.join("、")}`)
  }
  await bdaConfig.locator('[data-animation-id="alpha:press"]').click()
  await bda.waitForFunction(() => document.querySelector('#bda-config-fields [data-animation-id="alpha:press"]')?.getAttribute("aria-selected") === "true")
  const groupLabels = await bdaConfig.locator(":scope > section").evaluateAll((sections) => sections.map((section) => section.dataset.inspectorGroupLabel))
  assert.deepEqual(groupLabels, ["动画", "预览", "变化", "时间与循环", "引用"])
  const uses = await bdaConfig.locator('[data-inspector-group-label="引用"]').innerText()
  for (const event of ["按键按下", "元素显示", "元素隐藏", "经组合 combo"]) {
    assert.ok(uses.includes(event), `引用缺少「${event}」：${uses}`)
  }
  assert.equal(await bdaConfig.locator(".ui-animation-player").count(), 1, "选中的效果有播放器")
  await bdaConfig.locator('[data-animation-id="shift:slide"]').click()
  await bda.waitForFunction(() => document.querySelector('#bda-config-fields [data-inspector-group-label="引用"]')?.textContent.includes("按键抬起"))
  await bdaConfig.locator('[data-animation-id="alpha:press"]').click()
  await bda.waitForFunction(() => document.querySelector('#bda-config-fields [data-animation-id="alpha:press"]')?.getAttribute("aria-selected") === "true")
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
  await legacyFields.locator(".ui-listbox").waitFor()
  const legacyItems = await legacyFields.locator("[data-animation-id]").evaluateAll((nodes) => nodes.map((node) => node.dataset.animationId))
  assert.ok(legacyItems.length >= 7 && legacyItems[0] === "ANIM1", `旧版检查器没有列出动效：${legacyItems.join("、")}`)
  const legacyGroups = await legacyFields.locator(":scope > section").evaluateAll((sections) => sections.map((section) => section.dataset.inspectorGroupLabel))
  assert.deepEqual(legacyGroups, ["动画", "预览", "变化", "时间与循环", "引用"])
  assert.ok(await legacyFields.locator(".ui-animation-player canvas").count() > 0, "旧版检查器缺少播放预览")
  assert.ok(await legacyFields.locator(".ui-animation-lane").count() > 0, "旧版检查器缺少时间轴")
  assert.match(await legacyFields.locator('[data-inspector-group-label="引用"]').innerText(), /按下 · PRESS_ANIM/)

  const duration = legacyFields.locator('[data-inspector-group-label="时间与循环"] input[aria-label="时长"]')
  await duration.fill("999")
  await duration.press("Tab")
  await legacy.waitForFunction(async () => {
    const { appState } = await import("/src/app/state.ts")
    return appState.selectedDocument.get("ANIM1", "DURATION") === "999"
  })
  await undoRedo(legacy, "undo")
  await legacy.waitForFunction(async () => {
    const { appState } = await import("/src/app/state.ts")
    return appState.selectedDocument.get("ANIM1", "DURATION") !== "999"
  })
  assert.equal(await legacyFields.locator('[data-animation-id="ANIM1"]').getAttribute("aria-selected"), "true", "撤销后仍选中同一个动效")

  // 组合动效：子动效列表移除一项，BUILD_LIST 与 BUILD_NUM 一起写回。
  const combination = legacyFields.locator("[data-animation-id]").filter({ hasText: "组合" }).first()
  const comboSection = await combination.getAttribute("data-animation-id")
  await combination.click()
  await legacyFields.locator(".animation-combo-item").first().waitFor()
  const before = await legacy.evaluate(async (section) => (await import("/src/app/state.ts")).appState.selectedDocument.get(section, "BUILD_LIST"), comboSection)
  await legacyFields.locator(".animation-combo-item").last().getByRole("button", { name: /^移除/ }).click()
  await legacy.waitForFunction(async ({ section, before }) => {
    const { appState } = await import("/src/app/state.ts")
    const list = appState.selectedDocument.get(section, "BUILD_LIST")
    return list !== before && appState.selectedDocument.get(section, "BUILD_NUM") === String(list.split(",").filter(Boolean).length)
  }, { section: comboSection, before })

  // 新建与复制：追加 [ANIM n+1]，同步 ANIM_NUM，并直接选中新的动效。
  const count = legacyItems.length + 1
  await legacyFields.getByLabel("新建动画", { exact: true }).selectOption("basic")
  await legacy.waitForFunction(async (count) => {
    const { appState } = await import("/src/app/state.ts")
    const document = appState.selectedDocument
    return document.get("GLOBAL", "ANIM_NUM") === String(count) && document.sections().includes(`ANIM${count}`)
  }, count)
  assert.equal(await legacyFields.locator(`[data-animation-id="ANIM${count}"]`).getAttribute("aria-selected"), "true")
  await legacyFields.getByRole("button", { name: `复制动画 ${count}`, exact: true }).click()
  await legacy.waitForFunction(async (count) => (await import("/src/app/state.ts")).appState.selectedDocument.get("GLOBAL", "ANIM_NUM") === String(count + 1), count)

  assert.deepEqual(errors, [], `页面报错：${errors.join("；")}`)
  console.log("baidu animation: BDA/BDS 检查器按列表选择编辑，动效在编辑/导出/源码回写链路中完整保留")
} finally {
  await browser.close()
  await server.close()
}
