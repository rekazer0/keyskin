// 旧版 anim.ini 检查器的结构与接线断言（无 DOM 测试环境，采用源码结构 + 纯函数行为的组合断言）。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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
const preview = read("src/legacy-animation-preview.ts")
const css = read("src/legacy-animation.css")
const pure = read("src/legacy-animation.ts")

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

test("检查器导出 Lead 接线需要的两个入口", () => {
  assert.match(inspector, /export function populateLegacyAnimationInspector\(container: HTMLElement\): boolean/)
  assert.match(inspector, /export function legacyAnimationInspectorTitle\(\): \{ name: string; context: string \} \| undefined/)
  assert.match(inspector, /container\.dataset\.path = appState\.selectedPath/)
})

test("检查器按 DESIGN.md §10 用 ui-* 组件与分组结构呈现", () => {
  for (const className of ["ui-section", "ui-field", "ui-input", "ui-select", "ui-switch", "ui-subsection", "ui-badge", "ui-list-item"]) {
    assert.match(inspector, new RegExp(`\\b${className}\\b`), `缺少 ${className}`)
  }
  // 分组与属性行要能被分类栏 / 筛选 / 改动标记识别。
  assert.match(inspector, /document-property-section/)
  assert.match(inspector, /document-section-heading/)
  assert.match(inspector, /document-section-title/)
  assert.match(inspector, /document-property-grid/)
  assert.match(inspector, /dataset\.inspectorGroupLabel = title/)
  assert.match(inspector, /dataset\.documentKey = key/)
  assert.match(inspector, /dataset\.inspectorRowKey/)
  // 不可编辑状态禁用所有控件。
  assert.match(inspector, /input\.disabled = !isEditing\(\)/)
  assert.match(inspector, /select\.disabled = !isEditing\(\)/)
  assert.match(inspector, /button\.disabled = !isEditing\(\)/)
})

test("编辑走 commitText 一步撤销，并刷新源码与画布", () => {
  assert.match(inspector, /appState\.selectedDocument = IniDocument\.parse\(after\)/)
  assert.match(inspector, /commitText\(appState\.selectedPath, before, after\)/)
  assert.match(inspector, /setSourceValue\(after\)/)
  assert.match(inspector, /refreshPreview\(\)/)
  assert.match(inspector, /updateDirty\(\)/)
  assert.match(inspector, /writeLegacyAnimationFields\(text, entry\.section/)
  assert.match(inspector, /writeLegacyAnimationKind\(text, entry\.section/)
  assert.match(inspector, /writeLegacyAnimationType\(text, entry\.section/)
})

test("每个动效分组包含类型选择、时间轴、字段分组与组合/帧/粒子专属内容", () => {
  for (const label of [
    "动画概览", "动效类型", "动画类型", "粒子类型", "时间轴", "组合", "子动效列表", "组合方式",
    "帧动效", "gif 路径", "发射", "运动", "外观", "在画布预览", "被引用的动效", "自动识别", "高级参数",
  ]) {
    assert.match(inspector + pure, new RegExp(label), `缺少标签 ${label}`)
  }
  assert.match(inspector, /legacyAnimationFieldGroups\(entry\)/)
  assert.match(inspector, /legacyAnimationTimeline\(entry, byIndex\)/)
  assert.match(inspector, /LEGACY_ANIMATION_KINDS\.map/)
  assert.match(inspector, /legacyAnimationTypeOptions\(entry\.kind\)/)
  assert.match(inspector, /legacyAnimationKindLabel/)
  assert.match(inspector, /combinationSummary/)
  // 纯函数确实给出这些分组，源码断言不是空转。
  assert.deepEqual(legacyAnimationFieldGroups(sample.entries[0]).map((group) => group.title), ["数值", "插值", "时间轴"])
  assert.deepEqual(legacyAnimationFieldGroups(sample.entries[1]).map((group) => group.title), ["组合", "时间轴"])
  assert.equal(legacyAnimationTimeline(sample.entries[1], new Map([["1", sample.entries[0]]])).duration, 300)
  assert.deepEqual(LEGACY_ANIMATION_KINDS.map(({ label }) => label), ["基础动效", "组合动效", "帧动效", "粒子动效"])
  assert.deepEqual(legacyAnimationTypeOptions("particle"), [[0, "简单粒子"], [1, "复杂粒子"]])
})

test("顶部示意预览是纯前端 canvas，按时间轴播放几何示意", () => {
  assert.match(inspector, /legacyAnimationPreviewBlock\(model, byIndex\)/)
  assert.match(preview, /element\("canvas", "legacy-animation-preview-canvas"\)/)
  assert.match(preview, /legacyAnimationPreviewState\(entry, currentIndex, elapsed\)/)
  assert.match(preview, /requestAnimationFrame\(tick\)/)
  assert.match(preview, /prefers-reduced-motion: reduce/)
  assert.match(preview, /legacyParticleFrames\(emitter, elapsed/)
  assert.match(preview, /--accent-soft/)
  assert.match(preview, /--font-size-xs/)
})

test("粒子动效保留在键盘画布预览的能力，引用列表可点击说明来源", () => {
  assert.match(inspector, /parseLegacyParticleEmitter\(appState\.selectedDocument, entry\.section\)/)
  assert.match(inspector, /preview\.setParticlePreview\(/)
  assert.match(inspector, /appState\.particlePreviewSection = entry\.section/)
  assert.match(inspector, /legacyAnimationReferences\(styleDocument\(\), layoutDocument\(\)\)/)
  assert.match(inspector, /legacyAnimationReferenceText\(item\)/)
  assert.match(inspector, /legacy-animation-reference-detail/)
  assert.match(inspector, /legacy-animation-reference-list/)
})

test("CSS 只引用 token、没有 !important 与色值字面量，并且由检查器自己加载", () => {
  assert.match(inspector, /import "\.\.\/legacy-animation\.css"/)
  for (const className of [
    "legacy-animation-preview", "legacy-animation-preview-canvas", "legacy-animation-preview-time",
    "legacy-animation-timeline", "legacy-animation-timeline-track", "legacy-animation-chips",
    "legacy-animation-pair", "legacy-animation-warning", "legacy-animation-particle-bar",
    "legacy-animation-reference-list", "legacy-animation-reference-detail",
  ]) {
    assert.match(css, new RegExp(`\\.${className}\\b`), `CSS 缺少 ${className}`)
  }
  assert.doesNotMatch(css, /!important/)
  for (const literal of [/#[0-9a-f]{3,8}\b/i, /\brgba?\(/, /\bhsla?\(/, /(?<![-\w])(?:white|black)(?![-\w])/]) {
    assert.doesNotMatch(css, literal)
  }
  assert.doesNotMatch(css, /font-size:\s*\d/)
  assert.doesNotMatch(css, /(?:padding|margin|gap)(?:-[a-z]+)*:\s*-?\d+px/)
  assert.match(css, /var\(--space-/)
  assert.match(css, /var\(--radius-/)
  assert.match(css, /var\(--font-size-/)
})

test("检查器、预览与纯函数文件都不超过 800 行", () => {
  for (const [name, source] of [["检查器", inspector], ["预览", preview], ["纯函数模块", pure]]) {
    assert.ok(source.split("\n").length <= 800, `${name}超过 800 行`)
  }
})
