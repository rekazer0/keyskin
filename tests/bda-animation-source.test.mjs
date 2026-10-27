import assert from "node:assert/strict"
import test from "node:test"
import { encodedField, encodeVarint, join } from "../src/bda-encode.ts"
import { decodeBdaAnimation } from "../src/bda-decode.ts"
import { applyDecodedBdaSource, decodedBdaSource } from "../src/bda-source.ts"
import { SkinArchive } from "../src/skin.ts"
import { bdaAnimatedSkinBytes } from "./helpers/bda-animation-fixture.mjs"

const PATH = "light/skin/port/animationConfig"
const bytes = () => SkinArchive.open(bdaAnimatedSkinBytes(), "bda").getBytes(PATH)
const edit = (mutate, source = bytes()) => {
  const desired = JSON.parse(decodedBdaSource(PATH, source))
  mutate(desired)
  return applyDecodedBdaSource(PATH, source, JSON.stringify(desired))
}

test("源码 JSON 改动画效果参数会写回 protobuf 并保留其他动效", () => {
  const output = edit((desired) => {
    desired.effects["alpha:press"].duration = 500
    desired.effects["alpha:press"].delay = 40
    desired.effects["rotate:spin"].pivotPx = [30, 60]
    desired.effects["emitter:spark"].birthRate = 30
    desired.designWidth = 1440
  })
  const animation = decodeBdaAnimation(output)
  const alpha = animation.effects.get("alpha:press")
  assert.equal(alpha.duration, 500)
  assert.equal(alpha.delay, 40)
  assert.deepEqual(animation.effects.get("rotate:spin").pivotPx, [30, 60])
  assert.equal(animation.effects.get("emitter:spark").birthRate, 30)
  assert.equal(animation.designWidth, 1440)

  // 没改的效果保持原值。
  assert.equal(animation.effects.get("scale:enter").duration, 300)
  assert.deepEqual(animation.effects.get("scale:enter").interpolationXY, [1, 3])
  assert.deepEqual(animation.effects.get("emitter:spark").life, [300, 600])
  assert.equal(animation.targets.length, 11)
})

test("源码 JSON 改动画时未知 protobuf 字段原样保留", () => {
  const unknown = encodedField(99, 0, encodeVarint(7))
  const source = join([bytes(), unknown])
  const output = edit((desired) => {
    desired.effects["alpha:press"].to = [[255, 255], [255, 255]]
  }, source)
  const tail = output.slice(output.length - unknown.length)
  assert.deepEqual([...tail], [...unknown])
})

test("源码 JSON 改序列帧仍走原来的帧 patch", () => {
  const output = edit((desired) => {
    desired.sequences.seq.frames[0].duration = 333
  })
  const sequence = decodeBdaAnimation(output).sequences.get("seq")
  assert.equal(sequence.frames[0].duration, 333)
  assert.equal(sequence.frames[1].duration, 120)
})

test("暂不支持的动画绑定改动会给出中文提示", () => {
  assert.throws(
    () => edit((desired) => { desired.bindings = {} }),
    /暂不支持修改 BDA 动画绑定/,
  )
  assert.throws(
    () => edit((desired) => { desired.targets = ["KEY_A"] }),
    /暂不支持修改 BDA 动画目标/,
  )
})

test("写入失败不会破坏原文件（无效类型抛错）", () => {
  assert.throws(() => edit((desired) => { desired.effects["alpha:press"].duration = "很长" }))
  const original = bytes()
  const unchanged = decodeBdaAnimation(original)
  assert.equal(unchanged.effects.get("alpha:press").duration, 240)
})
