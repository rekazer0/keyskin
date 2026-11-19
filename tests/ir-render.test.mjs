// 板的渲染投影：每个键与每种组件都出一项，几何来自布局树，样式只给引用。
import assert from "node:assert/strict"
import test from "node:test"
import { bdsRenders } from "../src/skin-model/formats/bds/render.ts"
import { absoluteBoard } from "../src/skin-model/layout.ts"
import { box } from "./helpers/boxes.mjs"

/** 一块板：两个键 + 五种组件，几何都给全。 */
function board() {
  return {
    id: "board",
    kind: "main",
    geometry: "document",
    orientation: "port",
    size: { width: 300, height: 100 },
    layout: absoluteBoard([
      { id: "KEY1", ...box(0, 0, 100, 50) },
      { id: "KEY2", ...box(100, 0, 100, 50) },
    ]),
    keys: [
      {
        id: "KEY1",
        actions: { press: { kind: "text", value: "a" } },
        container: { back: { style: "101" }, fore: [{ style: "102" }] },
      },
      {
        id: "KEY2",
        actions: { press: { kind: "text", value: "b" } },
        container: { back: { style: "103" }, fore: [] },
      },
    ],
    backdrop: { style: "1", foreStyle: "2", viewRect: box(0, 0, 300, 100) },
    candidates: [{ style: "3", viewRect: box(0, 0, 300, 40) }],
    list: { style: "4", foreStyle: "5", viewRect: box(0, 50, 300, 50) },
    more: { foreStyle: "6", viewRect: box(200, 0, 100, 40) },
    hint: { style: "7", foreStyle: "8", viewRect: box(0, 0, 120, 40) },
    tips: new Map(),
  }
}

test("每个键都出一项，几何来自布局树", async () => {
  const renders = await bdsRenders(board())
  const keys = renders.filter((render) => render.section.startsWith("KEY"))
  assert.equal(keys.length, 2)
  assert.deepEqual(keys[0].rect, { x: 0, y: 0, width: 100, height: 50 })
  assert.deepEqual(keys[1].rect, { x: 100, y: 0, width: 100, height: 50 })
})

test("样式只给引用，解析留给绘制阶段", async () => {
  const renders = await bdsRenders(board())
  const first = renders.find((render) => render.section === "KEY1")
  assert.equal(first.backStyle, "101")
  assert.deepEqual(first.foreStyles, ["102"])
  assert.deepEqual(first.container.fore, [{ style: "102" }])
})

test("面板、候选栏、列表、更多菜单、气泡各出一项", async () => {
  const renders = await bdsRenders(board())
  const components = renders.filter((render) => !render.section.startsWith("KEY"))
  assert.deepEqual(components.map((render) => render.section).sort(), ["CAND", "HINT", "LIST", "MORE", "PANEL"])
  const panel = components.find((render) => render.section === "PANEL")
  assert.deepEqual(panel.rect, { x: 0, y: 0, width: 300, height: 100 })
  assert.equal(panel.backStyle, "1")
})

test("没有几何的组件不出现", async () => {
  const empty = { ...board(), candidates: [], list: undefined, more: undefined, hint: undefined }
  const renders = await bdsRenders(empty)
  const components = renders.filter((render) => !render.section.startsWith("KEY"))
  assert.deepEqual(components.map((render) => render.section), ["PANEL"])
})

test("按键种类随容器一起透传", async () => {
  const withCell = board()
  withCell.keys = [...withCell.keys, {
    id: "LIST:1",
    kind: "list-cell",
    actions: {},
    container: { fore: [{ style: "9" }] },
  }]
  withCell.layout = absoluteBoard([
    { id: "KEY1", ...box(0, 0, 100, 50) },
    { id: "KEY2", ...box(100, 0, 100, 50) },
    { id: "LIST:1", ...box(0, 60, 100, 40) },
  ])
  const renders = await bdsRenders(withCell)
  const cell = renders.find((render) => render.section === "LIST:1")
  assert.equal(cell.key.kind, "list-cell")
})
