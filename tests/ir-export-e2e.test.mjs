// 跨格式导出的端到端：用真实皮肤包验证新的 IR 导出路径。
//
// 旧导出是一条按格式对展开的分支树，删掉之后必须有测试证明：
// 每种转换都能产出可以再读回来的包，且按键数不丢。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { convertSession, openSession } from "../src/skin-model/session.ts"

function bytesOf(path) {
  return new Uint8Array(readFileSync(new URL(`../public/${path}`, import.meta.url)))
}

function bdsArchive() {
  return SkinArchive.open(bytesOf("bda-base.bds"), "bds")
}

function bdaArchive() {
  return SkinArchive.open(bytesOf("default-template.bda"), "bda")
}

test("BDS 转到 SXI 后能读回同样多的按键", async () => {
  const source = bdsArchive()
  const opened = await openSession(source)
  assert.ok(opened.ok)
  const saved = await convertSession(source, "sxi")
  assert.ok(saved.ok, saved.ok ? "" : saved.error.message)
  const again = await openSession(SkinArchive.open(saved.bytes, "bds"))
  assert.ok(again.ok)
  assert.equal(again.format, "sxi")
  assert.equal(again.model.boards[0].keys.length, opened.model.boards[0].keys.length)
})

test("BDS 转到 BDA 需要布局骨架，转出的包带外观配置", async () => {
  const source = bdsArchive()
  const saved = await convertSession(source, "bda", { base: source })
  assert.ok(saved.ok, saved.ok ? "" : saved.error.message)
  const archive = SkinArchive.open(saved.bytes, "bda")
  assert.ok(archive.names().some((name) => /appearanceConfig$/.test(name)), "没有生成外观配置")
})

test("BDA 转到 BDS 后能按百度布局读回按键", async () => {
  const source = bdaArchive()
  const saved = await convertSession(source, "bds", { base: bdsArchive() })
  assert.ok(saved.ok, saved.ok ? "" : saved.error.message)
  const again = await openSession(SkinArchive.open(saved.bytes, "bds"))
  assert.ok(again.ok)
  assert.equal(again.format, "bds")
  assert.ok(again.model.boards.length > 0)
  assert.ok(again.model.boards[0].keys.length > 0)
})

test("转换后的包自检没有错误", async () => {
  const source = bdsArchive()
  const saved = await convertSession(source, "sxi")
  assert.ok(saved.ok)
  const again = await openSession(SkinArchive.open(saved.bytes, "bds"))
  assert.ok(again.ok)
  const { validateModel } = await import("../src/skin-model/validate.ts")
  const report = validateModel(again.model)
  assert.equal(report.errors, 0, report.issues.slice(0, 3).map((issue) => `${issue.code} ${issue.subject}`).join("；"))
})

test("不支持的目标格式会带损失报告，不静默成功", async () => {
  const source = bdsArchive()
  const opened = await openSession(source)
  assert.ok(opened.ok)
  const saved = await convertSession(source, "bda", { base: source })
  assert.ok(saved.ok)
  // BDA 表达不了布局，损失报告必须非空
  assert.ok(saved.loss.items.length > 0, "损失报告为空，说明能力表没有如实描述")
})
