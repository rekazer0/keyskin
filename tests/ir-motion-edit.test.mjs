// 动效的模型编辑：改关键帧、时间轴与作用对象，全部落在 MotionNode 上。
import assert from "node:assert/strict"
import test from "node:test"
import { emptyModel } from "../src/skin-model/model.ts"
import {
  addKeyframe, firstTrackOf, keyframesOf, motionDuration, motionNodeAt, motionNodes,
  motionViews, removeKeyframe, setKeyframe, setMotionTarget, setMotionTiming,
} from "../src/skin-model/motion-edit.ts"

function model() {
  const skin = emptyModel({ theme: "light", orientation: "port" })
  skin.motions.set("m1", {
    kind: "track",
    target: { subject: "key", name: "KEY1", property: "alpha" },
    keyframes: [{ time: 0, value: 255 }, { time: 100, value: 0 }],
    timeline: { delay: 0, duration: 100, repeat: 1, reverse: false, clear: false },
  })
  skin.motions.set("m2", {
    kind: "group",
    method: "sequential",
    children: [
      { kind: "frames", frames: [{ image: "a.webp", duration: 40 }] },
      {
        kind: "track",
        target: { subject: "panel", property: "scale" },
        keyframes: [{ time: 0, value: 1 }, { time: 200, value: 2 }],
      },
    ],
  })
  skin.motions.set("m3", { kind: "opaque", format: "bda.lottie", blob: {} })
  return skin
}

test("节点路径与关键帧读取", () => {
  const skin = model()
  const group = skin.motions.get("m2")
  assert.deepEqual(motionNodes(group).map((ref) => ref.node.kind), ["group", "frames", "track"])
  assert.deepEqual(motionNodeAt(group, [1])?.kind, "track")
  assert.equal(motionNodeAt(group, [9]), undefined)
  assert.deepEqual(keyframesOf(motionNodeAt(group, [1])), [{ time: 0, value: 1 }, { time: 200, value: 2 }])
  assert.equal(keyframesOf(group).length, 0, "组合节点自身没有关键帧")
  assert.deepEqual(firstTrackOf(group)?.path, [1])
  assert.equal(motionDuration(group), 0)
})

test("改关键帧落在 MotionNode.track.keyframes 上", () => {
  const skin = model()
  const next = setKeyframe(skin, "m1", [], 1, { value: 128 })
  const node = next.motions.get("m1")
  assert.equal(node.kind, "track")
  assert.deepEqual(node.keyframes, [{ time: 0, value: 255 }, { time: 100, value: 128 }])
  // 原模型不动。
  assert.equal(skin.motions.get("m1").keyframes[1].value, 0)
})

test("改关键帧时间、嵌套路径与非法输入", () => {
  const skin = model()
  const nested = setKeyframe(skin, "m2", [1], 0, { time: 50, value: 1.5 })
  const child = motionNodeAt(nested.motions.get("m2"), [1])
  assert.deepEqual(child.keyframes[0], { time: 50, value: 1.5 })
  assert.equal(setKeyframe(skin, "m1", [], 9, { value: 1 }), skin, "越界不该造新模型")
  assert.equal(setKeyframe(skin, "m1", [], 0, { value: Number.NaN }), skin, "非有限值被拒绝")
  assert.equal(setKeyframe(skin, "missing", [], 0, { value: 1 }), skin)
  assert.equal(setKeyframe(skin, "m3", [], 0, { value: 1 }), skin, "不透明节点没有关键帧")
})

test("增删关键帧", () => {
  const skin = model()
  const added = addKeyframe(skin, "m1", [], { time: 100, value: 0 })
  assert.equal(added.motions.get("m1").keyframes.length, 3)
  const removed = removeKeyframe(added, "m1", [], 1)
  assert.deepEqual(removed.motions.get("m1").keyframes, [{ time: 0, value: 255 }, { time: 100, value: 0 }])
  const minimal = removeKeyframe(removeKeyframe(removed, "m1", [], 0), "m1", [], 0)
  assert.equal(minimal.motions.get("m1").keyframes.length, 1, "轨道至少保留一个关键帧")
})

test("时间轴与作用对象", () => {
  const skin = model()
  const timed = setMotionTiming(skin, "m1", { duration: 300, repeat: 2 })
  assert.deepEqual(timed.motions.get("m1").timeline, { delay: 0, duration: 300, repeat: 2, reverse: false, clear: false })
  const noop = setMotionTiming(skin, "m1", { duration: 100 })
  assert.equal(noop, skin)
  const targeted = setMotionTarget(skin, "m1", [], { name: "KEY2", property: "scale" })
  const node = targeted.motions.get("m1")
  assert.equal(node.target.name, "KEY2")
  assert.equal(node.target.property, "scale")
  assert.equal(setMotionTarget(skin, "m2", [0], { name: "x" }), skin, "非轨道节点没有作用对象")
})

test("列表投影给出节点种类、时长与绑定数", () => {
  const skin = model()
  const views = motionViews(skin)
  assert.deepEqual(views.map((view) => [view.id, view.kind, view.count]), [["m1", "track", 2], ["m2", "group", 2], ["m3", "opaque", 0]])
  assert.equal(views[0].duration, 100)
  assert.equal(views[0].target?.property, "alpha")
  assert.equal(views[2].format, "bda.lottie")
  assert.equal(views[0].bindings, 0)
})
