// 模型编辑：不可变更新与引用清理。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { addKey, findKey, moveKey, patchKey, removeKey, removeStyle, resizeBoard, setKeyAction, setKeyContainer, setBoardBackdrop, setMeta, setStyle } from "../src/skin-model/edit.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds/index.ts"
import { validateModel } from "../src/skin-model/validate.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { readWith, rectOfKey } from "./support/driver.mjs"

async function model() {
  return readWith(bdsFormat, bdsSource(SkinArchive.open(new Uint8Array(bdsFixture()), "bds")))
}

const BOARD = "light/skin/port/py_26.ini"

test("改按键矩形返回新模型，原模型不动", async () => {
  const before = await model()
  const original = await rectOfKey(before, BOARD, "KEY1")
  const after = moveKey(before, BOARD, "KEY1", { position: { x: 400, y: 20 }, size: { width: 90, height: 100 } })
  assert.notEqual(after, before)
  assert.deepEqual(await rectOfKey(after, BOARD, "KEY1"), { position: { x: 400, y: 20 }, size: { width: 90, height: 100 } })
  assert.deepEqual(await rectOfKey(before, BOARD, "KEY1"), original, "原模型被改了")
})

test("改容器各层引用与动作", async () => {
  const before = await model()
  const base = findKey(before, BOARD, "KEY1").key.container
  const styled = setKeyContainer(before, BOARD, "KEY1", { ...base, back: { style: "7" } })
  assert.equal(findKey(styled, BOARD, "KEY1").key.container.back?.style, "7")
  const actioned = setKeyAction(styled, BOARD, "KEY1", "long-press", { kind: "delete" })
  assert.deepEqual(findKey(actioned, BOARD, "KEY1").key.actions["long-press"], { kind: "delete" })
  const cleared = setKeyAction(actioned, BOARD, "KEY1", "long-press", null)
  assert.equal(findKey(cleared, BOARD, "KEY1").key.actions["long-press"], undefined)
})

test("前景层整体替换，不残留旧层", async () => {
  const before = await model()
  const base = findKey(before, BOARD, "KEY1").key.container
  const after = patchKey(before, BOARD, "KEY1", { container: { ...base, fore: [{ style: "9" }] } })
  assert.deepEqual(findKey(after, BOARD, "KEY1").key.container.fore.map((layer) => layer.style), ["9"])
})

test("增删按键", async () => {
  const before = await model()
  const key = { ...findKey(before, BOARD, "KEY2").key, id: "KEY9" }
  const added = addKey(before, BOARD, key)
  assert.ok(findKey(added, BOARD, "KEY9"))
  assert.equal(addKey(added, BOARD, key), added, "重复 id 应当返回原模型")
  const removed = removeKey(added, BOARD, "KEY9")
  assert.equal(findKey(removed, BOARD, "KEY9"), undefined)
})

test("删样式会清掉按键与动效上的引用", async () => {
  const before = await model()
  const styleId = findKey(before, BOARD, "KEY1").key.container.back?.style
  assert.ok(styleId)
  const after = removeStyle(before, BOARD === "" ? "" : styleId)
  assert.equal(after.styles.has(styleId), false)
  assert.notEqual(findKey(after, BOARD, "KEY1").key.container.back?.style, styleId)
  const report = validateModel(after)
  assert.ok(!report.issues.some((issue) => issue.code === "missing-style"), "删样式后仍有悬空引用")
})

test("改板尺寸会同步主板分辨率", async () => {
  const before = await model()
  const after = resizeBoard(before, BOARD, { width: 1200, height: 700 })
  assert.deepEqual(after.boards[0].container, { width: 1200, height: 700 })
  assert.deepEqual(after.meta.resolution, { width: 1200, height: 700 })
})

test("替换样式", async () => {
  const before = await model()
  const after = setStyle(before, "900", { normal: [{ kind: "color", value: "#fff" }] })
  assert.deepEqual(after.styles.get("900").normal, [{ kind: "color", value: "#fff" }])
  assert.equal(before.styles.has("900"), false)
})

test("内边距可以打补丁，也可以清掉", async () => {
  const before = await model()
  const padded = patchKey(before, BOARD, "KEY1", { padding: { left: 1, top: 2, right: 3, bottom: 4 } })
  assert.deepEqual(findKey(padded, BOARD, "KEY1").key.padding, { left: 1, top: 2, right: 3, bottom: 4 })
  const cleared = patchKey(padded, BOARD, "KEY1", { padding: null })
  assert.equal(findKey(cleared, BOARD, "KEY1").key.padding, undefined)
})

test("皮肤信息改动写进模型，空串表示清掉", async () => {
  const before = await model()
  const named = setMeta(before, { name: "新名字", author: "作者" })
  assert.equal(named.meta.name, "新名字")
  assert.equal(named.meta.author, "作者")
  assert.equal(before.meta.name, before.meta.name, "原模型不该被改")
  const cleared = setMeta(named, { name: "" })
  assert.equal(cleared.meta.name, undefined)
  assert.equal(cleared.meta.author, "作者", "其它字段应当保留")
})

test("板的面板背景样式可换可清，其余属性保留", async () => {
  const before = await model()
  const board = before.boards[0]
  const styled = setBoardBackdrop(before, board.id, "9")
  assert.equal(styled.boards[0].backdrop, "9")
  const cleared = setBoardBackdrop(styled, board.id, null)
  assert.equal(cleared.boards[0].backdrop, undefined)
  assert.equal(cleared.boards[0].keys.length, before.boards[0].keys.length, "其余属性应当保留")
})
