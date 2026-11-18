// IR 模型：板、样式、动效、能力与损失。
import assert from "node:assert/strict"
import test from "node:test"
import { emptyModel, boardsOfKind } from "../src/skin-model/model.ts"
import { requiredCapabilities, lossOf } from "../src/skin-model/capability.ts"
import { absoluteBoard, computeLayout } from "../src/skin-model/layout.ts"
import { box, rectOf } from "./helpers/boxes.mjs"

function model() {
  const result = emptyModel({ appearance: "light", orientation: "port" })
  result.boards.push({
    id: "main",
    kind: "main",
    geometry: "document",
    orientation: "port",
    size: { width: 1080, height: 600 },
    layout: absoluteBoard([{ id: "k1", ...box(10, 10, 100, 50) }]),
    keys: [
      {
        id: "k1",
        rect: box(10, 10, 100, 50),
        actions: { press: { kind: "text", value: "a" } },
        style: { back: "1", fore: [] },
      },
    ],
  })
  result.styles.set("1", { normal: [{ kind: "image", file: "bg" }], pressed: [{ kind: "color", value: "FF000000" }] })
  result.motions.set("m1", {
    id: "m1",
    root: { kind: "track", delay: 0, duration: 200, track: { property: "alpha", from: [[255, 255], [255, 255]], to: [[0, 0], [0, 0]], relative: false, easing: { kind: "linear" } } },
    timeline: { delay: 0, duration: 200, repeat: 1, reverse: false, clear: false },
    bindings: [{ target: "k1", slot: "press", scope: "back" }],
  })
  result.sounds.set("key", { slot: "key", resource: "click" })
  return result
}

test("模型可容纳板、样式、动效与音效", () => {
  const skin = model()
  assert.equal(boardsOfKind(skin, "main").length, 1)
  assert.equal(skin.styles.size, 1)
  assert.equal(skin.motions.size, 1)
  assert.equal(skin.sounds.size, 1)
})

test("板的布局树可用于计算按键矩形", async () => {
  const skin = model()
  const layout = await computeLayout(skin.boards[0].layout, skin.boards[0].size)
  assert.deepEqual(rectOf(layout.get("k1")), { x: 10, y: 10, width: 100, height: 50 })
})

test("能力需求覆盖实际用到的维度", () => {
  const skin = model()
  const required = requiredCapabilities(skin)
  for (const capability of ["board.geometry", "board.keys", "key.actions", "style.image", "style.color", "motion.track", "motion.binding", "sound"]) {
    assert.ok(required.has(capability), `缺少 ${capability}`)
  }
})

test("目标格式缺能力时生成损失报告", () => {
  const skin = model()
  const target = new Map([
    ["board.geometry", "full"],
    ["board.keys", "full"],
    ["key.actions", "full"],
    ["style.image", "full"],
    ["style.color", "full"],
    ["motion.track", "full"],
    ["motion.binding", "none"],
    ["sound", "partial"],
  ])
  const report = lossOf(skin, target)
  assert.ok(report.items.some((item) => item.capability === "motion.binding" && item.reason === "no-equivalent"))
  assert.ok(report.items.some((item) => item.capability === "sound" && item.reason === "approximated"))
})
