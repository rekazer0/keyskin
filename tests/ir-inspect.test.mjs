// 属性视图：字段来自模型，而不是各格式自己的表。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds.ts"
import { actionText, boardProperties, keyActions, keyGeometry, keyProperties, keyStates, motionProperties, panelProperties, styleProperties, summarizeModel } from "../src/skin-model/inspect.ts"
import { setKeyAction } from "../src/skin-model/edit.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { readWith, warm } from "./support/driver.mjs"

const BOARD = "light/skin/port/py_26.ini"

async function model() {
  const built = await readWith(bdsFormat, bdsSource(SkinArchive.open(new Uint8Array(bdsFixture()), "bds")))
  // 检查器读的是布局派生缓存；界面在模型建好时预热，测试走同一条路。
  await warm(built)
  return built
}

test("按键几何来自模型", async () => {
  const views = keyGeometry(await model(), BOARD, "KEY1")
  const byKey = new Map(views.map((view) => [view.key, view.value]))
  assert.equal(byKey.get("x"), 10)
  assert.equal(byKey.get("width"), 100)
  assert.equal(byKey.get("height"), 120)
  assert.ok(views.every((view) => view.readOnly === false), "文档几何应当可改")
})

test("动作视图给出可读文本，未配置的格子仍然出现", async () => {
  const before = await model()
  const views = keyActions(before, BOARD, "KEY1")
  const byKey = new Map(views.map((view) => [view.key, view]))
  assert.equal(byKey.get("action.press").value, "q")
  assert.equal(byKey.get("action.swipe-up").value, "空格")
  assert.equal(byKey.get("action.swipe-left").value, undefined, "未配置的动作不应有值")
  assert.equal(views.length, 6)
})

test("改动作后视图跟着变", async () => {
  const before = await model()
  const after = setKeyAction(before, BOARD, "KEY1", "long-press", { kind: "delete" })
  const views = keyActions(after, BOARD, "KEY1")
  assert.equal(views.find((view) => view.key === "action.long-press").value, "删除")
})

test("动作文本覆盖所有动作类型", () => {
  assert.equal(actionText({ kind: "text", value: " " }), "空格")
  assert.equal(actionText({ kind: "delete" }), "删除")
  assert.equal(actionText({ kind: "delete", forward: true }), "前向删除")
  assert.equal(actionText({ kind: "enter" }), "回车")
  assert.equal(actionText({ kind: "candidate-page", direction: "up" }), "候选上页")
  assert.equal(actionText({ kind: "case", mode: "lock" }), "大写锁定")
  assert.equal(actionText({ kind: "switch", board: "symbol" }), "符号")
  assert.equal(actionText({ kind: "system", code: "F31" }), "F31")
  assert.equal(actionText(undefined), undefined)
})

test("按键属性包含几何、动作与样式", async () => {
  const views = keyProperties(await model(), BOARD, "KEY1")
  const keys = new Set(views.map((view) => view.key))
  assert.ok(keys.has("x"))
  assert.ok(keys.has("action.press"))
  assert.ok(keys.has("style.back"))
  assert.ok(keys.has("style.fore.0"))
})

test("状态覆盖出现在按键属性里", async () => {
  const views = keyStates(await model(), BOARD, "KEY1")
  assert.ok(views.length > 0, "夹具里的提示键没有读成状态覆盖")
  assert.match(String(views[0].label), /状态 S\d+/)
})

test("板与面板属性", async () => {
  const before = await model()
  const board = new Map(boardProperties(before, BOARD).map((view) => [view.key, view]))
  assert.equal(board.get("size.width").value, 1080)
  assert.equal(board.get("kind").value, "main")
  assert.equal(board.get("geometry").value, "document")
  const panel = new Map(panelProperties(before, BOARD).map((view) => [view.key, view]))
  assert.equal(panel.get("panel.backdrop").value, "1")
  assert.ok(panel.has("panel.candidate"))
})

test("样式与动效属性", async () => {
  const before = await model()
  const styleId = [...before.styles.keys()][0]
  const style = styleProperties(before, styleId)
  assert.equal(style[0].value, styleId)
  assert.ok(style.length > 1)
  const motionId = [...before.motions.keys()][0]
  const motion = new Map(motionProperties(before, motionId).map((view) => [view.key, view]))
  assert.ok(motion.get("motion.kind").value)
})

test("模型摘要", async () => {
  const summary = summarizeModel(await model())
  assert.equal(summary.boards, 3)
  assert.ok(summary.keys >= 4)
  assert.ok(summary.styles > 0)
  assert.deepEqual(summary.main, { width: 1080, height: 600 })
})
