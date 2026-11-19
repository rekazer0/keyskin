// IR 布局：节点样式直接使用 taffy 的 StylePropertyValues，计算结果用 LayoutPropertyValues。
import assert from "node:assert/strict"
import test from "node:test"
import { AlignItems, Display, FlexDirection, Position } from "taffy-layout"
import { absoluteBoard, computeLayout, styleProperties } from "../src/skin-model/layout.ts"
import { box, rectOf } from "./helpers/boxes.mjs"

test("绝对盒子经 taffy 计算后与输入一致", async () => {
  const board = absoluteBoard([
    { id: "a", ...box(10, 20, 100, 50) },
    { id: "b", ...box(200, 60, 90, 40) },
  ])
  const layout = await computeLayout(board, { width: 1080, height: 400 })
  assert.deepEqual(rectOf(layout.get("a")), { x: 10, y: 20, width: 100, height: 50 })
  assert.deepEqual(rectOf(layout.get("b")), { x: 200, y: 60, width: 90, height: 40 })
})

test("相对定位按 inset 偏移，并保留在流中的占位", async () => {
  const board = {
    id: "board",
    style: { display: Display.Flex, flexDirection: FlexDirection.Row, size: { width: 300, height: 100 } },
    children: [
      {
        id: "left",
        style: {
          position: Position.Relative,
          inset: { left: 5, top: 3, right: "auto", bottom: "auto" },
          size: { width: 100, height: 100 },
        },
      },
      { id: "right", style: { size: { width: 100, height: 100 } } },
    ],
  }
  const layout = await computeLayout(board, { width: 1080, height: 400 })
  assert.deepEqual(rectOf(layout.get("left")), { x: 5, y: 3, width: 100, height: 100 })
  assert.deepEqual(rectOf(layout.get("right")), { x: 100, y: 0, width: 100, height: 100 })
})

test("flex 行按百分比分配宽度并对齐", async () => {
  const board = {
    id: "board",
    style: {
      display: Display.Flex,
      flexDirection: FlexDirection.Row,
      alignItems: AlignItems.Center,
      size: { width: 300, height: 100 },
    },
    children: [
      { id: "left", style: { size: { width: "50%", height: 40 } } },
      { id: "right", style: { size: { width: "50%", height: 40 } } },
    ],
  }
  const layout = await computeLayout(board, { width: 1080, height: 400 })
  assert.deepEqual(rectOf(layout.get("left")), { x: 0, y: 30, width: 150, height: 40 })
  assert.deepEqual(rectOf(layout.get("right")), { x: 150, y: 30, width: 150, height: 40 })
})

test("网格等分容器宽度并保留列间距", async () => {
  const board = {
    id: "board",
    style: {
      display: Display.Grid,
      gridTemplateColumns: [{ count: 3, tracks: [{ min: "auto", max: "1fr" }] }],
      gap: { width: 2, height: 2 },
      size: { width: 300, height: 100 },
    },
    children: [
      { id: "g0", style: { size: { height: 100 } } },
      { id: "g1", style: { size: { height: 100 } } },
      { id: "g2", style: { size: { height: 100 } } },
    ],
  }
  const layout = await computeLayout(board, { width: 1080, height: 400 })
  assert.equal(layout.get("g0").position.x, 0)
  assert.ok(layout.get("g1").position.x >= 100 && layout.get("g1").position.x <= 101)
  assert.ok(layout.get("g2").position.x >= 200 && layout.get("g2").position.x <= 201)
})

test("网格按固定轨道宽度排列", async () => {
  const board = {
    id: "board",
    style: {
      display: Display.Grid,
      gridTemplateColumns: [
        { min: 100, max: 100 },
        { min: 200, max: 200 },
        { min: 50, max: 50 },
      ],
      gap: { width: 4, height: 4 },
      size: { width: 354, height: 100 },
    },
    children: [
      { id: "c0", style: { size: { height: 100 } } },
      { id: "c1", style: { size: { height: 100 } } },
      { id: "c2", style: { size: { height: 100 } } },
    ],
  }
  const layout = await computeLayout(board, { width: 1080, height: 400 })
  assert.equal(layout.get("c0").position.x, 0)
  assert.equal(layout.get("c1").position.x, 104)
  assert.equal(layout.get("c2").position.x, 308)
})

test("样式属性名来自 taffy 的 StyleProperty", () => {
  const style = { display: Display.Flex, size: { width: "100%", height: "100%" } }
  assert.deepEqual(styleProperties(style).sort(), ["display", "size"])
})
