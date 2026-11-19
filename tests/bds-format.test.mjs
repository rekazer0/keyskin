// BDS 转换器：读出的模型与写回后再次读出的一致性。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds.ts"
import { setNodeRect } from "../src/skin-model/layout.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { box, rectOf } from "./helpers/boxes.mjs"
import { readWith, rectOfKey, writeWith } from "./support/driver.mjs"

test("BDS 转换器读出完整模型", async () => {
  const archive = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  const source = bdsSource(archive)
  assert.ok(source)
  const model = await readWith(bdsFormat, source)
  assert.equal(model.meta.name, "测试皮肤")
  assert.equal(model.boards.length, 3)
  const board = model.boards[0]
  assert.equal(board.id, "light/skin/port/py_26.ini")
  assert.equal(board.kind, "main")
  const nine = model.boards[1]
  assert.equal(nine.id, "light/skin/port/py_9.ini")
  assert.equal(nine.kind, "number")
  assert.equal(nine.keys.length, 2)
  const symbols = model.boards[2]
  assert.equal(symbols.kind, "symbol")
  assert.equal(board.keys.length, 2)
  const key = board.keys[0]
  assert.deepEqual(rectOf(await rectOfKey(model, board.id, key.id)), { x: 10, y: 0, width: 100, height: 120 })
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
  const model = await readWith(bdsFormat, source)
  model.boards[0].layout = setNodeRect(model.boards[0].layout, "KEY2", box(300, 5, 100, 120))
  const rebuilt = await writeWith(bdsFormat, model, source)
  const again = await readWith(bdsFormat, rebuilt)
  const key = again.boards[0].keys.find((item) => item.id === "KEY2")
  assert.ok(key)
  assert.deepEqual(rectOf(await rectOfKey(again, again.boards[0].id, "KEY2")), { x: 300, y: 5, width: 100, height: 120 })
  assert.equal(again.boards[0].keys[0].style.back, "2")
})

test("重建把用到的图片重新打包成一张图集", async () => {
  const archive = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  const source = bdsSource(archive)
  assert.ok(source)
  const model = await readWith(bdsFormat, source)
  assert.ok(model.images.size > 0, "导入时没有切出图片资源")
  const rebuilt = await writeWith(bdsFormat, model, source)
  const til = rebuilt.archive.names().find((name) => name.endsWith("res/atlas.til"))
  const png = rebuilt.archive.names().find((name) => name.endsWith("res/atlas.png"))
  assert.ok(til && png, "重建没有生成图集")
  const text = rebuilt.archive.getText(til)
  assert.match(text, /SOURCE_RECT=/)
  const again = await readWith(bdsFormat, rebuilt)
  assert.ok(again.images.size > 0, "重建的图集读不出图片")
})

test("读出面板的候选栏、气泡、列表与工具栏", async () => {
  const archive = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  const source = bdsSource(archive)
  assert.ok(source)
  const board = (await readWith(bdsFormat, source)).boards[0]
  assert.equal(board.backdrop?.style, "1")
  assert.equal(board.candidates?.[0]?.style, "6")
  assert.equal(board.candidates?.[0]?.cellStyle, "120")
  assert.equal(board.candidates?.[0]?.icons?.[0]?.action?.kind, "system")
  assert.equal(board.hint?.style, "0")
  assert.deepEqual(board.hint?.offset, { x: 1, y: 2 })
  assert.equal(board.list?.cellStyle, "120")
  assert.deepEqual(board.list?.cellSize, { width: 100, height: 50 })
  assert.equal(board.list?.count, 3)
})

test("重建后仍能读回面板组件", async () => {
  const archive = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  const source = bdsSource(archive)
  assert.ok(source)
  const model = await readWith(bdsFormat, source)
  const rebuilt = await writeWith(bdsFormat, model, source)
  const again = (await readWith(bdsFormat, rebuilt)).boards[0]
  assert.ok(again.backdrop?.style)
  assert.ok(again.candidates?.length)
  assert.ok(again.hint)
  assert.ok(again.list)
  assert.equal(again.list?.cellSize?.width, 100)
})

test("图集超过一页时按页切分", async () => {
  const archive = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  const source = bdsSource(archive)
  assert.ok(source)
  const model = await readWith(bdsFormat, source)
  // 造一张比单页还高的图片，逼出第二页。
  const tall = { width: 8, height: 4096, data: new Uint8Array(8 * 4096 * 4) }
  model.images = new Map([...model.images, ["tall", tall]])
  const style = { normal: [{ kind: "image", image: "tall" }] }
  model.styles = new Map([...model.styles, ["900", style]])
  const rebuilt = await writeWith(bdsFormat, model, source)
  const pages = rebuilt.archive.names().filter((name) => /res\/atlas\d*\.png$/.test(name)).sort()
  assert.equal(pages.length, 2, `图集页数 ${pages.join(",")}`)
  const again = await readWith(bdsFormat, rebuilt)
  assert.ok(again.images.size > 0)
})
