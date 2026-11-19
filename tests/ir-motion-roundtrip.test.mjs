// 动效与音效的跨格式回归。
//
// 旧转换器带走了二十多个针对它们自己路径的测试。这个文件用中间表示重新验证
// 同一批行为：动效与音效在格式之间往返时不应无故消失。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { convertSession, openSession } from "../src/skin-model/session.ts"
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
  const rewritten = await bdaFormat.read(bdaSource(bdaFormat.write(model).archive, base))
  assert.equal(rewritten.motions.size, before, "动效数量不该在写回后变化")
})

test("BDA 动效的种类在写回后保留", async () => {
  const base = bdsBase()
  const source = bdaSource(bdaAnimated(), base)
  const model = await bdaFormat.read(source)
  const kinds = new Map([...model.motions].map(([id, motion]) => [id, motion.root.kind]))
  const rewritten = await bdaFormat.read(bdaSource(bdaFormat.write(model).archive, base))
  for (const [id, kind] of kinds) {
    assert.equal(rewritten.motions.get(id)?.root.kind, kind, `${id} 的动效类型变了`)
  }
})

test("跨格式往返后动效键与类型都不变", async () => {
  const base = bdsBase()
  const source = bdaSource(bdaAnimated(), base)
  const before = await openSession(bdaAnimated(), { base })
  assert.ok(before.ok)
  const saved = await convertSession(bdaAnimated(), "bda", { base })
  assert.ok(saved.ok, saved.ok ? "" : saved.error.message)
  const after = await openSession(SkinArchive.open(saved.bytes, "bda"), { base })
  assert.ok(after.ok)
  assert.deepEqual(
    [...after.model.motions.keys()].sort(),
    [...before.model.motions.keys()].sort(),
    "往返后动效键变了",
  )
  const rebuild = await bdaFormat.read(bdaSource(bdaFormat.write(await bdaFormat.read(source)).archive, base))
  for (const [id, motion] of rebuild.motions) {
    assert.equal(motion.root.kind, (await bdaFormat.read(source)).motions.get(id)?.root.kind, `${id} 的类型变了`)
  }
})

test("Lottie 与视频动效保留媒体类型，不被写成普通帧图", async () => {
  const base = bdsBase()
  const source = bdaSource(bdaAnimated(), base)
  const model = await bdaFormat.read(source)
  const media = [...model.motions].flatMap(([id, motion]) => (
    motion.root.kind === "frames" && motion.root.media ? [[id, motion.root.media]] : []
  ))
  assert.ok(media.some(([, kind]) => kind === "lottie"), "夹具里应有 Lottie 动效")
  assert.ok(media.some(([, kind]) => kind === "video"), "夹具里应有视频动效")
  const back = await bdaFormat.read(bdaSource(bdaFormat.write(model).archive, base))
  for (const [id, kind] of media) {
    const root = back.motions.get(id)?.root
    assert.equal(root?.kind === "frames" ? root.media : undefined, kind, `${id} 的媒体类型丢了`)
  }
})

test("动效绑定在写回后保留", async () => {
  const base = bdsBase()
  const source = bdaSource(bdaAnimated(), base)
  const model = await bdaFormat.read(source)
  const before = [...model.motions.values()].reduce((total, motion) => total + motion.bindings.length, 0)
  assert.ok(before > 0, "夹具应当带动效绑定")
  const back = await bdaFormat.read(bdaSource(bdaFormat.write(model).archive, base))
  const after = [...back.motions.values()].reduce((total, motion) => total + motion.bindings.length, 0)
  assert.equal(after, before, "绑定数在写回后变了")
  const sample = [...back.motions.values()].find((motion) => motion.bindings.length)
  assert.equal(sample.bindings[0].slot, "press")
  assert.ok(sample.bindings[0].target)
})
