// 板的能力判断：模型为首选来源，模型缺席时按格式退回。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds/index.ts"
import { fallbackTraits, traitsOf, isNativeFormat } from "../src/skin-model/board-capability.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { readWith } from "./support/driver.mjs"

async function model() {
  return readWith(bdsFormat, bdsSource(SkinArchive.open(new Uint8Array(bdsFixture()), "bds")))
}

test("模型里的文档板：几何可改、可增删键", async () => {
  const skin = await model()
  const board = skin.boards.find((item) => item.geometry === "document")
  assert.ok(board, "夹具里应当有文档排布的板")
  const traits = traitsOf(board, "bds")
  assert.equal(traits.geometry, "document")
  assert.equal(traits.geometryEditable, true)
  assert.equal(traits.keyAdjustable, true)
  assert.equal(traits.touchEditable, true)
  assert.equal(traits.native, false)
})

test("模型里找不到板时退回格式判断", async () => {
  const skin = await model()
  const bda = fallbackTraits("bda")
  assert.equal(bda.geometryEditable, false, "BDA 的几何由客户端布局决定")
  assert.equal(bda.native, true)

  const bds = fallbackTraits("bds")
  assert.equal(bds.geometryEditable, true, "百度皮肤默认可以改几何")
  assert.equal(bds.native, false)
})

test("手心与搜狗按原生格式处理", async () => {
  for (const format of ["sxi", "ssf"]) {
    const traits = fallbackTraits(format)
    assert.equal(traits.native, true, `${format} 应当有专属界面`)
    assert.equal(traits.geometryEditable, false, `${format} 的几何不在这里改`)
  }
})

test("没有模型、没有格式时给出可编辑的保守结果", () => {
  const traits = fallbackTraits(undefined)
  assert.equal(traits.geometryEditable, true)
  assert.equal(traits.native, false)
})

test("工具栏板不允许增删按键", async () => {
  const skin = await model()
  const toolbar = skin.boards.find((item) => item.kind === "toolbar")
  if (!toolbar) return
  assert.equal(traitsOf(toolbar, "bds").keyAdjustable, false)
})
