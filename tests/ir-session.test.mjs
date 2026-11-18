// 会话层：应用侧的打开、保存与换格式入口。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { capabilitiesOf, convertSession, openSession, saveSession } from "../src/skin-model/session.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { sxiFixture } from "./helpers/sxi-fixture.mjs"

function bds() {
  return SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
}

function sxi() {
  return SkinArchive.open(new Uint8Array(sxiFixture()), "bds")
}

test("打开皮肤返回格式与模型", async () => {
  const opened = await openSession(bds())
  assert.ok(opened.ok)
  assert.equal(opened.format, "bds")
  assert.ok(opened.model.boards.length > 0)
  assert.ok(capabilitiesOf(opened.model).length > 0)
})

test("无法识别时返回错误对象而不是抛错", async () => {
  const empty = SkinArchive.open(new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "bds")
  const opened = await openSession(empty)
  assert.equal(opened.ok, false)
  assert.equal(opened.error.kind, "unrecognized")
})

test("搜狗包缺骨架时报缺少基础，而不是识别失败", async () => {
  const bare = SkinArchive.fromSourceFiles([{ path: "phoneTheme.ini", data: new TextEncoder().encode("[General]\nskin_name=x\n") }])
  const opened = await openSession(bare)
  assert.equal(opened.ok, false)
  assert.equal(opened.error.kind, "missing-basis")
})

test("保存成同格式后能再打开", async () => {
  const opened = await openSession(bds())
  assert.ok(opened.ok)
  const saved = await saveSession(opened.model, "bds", opened.source)
  assert.ok(saved.ok)
  const again = await openSession(SkinArchive.open(saved.bytes, "bds"))
  assert.ok(again.ok)
  assert.equal(again.model.boards.length, opened.model.boards.length)
})

test("换格式转换返回字节与损失报告", async () => {
  const saved = await convertSession(bds(), "sxi")
  assert.ok(saved.ok)
  assert.ok(saved.bytes.byteLength > 0)
  assert.ok(Array.isArray(saved.warnings))
  const opened = await openSession(SkinArchive.open(saved.bytes, "bds"))
  assert.ok(opened.ok)
  assert.equal(opened.format, "sxi")
  assert.ok(opened.model.boards[0].keys.length > 0)
})

test("手心皮肤经会话层打开并保存回去", async () => {
  const opened = await openSession(sxi())
  assert.ok(opened.ok)
  assert.equal(opened.format, "sxi")
  const saved = await saveSession(opened.model, "sxi", opened.source)
  assert.ok(saved.ok)
  const again = await openSession(SkinArchive.open(saved.bytes, "bds"))
  assert.ok(again.ok)
  assert.equal(again.model.boards[0].keys.length, opened.model.boards[0].keys.length)
})

test("BDA 保存需要骨架，缺了回来的是失败", async () => {
  const archive = SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/default-template.bda", import.meta.url))), "bda")
  const opened = await openSession(archive)
  assert.equal(opened.ok, false)
  assert.equal(opened.error.kind, "missing-basis")
})
