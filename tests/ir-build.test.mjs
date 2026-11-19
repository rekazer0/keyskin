// 基于布局与样式构建渲染模型。
import assert from "node:assert/strict"
import test from "node:test"
import { buildBoard } from "../src/skin-model/build.ts"
import { absoluteBoard } from "../src/skin-model/layout.ts"
import { emptyModel } from "../src/skin-model/model.ts"
import { box, rectOf } from "./helpers/boxes.mjs"

function model() {
  const result = emptyModel({ appearance: "light", orientation: "port" })
  result.boards.push({
    id: "board",
    kind: "main",
    geometry: "document",
    orientation: "port",
    size: { width: 300, height: 100 },
    layout: absoluteBoard([{ id: "k", ...box(10, 10, 100, 50) }]),
    keys: [{
      id: "k",
      actions: { press: { kind: "text", value: "a" } },
      container: { back: { style: "1" }, fore: [{ style: "2" }] },
    }],
  })
  result.styles.set("1", { normal: [{ kind: "image", file: "bg" }] })
  result.styles.set("2", { normal: [{ kind: "text", text: "a", style: { fontSize: 12 } }] })
  return result
}

test("构建后的按键矩形来自布局树", async () => {
  const skin = model()
  const renders = await buildBoard(skin, skin.boards[0])
  const render = renders.find((item) => item.key.id === "k")
  assert.ok(render)
  assert.deepEqual(rectOf(render.rect), { x: 10, y: 10, width: 100, height: 50 })
})

test("构建后的图层来自样式引用", async () => {
  const skin = model()
  const renders = await buildBoard(skin, skin.boards[0])
  const render = renders.find((item) => item.key.id === "k")
  assert.ok(render)
  assert.equal(render.layers.length, 2)
  assert.equal(render.layers[0].kind, "image")
  assert.equal(render.layers[1].kind, "text")
  assert.equal(render.back?.normal[0].kind, "image")
})
