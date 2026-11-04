import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { appSource } from "./helpers/app-source.mjs"

const html = readFileSync(new URL("../picker.html", import.meta.url), "utf8")
const script = readFileSync(new URL("../src/picker-window.ts", import.meta.url), "utf8")
const css = readFileSync(new URL("../src/picker.css", import.meta.url), "utf8")
const main = appSource()

test("图片切片窗口的标题栏是 .ui-pane-header：返回、样式名、图片名、数量、搜索", () => {
  assert.match(html, /<header class="ui-pane-header picker-toolbar">/)
  assert.match(html, /<span id="picker-style" hidden><\/span>/)
  assert.match(script, /styleName\.textContent = payload\.styleName \?\? ""/)
  assert.match(css, /\.picker-toolbar \{/)
  assert.match(main, /styleName: imagePickerStyleName\(target\)/)
})

test("左侧返回项在切片窗口与全部图片列表之间切换", () => {
  assert.match(html, /<button id="picker-back" class="ui-icon-button"[^>]*title="返回全部图片" aria-label="返回"/)
  assert.match(script, /if \(view === "image"\) showResourceList\(\)/)
  assert.match(script, /back\.title = "返回图片切片"/)
  assert.match(script, /emitMain\("image-picker-resources-request"\)/)
  assert.match(main, /onPickerEvent\("image-picker-resources-request"/)
})

test("全部图片列表复用现有窗口，不再新建资源窗口", () => {
  assert.doesNotMatch(main, /"resource-picker"/)
  assert.doesNotMatch(main, /picker\.html\?mode=/)
  assert.match(main, /function openImagePickerList\(\): void \{[\s\S]{0,220}showPickerWindow\("list"/)
  assert.match(main, /WebviewWindow\.getByLabel\("image-picker"\)/)
  assert.match(main, /emitToPicker\("image-picker-show-list"\)/)
  assert.match(script, /onMain\("image-picker-show-list", \(\) => showResourceList\(\)\)/)
  // 列表项只上报选择，选完由主窗口决定是切图还是关窗。
  assert.equal(script.match(/getCurrentWindow\(\)\.close\(\)/g)?.length, 1)
  // Esc 分层：先关预览，再关窗口。
  assert.match(script, /event\.key !== "Escape"[\s\S]{0,160}closeLibraryPreview\(\)[\s\S]{0,80}getCurrentWindow\(\)\.close\(\)/)
})

test("切片窗口不再提供右侧的选择图片资源按钮", () => {
  assert.doesNotMatch(html, /choose-resource/)
  assert.doesNotMatch(script, /choose-resource/)
  assert.doesNotMatch(main, /resource-picker-open/)
})

test("样式库在切片窗口内作为视图打开，切片返回直接切到全部样式", () => {
  assert.match(main, /appState\.styleLibrarySelected = undefined\s*void showPickerWindow\("styles", "全部样式"/)
  assert.match(main, /onPickerEvent\("image-picker-back-styles", \(\) => void emitStyleLibrary\(true\)\)/)
  assert.match(main, /styleLibrary: Boolean\(appState\.stylePickerTarget\),/)
  assert.match(script, /onMain<StyleLibraryPayload>\("style-library-data"/)
  assert.match(html, /<section id="style-library-view"/)
})

test("网页端与桌面端共用 picker.html，网页端嵌在页内弹窗的 iframe 里，不再有另一套页内选择器", () => {
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8")
  assert.match(index, /<dialog id="picker-dialog"[^>]*>\s*<iframe id="picker-frame"/)
  assert.doesNotMatch(index, /style-image-dialog|style-picker-dialog/)
  assert.doesNotMatch(main, /openStyleImageResourcePicker|renderStylePicker|drawImageSlicePicker/)
  assert.match(main, /pickerFrame\.src = "picker\.html"\s*pickerDialog\.showModal\(\)/)
  assert.match(main, /pickerFrame\.src = "about:blank"/)
  // 网页端没有原生标题栏：关闭按钮和 Esc 交给主页面收起弹窗。
  assert.match(html, /<button id="picker-close" class="ui-icon-button"[^>]*hidden>/)
  assert.match(main, /onPickerEvent\("picker-close", \(\) => closeDialog\(pickerDialog\)\)/)
})

test("没有 TIL 切片时整张图可像切片一样选中，引用写成不带序号的图片名", () => {
  const canvas = readFileSync(new URL("../src/slice-picker-canvas.ts", import.meta.url), "utf8")
  assert.match(canvas, /slices\.length \? slices : \[\{ index: WHOLE_IMAGE_INDEX, source: \[0, 0, image\.naturalWidth, image\.naturalHeight\] \}\]/)
  assert.match(script, /tileSliceAt\(pickableSlices\(imagePayload\.slices, image\), point\)/)
  assert.match(main, /return index === WHOLE_IMAGE_INDEX \? name : `\$\{name\},\$\{index\}`/)
  // 底部说明栏已删除，画布区域铺满窗口。
  assert.doesNotMatch(html, /picker-meta/)
})
