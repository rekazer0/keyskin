import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { strToU8, unzipSync, zipSync } from "fflate"
import { SkinArchive } from "../src/skin.ts"
import { buildSxiZip } from "../src/palm/palm-export.ts"
import { convertSxiToBda } from "../src/palm/sxi-to-baidu.ts"
import { applyLegacyBaiduMotion } from "../src/legacy-to-bda-motion.ts"
import { decodeBdaAnimation } from "../src/bda-decode.ts"
import { encodePng, decodePng } from "../src/ssf/ssf-png.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"

const templateBytes = new Uint8Array(readFileSync(new URL("../public/default-template.bda", import.meta.url)))
const template = () => SkinArchive.open(templateBytes, "bda")
const GIF = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"))
const INI = `[ANIM1]
TYPE=0
FROM=rand(10,30)
TO=240
DURATION=321
DELAY=25
REPEAT_CNT=3
REPEAT_MODE=1
REMOVE=1
INTPOL=2
[ANIM2]
TYPE=4
FROM=80,90
TO=110,120
PIVOT=40,60
PIVOT_PX=12,16
DURATION=456
INTPOL=1,3
[ANIM3]
BUILD_NUM=2
BUILD_LIST=1,2
BUILD_METHOD=1
DELAY=40
REPEAT_CNT=2
REPEAT_MODE=1
REMOVE=1
[ANIM4]
CATEGORY=3
TYPE=0
PARTICLE_IMAGE=150
LIFE=700,1300
DURATION=2400
BIRTH_RATE=12
TOTAL_NUMBER=24
EMIT_REGION=0.1,0.2,0.8,0.9
VELOCITY=15,35
VELOCITY_DIRECTION=-90,-45
ACCELERATION=1,3
ACCELERATION_DIRECTION=90,120
INIT_SCALE=0.5,1.5
SCALE_SPEED=-0.2,0.1
INIT_ROTATE=-20,20
ROTATE_SPEED=5,15
INIT_ALPHA=100,220
ALPHA_SPEED=-40,-20
FINISH_AFTER_PRACTICES=1
REMOVE_INCLUDE_PRACTICES=1
MIRROR_UP=2
REPEAT_CNT=4
REMOVE=1
[ANIM5]
CATEGORY=2
ANIM_PATH=res/spark.gif
[ANIM6]
TYPE=2
FROM_PX=rand(-20,-10),5
TO_PX=30,-15
DURATION=250
[ANIM7]
TYPE=1
FROM=-30
TO=90
DURATION=500
PIVOT=50,50
[ANIM8]
TYPE=2
FROM=-10,20
TO=25,35
DURATION=180
`
function source(extra = "") {
  const files = unzipSync(bdsFixture())
  files["light/res/anim.ini"] = strToU8(INI + extra)
  files["light/res/default.css"] = strToU8(new TextDecoder().decode(files["light/res/default.css"]) + `
[STYLE140]
PRESS_ANIM=3
RELEASE_ANIM=6
SHOW_ANIM=7
HIDE_ANIM=8
[STYLE141]
PRESS_ANIM=4
[STYLE142]
PRESS_ANIM=5
[STYLE150]
NM_IMG=particles,1
`)
  files["light/port/py_26.ini"] = strToU8(`[PANEL]
SIZE=1080,600
KEY_NUM=3
[KEY1]
CENTER=q
VIEW_RECT=0,0,100,100
BACK_ANIM_STYLE=140
FORE_ANIM_STYLE=141
ANIM_STYLE=142
[KEY2]
CENTER=NOT_A_REAL_KEY
VIEW_RECT=100,0,100,100
BACK_ANIM_STYLE=140
[KEY3]
CENTER=w
VIEW_RECT=200,0,100,100
`)
  files["light/res/particles.png"] = encodePng({ width: 2, height: 1, data: Uint8Array.from([255, 0, 0, 255, 0, 200, 50, 255]) })
  files["light/res/particles.til"] = strToU8("[IMG1]\nSOURCE_RECT=1,0,1,1\n")
  files["light/res/spark.gif"] = GIF
  return SkinArchive.open(zipSync(files), "bds")
}
const effect = (animation, kind, id) => animation.effects.get(`${kind}:legacy_${id}`)

test("BDS → BDA helper preserves real transforms, combination timing, particle values, GIF and actual bindings", () => {
  const input = source()
  const output = template()
  const inputBefore = input.toBytes()
  const warnings = applyLegacyBaiduMotion(input, output)
  const animation = decodeBdaAnimation(output.getBytes("light/skin/port/animationConfig"))
  const alpha = effect(animation, "alpha", 1)
  assert.equal(alpha.duration, 321)
  assert.equal(alpha.delay, 25)
  assert.equal(alpha.repeatCount, 3)
  assert.equal(alpha.repeatMode, 1)
  assert.equal(alpha.removeOnFinish, true)
  assert.equal(alpha.interpolation, 2)
  assert.deepEqual(alpha.from[0], [10, 30])
  assert.deepEqual(alpha.to[0], [240, 240])
  const scale = effect(animation, "scale", 2)
  assert.deepEqual(scale.from, [[80, 80], [90, 90]])
  assert.deepEqual(scale.to, [[110, 110], [120, 120]])
  assert.deepEqual(scale.pivot, [40, 60])
  assert.deepEqual(scale.pivotPx, [12, 16])
  assert.deepEqual(scale.interpolationXY, [1, 3])
  const group = effect(animation, "group", 3)
  assert.deepEqual(group.items, [{ kind: "alpha", key: "legacy_1" }, { kind: "scale", key: "legacy_2" }])
  assert.equal(group.buildMode, 1)
  assert.equal(group.repeatCount, 2)
  assert.equal(group.delay, 40)
  assert.equal(group.repeatMode, 1)
  assert.equal(group.removeOnFinish, true)
  const particle = effect(animation, "emitter", 4)
  assert.ok(Math.abs(particle.duration - 2.4) < 0.00001)
  assert.equal(particle.birthRate, 12)
  assert.equal(particle.totalNumber, 24)
  assert.deepEqual(particle.life, [700, 1300])
  assert.deepEqual(particle.velocity, [15, 35])
  assert.deepEqual(particle.velocityDirection, [-90, -45])
  assert.deepEqual(particle.acceleration, [1, 3])
  assert.deepEqual(particle.accelerationDirection, [90, 120])
  assert.deepEqual(particle.rotation, [-20, 20])
  assert.deepEqual(particle.spin, [5, 15])
  assert.deepEqual(particle.alpha, [100, 220])
  assert.deepEqual(particle.alphaSpeed, [-40, -20])
  assert.deepEqual(particle.scale, [0.5, 1.5])
  assert.ok(Math.abs(particle.scaleSpeed[0] + 0.2) < 0.00001)
  assert.equal(particle.finishAfterPractices, 1)
  assert.equal(particle.keepParticlesOnRemove, 1)
  assert.equal(particle.mirrorUp, 2)
  assert.equal(particle.repeatCount, 4)
  assert.equal(particle.removeOnFinish, true)
  particle.emitRegion.forEach((value, index) => assert.ok(Math.abs(value - [0.1, 0.2, 0.8, 0.9][index]) < 0.00001))
  assert.equal(particle.resources[0].type, 0)
  const image = decodePng(output.getBytes(`light/skin/res/${particle.resources[0].resourceID}`))
  assert.deepEqual([image.width, image.height], [1, 1])
  assert.deepEqual([...image.data], [0, 200, 50, 255], "copy the requested tile, not the entire atlas")
  const gif = effect(animation, "frame", 5)
  assert.equal(gif.resource.type, 1)
  assert.deepEqual(output.getBytes(`light/skin/res/${gif.resource.resourceID}`), GIF)
  const pixels = effect(animation, "shift", 6)
  assert.equal(pixels.relative, false)
  assert.deepEqual(pixels.from, [[-20, -10], [5, 5]])
  assert.deepEqual(pixels.to, [[30, 30], [-15, -15]])
  assert.equal(effect(animation, "shift", 8).relative, true)
  assert.deepEqual(effect(animation, "shift", 8).to, [[25, 25], [35, 35]])
  assert.deepEqual(animation.targetBindings.get("KEY_Q").map(({ kind, key, scope, event }) => ({ kind, key, scope, event })), [
    { kind: "frame", key: "legacy_5", scope: 2, event: 1 },
    { kind: "emitter", key: "legacy_4", scope: 0, event: 1 },
    { kind: "group", key: "legacy_3", scope: 1, event: 1 },
    { kind: "shift", key: "legacy_6", scope: 1, event: 2 },
    { kind: "rotate", key: "legacy_7", scope: 1, event: 3 },
    { kind: "shift", key: "legacy_8", scope: 1, event: 4 },
  ])
  assert.deepEqual(input.toBytes(), inputBefore)
  assert.ok(!animation.targetBindings.has("KEY_W"), "do not bind an unrelated key")
  assert.ok(warnings.some((warning) => warning.includes("没有可映射的目标")))
  assert.ok(!warnings.some((warning) => warning === "百度按键动画在搜狗皮肤中没有对应，已忽略"))
  assert.ok(!animation.targetBindings.has("KEY_NOT_A_REAL_KEY"))
})

test("shared helper reports unsupported fields, missing resources, 3D, cycles and incomplete groups without dangling bindings", () => {
  const input = source(`
[ANIM9]
TYPE=5
FROM=0,0,0
TO=90,0,0
[ANIM10]
BUILD_LIST=1,99
[ANIM11]
BUILD_LIST=11
[ANIM12]
CATEGORY=2
ANIM_PATH=missing.gif
[ANIM13]
TYPE=0
FROM=0
TO=255
EXTRA_UNKNOWN=123
`)
  input.setText("light/skin/res/default.css", "[STYLE1]\nPRESS_ANIM=9\nRELEASE_ANIM=10\nSHOW_ANIM=11\nHIDE_ANIM=12\n")
  input.setText("light/skin/port/py_26.ini", "[KEY1]\nCENTER=q\nANIM_STYLE=1\n")
  const output = template()
  const warnings = applyLegacyBaiduMotion(input, output)
  const animation = decodeBdaAnimation(output.getBytes("light/skin/port/animationConfig"))
  for (const id of ["group:legacy_10", "group:legacy_11", "frame:legacy_12"]) assert.ok(!animation.effects.has(id))
  assert.equal(animation.targets.length, 0)
  for (const phrase of ["3D", "ANIM99", "循环引用", "missing.gif", "EXTRA_UNKNOWN"]) {
    assert.ok(warnings.some((warning) => warning.includes(phrase)), phrase)
  }
})

test("orientation overrides and dual themes produce distinct resources and animations; output reopens intact", () => {
  const input = source()
  input.setText("light/skin/land/res/anim.ini", "[ANIM1]\nTYPE=0\nFROM=40\nTO=200\nDURATION=999\n")
  input.setText("light/skin/land/res/default.css", "[STYLE1]\nPRESS_ANIM=1\n")
  input.setText("light/skin/land/py_26.ini", "[KEY1]\nCENTER=q\nFORE_ANIM_STYLE=1\n")
  input.setText("dark/skin/res/anim.ini", "[ANIM1]\nTYPE=1\nFROM=10\nTO=80\nDURATION=222\n")
  input.setText("dark/skin/res/default.css", "[STYLE1]\nPRESS_ANIM=1\n")
  input.setText("dark/skin/port/py_26.ini", "[KEY1]\nCENTER=q\nBACK_ANIM_STYLE=1\n")
  // Use a dual-theme BDA package so canonical setBytes also exercises packaging roots.
  const raw = unzipSync(templateBytes)
  for (const [path, bytes] of Object.entries(raw)) if (path.startsWith("port/") || path.startsWith("land/") || path.startsWith("res/")) {
    delete raw[path]; raw[`light/${path}`] = bytes; raw[`dark/${path}`] = bytes
  }
  raw["Info.txt"] = strToU8("Name=dual\nAtomSkinName=light,dark\n")
  const output = SkinArchive.open(zipSync(raw), "bda")
  applyLegacyBaiduMotion(input, output)
  const reopened = SkinArchive.open(output.toBytes(), "bda")
  const light = decodeBdaAnimation(reopened.getBytes("light/skin/land/animationConfig"))
  const dark = decodeBdaAnimation(reopened.getBytes("dark/skin/port/animationConfig"))
  assert.equal(effect(light, "alpha", 1).duration, 999)
  assert.deepEqual(effect(light, "alpha", 1).from[0], [40, 40])
  assert.equal(light.targetBindings.get("KEY_Q")[0].scope, 0)
  assert.equal(effect(dark, "rotate", 1).duration, 222)
  assert.equal(dark.targetBindings.get("KEY_Q")[0].scope, 1)
})

test("native SXI basic/combination/particle/GIF motion bypasses the Sogou intermediary", async () => {
  const input = source()
  input.setText("light/skin/res/anim.ini", INI.replace("rand(10,30)", "20").replace("rand(-20,-10)", "-15")
    .replace("INTPOL=1,3", "INTPOL=1").replace("ANIM_PATH=res/spark.gif", "SOURCE_FILE=res/spark.gif"))
  const sxi = SkinArchive.open(buildSxiZip(input).bytes, "sxi")
  const originalTemplate = template()
  const before = originalTemplate.toBytes()
  const { bytes, warnings } = await convertSxiToBda(sxi, originalTemplate)
  const output = SkinArchive.open(bytes, "bda")
  const motion = decodeBdaAnimation(output.getBytes("light/skin/port/animationConfig"))
  assert.equal(effect(motion, "alpha", 1).duration, 321)
  assert.deepEqual(effect(motion, "alpha", 1).from[0], [20, 20])
  assert.equal(effect(motion, "group", 3).buildMode, 1)
  assert.deepEqual(effect(motion, "group", 3).items.map(({ key }) => key), ["legacy_1", "legacy_2"])
  const particle = effect(motion, "emitter", 4)
  assert.deepEqual(particle.life, [700, 1300])
  assert.equal(particle.totalNumber, 24)
  assert.deepEqual([...decodePng(output.getBytes(`light/skin/res/${particle.resources[0].resourceID}`)).data], [0, 200, 50, 255])
  assert.deepEqual(output.getBytes(`light/skin/res/${effect(motion, "frame", 5).resource.resourceID}`), GIF)
  const bindings = motion.targetBindings.get("KEY_Q")
  for (const [kind, scope] of [["group", 1], ["emitter", 0], ["frame", 2]]) {
    assert.ok(bindings.some((binding) => binding.kind === kind && binding.scope === scope && binding.event === 1), kind)
  }
  assert.ok(!warnings.some((warning) => warning === "百度按键动画在搜狗皮肤中没有对应，已忽略"))
  assert.deepEqual(originalTemplate.toBytes(), before)
})

test("panel, hold, press slots and cross-panel conflicts resolve deterministically with warnings", () => {
  const input = source()
  input.setText("light/skin/res/default.css", "[STYLE1]\nPRESS_ANIM=1\nHOLD_ANIM=7\n[STYLE2]\nPRESS_ANIM=2\n")
  input.setText("light/skin/port/py_26.ini", "[PANEL]\nANIM_STYLE=1\n[KEY1]\nCENTER=q\nPRESS_STYLE=1\n")
  input.setText("light/skin/port/en_26.ini", "[KEY1]\nCENTER=q\nPRESS_STYLE=2\n")
  const output = template()
  const warnings = applyLegacyBaiduMotion(input, output)
  const motion = decodeBdaAnimation(output.getBytes("light/skin/port/animationConfig"))
  assert.equal(motion.targetBindings.get("py_26")[0].scope, 2)
  assert.equal(motion.targetBindings.get("py_26")[0].event, 1)
  assert.ok(motion.targetBindings.get("KEY_Q").some((binding) => binding.event === 7 && binding.key === "legacy_7"))
  assert.equal(motion.targetBindings.get("KEY_Q").filter((binding) => binding.event === 1).length, 1)
  assert.ok(warnings.some((warning) => warning.includes("动画冲突")))
})

test("Palm-only/unknown fields and random combinations warn instead of silently appearing lossless", async () => {
  const sxi = SkinArchive.open(buildSxiZip(source()).bytes, "sxi")
  const skin = JSON.parse(sxi.getText("skin.json"))
  const animations = skin.default.s_info.ss_2
  animations[1].a1.c_delay = 15
  animations[1].a1.future_property = 33
  animations[3].a3.a_method = "random"
  animations[30] = { id: "ANIM30", a10: { b: { t: 0, c: 10 }, file: "spark.gif" } }
  sxi.setText("skin.json", JSON.stringify(skin))
  const { bytes, warnings } = await convertSxiToBda(sxi, template())
  const motion = decodeBdaAnimation(SkinArchive.open(bytes, "bda").getBytes("light/skin/port/animationConfig"))
  assert.ok(!motion.effects.has("group:legacy_3"))
  assert.ok(!motion.effects.has("alpha:legacy_30"))
  for (const phrase of ["c_delay", "future_property", "随机组合", "a10", "CATEGORY=10"]) {
    assert.ok(warnings.some((warning) => warning.includes(phrase)), phrase)
  }
})

test("infinite repeat stays a looping BDA count and shared definitions survive partial orientation overrides", () => {
  const input = source()
  input.setText("light/skin/port/res/anim.ini", "[ANIM1]\nREPEAT_CNT=inf\n")
  const output = template()
  applyLegacyBaiduMotion(input, output)
  const motion = decodeBdaAnimation(output.getBytes("light/skin/port/animationConfig"))
  const alpha = effect(motion, "alpha", 1)
  assert.equal(alpha.repeatCount, 2147483647)
  assert.equal(alpha.duration, 321)
  assert.deepEqual(alpha.from[0], [10, 30])
  assert.equal(effect(motion, "group", 3).items[0].key, "legacy_1")
  assert.ok(motion.targetBindings.get("KEY_Q").some((binding) => binding.kind === "group"))
})
