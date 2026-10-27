// anim.ini 的结构化模型：解析、按类型清理字段的写回、时间轴/几何预览，以及与现有预览解析器的语义一致性。
import assert from "node:assert/strict"
import test from "node:test"
import { IniDocument } from "../src/ini.ts"
import {
  LEGACY_ANIMATION_FIELDS,
  LEGACY_ANIMATION_KINDS,
  legacyAnimationFieldGroups,
  legacyAnimationKindLabel,
  legacyAnimationPreviewState,
  legacyAnimationReferenceText,
  legacyAnimationReferences,
  legacyAnimationTimeline,
  legacyAnimationTypeLabel,
  legacyAnimationTypeOptions,
  legacyAnimationValueParts,
  parseLegacyAnimationFile,
  writeLegacyAnimationFields,
  writeLegacyAnimationKind,
  writeLegacyAnimationType,
} from "../src/legacy-animation.ts"
import {
  legacyAnimationOpacity,
  legacyAnimationTranslation,
  parseLegacyAnimation,
} from "../src/preview-animation.ts"

const ANIM_INI = `[GLOBAL]
ANIM_NUM=4

; 组合动效与基础动效分开写
[ANIM1]
CATEGORY=0
TYPE=0
DURATION=200
DELAY=100
FROM=0
TO=255
INTPOL=0

[ANIM2]
CATEGORY=0
TYPE=2
DURATION=300
FROM=10,20
TO=110,70
CUSTOM=keep

[ANIM3]
CATEGORY=1
BUILD_NUM=2
BUILD_LIST=1,2
BUILD_METHOD=1

[ANIM4]
CATEGORY=2
ANIM_PATH=test.gif

[ANIM5]
CATEGORY=3
TYPE=0
PARTICLE_IMAGE=11,31
LIFE=1000,2000
EMIT_REGION=0,0,1,1
BIRTH_RATE=5
TOTAL_NUMBER=10

[PATH1]
MOVE_TO_POINT=0,0
LINE_TO_POINT=0.2,0.2
`

function entriesByName(text = ANIM_INI) {
  return new Map(parseLegacyAnimationFile(text).entries.map((entry) => [String(entry.index), entry]))
}

function sectionText(text, section) {
  const start = text.indexOf(`[${section}]`)
  assert.ok(start >= 0, `${section} 应该存在`)
  const rest = text.slice(start + section.length + 2)
  const next = rest.search(/^\[/m)
  return next < 0 ? rest : rest.slice(0, next)
}

/* —— 解析 —— */
test("anim.ini 解析出基础 / 组合 / 帧 / 粒子四类动效", () => {
  const model = parseLegacyAnimationFile(ANIM_INI)
  assert.equal(model.animNum, 4)
  assert.deepEqual(model.extraSections, ["PATH1"], "粒子的 [PATH1] 曲线段不算动效，但要保留")
  assert.deepEqual(model.entries.map((entry) => [entry.section, entry.kind, entry.type, entry.category]), [
    ["ANIM1", "basic", 0, 0],
    ["ANIM2", "basic", 2, 0],
    ["ANIM3", "combination", undefined, 1],
    ["ANIM4", "frame", undefined, 2],
    ["ANIM5", "particle", 0, 3],
  ])
  const basic = model.entries[1]
  assert.deepEqual(basic.fields.map(([key]) => key), ["CATEGORY", "TYPE", "DURATION", "FROM", "TO", "CUSTOM"])
  assert.equal(model.entries[0].index, 1)
})

test("CATEGORY 缺省时按内容识别动效类型", () => {
  const model = parseLegacyAnimationFile(`[GLOBAL]
ANIM_NUM=4

[ANIM1]
TYPE=0
FROM=0
TO=255
DURATION=100

[ANIM2]
BUILD_NUM=2
BUILD_LIST=1,1
BUILD_METHOD=0

[ANIM3]
ANIM_PATH=press.gif

[ANIM4]
PARTICLE_IMAGE=11
LIFE=100,200
`)
  assert.deepEqual(model.entries.map((entry) => [entry.section, entry.kind, entry.category]), [
    ["ANIM1", "basic", undefined],
    ["ANIM2", "combination", undefined],
    ["ANIM3", "frame", undefined],
    ["ANIM4", "particle", undefined],
  ])
})

test("动效类型与 TYPE 的中文标签覆盖手册定义", () => {
  assert.deepEqual(LEGACY_ANIMATION_KINDS.map(({ kind, label }) => [kind, label]), [
    ["basic", "基础动效"],
    ["combination", "组合动效"],
    ["frame", "帧动效"],
    ["particle", "粒子动效"],
  ])
  assert.deepEqual(legacyAnimationTypeOptions("basic"), [
    [0, "透明度"], [1, "旋转"], [2, "平移"], [3, "缩放（目标区域）"], [4, "缩放（整体）"], [5, "3D 旋转"],
  ])
  assert.deepEqual(legacyAnimationTypeOptions("particle"), [[0, "简单粒子"], [1, "复杂粒子"]])
  assert.deepEqual(legacyAnimationTypeOptions("frame"), [])
  assert.equal(legacyAnimationTypeLabel("basic", 4), "缩放（整体）")
  assert.equal(legacyAnimationTypeLabel("particle", 1), "复杂粒子")
  assert.equal(legacyAnimationTypeLabel("basic", 9), "TYPE=9")
  assert.equal(legacyAnimationKindLabel("combination"), "组合动效")
})

test("字段分组跟随 TYPE 选择 FROM/TO 的写法，未知键进高级参数", () => {
  const map = entriesByName()
  assert.deepEqual(legacyAnimationFieldGroups(map.get("1")).map((group) => group.title), ["数值", "插值", "时间轴"])
  assert.deepEqual(legacyAnimationFieldGroups(map.get("2"))[0], {
    title: "数值",
    keys: ["FROM", "TO", "FROM_PX", "TO_PX"],
  })
  assert.deepEqual(legacyAnimationFieldGroups(map.get("2")).at(-1), { title: "高级参数（1）", keys: ["CUSTOM"] })
  assert.deepEqual(legacyAnimationFieldGroups(map.get("3")).map((group) => group.title), ["组合", "时间轴"])
  assert.deepEqual(legacyAnimationFieldGroups(map.get("4")).map((group) => group.title), ["帧动效"])
  assert.deepEqual(legacyAnimationFieldGroups(map.get("5")).map((group) => group.title), ["发射", "运动", "外观", "时间轴"])
  assert.equal(LEGACY_ANIMATION_FIELDS.FROM_PX.unit, "px")
  assert.equal(LEGACY_ANIMATION_FIELDS.BUILD_METHOD.label, "组合方式")
})

/* —— 写回 —— */
test("改字段只动目标行：保留段顺序、注释、未知键与其他段，并修正 ANIM_NUM", () => {
  const before = parseLegacyAnimationFile(ANIM_INI)
  assert.equal(before.animNum, 4)
  const after = writeLegacyAnimationFields(ANIM_INI, "ANIM2", { TO: "200,100", NEW_FIELD: "1" })
  assert.match(sectionText(after, "ANIM2"), /TO=200,100/)
  assert.match(sectionText(after, "ANIM2"), /NEW_FIELD=1/)
  assert.match(sectionText(after, "ANIM2"), /CUSTOM=keep/)
  assert.match(sectionText(after, "ANIM2"), /FROM=10,20/)
  assert.match(after, /; 组合动效与基础动效分开写/)
  assert.match(after, /ANIM_NUM=5/, "实际有 5 个 [ANIM*]，写回时按段数修正 ANIM_NUM")
  assert.ok(after.startsWith("[GLOBAL]"))
  assert.equal(after.indexOf("[ANIM3]") > after.indexOf("[ANIM2]"), true)
  assert.match(after, /\[PATH1\][\s\S]*LINE_TO_POINT=0\.2,0\.2/, "未知段保持原样")

  const removed = writeLegacyAnimationFields(after, "ANIM2", { CUSTOM: undefined })
  assert.doesNotMatch(sectionText(removed, "ANIM2"), /CUSTOM/)
  assert.match(sectionText(removed, "ANIM2"), /TO=200,100/)
})

test("切到组合动效时清理基础字段、写入组合默认值，未知键保留", () => {
  const after = writeLegacyAnimationKind(ANIM_INI, "ANIM2", "combination")
  const body = sectionText(after, "ANIM2")
  assert.match(body, /CATEGORY=1/)
  assert.match(body, /BUILD_LIST=/)
  assert.match(body, /BUILD_NUM=0/)
  assert.match(body, /BUILD_METHOD=1/)
  assert.match(body, /CUSTOM=keep/, "未知键不能被类型切换清掉")
  for (const key of ["TYPE", "FROM", "TO", "DURATION"]) assert.doesNotMatch(body, new RegExp(`^${key}=`, "m"))
  assert.equal(parseLegacyAnimationFile(after).entries.find((entry) => entry.section === "ANIM2").kind, "combination")
  assert.match(after, /ANIM_NUM=5/)
  assert.equal(writeLegacyAnimationKind(after, "ANIM2", "combination"), after, "同类型写回不产生改动")
})

test("切到帧动效 / 粒子动效写入各自的默认字段", () => {
  const frame = writeLegacyAnimationKind(ANIM_INI, "ANIM2", "frame")
  assert.match(sectionText(frame, "ANIM2"), /CATEGORY=2/)
  assert.match(sectionText(frame, "ANIM2"), /ANIM_PATH=/)
  assert.doesNotMatch(sectionText(frame, "ANIM2"), /^TYPE=/m)

  const particle = writeLegacyAnimationKind(ANIM_INI, "ANIM2", "particle")
  const body = sectionText(particle, "ANIM2")
  assert.match(body, /CATEGORY=3/)
  for (const key of ["LIFE", "EMIT_REGION", "TOTAL_NUMBER", "BIRTH_RATE", "PARTICLE_IMAGE", "INIT_ALPHA"]) {
    assert.match(body, new RegExp(`^${key}=`, "m"), `${key} 应有粒子默认值`)
  }
  assert.equal(parseLegacyAnimationFile(particle).entries.find((entry) => entry.section === "ANIM2").kind, "particle")
})

test("切 TYPE 时重置 FROM/TO 写法并清理该类型不适用的字段", () => {
  const rotate = writeLegacyAnimationType(ANIM_INI, "ANIM2", 1)
  const body = sectionText(rotate, "ANIM2")
  assert.match(body, /TYPE=1/)
  assert.match(body, /^FROM=0$/m)
  assert.match(body, /^TO=360$/m)
  assert.doesNotMatch(body, /FROM_PX|TO_PX/)
  assert.match(body, /CUSTOM=keep/)

  const scaled = writeLegacyAnimationType(ANIM_INI, "ANIM2", 4)
  assert.match(sectionText(scaled, "ANIM2"), /^FROM=100,100$/m)
  assert.match(sectionText(scaled, "ANIM2"), /^TO=100,100$/m)

  const pixels = writeLegacyAnimationType(ANIM_INI, "ANIM2", 2)
  assert.match(sectionText(pixels, "ANIM2"), /^FROM=0,0$/m)
  assert.equal(writeLegacyAnimationType(ANIM_INI, "ANIM2", 9), ANIM_INI, "非法 TYPE 不写回")
  assert.equal(writeLegacyAnimationType(ANIM_INI, "ANIM3", 1), ANIM_INI, "组合动效没有基础 TYPE")
})

/* —— 时间轴与几何预览 —— */
test("时间轴按 DELAY / REPEAT / REPEAT_MODE 计算总时长", () => {
  const map = entriesByName()
  assert.deepEqual(legacyAnimationTimeline(map.get("1"), map), {
    delay: 100, duration: 200, repeat: 1, reverse: false, remove: undefined, total: 300,
  })
  const repeated = parseLegacyAnimationFile(`[GLOBAL]
ANIM_NUM=1

[ANIM1]
CATEGORY=0
TYPE=0
FROM=0
TO=255
DURATION=100
DELAY=50
REPEAT_CNT=3
REPEAT_MODE=1
REMOVE=1
`)
  assert.deepEqual(legacyAnimationTimeline(repeated.entries[0], new Map([["1", repeated.entries[0]]])), {
    delay: 50, duration: 100, repeat: 3, reverse: true, remove: true, total: 50 + 100 * 3 * 2,
  })
})

test("组合动效：接续取子动效总和，同时取最大值", () => {
  const map = entriesByName()
  assert.equal(legacyAnimationTimeline(map.get("3"), map).duration, 300 + 300)
  const parallel = parseLegacyAnimationFile(ANIM_INI.replace("BUILD_METHOD=1", "BUILD_METHOD=0"))
  const parallelMap = new Map(parallel.entries.map((entry) => [String(entry.index), entry]))
  assert.equal(legacyAnimationTimeline(parallelMap.get("3"), parallelMap).duration, 300)
  assert.equal(legacyAnimationTimeline(map.get("4"), map).duration, 0, "帧动效时长由 gif 自己决定")
  assert.equal(legacyAnimationTimeline(map.get("5"), map).duration, 2000, "粒子动效未写 DURATION 时按 10 个 / 5 个每秒估算")
})

test("几何预览按 TYPE 解释 FROM/TO，并支持 rand() 随机区间取中点", () => {
  const map = entriesByName()
  assert.equal(legacyAnimationPreviewState(map.get("1"), map, 0).opacity, 0)
  assert.equal(legacyAnimationPreviewState(map.get("1"), map, 100).opacity, 0, "延迟期间保持起始值")
  assert.equal(legacyAnimationPreviewState(map.get("1"), map, 200).opacity, 0.5)
  assert.equal(legacyAnimationPreviewState(map.get("1"), map, 300).opacity, 1)
  assert.equal(legacyAnimationPreviewState(map.get("1"), map, 999).opacity, 1, "播完停在终止值")

  assert.deepEqual(legacyAnimationPreviewState(map.get("2"), map, 0).translate, [10, 20])
  assert.deepEqual(legacyAnimationPreviewState(map.get("2"), map, 150).translate, [60, 45])
  assert.deepEqual(legacyAnimationPreviewState(map.get("2"), map, 300).translate, [110, 70])

  assert.equal(legacyAnimationPreviewState(map.get("4"), map, 100).active, false, "帧动效不做几何示意")

  const randomized = parseLegacyAnimationFile(`[GLOBAL]
ANIM_NUM=1

[ANIM1]
CATEGORY=0
TYPE=0
FROM=0
TO=rand(100,200)
DURATION=100
`)
  assert.equal(legacyAnimationPreviewState(randomized.entries[0], new Map([["1", randomized.entries[0]]]), 50).opacity, 75 / 255)
})

test("插值器按 INTPOL 加速或减速", () => {
  const accelerated = parseLegacyAnimationFile(`[GLOBAL]
ANIM_NUM=1

[ANIM1]
CATEGORY=0
TYPE=0
FROM=0
TO=255
DURATION=100
INTPOL=1
`)
  const state = legacyAnimationPreviewState(accelerated.entries[0], new Map([["1", accelerated.entries[0]]]), 50)
  assert.equal(state.opacity, 0.25, "加速插值器 progress²")
})

test("组合动效的几何状态：接续时依次生效，同时时叠加", () => {
  const map = entriesByName()
  const sequential = legacyAnimationPreviewState(map.get("3"), map, 450)
  assert.equal(sequential.opacity, 1, "第一个子动效已播完，透明度停在终止值")
  assert.deepEqual(sequential.translate, [60, 45], "第二个子动效从 300ms 开始，450ms 时走到一半")
  const parallelText = ANIM_INI.replace("BUILD_METHOD=1", "BUILD_METHOD=0")
  const parallelMap = entriesByName(parallelText)
  const parallel = legacyAnimationPreviewState(parallelMap.get("3"), parallelMap, 300)
  assert.deepEqual(parallel.translate, [110, 70], "同时播放时第二个子动效从自己的起点独立播放")
  assert.equal(parallel.opacity, 1, "透明度按乘积累加，第一个子动效结束后为 1")
})

test("与 preview-animation 的 parseLegacyAnimation 语义一致（透明度 / 平移）", () => {
  const styles = IniDocument.parse(`[GLOBAL]
STYLE_NUM=2

[STYLE1]
PRESS_ANIM=1

[STYLE2]
PRESS_ANIM=2
`)
  const animations = IniDocument.parse(ANIM_INI)
  const legacy = parseLegacyAnimation(styles, animations)
  const map = entriesByName()
  // 播完之后本模块按「停在终止值」处理（画布需要保持末帧），preview-animation 则返回 undefined，比较窗口内的采样。
  for (const elapsed of [0, 50, 100, 150, 200, 250, 300]) {
    assert.equal(
      legacyAnimationPreviewState(map.get("1"), map, elapsed).opacity,
      legacyAnimationOpacity(legacy, "1", elapsed),
      `透明度在 ${elapsed}ms 应该一致`,
    )
    const expected = legacyAnimationTranslation(legacy, "2", elapsed, { width: 100, height: 100 }) ?? [10, 20]
    const actual = legacyAnimationPreviewState(map.get("2"), map, elapsed).translate
    assert.ok(
      Math.abs(actual[0] - expected[0]) < 1e-9 && Math.abs(actual[1] - expected[1]) < 1e-9,
      `平移到 ${elapsed}ms 应该一致（${actual} vs ${expected}）`,
    )
  }
})

/* —— default.css / 布局引用 —— */
test("收集 default.css 与布局 ANIM_STYLE 指向的动效", () => {
  const styles = IniDocument.parse(`[GLOBAL]
STYLE_NUM=2

[STYLE335]
PRESS_ANIM=1
SHOW_ANIM=2

[STYLE336]
PRESS_ANIM=3
`)
  const layout = IniDocument.parse(`[PANEL]
KEY_NUM=1

[KEY1]
ANIM_STYLE=335
FORE_ANIM_STYLE=335,336
`)
  const references = legacyAnimationReferences(styles, layout)
  assert.deepEqual(
    references.map((reference) => [reference.animation, legacyAnimationReferenceText(reference)]),
    [
      [1, "STYLE335 · PRESS_ANIM"],
      [2, "STYLE335 · SHOW_ANIM"],
      [3, "STYLE336 · PRESS_ANIM"],
      [1, "KEY1.ANIM_STYLE → STYLE335 · PRESS_ANIM"],
      [2, "KEY1.ANIM_STYLE → STYLE335 · SHOW_ANIM"],
      [1, "KEY1.FORE_ANIM_STYLE → STYLE335 · PRESS_ANIM"],
      [2, "KEY1.FORE_ANIM_STYLE → STYLE335 · SHOW_ANIM"],
      [3, "KEY1.FORE_ANIM_STYLE → STYLE336 · PRESS_ANIM"],
    ],
  )
  assert.deepEqual(legacyAnimationReferences(undefined, layout), [])
})

test("顶层逗号切分不会拆开 rand() 里的逗号", () => {
  assert.deepEqual(legacyAnimationValueParts("rand(-50,0),rand(1,2)"), ["rand(-50,0)", "rand(1,2)"])
  assert.deepEqual(legacyAnimationValueParts("10,20,30"), ["10", "20", "30"])
})
