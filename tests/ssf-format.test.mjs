// 搜狗皮肤转换器：骨架提供几何，皮肤自己的段提供样式与前景。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { ssfFormat, ssfSource } from "../src/skin-model/formats/ssf.ts"
import { unpackSsf } from "../src/ssf/ssf-package.ts"
import { ssfFixture } from "./helpers/ssf-fixture.mjs"
import { ssfSkeletonFixture } from "./helpers/ssf-skeleton-fixture.mjs"

async function model() {
  const files = await unpackSsf(ssfFixture())
  const skeleton = SkinArchive.open(ssfSkeletonFixture(), "bds")
  const source = ssfSource(files, skeleton)
  assert.ok(source)
  return { source, model: await ssfFormat.read(source) }
}

test("搜狗皮肤读出骨架几何与皮肤样式", async () => {
  const { model: skin } = await model()
  assert.equal(skin.meta.name, "测试皮肤")
  assert.equal(skin.meta.author, "测试作者")
  assert.equal(skin.meta.appearance, "light")
  const board = skin.boards[0]
  assert.equal(board.keys.length, 3)
  assert.equal(board.geometry, "document")
  assert.ok(board.size.width > 0)
  const keys = board.keys.map((key) => key.rect.position.x)
  assert.deepEqual(keys, [0, 360, 720])
  const look = [...skin.styles.keys()].filter((name) => name.startsWith("ssf:"))
  assert.ok(look.length > 0, "没有读到皮肤自己的样式")
})

test("搜狗按键动作来自骨架的 CENTER", async () => {
  const { model: skin } = await model()
  const texts = skin.boards[0].keys.map((key) => key.actions.press?.kind === "text" ? key.actions.press.value : undefined)
  assert.equal(texts[0], "q")
  assert.equal(texts[1], "w")
})

test("写回只改皮肤自己的 INI，其余文件字节不变", async () => {
  const { source, model: skin } = await model()
  const back = ssfFormat.write(skin, source)
  const png = "1080/status1/26key.png"
  assert.deepEqual(back.files.get(png), source.files.get(png), "图片被重写了")
  assert.ok(back.files.size >= source.files.size)
  const again = await ssfFormat.read(back)
  assert.equal(again.boards[0].keys.length, 3)
})
