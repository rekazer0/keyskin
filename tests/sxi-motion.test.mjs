// 手心动画 ↔ IR 动效：`ss_2` 的动画家族、`ss_1.s_5` 的时机绑定。
import assert from "node:assert/strict"
import test from "node:test"
import { motionsOfSkin, skinAnimationsOf } from "../src/skin-model/formats/sxi/motion.ts"

/** 一个最小的手心皮肤：两个动画（属性变化与帧序列），样式 7 按下播放 100。 */
function skin() {
  return {
    default: {
      light: {
        s_info: {
          ss_2: {
            "100": { a1: { b: { c: 0, t: 0 }, from: "255", to: "0", duration: "200", delay: "0", style: "1" } },
            "200": { af2: { type: "0", file: "anim.webp", psr: ["100", "200"], d: "300", delay: "0" } },
          },
          ss_1: { "7": { s_5: { "1": "100" } }, "8": { s_5: { "3": "200" } } },
        },
      },
    },
  }
}

test("手心动画读成动效：属性变化成轨道，帧序列成帧", () => {
  const motions = motionsOfSkin(skin(), "light", "port")
  assert.equal(motions.size, 2)
  const alpha = motions.get("100")
  assert.equal(alpha.kind, "track")
  assert.equal(alpha.target.property, "alpha")
  assert.deepEqual(alpha.vector.from, [[255, 255], [255, 255]])
  assert.deepEqual(alpha.vector.to, [[0, 0], [0, 0]])
  assert.equal(alpha.easing.kind, "ease-out")
  assert.equal(alpha.timeline.duration, 0.2)
  assert.deepEqual(alpha.bindings.map((binding) => binding.slot), ["press"])

  const frames = motions.get("200")
  assert.equal(frames.kind, "frames")
  assert.ok(frames.frames.length >= 1)
  assert.equal(frames.frames[0].image, "anim.webp")
  assert.deepEqual(frames.bindings.map((binding) => binding.slot), ["show"])
})

test("动效写回手心动画：家族与时长都回来", () => {
  const motions = motionsOfSkin(skin(), "light", "port")
  const built = skinAnimationsOf(motions)
  assert.ok(built.animations["100"].a1)
  assert.equal(built.animations["100"].a1.duration, "200")
  assert.equal(built.animations["100"].a1.from, "255")
  assert.equal(built.animations["100"].a1.to, "0")
  assert.ok(built.animations["200"].af2)
  assert.equal(built.animations["200"].af2.file, "anim.webp")
  assert.deepEqual(built.bindings.get("7"), { "1": "100" })
  assert.deepEqual(built.bindings.get("8"), { "3": "200" })
  assert.deepEqual(built.warnings, [])
})

test("写回的动画再读出来，类型与时长不变", () => {
  const before = motionsOfSkin(skin(), "light", "port")
  const round = motionsOfSkin({ default: { light: { s_info: { ss_2: skinAnimationsOf(before).animations } } } }, "light", "port")
  assert.equal(round.size, before.size)
  for (const [id, motion] of before) {
    assert.equal(round.get(id)?.kind, motion.kind, `${id} 的类型变了`)
    assert.equal(round.get(id)?.timeline.duration, motion.timeline.duration, `${id} 的时长变了`)
  }
})
