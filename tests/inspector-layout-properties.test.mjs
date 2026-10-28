import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { appSource } from "./helpers/app-source.mjs"

const main = appSource()

test("every selected INI layout can open its property inspector", () => {
  // ini / cnd / pop 都是属性面板能描述并回写的布局配置文档。
  assert.match(main, /function isConfigLayoutPath\(path: string\): boolean \{\s*return \/\\\.\(ini\|cnd\|pop\)\$\/i\.test\(path\)/)
  // BDA 容器里的同名遗留文件由 bda 解析器处理，不能按普通布局文档放行；
  // 搜狗皮肤自己的 INI 由搜狗检查器解析；画布用的官方骨架不属于皮肤，不是皮肤里的文件。
  assert.match(main, /function showsLayoutProperties\(path: string\): boolean \{\s*if \(appState\.archive\?\.format === "ssf"\) return \/\\\.ini\$\/i\.test\(path\) && appState\.archive\.isText\(path\)\s*return appState\.archive\?\.format !== "bda" && isConfigLayoutPath\(path\)/)
  // 搜狗皮肤的属性由 ssf-inspector.ts 填进文档分区，不走百度的文档解释。
  assert.match(main, /if \(appState\.archive\?\.format === "ssf"\) \{\s*documentFieldsGroup\.hidden = !populateSsfInspector\(documentFields\)/)
  // 手心皮肤同样由自己的检查器（sxi-inspector.ts）读写 skin.json。
  assert.match(main, /if \(appState\.archive\?\.format === "sxi"\) \{\s*documentFieldsGroup\.hidden = !populateSxiInspector\(documentFields\)/)
  // 从任意侧边栏点开布局文件都落到属性页。
  assert.match(main, /preferredSidebarView === "overview" \|\| showsLayoutProperties\(path\)/)
  // “源文件”侧边栏不再把布局文件顶到源代码页。
  assert.match(main, /preferredSidebarView === "source"[\s\S]{0,240}&& path !== appState\.layoutPath && !showsLayoutProperties\(path\)/)
  // 属性标签对布局文件始终可用，不再要求概览分组或当前布局。
  assert.match(main, /const configLayoutSelected = showsLayoutProperties\(appState\.selectedPath\)/)
  assert.match(main, /\(configLayoutSelected \|\| overviewSelected \|\| layoutSelected\) && !imageSelected/)
  assert.match(main, /const layoutSelected = appState\.selectedPath === appState\.layoutPath && \/\\\.ini\$\/i\.test\(appState\.selectedPath\)/)
  assert.doesNotMatch(main, /previousInspectorTab === "source" && path === layoutPath/)
})

test("a single-section layout keeps the inspector category rail", () => {
  // 只有 [PANEL] 的布局（help.ini）此前被当成「没有可切换的分组」，整条分类轨被收起，
  // 属性检查器看起来比多分区布局少了一侧导航。只有完全没有分组时才该隐藏。
  assert.doesNotMatch(main, /mobileInspectorGroups\.hidden = groups\.length < 2/)
  assert.match(main, /mobileInspectorGroups\.hidden = groups\.length === 0/)
})

test("unknown INI properties keep their source names", () => {
  assert.match(main, /const known = documentFieldLabels\[key\] \?\? sourceKeyLabels\[key\]/)
  assert.match(main, /documentSectionLabels\[section\] \?\? section/)
  // 译文之外的原始键名留在悬停提示里，属性行始终能对应回 ini 的键。
  assert.match(main, /caption\.title = captionLabel === entry\.key \? entry\.key : `\$\{captionLabel\}（\$\{entry\.key\}）`/)
})

test("document inspector labels cover the keys real skins use", () => {
  const labels = main.slice(main.indexOf("const documentFieldLabels"), main.indexOf("const documentSectionLabels"))
  // 只出现在文档配置节里的键，此前会显示成英文原名。
  for (const key of [
    "NAMES", "VALUES", "VERSION", "TEXT_STYLE", "BACK_ANIM_STYLE", "FORE_ANIM_STYLE", "HW_FORE_STYLE",
    "ANIM_LEVEL", "ICON_NUM", "ICON_INDEX", "BACK_ICON", "ARROW_ICON", "ICON_UP", "ICON_DN", "ICON_LT",
    "ICON_RT", "ANCHOR_TYPE", "PERSIST", "CELL_W", "FIRST_GAP", "NML_BACK_STYLE", "SEL_BACK_STYLE",
    "NML_FONT_STYLE", "SEL_FONT_STYLE", "HLINE_STYLE", "VLINE_STYLE", "SCROLL_SIDE", "SYM_LAYOUT",
    "EVENT_NUM", "IDLE_TIME", "FIX_SIZE",
  ]) {
    assert.match(labels, new RegExp(`^\\s{2}${key}: "[^"]+"`, "m"), `${key} 缺少中文标签`)
  }
  // 侧边栏分组名与源码标签表共用，避免同一概念出现两种写法。
  assert.match(main, /^import \{ sourceKeyLabels \} from "\.\.?\/config-labels\.ts"$/m)
  // 按 id 绑定布局文件的键（SYM_LAYOUT / NUM_9_LAYOUT…）沿用侧边栏名称。
  assert.match(main, /const layoutIDLabels: Record<string, string> = \{/)
  assert.match(main, /const layout = key\.match\(\/\^\(\[A-Z0-9_\]\+\)_LAYOUT\$\/\)/)
  for (const id of ["en_9_pad", "en_9s_pad", "def_26_new", "en_26_new", "en_26s_new"]) {
    assert.match(main, new RegExp(`^\\s{2}${id}: "[^"]+"`, "m"), `${id} 布局缺少名称`)
  }
})

test("document sections and category rail stay readable", () => {
  const sections = main.slice(main.indexOf("const documentSectionLabels"), main.indexOf("const documentPairFieldLabels"))
  for (const section of ["LIST", "BAR", "SWITCH", "TAB", "DRAW", "VIEWSTATE"]) {
    assert.match(sections, new RegExp(`^\\s{2}${section}: "[^"]+"`, "m"), `${section} 分区缺少中文名称`)
  }
  assert.match(main, /const event = section\.match\(\/\^EVENT\(\\d\+\)\$\/i\)/)
  // 分类轨上不再出现两个同名按钮；去重后的名称要写回分组自身，
  // 否则按标签找回 active 分组时会选中同名的另一个。
  assert.match(main, /const usedRailLabels = new Map<string, number>\(\)/)
  // 面板重绘会重建分区元素，当前分组要用稳定键记住，否则高亮会跳回同名的第一个分组。
  assert.match(main, /inspectorGroupKey: ""/)
  assert.match(main, /function mobileInspectorGroupKey\(group: HTMLElement\): string \{/)
  assert.match(main, /const active = groups\.find\(\(group\) => mobileInspectorGroupKey\(group\) === appState\.inspectorGroupKey\)/)
  assert.match(main, /const seen = usedRailLabels\.get\(label\) \?\? 0/)
  assert.match(main, /label = `\$\{label\} \$\{seen \+ 1\}`\s*\n\s*group\.dataset\.inspectorGroupLabel = label/)
})

test("numeric fields never hide a non-numeric value", () => {
  assert.match(main, /function looksNumeric\(value: string\): boolean \{\s*return \/\^-\?\\d\+\(\?:\\\.\\d\+\)\?\$\/\.test\(value\.trim\(\)\)/)
  assert.match(main, /if \(documentNumericFields\.has\(entry\.key\) && looksNumeric\(entry\.value\)\) \{/)
})

test("style reference thumbnails are redrawn when their group becomes visible", () => {
  // 这一行曾经落在 setMobileInspectorGroup 之外，变成模块顶层的死代码。
  assert.match(main, /quickInspector\.scrollTop = 0[\s\S]{0,220}redrawStyleStateCanvases\(\)/)
  assert.doesNotMatch(main, /\n\}\n\s*redrawStyleStateCanvases\(\)/)
})
