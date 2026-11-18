// 模型差异比较：增删改的清单与摘要。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds.ts"
import { diffModels, describeDiff, diffSize, isEmptyDiff } from "../src/skin-model/compare.ts"
import { moveKey, removeKey, addKey, setKeyAction, removeStyle } from "../src/skin-model/edit.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"

const BOARD = "light/skin/port/py_26.ini"

async function model() {
  return bdsFormat.read(bdsSource(SkinArchive.open(new Uint8Array(bdsFixture()), "bds")))
}

test("同一份模型没有差异", async () => {
  const before = await model()
  const diff = diffModels(before, before)
  assert.equal(isEmptyDiff(diff), true)
  assert.equal(describeDiff(diff), "没有改动")
  assert.equal(diffSize(diff), 0)
})

test("移动按键记成按键改动，板不动", async () => {
  const before = await model()
  const after = moveKey(before, BOARD, "KEY1", { position: { x: 1, y: 2 }, size: { width: 3, height: 4 } })
  const diff = diffModels(before, after)
  assert.deepEqual(diff.keys.changed, [`${BOARD}/KEY1`])
  assert.equal(diff.boards.changed.length, 0, "只有按键变了，板本身不该算改动")
  assert.equal(isEmptyDiff(diff), false)
})

test("删按键记成删除", async () => {
  const before = await model()
  const after = removeKey(before, BOARD, "KEY1")
  const diff = diffModels(before, after)
  assert.deepEqual(diff.keys.removed, [`${BOARD}/KEY1`])
  assert.equal(diff.keys.added.length, 0)
})

test("新增按键记成新增", async () => {
  const before = await model()
  const after = addKey(before, BOARD, { ...before.boards[0].keys[0], id: "KEY9" })
  const diff = diffModels(before, after)
  assert.deepEqual(diff.keys.added, [`${BOARD}/KEY9`])
})

test("改动作算按键改动", async () => {
  const before = await model()
  const after = setKeyAction(before, BOARD, "KEY1", "press", { kind: "enter" })
  const diff = diffModels(before, after)
  assert.deepEqual(diff.keys.changed, [`${BOARD}/KEY1`])
})

test("删样式记成样式删除，同时按键改动", async () => {
  const before = await model()
  const styleId = before.boards[0].keys[0].style.back
  const after = removeStyle(before, styleId)
  const diff = diffModels(before, after)
  assert.deepEqual(diff.styles.removed, [styleId])
  assert.ok(diff.keys.changed.length > 0, "引用被清掉的按键应算改动")
})

test("摘要与数量能读出改了什么", async () => {
  const before = await model()
  const after = removeKey(before, BOARD, "KEY1")
  const diff = diffModels(before, after)
  assert.match(describeDiff(diff), /按键 删除 1/)
  assert.equal(diffSize(diff), 1)
})

test("元信息变化单独标记", async () => {
  const before = await model()
  const after = { ...before, meta: { ...before.meta, name: "改过的名字" } }
  const diff = diffModels(before, after)
  assert.equal(diff.meta, true)
  assert.match(describeDiff(diff), /皮肤信息/)
  assert.equal(isEmptyDiff(diff), false)
})
