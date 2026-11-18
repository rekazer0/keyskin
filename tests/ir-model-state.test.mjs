// 当前文档的模型状态：懒加载、缓存与失效。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { SkinModelState } from "../src/app/skin-model-state.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"

function archive() {
  return SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
}

test("第一次读取会构建模型，第二次直接复用", async () => {
  const state = new SkinModelState()
  const source = archive()
  const first = await state.load(source)
  assert.equal(first.state, "ready")
  assert.ok(state.model)
  const cached = await state.load(source)
  assert.equal(cached, first, "同一归档没有复用快照")
})

test("换归档后重新构建", async () => {
  const state = new SkinModelState()
  const a = archive()
  const b = archive()
  const first = await state.load(a)
  assert.equal(first.state, "ready")
  const second = await state.load(b)
  assert.equal(second.state, "ready")
  assert.notEqual(second, first)
})

test("失效后下次读取重建", async () => {
  const state = new SkinModelState()
  const source = archive()
  const first = await state.load(source)
  assert.equal(first.state, "ready")
  state.invalidate()
  assert.equal(state.model, undefined)
  const again = await state.load(source)
  assert.equal(again.state, "ready")
  assert.notEqual(again, first)
})

test("reset 清掉快照，避免拿到上一份皮肤的模型", async () => {
  const state = new SkinModelState()
  await state.load(archive())
  assert.ok(state.model)
  state.reset()
  assert.equal(state.model, undefined)
  assert.deepEqual(state.current, { state: "empty" })
})

test("无法识别的包记成不可用，而不是抛错", async () => {
  const state = new SkinModelState()
  const bare = SkinArchive.open(new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "bds")
  const status = await state.load(bare)
  assert.equal(status.state, "unavailable")
  assert.equal(state.model, undefined)
})

test("读到的模型带自检报告", async () => {
  const state = new SkinModelState()
  const status = await state.load(archive())
  assert.equal(status.state, "ready")
  if (status.state !== "ready") return
  assert.equal(status.report.errors, 0)
  assert.equal(state.report?.errors, 0)
})

test("编辑让模型失效后，读取会触发重建", async () => {
  const state = new SkinModelState()
  const source = archive()
  await state.load(source)
  assert.ok(state.model)
  state.invalidate()
  assert.equal(state.model, undefined)
  // ensure 不等待结果，但会把重建排上；随后 await load 应当拿到同一份。
  state.ensure(source)
  const status = await state.load(source)
  assert.equal(status.state, "ready")
  assert.ok(state.model)
})

test("已有模型时不重复构建", async () => {
  const state = new SkinModelState()
  const source = archive()
  const first = await state.load(source)
  state.ensure(source)
  const second = await state.load(source)
  assert.equal(second, first, "ensure 不该让已有模型重建")
})
