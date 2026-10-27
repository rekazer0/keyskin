import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { decodeBdaAnimation } from "../src/bda-decode.ts"
import { buildLegacyMotion, legacyMotionIni, legacyStyleProp } from "../src/bda-motion.ts"
import { IniDocument } from "../src/ini.ts"
import { parseLegacyAnimation, parseLegacyParticleEmitter } from "../src/preview-animation.ts"
import { animationConfigBytes } from "./helpers/bda-animation-fixture.mjs"

const decode = () => decodeBdaAnimation(new Uint8Array(animationConfigBytes()))
const sectionByType = (motion, type) => [...motion.sections.values()].find((section) => section.TYPE === type)
const particleSection = (motion) => [...motion.sections.values()].find((section) => section.CATEGORY === "3")
const frameSection = (motion) => [...motion.sections.values()].find((section) => section.CATEGORY === "2")

test("BDA 事件按旧版 CSS 动画字段映射", () => {
  assert.equal(legacyStyleProp(1), "PRESS_ANIM")
  assert.equal(legacyStyleProp(2), "RELEASE_ANIM")
  assert.equal(legacyStyleProp(0), "SHOW_ANIM")
  assert.equal(legacyStyleProp(3), "SHOW_ANIM")
  assert.equal(legacyStyleProp(4), "HIDE_ANIM")
  for (const unsupported of [5, 6, 7, 8, 9]) assert.equal(legacyStyleProp(unsupported), undefined)
})

test("基础动效转成旧版 TYPE 0/1/2/4 并保留时间参数", () => {
  const motion = buildLegacyMotion(decode())
  const alpha = sectionByType(motion, "0")
  assert.equal(alpha.DURATION, "240")
  assert.equal(alpha.DELAY, "20")
  assert.equal(alpha.REPEAT_CNT, "2")
  assert.equal(alpha.REPEAT_MODE, "1")
  assert.equal(alpha.INTPOL, "2")
  assert.equal(alpha.REMOVE, "1")
  assert.equal(alpha.FROM, "rand(0,40)")
  assert.equal(alpha.TO, "rand(230,255)")

  const rotate = sectionByType(motion, "1")
  assert.equal(rotate.TO, "rand(180,360)")
  assert.equal(rotate.PIVOT_PX, "25,75")
  assert.equal(rotate.PIVOT, undefined)

  const scale = sectionByType(motion, "4")
  assert.equal(scale.FROM, "rand(60,80),rand(60,80)")
  assert.equal(scale.INTPOL, "1,3")

  const shift = sectionByType(motion, "2")
  assert.equal(shift.FROM, "rand(-20,0),0")
  assert.equal(shift.TO, "rand(80,120),rand(0,20)")
  assert.equal(shift.FROM_PX, undefined)
})

test("BDA 绝对位移转成 FROM_PX/TO_PX，不再写百分比", () => {
  const motion = buildLegacyMotion(decode())
  const pixel = [...motion.sections.values()].find((section) => section.FROM_PX !== undefined)
  assert.equal(pixel.TYPE, "2")
  assert.equal(pixel.FROM_PX, "rand(-30,-10),0")
  assert.equal(pixel.TO_PX, "rand(0,10),rand(0,40)")
  assert.equal(pixel.FROM, undefined)
})

test("组合动效转成旧版 BUILD_* 并保持播放方式", () => {
  const motion = buildLegacyMotion(decode())
  const combo = [...motion.sections.values()].find((section) => section.BUILD_NUM)
  assert.equal(combo.BUILD_NUM, "2")
  assert.equal(combo.BUILD_METHOD, "1")
  const ids = combo.BUILD_LIST.split(",").map(Number)
  assert.deepEqual(ids.map((id) => motion.sections.get(id)?.TYPE ?? "3"), ["0", "1"])
})

test("粒子与 GIF 帧动效转成旧版 CATEGORY=3 / CATEGORY=2", () => {
  const motion = buildLegacyMotion(decode(), {
    imageStyle: () => 77,
    animationPath: () => "spark.gif",
  })
  const particle = particleSection(motion)
  assert.equal(particle.TYPE, "0")
  assert.equal(particle.PARTICLE_IMAGE, "77")
  assert.equal(particle.LIFE, "300,600")
  assert.equal(particle.EMIT_REGION, "0,0,1,0.4")
  assert.equal(particle.DURATION, "500")
  assert.equal(particle.TOTAL_NUMBER, "12")
  assert.equal(particle.VELOCITY, "0,120")

  const frame = frameSection(motion)
  assert.equal(frame.ANIM_PATH, "spark.gif")
})

test("无法表达的动效给出降级警告而不是静默丢弃", () => {
  const motion = buildLegacyMotion(decode(), { imageStyle: () => 77, animationPath: () => "spark.gif" })
  const text = motion.warnings.join("\n")
  assert.match(text, /图片序列动效/)
  assert.match(text, /Lottie/)
  assert.match(text, /视频/)
  assert.match(text, /输入文字/)
})

test("绑定按目标与作用域保留，供转换层套到样式上", () => {
  const motion = buildLegacyMotion(decode(), { imageStyle: () => 77, animationPath: () => "spark.gif" })
  const byTarget = (target) => motion.bindings.filter((binding) => binding.target === target)
  assert.deepEqual(byTarget("KEY_A").map(({ event, scope }) => `${event}:${scope}`).sort(), ["1:2", "2:0", "3:1"])
  assert.equal(byTarget("MAIN_KEY")[0].scope, 2)
  assert.equal(byTarget("PANEL")[0].event, 0)
  assert.equal(byTarget("CAND")[0].event, 3)
  assert.equal(byTarget("HINT")[0].event, 4)
  assert.equal(byTarget("UNKNOWN_SLOT").length, 1)
  for (const binding of motion.bindings) assert.ok(motion.sections.has(binding.animation))
})

test("生成的 anim.ini 能被编辑器现有解析器读回（语义等价）", () => {
  const motion = buildLegacyMotion(decode(), { imageStyle: () => 77, animationPath: () => "spark.gif" })
  const text = legacyMotionIni(motion)
  assert.ok(text)
  const animations = IniDocument.parse(text)
  assert.equal(animations.get("GLOBAL", "ANIM_NUM"), String(motion.sections.size))
  for (const id of motion.sections.keys()) assert.ok(animations.sections().includes(`ANIM${id}`))

  const alphaID = [...motion.sections].find(([, section]) => section.TYPE === "0")[0]
  const styles = IniDocument.parse(`[GLOBAL]\nSTYLE_NUM=1\n\n[STYLE1]\nPRESS_ANIM=${alphaID}\n`)
  const parsed = parseLegacyAnimation(styles, animations)
  const frame = parsed.get("1").frames[0]
  assert.equal(frame.type, "opacity")
  assert.equal(frame.duration, 240)
  assert.equal(frame.delay, 20)
  assert.equal(frame.repeat, 2)
  assert.equal(frame.reverse, true)
  assert.deepEqual(frame.easing, [2, 2])
  assert.deepEqual(frame.from, [20 / 255, 20 / 255])
  assert.deepEqual(frame.to, [242.5 / 255, 242.5 / 255])

  const particleID = [...motion.sections].find(([, section]) => section.CATEGORY === "3")[0]
  const emitter = parseLegacyParticleEmitter(animations, `ANIM${particleID}`)
  assert.deepEqual(emitter.images, ["77"])
  assert.deepEqual(emitter.life, [300, 600])
  assert.deepEqual(emitter.emitRegion, [0, 0, 1, 0.4])
})
