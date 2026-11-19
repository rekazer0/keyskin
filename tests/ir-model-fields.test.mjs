// 模型属性 → 检查器字段的适配。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds/index.ts"
import { keyGeometry, keyActions, keyStyleRefs } from "../src/skin-model/inspect.ts"
import { fieldOf, fieldsOf, geometryRows, valueOfField } from "../src/app/model-fields.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { readWith, warm } from "./support/driver.mjs"

const BOARD = "light/skin/port/py_26.ini"

async function model() {
  const built = await readWith(bdsFormat, bdsSource(SkinArchive.open(new Uint8Array(bdsFixture()), "bds")))
  await warm(built)
  return built
}

test("数值属性变成带范围的数值字段", async () => {
  const views = keyGeometry(await model(), BOARD, "KEY1")
  const x = views.find((view) => view.key === "x")
  const spec = fieldOf(x)
  assert.equal(spec.kind, "number")
  assert.equal(spec.value, "10")
  assert.equal(spec.min, 0)
  assert.equal(spec.max, 1080)
})

test("只读属性不会被误当可编辑", async () => {
  const views = keyGeometry(await model(), BOARD, "KEY1")
  const readonly = { ...views[0], readOnly: true }
  assert.equal(fieldOf(readonly).kind, "readonly")
})

test("动作属性是文本框，未配置时为空", async () => {
  const views = keyActions(await model(), BOARD, "KEY1")
  const press = fieldOf(views.find((view) => view.key === "action.press"))
  assert.equal(press.kind, "text")
  assert.equal(press.value, "q")
  const empty = fieldOf(views.find((view) => view.key === "action.swipe-left"))
  assert.equal(empty.value, "")
})

test("样式引用走引用卡", async () => {
  const views = keyStyleRefs(await model(), BOARD, "KEY1")
  const back = views.find((view) => view.key === "style.back")
  const spec = fieldOf(back)
  assert.equal(spec.kind, "style")
  assert.equal(spec.value, "2")
  assert.equal(spec.reference, "style.back")
})

test("整组属性转成字段，保持顺序", async () => {
  const views = keyGeometry(await model(), BOARD, "KEY1")
  const fields = fieldsOf(views)
  assert.equal(fields.length, views.length)
  assert.deepEqual(fields.map((field) => field.view.key), views.map((view) => view.key))
})

test("几何并成两行：位置与尺寸", async () => {
  const views = keyGeometry(await model(), BOARD, "KEY1")
  const rows = geometryRows(views)
  assert.equal(rows.length, 4, "位置、尺寸、触摸位置、触摸尺寸")
  assert.deepEqual(rows[0].map((field) => field.view.key), ["x", "y"])
  assert.deepEqual(rows[1].map((field) => field.view.key), ["width", "height"])
})

test("字段值解析：数值转换，空串表示未配置", async () => {
  const views = keyGeometry(await model(), BOARD, "KEY1")
  const x = views.find((view) => view.key === "x")
  assert.equal(valueOfField(x, "42"), 42)
  assert.equal(valueOfField(x, ""), undefined)
  assert.equal(valueOfField(x, "abc"), undefined)
})
