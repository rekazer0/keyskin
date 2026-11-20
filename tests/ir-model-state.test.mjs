// 当前文档的模型状态：懒加载、缓存与失效。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

test("同步新模型：快照被替换，不必作废重建", async () => {
  const state = new SkinModelState()
  const source = archive()
  const ready = await state.load(source)
  assert.equal(ready.state, "ready")
  const before = state.model
  const edited = { ...before, meta: { ...before.meta, name: "改过的名字" } }
  state.update(edited)
  assert.equal(state.model, edited, "同步后应当直接拿到新模型")
  const again = await state.load(source)
  assert.equal(again.state, "ready")
  assert.equal(state.model, edited, "同步过的模型不该被重建覆盖")
})

test("没有快照时同步被忽略", async () => {
  const state = new SkinModelState()
  const source = archive()
  const model = (await state.load(source)).model
  state.reset()
  state.update(model)
  assert.equal(state.model, undefined, "没有快照时不该凭空造出一份")
})

test("先无骨架建好的模型，带骨架 ensure 会重建", async () => {
  const state = new SkinModelState()
  const archive = SkinArchive.open(
    new Uint8Array(readFileSync(new URL("../public/default-template.bda", import.meta.url))),
    "bda",
  )
  const base = SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/bda-base.bds", import.meta.url))))
  const bare = await state.load(archive, {})
  assert.equal(bare.state, "ready")
  assert.ok(bare.model.boards.every((board) => board.container.kind === "unknown"), "没带骨架时不该有画布尺寸")

  state.ensure(archive, { base })
  const withBase = await state.load(archive, { base })
  assert.equal(withBase.state, "ready")
  assert.ok(withBase.model.boards.every((board) => board.container.kind === "known"), "带骨架后应重建出画布尺寸")
  assert.ok(withBase.model.boards.length > bare.model.boards.length, "带骨架后板应来自骨架布局")
})
