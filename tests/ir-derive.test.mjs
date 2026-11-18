// 布局推导：从按键矩形得到 grid / 行容器 / 绝对矩形，并验证计算后与输入一致。
import assert from "node:assert/strict"
import test from "node:test"
import { Display } from "taffy-layout"
import { deriveBoardLayout } from "../src/skin-model/derive/layout.ts"
import { computeLayout } from "../src/skin-model/layout.ts"

test("规整网格推导为 grid 并精确复现", async () => {
  const keys = []
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 3; column++) {
      keys.push({ id: `k${row}${column}`, x: column * 101, y: row * 51, width: 100, height: 50 })
    }
  }
  const size = { width: 302, height: 101 }
  const board = deriveBoardLayout("board", keys, size)
  assert.equal(board.style.display, Display.Grid)
  const layout = await computeLayout(board, size)
  for (const key of keys) {
    assert.deepEqual(layout.get(key.id), { x: key.x, y: key.y, width: key.width, height: key.height })
  }
})

test("错位的行推导为行容器并精确复现", async () => {
  const keys = [
    { id: "a", x: 0, y: 0, width: 100, height: 50 },
    { id: "b", x: 100, y: 0, width: 100, height: 50 },
    { id: "c", x: 10, y: 60, width: 100, height: 50 },
    { id: "d", x: 110, y: 60, width: 100, height: 50 },
  ]
  const size = { width: 200, height: 110 }
  const board = deriveBoardLayout("board", keys, size)
  assert.equal(board.style.display, Display.Flex)
  const layout = await computeLayout(board, size)
  for (const key of keys) {
    assert.deepEqual(layout.get(key.id), { x: key.x, y: key.y, width: key.width, height: key.height })
  }
})

test("不规整的键盘保持绝对矩形", async () => {
  const keys = [
    { id: "a", x: 0, y: 0, width: 100, height: 50 },
    { id: "b", x: 120, y: 0, width: 90, height: 50 },
    { id: "c", x: 0, y: 60, width: 130, height: 50 },
  ]
  const size = { width: 300, height: 110 }
  const board = deriveBoardLayout("board", keys, size)
  assert.equal(board.style.display, Display.Flex)
  const layout = await computeLayout(board, size)
  for (const key of keys) {
    assert.deepEqual(layout.get(key.id), { x: key.x, y: key.y, width: key.width, height: key.height })
  }
})
