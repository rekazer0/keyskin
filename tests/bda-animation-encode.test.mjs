// BDA 动画效果定点写入：每个可编辑字段 patch 后 decodeBdaAnimation 必须读回期望值，
// 且未命中的 protobuf 字段（含未知字段）字节保持不变。样例字节按 animation.proto 的字段号手写。
import assert from "node:assert/strict"
import test from "node:test"
import { decodeBdaAnimation } from "../src/bda-decode.ts"
import { applyBdaAnimationEffects, encodedField, join as joinFields, rawFields, updateBdaAnimationEffect, updateBdaAnimationFrame } from "../src/bda-encode.ts"
import { SkinArchive } from "../src/skin.ts"
import { bdaAnimatedSkinBytes } from "./helpers/bda-animation-fixture.mjs"

const textEncoder = new TextEncoder()

const varint = (value) => {
  let current = BigInt(value >>> 0)
  const output = []
  do {
    let byte = Number(current & 0x7fn)
    current >>= 7n
    if (current) byte |= 0x80
    output.push(byte)
  } while (current)
  return Uint8Array.from(output)
}

const join = (parts) => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

const field = (number, wire, payload) => join([
  varint(number * 8 + wire),
  ...(wire === 2 ? [varint(payload.length)] : []),
  payload,
])
const v = (number, value) => field(number, 0, varint(value))
const bool = (number, value) => v(number, value ? 1 : 0)
const message = (number, payload) => field(number, 2, payload)
const string = (value) => textEncoder.encode(value)
const float32 = (number, value) => {
  const payload = new Uint8Array(4)
  new DataView(payload.buffer).setFloat32(0, value, true)
  return field(number, 5, payload)
}

/** RandomValue { min 1, max 2 } */
const randomValue = (min, max) => join([v(1, min), v(2, max)])
/** RandomPoint { randomX 1, randomY 2 } */
const randomPoint = (x, y) => join([message(1, randomValue(x[0], x[1])), message(2, randomValue(y[0], y[1]))])
/** Point { x 1, y 2 } */
const point = (x, y) => join([v(1, x), v(2, y)])
/** IntpolXY { intpolX 1, intpolY 2 } */
const intpolXY = (x, y) => join([v(1, x), v(2, y)])
/** Range { location 1, length 2 }，BDA 用起点 + 长度表示范围 */
const range = (from, to) => join([float32(1, from), float32(2, to - from)])
/** EdgeInsets { top 1, left 2, bottom 3, right 4 } */
const edgeInsets = (left, top, right, bottom) => join([
  float32(1, top), float32(2, left), float32(3, bottom), float32(4, right),
])
const resource = (type, resourceID) => join([v(1, type), message(2, string(resourceID))])
const mapEntry = (number, key, value) => message(number, join([message(1, string(key)), message(2, value)]))

const EFFECT_FIELD = { group: 3, alpha: 4, scale: 5, shift: 6, rotate: 7, frame: 8, image: 9, emitter: 10, lottie: 11, video: 13 }
const effectEntry = (kind, key, payload) => mapEntry(EFFECT_FIELD[kind], key, payload)

const common = ({ repeatCount = 1, repeatMode = 0, delay = 0, removeOnFinish = false, duration = 200, interpolation = 0 } = {}) => join([
  v(1, repeatCount), v(2, repeatMode), v(3, delay), bool(4, removeOnFinish), v(7, duration), v(8, interpolation),
])

/** 一份带未知字段、覆盖全部 10 种效果的 animationConfig。 */
function sampleAnimation() {
  const alpha = join([common({ repeatCount: 2, repeatMode: 1, delay: 100, duration: 300, interpolation: 1 }),
    message(5, randomValue(0, 100)), message(6, randomValue(20, 100)), message(88, string("alpha-unknown"))])
  const scale = join([common({ duration: 500, interpolation: 3 }),
    message(5, randomPoint([50, 100], [50, 100])), message(6, randomPoint([100, 120], [100, 120])),
    message(9, point(10, 20)), message(10, point(50, 60)), message(11, intpolXY(1, 2)), message(88, string("scale-unknown"))])
  const shift = join([common({ duration: 220 }),
    message(5, randomPoint([0, 10], [0, 20])), message(6, randomPoint([10, 20], [20, 40])), message(11, intpolXY(0, 4))])
  const shiftPx = join([common({ duration: 220 }),
    message(9, randomPoint([10, 20], [30, 40])), message(10, randomPoint([50, 60], [70, 80]))])
  const rotate = join([common({ duration: 250, removeOnFinish: true }),
    message(5, randomValue(0, 0)), message(6, randomValue(90, 90)), message(9, point(4, 6)), message(10, point(50, 50))])
  const group = join([v(1, 0), v(2, 2), v(3, 1), bool(4, false), v(5, 50),
    message(6, join([v(1, 1), message(2, string("alpha:press"))]))])
  const frame = join([v(1, 2), bool(2, true), message(3, resource(3, "frame.png")), v(4, 1)])
  const lottie = join([v(1, 1), bool(2, false), message(3, resource(9, "lottie.json")), message(88, string("lottie-unknown"))])
  const video = join([v(1, 1), bool(2, false), message(3, resource(6, "clip.mp4")), v(4, 0), message(5, resource(6, "poster.png"))])
  const image = join([v(1, 3), v(2, 1), bool(4, false),
    message(5, join([message(1, resource(1, "a.png")), v(2, 100)])),
    message(5, join([message(1, resource(1, "b.png")), v(2, 120)])),
    bool(6, true), v(7, 0)])
  const emitter = join([
    v(3, 1), v(4, 0), bool(5, true), float32(6, 1500), v(7, 20), v(8, 30),
    v(9, 0), v(10, 1), v(11, 0),
    message(12, edgeInsets(1, 2, 3, 4)),
    message(13, resource(1, "particle.png")),
    message(14, range(10, 15)), message(15, range(-45, 45)), message(16, range(0, 90)),
    message(17, range(50, 150)), message(18, range(-10, 10)), message(19, range(100, 100)),
    message(20, range(-5, 5)), message(21, range(0, 200)), message(22, range(0, 360)),
    message(23, range(0, 50)), message(24, range(-180, 180)),
    message(25, message(1, join([v(1, 0), message(2, point(0, 0))]))),
    v(26, 2),
  ])
  const bindings = join([
    message(1, join([
      v(1, 0), v(2, 1), message(4, string("alpha:press")), v(5, 1), message(6, string("KEY_A")),
    ])),
    message(2, join([
      v(1, 0), v(2, 1), message(3, string("image:seq")), v(4, 3), bool(6, true),
    ])),
  ])
  const bytes = join([
    mapEntry(1, "KEY_A", bindings),
    effectEntry("group", "g1", group),
    effectEntry("alpha", "press", alpha),
    effectEntry("scale", "pop", scale),
    effectEntry("shift", "slide", shift),
    effectEntry("shift", "slidePx", shiftPx),
    effectEntry("rotate", "spin", rotate),
    effectEntry("frame", "f1", frame),
    effectEntry("image", "seq", image),
    effectEntry("emitter", "spark", emitter),
    effectEntry("lottie", "lo", lottie),
    effectEntry("video", "vid", video),
    v(12, 1080),
    v(77, 12345),
  ])
  return bytes
}

const decode = (bytes) => decodeBdaAnimation(bytes)
const effect = (bytes, effectID) => decode(bytes).effects.get(effectID)

function entryBytes(bytes, effectID) {
  const [kind, key] = effectID.split(":")
  const entry = rawFields(bytes).find((item) => item.number === EFFECT_FIELD[kind] && item.bytes &&
    rawFields(item.bytes).find((child) => child.number === 1)?.bytes &&
    new TextDecoder().decode(rawFields(item.bytes).find((child) => child.number === 1).bytes) === key)
  assert.ok(entry?.bytes, `缺少效果 ${effectID}`)
  return entry.bytes
}

function effectMessageBytes(bytes, effectID) {
  const entry = rawFields(entryBytes(bytes, effectID))
  return entry.find((item) => item.number === 2).bytes
}

function fieldPayload(bytes, number) {
  return rawFields(bytes).find((item) => item.number === number)?.bytes
}

function patch(bytes, effectID, property, value) {
  return updateBdaAnimationEffect(bytes, effectID, property, value)
}

test("样例解码覆盖全部效果类型与绑定", () => {
  const animation = decode(sampleAnimation())
  assert.equal(animation.designWidth, 1080)
  assert.deepEqual(animation.targets, ["KEY_A"])
  assert.equal(animation.effects.size, 11)
  assert.deepEqual([...animation.effects.keys()].sort(), [
    "alpha:press", "emitter:spark", "frame:f1", "group:g1", "image:seq", "lottie:lo",
    "rotate:spin", "scale:pop", "shift:slide", "shift:slidePx", "video:vid",
  ].sort())
  const bindings = animation.targetBindings.get("KEY_A")
  assert.equal(bindings.length, 2)
  assert.equal(bindings[0].event, 1)
  assert.equal(bindings[0].condition, "KEY_A")
  assert.equal(bindings[1].isolated, true)
  assert.equal(bindings[1].removeOnInteraction, true)
  assert.equal(animation.sequences.get("seq").frames.length, 2)
})

test("变换类效果：公共字段、标量范围与双轴范围都能写回", () => {
  let bytes = sampleAnimation()
  bytes = patch(bytes, "alpha:press", "repeatCount", 4)
  bytes = patch(bytes, "alpha:press", "repeatMode", 0)
  bytes = patch(bytes, "alpha:press", "delay", 250)
  bytes = patch(bytes, "alpha:press", "removeOnFinish", true)
  bytes = patch(bytes, "alpha:press", "duration", 400)
  bytes = patch(bytes, "alpha:press", "interpolation", 4)
  bytes = patch(bytes, "alpha:press", "fromMin", 10)
  bytes = patch(bytes, "alpha:press", "fromMax", 20)
  bytes = patch(bytes, "alpha:press", "toMin", 30)
  bytes = patch(bytes, "alpha:press", "toMax", 40)
  const alpha = effect(bytes, "alpha:press")
  assert.equal(alpha.repeatCount, 4)
  assert.equal(alpha.repeatMode, 0)
  assert.equal(alpha.delay, 250)
  assert.equal(alpha.removeOnFinish, true)
  assert.equal(alpha.duration, 400)
  assert.equal(alpha.interpolation, 4)
  assert.deepEqual(alpha.from, [[10, 20], [10, 20]])
  assert.deepEqual(alpha.to, [[30, 40], [30, 40]])

  bytes = patch(bytes, "scale:pop", "fromXMin", 60)
  bytes = patch(bytes, "scale:pop", "fromXMax", 70)
  bytes = patch(bytes, "scale:pop", "fromYMin", 80)
  bytes = patch(bytes, "scale:pop", "fromYMax", 90)
  bytes = patch(bytes, "scale:pop", "toXMin", 110)
  bytes = patch(bytes, "scale:pop", "toYMax", 140)
  const scale = effect(bytes, "scale:pop")
  assert.deepEqual(scale.from, [[60, 70], [80, 90]])
  assert.deepEqual(scale.to, [[110, 120], [100, 140]])

  bytes = patch(bytes, "rotate:spin", "toMin", 180)
  bytes = patch(bytes, "rotate:spin", "toMax", 270)
  bytes = patch(bytes, "rotate:spin", "fromMin", -45)
  bytes = patch(bytes, "rotate:spin", "fromMax", -10)
  assert.deepEqual(effect(bytes, "rotate:spin").to, [[180, 270], [180, 270]])
  // proto int32 范围允许负数（旋转角度、像素位移）。
  assert.deepEqual(effect(bytes, "rotate:spin").from, [[-45, -10], [-45, -10]])
})

test("缩放/旋转中心与双轴插值器按 Point / IntpolXY 写入", () => {
  let bytes = sampleAnimation()
  bytes = patch(bytes, "scale:pop", "pivotPxX", 12)
  bytes = patch(bytes, "scale:pop", "pivotPxY", 24)
  bytes = patch(bytes, "scale:pop", "pivotX", 55)
  bytes = patch(bytes, "scale:pop", "pivotY", 65)
  bytes = patch(bytes, "scale:pop", "interpolationXYX", 2)
  bytes = patch(bytes, "scale:pop", "interpolationXYY", 4)
  const scale = effect(bytes, "scale:pop")
  assert.deepEqual(scale.pivotPx, [12, 24])
  assert.deepEqual(scale.pivot, [55, 65])
  assert.deepEqual(scale.interpolationXY, [2, 4])

  bytes = patch(bytes, "rotate:spin", "pivotY", 80)
  assert.deepEqual(effect(bytes, "rotate:spin").pivot, [50, 80])
  assert.deepEqual(effect(bytes, "rotate:spin").pivotPx, [4, 6])

  bytes = patch(bytes, "shift:slide", "interpolationXYX", 1)
  bytes = patch(bytes, "shift:slide", "interpolationXYY", 3)
  assert.deepEqual(effect(bytes, "shift:slide").interpolationXY, [1, 3])
})

test("位移的像素模式写 9/10 号字段，相对模式写 5/6 号字段", () => {
  let bytes = sampleAnimation()
  // 像素模式：解码器从 fromPx/toPx 读 from/to。
  bytes = patch(bytes, "shift:slidePx", "fromXMin", 11)
  bytes = patch(bytes, "shift:slidePx", "toYMax", 88)
  const pixel = effect(bytes, "shift:slidePx")
  assert.equal(pixel.relative, false)
  assert.deepEqual(pixel.from, [[11, 20], [30, 40]])
  assert.deepEqual(pixel.to, [[50, 60], [70, 88]])

  // 相对模式：from/to 在 5/6 号；9/10 号不存在。
  bytes = patch(bytes, "shift:slide", "fromXMax", 15)
  const relative = effect(bytes, "shift:slide")
  assert.equal(relative.relative, true)
  assert.deepEqual(relative.from, [[0, 15], [0, 20]])
  assert.equal(rawFields(effectMessageBytes(bytes, "shift:slide")).some((item) => item.number === 9), false)
})

test("帧/视频/图片序列：资源、起始帧、循环与帧播放参数写回", () => {
  let bytes = sampleAnimation()
  bytes = patch(bytes, "frame:f1", "resourceID", "new-frame.png")
  bytes = patch(bytes, "frame:f1", "startRepeatFrame", 2)
  bytes = patch(bytes, "frame:f1", "repeatCount", 5)
  bytes = patch(bytes, "frame:f1", "removeOnFinish", false)
  const frame = effect(bytes, "frame:f1")
  assert.equal(frame.resource.resourceID, "new-frame.png")
  assert.equal(frame.resource.type, 3, "写资源编号时保留资源类型")
  assert.equal(frame.startRepeatFrame, 2)
  assert.equal(frame.repeatCount, 5)
  assert.equal(frame.removeOnFinish, false)

  bytes = patch(bytes, "video:vid", "resourceID", "clip2.mp4")
  bytes = patch(bytes, "video:vid", "placeholderID", "poster2.png")
  assert.equal(effect(bytes, "video:vid").resource.resourceID, "clip2.mp4")
  assert.equal(effect(bytes, "video:vid").placeholder.resourceID, "poster2.png")

  bytes = patch(bytes, "image:seq", "loopForever", false)
  bytes = patch(bytes, "image:seq", "startRepeatFrame", 1)
  bytes = patch(bytes, "image:seq", "repeatMode", 0)
  bytes = updateBdaAnimationFrame(bytes, "seq", 1, "resourceID", "b2.png")
  bytes = updateBdaAnimationFrame(bytes, "seq", 1, "duration", 240)
  const image = effect(bytes, "image:seq")
  assert.equal(image.loopForever, false)
  assert.equal(image.startRepeatFrame, 1)
  assert.equal(image.repeatMode, 0)
  assert.deepEqual(image.sequence.frames, [
    { resourceID: "a.png", duration: 100 },
    { resourceID: "b2.png", duration: 240 },
  ])
  assert.equal(decode(bytes).sequences.get("seq").frames[1].duration, 240)
})

test("粒子效果：标量、浮点时长、发射区域、12 个随机范围与扩展字段", () => {
  let bytes = sampleAnimation()
  bytes = patch(bytes, "emitter:spark", "duration", 1234.5)
  bytes = patch(bytes, "emitter:spark", "repeatCount", 3)
  bytes = patch(bytes, "emitter:spark", "repeatMode", 1)
  bytes = patch(bytes, "emitter:spark", "birthRate", 25)
  bytes = patch(bytes, "emitter:spark", "totalNumber", 60)
  bytes = patch(bytes, "emitter:spark", "finishAfterPractices", 1)
  bytes = patch(bytes, "emitter:spark", "keepParticlesOnRemove", 0)
  bytes = patch(bytes, "emitter:spark", "mirrorUp", 2)
  bytes = patch(bytes, "emitter:spark", "emitterType", 3)
  bytes = patch(bytes, "emitter:spark", "emitRegionLeft", 11.5)
  bytes = patch(bytes, "emitter:spark", "emitRegionTop", 12.5)
  bytes = patch(bytes, "emitter:spark", "emitRegionRight", 13.5)
  bytes = patch(bytes, "emitter:spark", "emitRegionBottom", 14.5)
  bytes = patch(bytes, "emitter:spark", "lifeMin", 7)
  bytes = patch(bytes, "emitter:spark", "lifeMax", 9)
  bytes = patch(bytes, "emitter:spark", "velocityMin", 1.5)
  bytes = patch(bytes, "emitter:spark", "velocityMax", 2.5)
  bytes = patch(bytes, "emitter:spark", "accelerationDirectionMax", 90)
  const emitter = effect(bytes, "emitter:spark")
  assert.equal(emitter.duration, 1234.5)
  assert.equal(emitter.repeatCount, 3)
  assert.equal(emitter.repeatMode, 1)
  assert.equal(emitter.birthRate, 25)
  assert.equal(emitter.totalNumber, 60)
  assert.equal(emitter.finishAfterPractices, 1)
  assert.equal(emitter.keepParticlesOnRemove, 0)
  assert.equal(emitter.mirrorUp, 2)
  assert.equal(emitter.emitterType, 3)
  assert.deepEqual(emitter.emitRegion, [11.5, 12.5, 13.5, 14.5])
  assert.deepEqual(emitter.life, [7, 9])
  assert.deepEqual(emitter.velocity, [1.5, 2.5])
  assert.deepEqual(emitter.accelerationDirection, [-180, 90])
  assert.equal(emitter.resources[0].resourceID, "particle.png")
  assert.equal(emitter.paths.length, 1)
})

test("组合效果：构建方式、重复与延迟写回，子效果保持原样", () => {
  let bytes = sampleAnimation()
  bytes = patch(bytes, "group:g1", "buildMode", 1)
  bytes = patch(bytes, "group:g1", "repeatCount", 4)
  bytes = patch(bytes, "group:g1", "repeatMode", 0)
  bytes = patch(bytes, "group:g1", "delay", 320)
  bytes = patch(bytes, "group:g1", "removeOnFinish", true)
  const group = effect(bytes, "group:g1")
  assert.equal(group.buildMode, 1)
  assert.equal(group.repeatCount, 4)
  assert.equal(group.repeatMode, 0)
  assert.equal(group.delay, 320)
  assert.equal(group.removeOnFinish, true)
  assert.deepEqual(group.items, [{ kind: "alpha", key: "alpha:press" }])
})

test("patch 只改命中字段：未涉及的效果、未知字段与设计宽度字节不变", () => {
  const bytes = sampleAnimation()
  const patched = patch(bytes, "alpha:press", "duration", 999)
  assert.equal(decode(patched).designWidth, 1080)
  assert.equal(rawFields(patched).find((item) => item.number === 77).varint, 12345)
  assert.deepEqual(fieldPayload(effectMessageBytes(patched, "alpha:press"), 88), string("alpha-unknown"))
  assert.deepEqual(fieldPayload(effectMessageBytes(patched, "scale:pop"), 88), string("scale-unknown"))
  assert.deepEqual(fieldPayload(effectMessageBytes(patched, "lottie:lo"), 88), string("lottie-unknown"))
  // 其他效果整段字节不变。
  for (const effectID of ["group:g1", "scale:pop", "shift:slidePx", "rotate:spin", "frame:f1", "image:seq", "emitter:spark", "lottie:lo", "video:vid"]) {
    assert.deepEqual(entryBytes(patched, effectID), entryBytes(bytes, effectID), effectID)
  }
  // 设计宽度与绑定不变。
  assert.deepEqual(
    decode(patched).targetBindings.get("KEY_A"),
    decode(bytes).targetBindings.get("KEY_A"),
  )
})

test("无效值抛出中文错误，不写出半截结果", () => {
  const bytes = sampleAnimation()
  assert.throws(() => patch(bytes, "alpha:press", "repeatCount", -1), /BDA 动画数值无效/)
  assert.throws(() => patch(bytes, "alpha:press", "repeatCount", 1.5), /BDA 动画数值无效/)
  assert.throws(() => patch(bytes, "alpha:press", "removeOnFinish", 1), /BDA 动画布尔值无效/)
  assert.throws(() => patch(bytes, "emitter:spark", "duration", Number.NaN), /BDA 动画数值无效/)
  assert.throws(() => patch(bytes, "emitter:spark", "lifeMin", "8"), /BDA 动画数值无效/)
  assert.throws(() => patch(bytes, "frame:f1", "resourceID", 5), /BDA 动画资源编号无效/)
  assert.throws(() => patch(bytes, "unknown:x", "repeatCount", 1), /BDA 动画效果类型不支持/)
  assert.throws(() => patch(bytes, "alpha:missing", "repeatCount", 1), /BDA 动画效果不存在/)
  assert.throws(() => patch(bytes, "alpha:press", "pivotX", 1), /BDA 动画效果不支持/)
  assert.throws(() => patch(bytes, "shift:slide", "pivotX", 1), /BDA 动画效果不支持/)
})

test("applyBdaAnimationEffects：按 JSON 差异定点写回标量、范围、中心与发射区域", () => {
  const bytes = sampleAnimation()
  const animation = decode(bytes)
  const current = Object.fromEntries(animation.effects)
  const desired = JSON.parse(JSON.stringify(current))
  desired["alpha:press"].repeatCount = 7
  desired["alpha:press"].from = [[5, 6], [5, 6]]
  desired["scale:pop"].pivotPx = [7, 8]
  desired["scale:pop"].interpolationXY = [0, 2]
  desired["shift:slide"].from = [[1, 2], [3, 4]]
  desired["emitter:spark"].duration = 2500
  desired["emitter:spark"].life = [4, 5]
  desired["emitter:spark"].emitRegion = [20, 21, 22, 23]
  desired["emitter:spark"].mirrorUp = 3
  desired["frame:f1"].resource = { ...desired["frame:f1"].resource, resourceID: "roundtrip.png" }
  desired["image:seq"].loopForever = false
  const patched = applyBdaAnimationEffects(bytes, desired, current)
  const after = decode(patched)
  assert.equal(after.effects.get("alpha:press").repeatCount, 7)
  assert.deepEqual(after.effects.get("alpha:press").from, [[5, 6], [5, 6]])
  assert.deepEqual(after.effects.get("scale:pop").pivotPx, [7, 8])
  assert.deepEqual(after.effects.get("scale:pop").interpolationXY, [0, 2])
  assert.deepEqual(after.effects.get("shift:slide").from, [[1, 2], [3, 4]])
  assert.equal(after.effects.get("emitter:spark").duration, 2500)
  assert.deepEqual(after.effects.get("emitter:spark").life, [4, 5])
  assert.deepEqual(after.effects.get("emitter:spark").emitRegion, [20, 21, 22, 23])
  assert.equal(after.effects.get("emitter:spark").mirrorUp, 3)
  assert.equal(after.effects.get("frame:f1").resource.resourceID, "roundtrip.png")
  assert.equal(after.effects.get("image:seq").loopForever, false)
  // 未知字段仍然保留。
  assert.deepEqual(fieldPayload(effectMessageBytes(patched, "scale:pop"), 88), string("scale-unknown"))
  assert.equal(rawFields(patched).find((item) => item.number === 77).varint, 12345)
})

test("applyBdaAnimationEffects：没有差异时字节完全不变，也接受 { effects } 包装", () => {
  const bytes = sampleAnimation()
  const current = decode(bytes).effects
  const same = JSON.parse(JSON.stringify(Object.fromEntries(current)))
  assert.deepEqual(applyBdaAnimationEffects(bytes, same, Object.fromEntries(current)), bytes)
  const desired = JSON.parse(JSON.stringify(Object.fromEntries(current)))
  desired["group:g1"].delay = 400
  const direct = applyBdaAnimationEffects(bytes, desired, Object.fromEntries(current))
  const wrapped = applyBdaAnimationEffects(bytes, { effects: desired }, { effects: Object.fromEntries(current) })
  assert.deepEqual(wrapped, direct)
  assert.equal(effect(direct, "group:g1").delay, 400)
})

test("applyBdaAnimationEffects：图片序列由帧写入负责，sequence 差异被跳过", () => {
  const bytes = sampleAnimation()
  const current = Object.fromEntries(decode(bytes).effects)
  const desired = JSON.parse(JSON.stringify(current))
  desired["image:seq"].sequence.frames[0].resourceID = "edited.png"
  assert.deepEqual(applyBdaAnimationEffects(bytes, desired, current), bytes)
})

test("applyBdaAnimationEffects：不支持的结构改动抛中文错误", () => {
  const bytes = sampleAnimation()
  const current = Object.fromEntries(decode(bytes).effects)
  const mutate = (apply) => {
    const desired = JSON.parse(JSON.stringify(current))
    apply(desired)
    return () => applyBdaAnimationEffects(bytes, desired, current)
  }
  assert.throws(mutate((desired) => { desired["group:g1"].items.push({ kind: "alpha", key: "x" }) }), /暂不支持增删 BDA 组合动画子效果/)
  assert.throws(mutate((desired) => { desired["emitter:spark"].resources = [] }), /暂不支持修改 BDA 粒子资源/)
  assert.throws(mutate((desired) => { desired["emitter:spark"].paths = [] }), /暂不支持修改 BDA 粒子路径/)
  assert.throws(mutate((desired) => { delete desired["alpha:press"] }), /暂不支持删除 BDA 动画效果/)
  assert.throws(mutate((desired) => { desired["alpha:new"] = { ...desired["alpha:press"], key: "new" } }), /暂不支持新增 BDA 动画效果/)
  assert.throws(mutate((desired) => { delete desired["alpha:press"].delay }), /暂不支持删除 BDA 动画字段/)
  assert.throws(mutate((desired) => { desired["scale:pop"].relative = false }), /暂不支持切换 BDA 动画相对模式/)
  assert.throws(mutate((desired) => { desired["alpha:press"].kind = "scale" }), /BDA 动画效果标识不能修改/)
  assert.throws(mutate((desired) => { desired["alpha:press"].unsupported = 1 }), /BDA 动画效果字段不支持/)
  assert.throws(mutate((desired) => { desired["alpha:press"].from = [[1]] }), /BDA 动画范围无效/)
  assert.throws(mutate((desired) => { desired["emitter:spark"].life = [1] }), /BDA 粒子参数范围无效/)
})

/* —— 与 Lead 的共享 fixture 对齐：11 个效果共存、含重复 map key 的真实样例 —— */

const FIXTURE_PATH = "light/skin/port/animationConfig"
const fixtureBytes = () => SkinArchive.open(bdaAnimatedSkinBytes(), "bda").getBytes(FIXTURE_PATH)

test("官方样例：多效果共存时只改目标效果，其他效果解码值保持不变", () => {
  const bytes = fixtureBytes()
  const before = decode(bytes)
  let patched = updateBdaAnimationEffect(bytes, "alpha:press", "duration", 500)
  patched = updateBdaAnimationEffect(patched, "alpha:press", "delay", 40)
  patched = updateBdaAnimationEffect(patched, "rotate:spin", "pivotPxX", 30)
  patched = updateBdaAnimationEffect(patched, "rotate:spin", "pivotPxY", 60)
  patched = updateBdaAnimationEffect(patched, "emitter:spark", "birthRate", 30)
  patched = updateBdaAnimationEffect(patched, "scale:enter", "interpolationXYX", 0)
  const after = decode(patched)
  assert.deepEqual([...after.effects.keys()], [...before.effects.keys()], "不能有任何一个效果丢失")
  assert.equal(after.effects.get("alpha:press").duration, 500)
  assert.equal(after.effects.get("alpha:press").delay, 40)
  assert.deepEqual(after.effects.get("rotate:spin").pivotPx, [30, 60])
  assert.equal(after.effects.get("emitter:spark").birthRate, 30)
  assert.deepEqual(after.effects.get("scale:enter").interpolationXY, [0, 3])
  for (const effectID of before.effects.keys()) {
    if (["alpha:press", "rotate:spin", "emitter:spark", "scale:enter"].includes(effectID)) continue
    assert.deepEqual(after.effects.get(effectID), before.effects.get(effectID), effectID)
  }
  assert.deepEqual(after.targets, before.targets)
  assert.deepEqual(after.targetBindings, before.targetBindings)
  assert.equal(after.designWidth, 1080)
})

test("重复 map key：patch 命中解码器读取的最后一条", () => {
  const bytes = fixtureBytes()
  const first = rawFields(bytes).find((item) => item.number === 4 && item.bytes &&
    new TextDecoder().decode(rawFields(item.bytes).find((child) => child.number === 1).bytes) === "press")
  // 追加一条同 key 的 map entry：protobuf map 语义下后者覆盖前者，decoder 读最后一条。
  const duplicated = joinFields([bytes, encodedField(4, 2, first.bytes)])
  const entries = rawFields(duplicated).filter((item) => item.number === 4 && item.bytes &&
    new TextDecoder().decode(rawFields(item.bytes).find((child) => child.number === 1).bytes) === "press")
  assert.equal(entries.length, 2)
  const before = decode(duplicated).effects.get("alpha:press").duration
  const patched = updateBdaAnimationEffect(duplicated, "alpha:press", "duration", 700)
  assert.equal(decode(patched).effects.get("alpha:press").duration, 700)
  assert.notEqual(before, 700)
  // 第一条仍然保持原值：只替换了最后一条 entry。
  const firstEntry = rawFields(patched).filter((item) => item.number === 4 && item.bytes &&
    new TextDecoder().decode(rawFields(item.bytes).find((child) => child.number === 1).bytes) === "press")[0]
  const firstValue = rawFields(rawFields(firstEntry.bytes).find((child) => child.number === 2).bytes)
  assert.equal(firstValue.find((field) => field.number === 7).varint, 240)
})

test("官方样例：applyBdaAnimationEffects 改一个/多个字段，其他效果不丢", () => {
  const bytes = fixtureBytes()
  const animation = decode(bytes)
  const current = Object.fromEntries(animation.effects)
  const desired = JSON.parse(JSON.stringify(current))
  desired["alpha:press"].duration = 500
  desired["alpha:press"].delay = 40
  desired["shift:slide"].from = [[-5, 6], [-7, 8]]
  desired["image:seq"].loopForever = false
  desired["frame:gif"].resource = { ...desired["frame:gif"].resource, resourceID: "next.gif" }
  const patched = applyBdaAnimationEffects(bytes, desired, current)
  const after = decode(patched)
  assert.deepEqual([...after.effects.keys()], [...animation.effects.keys()])
  assert.equal(after.effects.get("alpha:press").duration, 500)
  assert.equal(after.effects.get("alpha:press").delay, 40)
  assert.deepEqual(after.effects.get("shift:slide").from, [[-5, 6], [-7, 8]])
  assert.equal(after.effects.get("image:seq").loopForever, false)
  assert.equal(after.effects.get("frame:gif").resource.resourceID, "next.gif")
  for (const effectID of animation.effects.keys()) {
    if (["alpha:press", "shift:slide", "image:seq", "frame:gif"].includes(effectID)) continue
    assert.deepEqual(after.effects.get(effectID), animation.effects.get(effectID), effectID)
  }
})
