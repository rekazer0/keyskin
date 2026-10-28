// 旧版 anim.ini 动画检查器的结构与接线断言（无 DOM 测试环境，采用源码结构 + 纯函数行为的组合断言）。
// 界面行为（列表选择、播放、编辑、撤销）由 scripts/test-baidu-animation.mjs 在真实浏览器里验证。
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"
import {
  LEGACY_ANIMATION_KINDS,
  legacyAnimationFieldGroups,
  legacyAnimationTimeline,
  legacyAnimationTypeOptions,
  parseLegacyAnimationFile,
} from "../src/legacy-animation.ts"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const inspector = read("src/app/legacy-animation-inspector.ts")
const shared = read("src/animation-inspector.ts")
const pure = read("src/legacy-animation.ts")
const tree = read("src/app/file-tree.ts")

const sample = parseLegacyAnimationFile(`[GLOBAL]
ANIM_NUM=2

[ANIM1]
CATEGORY=0
TYPE=2
DURATION=300
FROM=0,0
TO=100,50

[ANIM2]
CATEGORY=1
BUILD_NUM=1
BUILD_LIST=1
BUILD_METHOD=1
`)

test("检查器导出对象头与填充两个入口，标题跟随动效设计 / 粒子设计", () => {
  assert.match(inspector, /export function populateLegacyAnimationInspector\(container: HTMLElement\): boolean/)
  assert.match(inspector, /export function legacyAnimationInspectorTitle\(\): \{ name: string; context: string \} \| undefined/)
  assert.match(inspector, /container\.dataset\.path = appState\.selectedPath/)
  assert.match(inspector, /animationModeTitle\(appState\.animationDesignMode\)/)
})

test("资源配置里百度 anim.ini 与 BDA animationConfig 都分成动效设计与粒子设计", () => {
  assert.match(tree, /label: `动效设计\$\{suffix\}`, path, className: "nav-style", icon: "film", navMode: "motion"/)
  assert.match(tree, /label: `粒子设计\$\{suffix\}`, path, className: "nav-style", icon: "wand-sparkles", navMode: "particle"/)
  assert.match(tree, /bdaConfigPaths\(appState\.archive, theme\.value, orientation\.value, "animation"\)/)
  assert.doesNotMatch(tree, /"动画效果"|动画与动效/, "不再有单独的动画分组或混合入口")
})

test("检查器用公共骨架：列表 → 预览 → 参数分组 → 引用", () => {
  assert.match(inspector, /renderAnimationResource\(container, \{/)
  assert.match(inspector, /shownInAnimationView\(entry\.kind === "particle"\)/, "粒子设计只列粒子，动效设计列其余三类")
  assert.match(inspector, /selectedAnimation\(items\)/)
  assert.match(inspector, /onSelect: selectAnimation/)
  assert.match(inspector, /animationSection\(group\.title, SECTION\)/)
  assert.match(inspector, /const SECTION = "document-property-section"/)
  assert.match(inspector, /dataset\.documentKey = key/)
  assert.match(inspector, /dataset\.inspectorRowKey/)
  for (const part of ["ui-listbox", 'setAttribute("role", "listbox")', 'setAttribute("role", "option")', "aria-selected", "animationPlayer(view.player)", '"预览"', '"引用"']) {
    assert.ok(shared.includes(part), `公共骨架缺少 ${part}`)
  }
})

test("编辑走 commitText 一步撤销，并刷新源码、画布与检查器", () => {
  assert.match(inspector, /appState\.selectedDocument = IniDocument\.parse\(after\)/)
  assert.match(inspector, /commitText\(appState\.selectedPath, before, after\)/)
  assert.match(inspector, /setSourceValue\(after\)/)
  assert.match(inspector, /refreshPreview\(\)/)
  assert.match(inspector, /updateDirty\(\)/)
  assert.match(inspector, /populateKeyInspector\(\)/)
  assert.match(inspector, /writeLegacyAnimationFields\(text, entry\.section/)
  assert.match(inspector, /writeLegacyAnimationKind\(text, entry\.section/)
  assert.match(inspector, /writeLegacyAnimationType\(text, entry\.section/)
  assert.match(inspector, /appendLegacyAnimation\(current, kind, copyOf\)/, "新建与复制都追加新的 [ANIM*]")
  // 不可编辑状态禁用所有控件。
  assert.match(inspector, /input\.disabled = !isEditing\(\)/)
  assert.match(inspector, /select\.disabled = !isEditing\(\)/)
})

test("参数按动效类型分组，组合动效用子动效列表编辑 BUILD_LIST", () => {
  for (const label of ["动效类型", "动画类型", "粒子类型", "组合方式", "子动效列表", "gif 路径", "发射", "运动", "外观", "其他参数"]) {
    assert.match(inspector + pure, new RegExp(label), `缺少标签 ${label}`)
  }
  assert.match(inspector, /legacyAnimationFieldGroups\(entry\)/)
  assert.match(inspector, /legacyAnimationTimeline\(entry, byIndex\)/)
  assert.match(inspector, /comboList\(\{/)
  assert.match(inspector, /BUILD_NUM: String\(ids\.length\)/, "增删子动效同步 BUILD_NUM")
  assert.deepEqual(legacyAnimationFieldGroups(sample.entries[0]).map((group) => group.title), ["变化", "时间与循环"])
  assert.deepEqual(legacyAnimationFieldGroups(sample.entries[1]).map((group) => group.title), ["组合", "时间与循环"])
  assert.equal(legacyAnimationTimeline(sample.entries[1], new Map([["1", sample.entries[0]]])).duration, 300)
  assert.deepEqual(LEGACY_ANIMATION_KINDS.map(({ label }) => label), ["基础动效", "组合动效", "帧动效", "粒子动效"])
  assert.deepEqual(legacyAnimationTypeOptions("particle"), [[0, "简单粒子"], [1, "复杂粒子"]])
})

test("播放器按百度的语义采样真实参数，画布上的粒子预览由它取代", () => {
  assert.match(inspector, /iniPreviewClip\(appState\.selectedDocument!, entry\.section, \{ fillBefore: true \}\)/)
  assert.match(inspector, /key: `\$\{appState\.selectedPath\}\|\$\{entry\.section\}`/)
  assert.match(inspector, /preview\.setParticlePreview\(\)/)
  assert.match(inspector, /legacyAnimationReferences\(styleDocument\(\), layoutDocument\(\)\)/)
  assert.ok(!existsSync(new URL("../src/legacy-animation-preview.ts", import.meta.url)), "旧的示意预览已删除")
  assert.ok(!existsSync(new URL("../src/legacy-animation.css", import.meta.url)), "样式并入公共组件")
})

test("检查器、公共骨架与纯函数文件都不超过 800 行", () => {
  for (const [name, source] of [["检查器", inspector], ["公共骨架", shared], ["纯函数模块", pure]]) {
    assert.ok(source.split("\n").length <= 800, `${name}超过 800 行`)
  }
})
