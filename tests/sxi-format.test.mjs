// 手心皮肤转换器：skin.json 直接带几何，读成板后再重建。
import assert from "node:assert/strict"
import test from "node:test"
import { unzipSync } from "fflate"
import { sxiFormat, sxiSource } from "../src/skin-model/formats/sxi.ts"
import { sxiFixture } from "./helpers/sxi-fixture.mjs"
import { rectOf } from "./helpers/boxes.mjs"
import { readWith, writeWith } from "./support/driver.mjs"

function files() {
  const unpacked = unzipSync(sxiFixture())
  return new Map(Object.entries(unpacked).map(([path, data]) => [path, data]))
}

test("手心皮肤读出按键、动作与面板", async () => {
  const source = sxiSource(files())
  assert.ok(source)
  const model = await readWith(sxiFormat, source)
  assert.equal(model.meta.name, "手心测试")
  const board = model.boards[0]
  assert.equal(board.keys.length, 2)
  assert.deepEqual(rectOf(board.keys[0].rect), { x: 0, y: 0, width: 540, height: 300 })
  assert.deepEqual(board.keys[0].actions.press, { kind: "text", value: "q" })
  assert.deepEqual(board.keys[0].actions["swipe-up"], { kind: "text", value: "1" })
  assert.deepEqual(board.keys[1].actions.press, { kind: "system", code: "F31" })
  assert.equal(board.keys[0].style.back, "sxi:10")
  assert.equal(board.backdrop?.style, "3")
  assert.equal(board.candidate?.style, "20")
  assert.equal(board.hint?.style, "30")
  assert.deepEqual(board.hint?.offset, { x: 10, y: 20 })
})

test("手心皮肤写回后仍能读出同样的按键", async () => {
  const source = sxiSource(files())
  assert.ok(source)
  const model = await readWith(sxiFormat, source)
  const rebuilt = await writeWith(sxiFormat, model)
  const again = await readWith(sxiFormat, rebuilt)
  assert.equal(again.boards[0].keys.length, 2)
  assert.deepEqual(rectOf(again.boards[0].keys[0].rect), { x: 0, y: 0, width: 540, height: 300 })
  assert.deepEqual(again.boards[0].keys[0].actions.press, { kind: "text", value: "q" })
  assert.equal(again.meta.name, "手心测试")
})

test("没有 keyboard 段的包不被认成手心皮肤", () => {
  const bare = new Map([["skin.json", new TextEncoder().encode(JSON.stringify({ default: {} }))]])
  assert.equal(sxiSource(bare), undefined)
})
