// 手心动画 ↔ IR 动效：`ss_2` 的 `a1` 属性过渡与 `a3` 组合。
import assert from "node:assert/strict"
import test from "node:test"
import { motionsOfTheme, motionsJson } from "../src/skin-model/formats/sxi/motion.ts"

function skin() {
  return {
    100: {
      id: "ANIM100",
      a1: {
        b: { t: 4, c: 0, count: 1, back: false, clear: true },
        style: 1,
        from_p: [100, 100],
        to_p: [90, 90],
        duration: 40,
        c_delay: 10,
      },
    },
    200: {
      id: "ANIM200",
      a3: { a_method: "sequential", animations: [100, 101] },
    },
  }
}

test("a1 读成两点轨道，a3 读成组合", () => {
  const motions = motionsOfTheme(skin(), "light")
  const track = motions.get("sxi:light:ss_2:100")
  assert.equal(track.kind, "track")
  assert.equal(track.target.property, "scale")
  assert.deepEqual(track.vector.from, [[100, 100], [100, 100]])
  assert.deepEqual(track.vector.to, [[90, 90], [90, 90]])
  assert.equal(track.easing.kind, "ease-in")
  assert.equal(track.timeline.duration, 0.04)
  assert.equal(track.timeline.delay, 0.01)
  const group = motions.get("sxi:light:ss_2:200")
  assert.equal(group.kind, "group")
  assert.equal(group.method, "sequential")
  assert.deepEqual(group.children.map((child) => child.id), ["sxi:light:ss_2:100", "sxi:light:ss_2:101"])
})

test("写回的动画家族、时长与组合方式都回来", () => {
  const motions = motionsOfTheme(skin(), "light")
  const rebuilt = motionsJson("light", motions, skin())
  assert.equal(rebuilt["100"].a1.duration, 40)
  assert.equal(rebuilt["100"].a1.c_delay, 10)
  assert.deepEqual(rebuilt["100"].a1.from_p, [100, 100])
  assert.deepEqual(rebuilt["100"].a1.to_p, [90, 90])
  assert.equal(rebuilt["200"].a3.a_method, "sequential")
  assert.deepEqual(rebuilt["200"].a3.animations, [100, 101])
})

test("动效写回后再读，类型与时长不变", () => {
  const before = motionsOfTheme(skin(), "light")
  const round = motionsOfTheme(motionsJson("light", before, skin()), "light")
  assert.equal(round.size, before.size)
  for (const [id, motion] of before) {
    assert.equal(round.get(id).kind, motion.kind, `${id} 的类型变了`)
    assert.equal(round.get(id).timeline.duration, motion.timeline.duration, `${id} 的时长变了`)
  }
})

test("不认识的动画家族原样保留成不透明节点", () => {
  const motions = motionsOfTheme({ 300: { id: "ANIM300", a4: { aera: [0, 0, 1, 1], count: 3 } } }, "light")
  const node = motions.get("sxi:light:ss_2:300")
  assert.equal(node.kind, "opaque")
  assert.equal(node.format, "sxi.a4")
  assert.deepEqual((motionsJson("light", motions, { 300: { id: "ANIM300", a4: { count: 3 } } }))["300"].a4, { aera: [0, 0, 1, 1], count: 3 })
})
