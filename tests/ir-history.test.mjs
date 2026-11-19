// 模型历史栈：撤销、重做与版本跳转。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds/index.ts"
import { ModelHistory } from "../src/skin-model/history.ts"
import { addKey, moveKey, removeKey } from "../src/skin-model/edit.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { readWith, rectOfKey } from "./support/driver.mjs"

const BOARD = "light/skin/port/py_26.ini"

async function model() {
  return readWith(bdsFormat, bdsSource(SkinArchive.open(new Uint8Array(bdsFixture()), "bds")))
}

test("初始状态不能撤销也不能重做", async () => {
  const history = new ModelHistory(await model())
  assert.equal(history.canUndo, false)
  assert.equal(history.canRedo, false)
  assert.equal(history.undo(), undefined)
  assert.equal(history.redo(), undefined)
})

test("记录一版后可以撤销，撤销后可重做", async () => {
  const before = await model()
  const history = new ModelHistory(before)
  const after = moveKey(before, BOARD, "KEY1", { position: { x: 5, y: 5 }, size: { width: 50, height: 50 } })
  assert.equal(await history.push(after), true)
  assert.equal(history.current, after)
  assert.equal(history.canUndo, true)

  const undone = history.undo()
  assert.equal(undone, before)
  assert.equal(history.canRedo, true)

  const redone = history.redo()
  assert.equal(redone, after)
  assert.equal(history.canRedo, false)
})

test("没有实际改动时不占历史", async () => {
  const before = await model()
  const history = new ModelHistory(before)
  assert.equal(await history.push(before), false, "同一个模型不该入栈")
  // 同一张布局树写回同一个矩形，模型引用都会换，但内容等价。
  const identical = moveKey(before, BOARD, "KEY1", await rectOfKey(before, BOARD, "KEY1"))
  assert.equal(await history.push(identical), false, "改成一样的值不该入栈")
  assert.equal(history.canUndo, false)
})

test("历史记录带改动摘要", async () => {
  const before = await model()
  const history = new ModelHistory(before)
  await history.push(removeKey(before, BOARD, "KEY1"))
  assert.match(history.list[0].label, /按键 删除 1/)
  assert.equal(history.list[0].size, 1)
  assert.equal(history.list[0].active, true)
  assert.equal(history.list.length, 2)
})

test("在中间位置编辑会丢掉重做分支", async () => {
  const base = await model()
  const history = new ModelHistory(base)
  const first = moveKey(base, BOARD, "KEY1", { position: { x: 1, y: 1 }, size: { width: 10, height: 10 } })
  const second = moveKey(first, BOARD, "KEY1", { position: { x: 2, y: 2 }, size: { width: 10, height: 10 } })
  await history.push(first)
  await history.push(second)
  history.undo()
  assert.equal(history.canRedo, true)

  const branch = addKey(first, BOARD, { ...first.boards[0].keys[0], id: "KEY9" })
  await history.push(branch)
  assert.equal(history.canRedo, false, "新分支应丢掉原来的重做记录")
  assert.equal(history.list.length, 3)
})

test("按列表位置跳转版本", async () => {
  const base = await model()
  const history = new ModelHistory(base)
  const first = moveKey(base, BOARD, "KEY1", { position: { x: 1, y: 1 }, size: { width: 10, height: 10 } })
  const second = moveKey(first, BOARD, "KEY1", { position: { x: 2, y: 2 }, size: { width: 10, height: 10 } })
  await history.push(first)
  await history.push(second)

  assert.equal(history.jump(1), first)
  assert.equal(history.jump(2), base)
  assert.equal(history.jump(0), second)
  assert.equal(history.jump(99), second, "越界不动")
})

test("超过上限丢弃最早的版本", async () => {
  const base = await model()
  const history = new ModelHistory(base, { limit: 3 })
  let current = base
  for (let index = 0; index < 5; index += 1) {
    current = moveKey(current, BOARD, "KEY1", { position: { x: index, y: 0 }, size: { width: 10, height: 10 } })
    await history.push(current)
  }
  assert.equal(history.list.length, 3)
  assert.equal(history.current, current)
})

test("换文档后历史清空", async () => {
  const base = await model()
  const history = new ModelHistory(base)
  await history.push(removeKey(base, BOARD, "KEY2"))
  assert.equal(history.canUndo, true)
  const other = await model()
  history.reset(other)
  assert.equal(history.canUndo, false)
  assert.equal(history.current, other)
})
