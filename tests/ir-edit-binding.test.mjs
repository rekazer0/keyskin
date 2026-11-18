// 字段改动 → 模型操作的分派。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds.ts"
import { findKey } from "../src/skin-model/edit.ts"
import { actionOfText, applyFieldChange, canApplyField, editableFields } from "../src/skin-model/edit-binding.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"

const BOARD = "light/skin/port/py_26.ini"

async function model() {
  return bdsFormat.read(bdsSource(SkinArchive.open(new Uint8Array(bdsFixture()), "bds")))
}

test("几何字段只改一个分量，其余不动", async () => {
  const before = await model()
  const original = findKey(before, BOARD, "KEY1").key.rect
  const after = applyFieldChange(before, { boardId: BOARD, keyId: "KEY1", field: "x", value: 400 })
  const rect = findKey(after, BOARD, "KEY1").key.rect
  assert.equal(rect.position.x, 400)
  assert.equal(rect.position.y, original.position.y)
  assert.deepEqual(rect.size, original.size)
})

test("尺寸字段改高不改宽", async () => {
  const before = await model()
  const after = applyFieldChange(before, { boardId: BOARD, keyId: "KEY1", field: "height", value: 55 })
  const rect = findKey(after, BOARD, "KEY1").key.rect
  assert.equal(rect.size.height, 55)
  assert.equal(rect.size.width, findKey(before, BOARD, "KEY1").key.rect.size.width)
})

test("触摸区字段写进触摸矩形，不动主矩形", async () => {
  const before = await model()
  const after = applyFieldChange(before, { boardId: BOARD, keyId: "KEY1", field: "touch.x", value: 3 })
  const key = findKey(after, BOARD, "KEY1").key
  assert.equal(key.touchRect?.position.x, 3)
  assert.deepEqual(key.rect, findKey(before, BOARD, "KEY1").key.rect)
})

test("手势字段绑定动作，空值解除", async () => {
  const before = await model()
  const bound = applyFieldChange(before, { boardId: BOARD, keyId: "KEY1", field: "action.long-press", value: "删除" })
  assert.deepEqual(findKey(bound, BOARD, "KEY1").key.actions["long-press"], { kind: "delete" })
  const cleared = applyFieldChange(bound, { boardId: BOARD, keyId: "KEY1", field: "action.long-press", value: "" })
  assert.equal(findKey(cleared, BOARD, "KEY1").key.actions["long-press"], undefined)
})

test("样式字段改引用，空值清掉", async () => {
  const before = await model()
  const changed = applyFieldChange(before, { boardId: BOARD, keyId: "KEY1", field: "style.back", value: "7" })
  assert.equal(findKey(changed, BOARD, "KEY1").key.style.back, "7")
  const cleared = applyFieldChange(changed, { boardId: BOARD, keyId: "KEY1", field: "style.back", value: "" })
  assert.equal(findKey(cleared, BOARD, "KEY1").key.style.back, undefined)
})

test("前景槽位整体替换", async () => {
  const before = await model()
  const after = applyFieldChange(before, { boardId: BOARD, keyId: "KEY1", field: "style.fore.0", value: "9" })
  assert.deepEqual(findKey(after, BOARD, "KEY1").key.style.fore, ["9"])
})

test("非法值不改模型", async () => {
  const before = await model()
  assert.equal(applyFieldChange(before, { boardId: BOARD, keyId: "KEY1", field: "x", value: undefined }), before)
  assert.equal(applyFieldChange(before, { boardId: BOARD, keyId: "KEY1", field: "height", value: "abc" }), before)
  assert.equal(applyFieldChange(before, { boardId: "不存在", keyId: "KEY1", field: "x", value: 1 }), before)
})

test("动作文本的解析覆盖常用写法", () => {
  assert.deepEqual(actionOfText("空格"), { kind: "text", value: " " })
  assert.deepEqual(actionOfText("回车"), { kind: "enter" })
  assert.deepEqual(actionOfText("F31"), { kind: "system", code: "F31" })
  assert.deepEqual(actionOfText("q"), { kind: "text", value: "q" })
  assert.equal(actionOfText(""), undefined)
})

test("可编辑字段清单与分派一致", async () => {
  for (const field of editableFields()) assert.equal(canApplyField(field), true, `${field} 不在分派里`)
  assert.equal(canApplyField("unknown"), false)
})

test("改过的几何写回归档后能读回", async () => {
  const { openSession, saveSession } = await import("../src/skin-model/session.ts")
  const base = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  const opened = await openSession(base)
  assert.ok(opened.ok)
  const boardId = opened.model.boards[0].id
  const keyId = opened.model.boards[0].keys[0].id
  const original = findKey(opened.model, boardId, keyId).key.rect.position.x
  const edited = applyFieldChange(opened.model, { boardId, keyId, field: "x", value: original + 100 })
  const saved = await saveSession(edited, "bds", opened.source)
  assert.ok(saved.ok)
  const again = await openSession(SkinArchive.open(saved.bytes, "bds"))
  assert.ok(again.ok)
  assert.equal(findKey(again.model, boardId, keyId).key.rect.position.x, original + 100, "改动没有落盘")
})

test("改过的手势动作写回归档后能读回", async () => {
  const { openSession, saveSession } = await import("../src/skin-model/session.ts")
  const base = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  const opened = await openSession(base)
  assert.ok(opened.ok)
  const boardId = opened.model.boards[0].id
  const keyId = opened.model.boards[0].keys[0].id
  const edited = applyFieldChange(opened.model, { boardId, keyId, field: "action.press", value: "回车" })
  const saved = await saveSession(edited, "bds", opened.source)
  assert.ok(saved.ok)
  const again = await openSession(SkinArchive.open(saved.bytes, "bds"))
  assert.ok(again.ok)
  assert.deepEqual(findKey(again.model, boardId, keyId).key.actions.press, { kind: "enter" }, "动作改动没有落盘")
})
