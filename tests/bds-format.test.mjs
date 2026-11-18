// BDS 转换器：读出的模型与写回后再次读出的一致性。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds.ts"
import { setNodeRect } from "../src/skin-model/layout.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { box, rectOf } from "./helpers/boxes.mjs"

test("BDS 转换器读出完整模型", async () => {
  const archive = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  const source = bdsSource(archive)
  assert.ok(source)
  const model = await bdsFormat.read(source)
  assert.equal(model.meta.name, "测试皮肤")
  assert.equal(model.boards.length, 1)
  const board = model.boards[0]
  assert.equal(board.keys.length, 2)
  const key = board.keys[0]
  assert.deepEqual(rectOf(key.rect), { x: 10, y: 0, width: 100, height: 120 })
  assert.deepEqual(key.actions.press, { kind: "text", value: "q" })
  assert.equal(key.style.back, "2")
  assert.deepEqual(key.style.fore, ["3", "4"])
  assert.ok(model.styles.size > 0)
  assert.equal(model.resources.get("click.wav")?.kind, "audio")
  assert.equal(model.motions.get("ANIM1").root.kind, "track")
})

test("重建后重新读出保持一致", async () => {
  const archive = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  const source = bdsSource(archive)
  assert.ok(source)
  const model = await bdsFormat.read(source)
  model.boards[0].layout = setNodeRect(model.boards[0].layout, "KEY2", box(300, 5, 100, 120))
  const rebuilt = await bdsFormat.write(model, source)
  const again = await bdsFormat.read(rebuilt)
  const key = again.boards[0].keys.find((item) => item.id === "KEY2")
  assert.ok(key)
  assert.deepEqual(rectOf(key.rect), { x: 300, y: 5, width: 100, height: 120 })
  assert.equal(again.boards[0].keys[0].style.back, "2")
})

test("重建把用到的图片重新打包成一张图集", async () => {
  const archive = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  const source = bdsSource(archive)
  assert.ok(source)
  const model = await bdsFormat.read(source)
  assert.ok(model.images.size > 0, "导入时没有切出图片资源")
  const rebuilt = await bdsFormat.write(model, source)
  const til = rebuilt.archive.names().find((name) => name.endsWith("res/atlas.til"))
  const png = rebuilt.archive.names().find((name) => name.endsWith("res/atlas.png"))
  assert.ok(til && png, "重建没有生成图集")
  const text = rebuilt.archive.getText(til)
  assert.match(text, /SOURCE_RECT=/)
  const again = await bdsFormat.read(rebuilt)
  assert.ok(again.images.size > 0, "重建的图集读不出图片")
})
