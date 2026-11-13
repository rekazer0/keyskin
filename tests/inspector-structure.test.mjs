// 检查器结构规范（DESIGN.md §10）：模式切换 → 对象头 → 可折叠分组 → 属性行；分类栏只做导航。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { appSource } from "./helpers/app-source.mjs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const html = read("index.html")
const shell = read("src/inspector-shell.ts")
const main = appSource()
const pane = html.slice(html.indexOf('<section class="source">'), html.indexOf('<div id="resource-inspector"'))

test("pane header: segmented mode switch above the object header", () => {
  const tabs = pane.indexOf('class="inspector-tabs ui-segmented"')
  const title = pane.indexOf('class="inspector-title key-inspector-title"')
  assert.ok(tabs > 0 && title > tabs, "模式切换在对象头之上")
  for (const tab of ["properties", "source", "ai"]) assert.match(pane, new RegExp(`data-inspector-tab="${tab}"`))
})

test("object-level actions and pointer modes live in the object header", () => {
  const actions = pane.slice(pane.indexOf("inspector-object-actions"), pane.indexOf('<div id="quick-inspector"'))
  for (const action of ["copy", "swap", "delete"]) assert.match(actions, new RegExp(`data-key-action="${action}"`))
  for (const mode of ["select", "move"]) assert.match(actions, new RegExp(`data-key-mode="${mode}"`))
  const toolbar = html.slice(html.indexOf('class="preview-toolbar-start"'), html.indexOf('class="preview-toolbar-end"'))
  assert.doesNotMatch(toolbar, /data-key-mode=/, "选择 / 移动不再放在画布工具栏")
})

test("properties are flat sections of rows inside one form scope", () => {
  assert.match(pane, /<div id="quick-inspector" class="ui-form" hidden>/)
  assert.doesNotMatch(pane, /inspector-card|appearance-section-heading|inspector-padding-box/, "不再使用卡片套卡片")
  assert.doesNotMatch(pane, /<svg\b/)
  for (const group of ["key-layout-fields", "key-appearance-fields", "key-typography-fields", "key-gesture-fields"]) {
    assert.match(pane, new RegExp(`<section class="ui-section key-only ${group}"[^>]*>\\s*<h3>`))
  }
})

test("batch arrange tools only exist for multi-selection", () => {
  assert.match(pane, /id="inspector-multi-layout"[^>]*hidden/)
  assert.match(main, /multiLayout\.hidden = !multiAvailable/)
})

test("the category rail only navigates: there is no grouped display mode", () => {
  assert.doesNotMatch(html, /inspector-grouped-display/)
  assert.doesNotMatch(main, /inspectorGroupedDisplay/)
})

test("sections are always expanded; edits can be reset from the rail", () => {
  assert.doesNotMatch(shell, /collapse|chevron/)
  // 属性分组不折叠；唯一的 <details> 是手机上的对象操作菜单（.toolbar-more，与预览「更多」同一套）
  assert.doesNotMatch(pane.replace(/<details[^>]*class="[^"]*toolbar-more[^"]*"[\s\S]*?<\/details>/g, ""), /<details|<summary/)
  assert.match(shell, /function resetAll/)
  assert.match(shell, /export function setInspectorKind/)
  assert.match(main, /setInspectorKind\(appState\.archive\?\.format === "bda" \? "bda" : appState\.archive \? "bds" : ""\)/)
})

test("the right rail: filter on top, groups with icon and label, edits count and reset at the bottom", () => {
  // Not <aside>: the sidebar's global `aside` rules would slide the rail off-screen on phones.
  const start = pane.indexOf('<div class="inspector-rail"')
  assert.ok(start >= 0, "分类栏不能用 <aside>")
  const rail = pane.slice(start, pane.indexOf("</nav>", start))
  assert.ok(rail.indexOf("inspector-filter-open") < rail.indexOf('<nav id="mobile-inspector-groups"'), "筛选在分组之上")
  assert.match(pane, /id="inspector-filter"[^>]*aria-label="筛选属性"/)
  const css = read("src/inspector.css")
  assert.match(css, /\.source \.inspector-rail \{[^}]*position: sticky;[^}]*float: right;/)
  assert.match(read("src/app/mobile-layout.ts"), /button\.append\(groupIcon\(label\), text\)/)
  assert.match(shell, /rail\.append\(reset\)/)
  // 导航标签与分组标题同名
  for (const [, label, heading] of html.matchAll(/data-inspector-group-label="([^"]+)">\s*<h3>([^<]+)<\/h3>/g)) assert.equal(label, heading)
})

test("style references are one shared card: number and kind on the left, normal | pressed previews on the right", () => {
  // 五处构建器（百度/手心、BDA、搜狗、动画图片、动画样式）都只组装 styleReferenceCard() 的参数。
  for (const file of ["src/app/style-references.ts", "src/bda-editor.ts", "src/app/ssf-fields.ts", "src/app/property-rows.ts"]) assert.match(read(file), /styleReferenceCard\(\{/, file)
  assert.match(read("src/app/legacy-animation-inspector.ts"), /StyleReferenceState\[\]/)
  assert.match(read("src/components.css"), /^\.ui-style-ref \{/m)
  assert.doesNotMatch(read("src/inspector.css"), /style-reference-row|style-picker-state|sound-style-main/)
})

test("the text group imports skin fonts and writes GLOBAL FONT_PATH to every CSS", () => {
  assert.match(pane, /<select id="font-file-select"/)
  assert.match(pane, /id="font-import"/)
  assert.match(pane, /id="font-remove"/)
  assert.match(read("src/app/skin-fonts.ts"), /withGlobalFontPath/)
  assert.match(read("src/app/skin-fonts.ts"), /skinStylePaths/)
})

test("gestures form a cross: tap in the middle, swipes around it, long press below", () => {
  const css = read("src/inspector.css")
  assert.match(css, /grid-template-areas: "\. up \." "left center right" "\. down \." "hold hold hold";/)
  for (const gesture of ["CENTER", "HOLD", "UP", "DOWN", "LEFT", "RIGHT"]) assert.match(pane, new RegExp(`data-gesture="${gesture}"`))
})

test("filter, modified marker and scrub handles live in the shared inspector shell", () => {
  assert.match(shell, /function applyFilter/)
  assert.match(shell, /data-filter-miss/)
  assert.match(shell, /function revertRow/)
  assert.match(shell, /className = "inspector-modified"/)
  assert.match(shell, /toggleAttribute\("data-scrub", Boolean\(scrubbableField\(handle\)\)\)/)
})
