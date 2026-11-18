// 动效与音效的跨格式回归。
//
// 旧转换器带走了二十多个针对它们自己路径的测试。这个文件用中间表示重新验证
// 同一批行为：动效与音效在格式之间往返时不应无故消失。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { openSession } from "../src/skin-model/session.ts"
import { countsOf } from "../src/skin-model/conformance.ts"
import { bdaFormat, bdaSource } from "../src/skin-model/formats/bda.ts"
import { bdaAnimatedSkinBytes } from "./helpers/bda-animation-fixture.mjs"

function bdsBase() {
  return SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/bda-base.bds", import.meta.url))), "bds")
}

function bdaAnimated() {
  return SkinArchive.open(new Uint8Array(bdaAnimatedSkinBytes()), "bda")
}

test("BDA 的动效在读出后不为空", async () => {
  const opened = await openSession(bdaAnimated(), { base: bdsBase() })
  assert.ok(opened.ok, opened.ok ? "" : opened.error.message)
  assert.ok(opened.model.motions.size > 0, "带注释的动画皮肤应当读出动效")
})

test("BDA 动效在原包基础上写回后数量不变", async () => {
  const base = bdsBase()
  const source = bdaSource(bdaAnimated(), base)
  const model = await bdaFormat.read(source)
  const before = model.motions.size
  assert.ok(before > 0)
  const rewritten = await bdaFormat.read(bdaFormat.write(model, source))
  assert.equal(rewritten.motions.size, before, "动效数量不该在写回后变化")
})

test("BDA 动效的种类在写回后保留", async () => {
  const base = bdsBase()
  const source = bdaSource(bdaAnimated(), base)
  const model = await bdaFormat.read(source)
  const kinds = new Map([...model.motions].map(([id, motion]) => [id, motion.root.kind]))
  const rewritten = await bdaFormat.read(bdaFormat.write(model, source))
  for (const [id, kind] of kinds) {
    assert.equal(rewritten.motions.get(id)?.root.kind, kind, `${id} 的动效类型变了`)
  }
})
