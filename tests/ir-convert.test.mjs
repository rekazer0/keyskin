// 跨格式转换：读一个格式，写出另一个格式，并报告目标格式表达不了的部分。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { convertSkin, describeLoss, previewConversion } from "../src/skin-model/convert.ts"
import { detectFormat, openSkin, SKIN_FORMATS, writeSkin } from "../src/skin-model/formats/index.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { sxiFixture } from "./helpers/sxi-fixture.mjs"

function bdsArchive() {
  return SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
}

function sxiArchive() {
  return SkinArchive.open(new Uint8Array(sxiFixture()), "bds")
}

test("按内容识别格式", () => {
  assert.equal(detectFormat(bdsArchive()), "bds")
  assert.equal(detectFormat(sxiArchive()), "sxi")
  const bare = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  assert.ok(SKIN_FORMATS.includes(detectFormat(bare)))
})

test("打开皮肤得到模型与格式", async () => {
  const opened = await openSkin(bdsArchive())
  assert.ok(opened)
  assert.equal(opened.format, "bds")
  assert.equal(opened.model.boards.length, 3)
})

test("搜狗包缺少骨架时返回未识别，而不是抛错", async () => {
  const ssfLike = SkinArchive.open(new Uint8Array(new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "ssf")
  assert.equal(await openSkin(ssfLike), undefined)
})

test("BDS 转写成 SXI 后仍是同一块键盘", async () => {
  const result = await convertSkin({ archive: bdsArchive(), target: "sxi" })
  assert.equal(result.from, "bds")
  assert.equal(result.to, "sxi")
  const again = await openSkin(result.output)
  assert.ok(again)
  assert.equal(again.format, "sxi")
  assert.equal(again.model.boards[0].keys.length, result.model.boards[0].keys.length)
  assert.deepEqual(
    again.model.boards[0].keys.map((key) => key.id),
    result.model.boards[0].keys.map((key) => key.id),
  )
})

test("SXI 转写成 BDS 后按键数量保持不变", async () => {
  const result = await convertSkin({ archive: sxiArchive(), target: "bds" })
  assert.equal(result.from, "sxi")
  const again = await openSkin(result.output)
  assert.ok(again)
  assert.equal(again.model.boards[0].keys.length, 2)
})

test("写出结果带能力损失报告", async () => {
  const opened = await openSkin(bdsArchive())
  assert.ok(opened)
  const written = await writeSkin(opened.model, "sxi")
  assert.equal(written.format, "sxi")
  assert.ok(Array.isArray(written.loss.items))
  for (const line of describeLoss(written.loss)) assert.equal(typeof line, "string")
})

test("转换前的预告与写出后的报告一致", async () => {
  const opened = await openSkin(bdsArchive())
  assert.ok(opened)
  const preview = await previewConversion(opened.model, "sxi")
  const written = await writeSkin(opened.model, "sxi")
  assert.equal(preview.items.length, written.loss.items.length)
})
