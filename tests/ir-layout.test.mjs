// IR 布局：taffy 树的计算。
import assert from "node:assert/strict"
import test from "node:test"
import { absoluteBoard, computeLayout } from "../src/skin-model/layout.ts"

test("绝对矩形经 taffy 计算后与输入一致", async () => {
  const board = absoluteBoard([
    { id: "a", x: 10, y: 20, width: 100, height: 50 },
    { id: "b", x: 200, y: 60, width: 90, height: 40 },
  ])
  const layout = await computeLayout(board, { width: 1080, height: 400 })
  assert.deepEqual(layout.get("a"), { x: 10, y: 20, width: 100, height: 50 })
  assert.deepEqual(layout.get("b"), { x: 200, y: 60, width: 90, height: 40 })
})

test("flex 行按百分比分配宽度", async () => {
  const board = {
    kind: "flex",
    id: "board",
    width: "100%",
    height: "100%",
    children: [
      {
        kind: "flex",
        id: "row",
        direction: "row",
        width: 300,
        height: 100,
        children: [
          { kind: "leaf", id: "left", width: "50%", height: "100%" },
          { kind: "leaf", id: "right", width: "50%", height: "100%" },
        ],
      },
    ],
  }
  const layout = await computeLayout(board, { width: 1080, height: 400 })
  assert.deepEqual(layout.get("left"), { x: 0, y: 0, width: 150, height: 100 })
  assert.deepEqual(layout.get("right"), { x: 150, y: 0, width: 150, height: 100 })
})

test("网格等分容器宽度并保留列间距", async () => {
  const board = {
    kind: "flex",
    id: "board",
    width: "100%",
    height: "100%",
    children: [
      {
        kind: "grid",
        id: "grid",
        columns: { equal: 3 },
        gap: 2,
        width: 300,
        height: 100,
        children: [
          { kind: "leaf", id: "g0", height: "100%" },
          { kind: "leaf", id: "g1", height: "100%" },
          { kind: "leaf", id: "g2", height: "100%" },
        ],
      },
    ],
  }
  const layout = await computeLayout(board, { width: 1080, height: 400 })
  assert.equal(layout.get("g0").x, 0)
  assert.ok(layout.get("g1").x >= 100 && layout.get("g1").x <= 101)
  assert.ok(layout.get("g2").x >= 200 && layout.get("g2").x <= 201)
})

test("网格按固定轨道宽度排列", async () => {
  const board = {
    kind: "flex",
    id: "board",
    width: "100%",
    height: "100%",
    children: [
      {
        kind: "grid",
        id: "grid",
        columns: { fixed: [100, 200, 50] },
        gap: 4,
        width: 354,
        height: 100,
        children: [
          { kind: "leaf", id: "c0", height: "100%" },
          { kind: "leaf", id: "c1", height: "100%" },
          { kind: "leaf", id: "c2", height: "100%" },
        ],
      },
    ],
  }
  const layout = await computeLayout(board, { width: 1080, height: 400 })
  assert.equal(layout.get("c0").x, 0)
  assert.equal(layout.get("c1").x, 104)
  assert.equal(layout.get("c2").x, 308)
})
