// 手心皮肤转换器：skin.json 带完整几何，读成板、样式与动效后再重建。
import assert from "node:assert/strict"
import test from "node:test"
import { unzipSync } from "fflate"
import { computeLayout } from "../src/skin-model/layout.ts"
import { sxiFormat, sxiSource } from "../src/skin-model/formats/sxi/index.ts"
import { sxiFixture } from "./helpers/sxi-fixture.mjs"
import { readWith, writeWith } from "./support/driver.mjs"

function files() {
  const unpacked = unzipSync(sxiFixture())
  return new Map(Object.entries(unpacked).map(([path, data]) => [path, data]))
}

test("手心皮肤读出按键、动作与样式", async () => {
  const source = sxiSource(files())
  assert.ok(source)
  const model = await readWith(sxiFormat, source)
  assert.equal(model.meta.name, "手心测试")
  const board = model.boards.find((item) => item.id === "sxi:default:port:full26Pinyin")
  assert.ok(board)
  assert.equal(board.kind, "main")
  assert.equal(board.keys.length, 2)
  const rects = await computeLayout(board.layout, board.container)
  assert.deepEqual(rects.get("1").position, { x: 0, y: 0 })
  assert.deepEqual(rects.get("1").size, { width: 100, height: 100 })
  const key = board.keys[0]
  assert.deepEqual(key.actions.press, { kind: "text", value: "q" })
  assert.deepEqual(key.actions["swipe-up"], { kind: "text", value: "1" })
  assert.deepEqual(key.actions["long-press"], { kind: "delete" })
  assert.deepEqual(key.labelPosition, [1, 2])
  assert.equal(key.container.back?.style, "sxi:light:10:s_2")
  assert.equal(key.container.fore[0].style, "sxi:light:11:s_1")
  assert.equal(key.container.fore[0].anim, "sxi:light:14:s_5")
  assert.equal(key.sound, "sxi:light:13:s_4")
  assert.equal(board.keys[1].hitArea.kind, "none")
  assert.ok(model.styles.has("sxi:light:11:s_1"))
  assert.ok(model.motions.get("sxi:light:ss_2:100").kind === "track")
  assert.ok(model.sounds.some((sound) => sound.variants.length > 0))
})

test("手心皮肤写回后仍能读出同样的按键与板", async () => {
  const source = sxiSource(files())
  assert.ok(source)
  const model = await readWith(sxiFormat, source)
  const rebuilt = await writeWith(sxiFormat, model)
  const again = await readWith(sxiFormat, sxiSource(new Map(rebuilt.files)))
  const board = again.boards.find((item) => item.id === "sxi:default:port:full26Pinyin")
  assert.ok(board)
  assert.equal(board.keys.length, 2)
  assert.deepEqual(board.keys[0].actions.press, { kind: "text", value: "q" })
  const rects = await computeLayout(board.layout, board.container)
  assert.deepEqual(rects.get("1").size, { width: 100, height: 100 })
  assert.equal(again.meta.name, "手心测试")
  assert.equal(again.boards.length, model.boards.length)
})

test("没有横竖布局的包不被认成手心皮肤", () => {
  const bare = new Map([["skin.json", new TextEncoder().encode(JSON.stringify({ default: {} }))]])
  assert.equal(sxiSource(bare), undefined)
})
