import { sourceKeyLabels } from "../config-labels.ts"
import { LEGACY_ANIMATION_FIELDS } from "../legacy-animation.ts"
import { visualResolver, isBdaLayoutPath, currentBdaAppearance, bdaAppearancePart, refreshBdaLayout, refreshSelectedBdaSource } from "./bda-documents"
import { documentFields, documentFieldsGroup, skinFields, toolbarFields, bdaConfigFields, bdaConfigFieldsGroup } from "./dom"
import { appState } from "./state"
import { preview } from "./canvas-interaction"
import type { PreviewItem } from "../preview-items.ts"
import { isToolbarPath, effectiveToolbarSections, isSkinInfoPath, setSourceValue, effectiveKeySection, currentSkinState } from "./config-context"
import { commitText, updateDirty, isEditing, commitBytes } from "./edit-history"
import { refreshPreview } from "./preview-render"
import { isStyleReferenceKey, openStyleReferenceEditor, openBdaStyleReferencePicker, layoutAnimationFields } from "./style-references"
import { bdaPanelKeyName, bdaStyleID } from "../bda.ts"
import { updateBdaDesignWidth, updateBdaAnimationFrame, updateBdaAnimationEffect } from "../bda-encode.ts"
import { renderBdaMetadataEditor, renderBdaLayoutEditor, renderBdaConfigEditor } from "../bda-editor.ts"
import { updateBdaRefs, updateSelectedBdaPanelProperty, updateBdaAppearanceStyleRef } from "./key-inspector"
import { openImageResourceChooser } from "./resource-inspector"
import { populateSsfInspector } from "./ssf-inspector"
import { populateSxiInspector } from "./sxi-inspector"
import { populateLegacyAnimationInspector } from "./legacy-animation-inspector"
import { keyAnimationItems, keyboardPlayback, selectAnimation, selectAnimationStyle, selectedAnimation, selectedAnimationStyle } from "./animation-resource"
import { bdaAnimationBindingsForKey, bdaBindingEffects } from "../preview-animation.ts"
import { configField } from "./config-value-control"
import { field, section, type FieldSpec } from "./property-rows"

export const documentFieldLabels: Record<string, string> = {
  BACK_STYLE: "背景样式",
  FORE_STYLE: "前景样式",
  CELL_STYLE: "单元格样式",
  VIEW_RECT: "显示区域",
  PADDING: "内边距",
  SIZE: "尺寸",
  TYPE: "类型",
  LAYOUT_NAME: "布局",
  Style: "皮肤风格",
  SkinType: "加载主题",
  SkinFlags: "半屏手写高度",
  Abilities: "功能标识",
  SupportPatch: "动态补丁支持",
  CoupleSkinName: "配套皮肤名",
  AtomSkinName: "主题目录",
  KEY_NUM: "按键数",
  TIP_NUM: "补丁数量",
  LIST_NUM: "列表数量",
  LIST_ORDER: "列表排列方向",
  CELL_SIZE: "单元格尺寸",
  GRID: "网格",
  POS: "位置",
  NO_BLUR: "精确输入",
  OFFSET_NUM: "偏移数量",
  INPUT_STYLE: "输入码样式",
  SCAND_STYLE: "云输入样式",
  FONT_NAME: "字体名称",
  FONT_SIZE: "字号",
  FONT_CLEARTYPE: "字体平滑",
  NM_COLOR: "正常颜色",
  HL_COLOR: "按下颜色",
  LIST_LEVEL: "列表层级",
  SHOW: "显示内容",
  INFO: "说明",
  ANIM_STYLE: "整键动画",
  PRESS_ANIM: "按下动画",
  RELEASE_ANIM: "松开动画",
  HIDE_ANIM: "隐藏动画",
  FIRST_PRESS_PANEL_ANIM: "首次按下面板动画",
  SHOW_ANIM: "显示动画",
  EVENT1: "动画事件",
  // 以下键只出现在文档配置节（LIST / BAR / SWITCH / CAND / ICON…），此前都显示为英文原名。
  NAMES: "列表名称",
  VALUES: "列表值",
  NAME: "事件名称",
  VERSION: "二次元 Logo",
  TEXT_STYLE: "图标文字颜色样式",
  BACK_ANIM_STYLE: "背景动画样式",
  FORE_ANIM_STYLE: "前景动画样式",
  PRESS_STYLE: "按下效果",
  HW_FORE_STYLE: "手写笔刷颜色样式",
  ANIM_LEVEL: "动画显示层级",
  ICON_NUM: "图标数量",
  ICON_INDEX: "图标序号",
  BACK_ICON: "背景图标",
  ARROW_ICON: "箭头图标",
  ICON_UP: "上滑气泡图标",
  ICON_DN: "下滑气泡图标",
  ICON_LT: "左滑气泡图标",
  ICON_RT: "右滑气泡图标",
  ANCHOR_TYPE: "锚点类型",
  PERSIST: "显示时机",
  CELL_W: "候选字间距",
  FIRST_GAP: "首项间距",
  NML_BACK_STYLE: "正常背景样式",
  SEL_BACK_STYLE: "选中背景样式",
  NML_FONT_STYLE: "正常文字样式",
  SEL_FONT_STYLE: "选中文字样式",
  HLINE_STYLE: "横线样式",
  VLINE_STYLE: "竖线样式",
  SCROLL_SIDE: "滚动条位置",
  SYM_LAYOUT: "符号面板布局",
  EVENT_NUM: "事件数量",
  IDLE_TIME: "屏保触发时间",
  FIX_SIZE: "图标固定大小",
}

export const documentSectionLabels: Record<string, string> = {
  PANEL: "面板",
  INPUT: "输入区",
  CAND: "候选栏",
  SCAND: "云输入栏",
  HINT: "气泡",
  MORE: "更多面板",
  LOGO: "Logo 菜单",
  EMOJI: "表情面板",
  GLOBAL: "全局设置",
  // SWITCH / BAR / LIST 等文档分区此前会显示为英文原名。
  LIST: "列表",
  BAR: "长按气泡",
  SWITCH: "工具栏",
  TAB: "标签",
  DRAW: "拖拉气泡",
  VIEWSTATE: "视图状态",
}

/** 成对数值的前缀，与按键布局区的 X / Y / W / H 一致。 */
const documentPairAffixes: Record<string, [string, string]> = {
  SIZE: ["W", "H"],
  POS: ["X", "Y"],
  CELL_SIZE: ["W", "H"],
  FIX_SIZE: ["W", "H"],
}

/** X,Y,W,H 拆成「位置」「尺寸」两行（DESIGN.md §10）。 */
const documentRectFields = new Set(["VIEW_RECT", "NON_SPLIT_PANEL_REGION"])
/** 四边存储序是 左,上,右,下；显示一律 ↑ → ↓ ←。 */
const EDGE_ORDER = [1, 2, 3, 0]

const documentNumericFields = new Set([
  "KEY_NUM", "TIP_NUM", "LIST_NUM", "OFFSET_NUM", "ANIM_NUM", "BUILD_NUM",
  "REPEAT_CNT", "FONT_SIZE", "BORDER_SIZE", "STYLE_NUM", "TILE_NUM", "VERSION",
  "CELL_W", "FIRST_GAP", "ICON_NUM", "ICON_INDEX", "EVENT_NUM", "ANCHOR_TYPE",
  "PERSIST", "SCROLL_SIDE", "HINT_TYPE", "ANIM_LEVEL", "HOLDFLAG", "IDLE_TIME",
])

/** number 输入框会清空非数字值，只有纯数字才切换到数字类型。 */
export function looksNumeric(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value.trim())
}

/** MORE.SYM_LAYOUT 这类键按 id 绑定布局文件，沿用侧边栏使用的布局名称。 */
export const layoutIDLabels: Record<string, string> = {
  bh: "笔画键盘",
  def_9: "五笔 9 键",
  def_26: "五笔 26 键",
  py_9: "拼音 9 键",
  py_26: "拼音 26 键",
  en_9: "英文 9 键",
  en_9s: "英文 9 键 Shift",
  en_9_h: "英文 9 键（加高）",
  en_9s_h: "英文 9 键 Shift（加高）",
  en_26: "英文 26 键",
  en_26s: "英文 26 键 Shift",
  num_9: "数字键盘",
  num_9_h: "数字键盘（加高）",
  num_26: "26 键数字键盘",
  num2: "数字键盘 2",
  symbol: "符号面板",
  symbol_h: "符号面板（加高）",
  sym_26_cn: "中文 26 键符号",
  sym_26_cn_h: "中文 26 键符号（加高）",
  sym_26_en: "英文 26 键符号",
  sym_26_en_h: "英文 26 键符号（加高）",
  emoji: "表情面板",
  hw_grid: "手写面板",
  hw_full: "全屏手写",
  help: "帮助面板",
  sel_ch: "中文选择栏",
  sel_ch_h: "中文选择栏（加高）",
  sel_en: "英文选择栏",
  sel_en_h: "英文选择栏（加高）",
  voice: "语音键盘",
  dial: "拨号键盘",
  email: "邮箱键盘",
  net: "网址键盘",
  net_shifts: "网址键盘大写",
  logo: "输入法标识",
  en_26_new: "英文 26 键",
  en_26s_new: "英文 26 键 Shift",
  def_26_new: "五笔 26 键",
  en_9_pad: "英文 9 键加高",
  en_9s_pad: "英文 9 键 Shift 加高",
  net_shift: "网址键盘 Shift",
  en_26_num: "英文 26 键数字行",
  en_26s_num: "英文 26 键 Shift 数字行",
  en_26_pad: "英文 26 键加高",
  en_26s_pad: "英文 26 键 Shift 加高",
  sym_26_pad: "中文 26 键符号（加高）",
}

export function translatedConfigLabel(key: string): string {
  // 文档标签优先，其次复用源码侧的通用标签表；都没有时保留原始键名，而不是猜一个词。
  const known = documentFieldLabels[key] ?? LEGACY_ANIMATION_FIELDS[key]?.label ?? sourceKeyLabels[key]
  if (known) return known
  const layout = key.match(/^([A-Z0-9_]+)_LAYOUT$/)
  if (layout) {
    const id = layout[1].toLowerCase()
    const name = layoutIDLabels[id] ?? id.replaceAll("_", " ")
    return /[A-Za-z0-9]$/.test(name) ? `${name} 布局` : `${name}布局`
  }
  return key
}

function translatedSectionLabel(section: string): string {
  const offset = section.match(/^OFFSET(\d+)$/)
  const animation = section.match(/^ANIM(\d+)$/)
  const icon = section.match(/^ICON(\d+)$/i)
  const tip = section.match(/^TIP(\d+)$/i)
  const event = section.match(/^EVENT(\d+)$/i)
  const label = offset
    ? `偏移 ${offset[1]}`
    : animation
      ? `动画 ${animation[1]}`
      : icon
        ? `工具按钮 ${icon[1]}`
        : tip
          ? `状态提示 ${tip[1]}`
          : event
            ? `事件 ${event[1]}`
            : documentSectionLabels[section] ?? section
  return `${label}（${section}）`
}

function isHiddenConfigEntry(section: string, key: string, showTips = false): boolean {
  if (/^OFFSET\d*$/i.test(section) || /^OFFSET(?:_|\d|$)/i.test(key)) return true
  return !showTips && (/^TIP\d*$/i.test(section) || /^TIP(?:_|\d|$)/i.test(key))
}

export function populateDocumentInspector(): void {
  documentFields.replaceChildren()
  if (appState.archive?.format === "ssf") {
    documentFieldsGroup.hidden = !populateSsfInspector(documentFields)
    return
  }
  if (appState.archive?.format === "sxi") {
    documentFieldsGroup.hidden = !populateSxiInspector(documentFields)
    return
  }
  // 旧版百度皮肤的 anim.ini（粒子也只在这里）有自己的可视化动效检查器，不再按通用 INI 行展开。
  if (appState.archive?.format !== "bda" && /(^|\/)anim\.ini$/i.test(appState.selectedPath) && populateLegacyAnimationInspector(documentFields)) {
    documentFieldsGroup.hidden = false
    return
  }
  const hasSelection = appState.selectedPath === appState.layoutPath && appState.selectedKeySections.length > 0
  if (appState.archive?.format === "bda" || !appState.selectedDocument || hasSelection || !appState.archive?.isText(appState.selectedPath)) {
    documentFieldsGroup.hidden = true
    return
  }
  const specialized = new Set<string>()
  const toolbarSections = new Set(isToolbarPath(appState.selectedPath) ? effectiveToolbarSections() : [])
  if (isSkinInfoPath(appState.selectedPath)) {
    for (const field of skinFields) specialized.add(`\u0000${field.dataset.skinField ?? ""}`)
  }
  if (isToolbarPath(appState.selectedPath)) {
    for (const field of toolbarFields) {
      const [section, key] = (field.dataset.toolbarField ?? "").split(".")
      specialized.add(`${key ? section : "CAND"}\u0000${key || section}`)
    }
  }
  const entries = appState.selectedDocument.entries().filter((entry) =>
    !/^KEY\d+$/.test(entry.section) &&
    !isHiddenConfigEntry(entry.section, entry.key, isToolbarPath(appState.selectedPath)) &&
    (!toolbarSections.size || toolbarSections.has(entry.section)) &&
    !specialized.has(`${entry.section}\u0000${entry.key}`),
  )
  // 缺少可选字段不等于不支持；只补检查器条目，不在查看时写入文档。
  if (appState.selectedPath === appState.layoutPath && appState.selectedDocument.get("PANEL", "ANIM_STYLE") === undefined) {
    entries.push({ section: "PANEL", key: "ANIM_STYLE", value: "" })
  }
  documentFieldsGroup.hidden = entries.length === 0
  if (!entries.length) return

  const update = (section: string, key: string, value: string): void => {
    if (!appState.selectedDocument || appState.selectedPath !== documentFieldsGroup.dataset.path) return
    const before = appState.selectedDocument.toString()
    if (!appState.selectedDocument.set(section, key, value)) return
    const text = appState.selectedDocument.toString()
    commitText(appState.selectedPath, before, text)
    setSourceValue(text)
    if (appState.selectedPath === appState.layoutPath) appState.layoutDocument = appState.selectedDocument
    refreshPreview()
    updateDirty()
  }
  const renderEntry = (entry: typeof entries[number]): HTMLElement[] => {
    const label = translatedConfigLabel(entry.key)
    const commit = (value: string) => update(entry.section, entry.key, value)
    const rowKey = [appState.selectedPath, entry.section, entry.key]
    const row = (spec: FieldSpec, commitValue: (value: never) => void, extra: { label?: string; key?: unknown } = {}) => field({
      key: entry.key, label: extra.label ?? label, name: extra.label && `${label}${extra.label}`, spec,
      commit: commitValue as (value: unknown) => void, rowKey: extra.key === undefined ? rowKey : [...rowKey, extra.key],
    })
    if (isStyleReferenceKey(entry.key)) return [row({ kind: "style", value: entry.value, reference: entry.key }, commit)]
    // 只改动的那几格写回，其余格保持原值；不重绘，所以就地更新。
    const values = entry.value.split(",").map((value) => value.trim())
    const numeric = values.every(looksNumeric)
    const pair = documentPairAffixes[entry.key]
    if (numeric && pair && values.length === 2) {
      return [row({ kind: "parts", affixes: pair, values }, (next: string[]) => commit(next.join(",")))]
    }
    if (numeric && documentRectFields.has(entry.key) && values.length === 4) {
      return ([["位置", ["X", "Y"], 0], ["尺寸", ["W", "H"], 2]] as const).map(([name, affixes, start]) =>
        row({ kind: "parts", affixes, values: values.slice(start, start + 2) }, (next: string[]) => {
          values.splice(start, 2, ...next)
          commit(values.join(","))
        }, { label: name, key: start }))
    }
    if (numeric && entry.key === "PADDING" && values.length === 4) {
      return [row({ kind: "parts", affixes: ["↑", "→", "↓", "←"], values: EDGE_ORDER.map((index) => values[index]), columns: 4 }, (next: string[]) => {
        EDGE_ORDER.forEach((index, position) => { values[index] = next[position] })
        commit(values.join(","))
      })]
    }
    // 百度配置值的类型化控件（开关、分段、九宫格、颜色）。
    const typed = configField(entry.section, entry.key, label, entry.value, isEditing(), commit)
    if (typed) return [typed]
    // 值不是数字时保持文本输入：number 输入框会清空显示，用户一编辑就丢原值。
    if (documentNumericFields.has(entry.key) && looksNumeric(entry.value)) {
      return [row({ kind: "number", value: entry.value, unit: entry.key === "IDLE_TIME" ? "ms" : undefined, range: entry.key === "FONT_SIZE" ? "fontSize" : undefined }, commit)]
    }
    return [row({ kind: "text", value: entry.value }, commit)]
  }
  for (const sectionName of [...new Set(entries.map((entry) => entry.section))]) {
    const sectionEntries = entries.filter((item) => item.section === sectionName)
    const title = sectionName ? translatedSectionLabel(sectionName).replace(/\s*[（(][^）)]*[）)]\s*$/, "") : "基本信息"
    documentFields.append(section(title, sectionEntries.filter((entry) => !layoutAnimationFields.has(entry.key)).flatMap(renderEntry), {
      code: sectionName && title !== sectionName ? sectionName : undefined,
    }))
    const animations = sectionEntries.filter((entry) => layoutAnimationFields.has(entry.key))
    if (animations.length) documentFields.append(section("动画", animations.flatMap(renderEntry)))
  }
  documentFieldsGroup.dataset.path = appState.selectedPath
}

export function selectedBdaKeyNames(): string[] {
  const layout = appState.layoutDocument
  if (!layout || !appState.selectedKeySections.length) return []
  const state = currentSkinState()
  const panel = currentBdaAppearance()?.appearance.panels.get(appState.layoutPath.split("/").pop()?.replace(/\.ini$/i, "") ?? "")
  return [...new Set(appState.selectedKeySections.flatMap((section) => {
    const names = [layout.get(section, "CENTER"), layout.get(section, "DOWN")]
      .filter((value): value is string => Boolean(value))
      .map(bdaPanelKeyName)
    // In a key state (Shift on, a mode lit…) the canvas draws the `_S<n>` state key: that is what is edited.
    if (state !== undefined && effectiveKeySection(section) !== section) {
      const stateKeys = names.map((name) => `${name}_S${state}`).filter((name) => panel?.keys.has(name))
      if (stateKeys.length) return stateKeys
    }
    return names
  }))]
}

export function selectedBdaSourceKeys(): string[] {
  if (appState.resourceConfigActive && appState.resourceInspectorMode === "style") return appState.selectedStyleID ? [appState.selectedStyleID] : []
  if (appState.selectedCandidate && appState.selectedPath === appState.layoutPath) return ["cand"]
  return isBdaLayoutPath(appState.selectedPath) ? selectedBdaKeyNames() : []
}

/** A BDA key plays an effect bound to it directly, or through a group holding the effect, on press. */
function bdaKeyPlays(id: string, key: PreviewItem): boolean {
  return bdaAnimationBindingsForKey(preview.animation, key).some((binding) =>
    `${binding.kind}:${binding.key}` === id || bdaBindingEffects(preview.animation!, binding).some((effect) => `${effect.kind}:${effect.key}` === id))
}

export function populateBdaConfigInspector(): void {
  bdaConfigFields.replaceChildren()
  if (!appState.archive || appState.archive.format !== "bda") {
    bdaConfigFieldsGroup.hidden = true
    return
  }
  const info = currentBdaAppearance()
  if (isSkinInfoPath(appState.selectedPath) && appState.selectedDocument) {
    bdaConfigFieldsGroup.hidden = false
    renderBdaMetadataEditor(bdaConfigFields, {
      entries: appState.selectedDocument.entries("").map(({ key, value }) => ({ key, value })),
      editable: isEditing(),
      label: translatedConfigLabel,
      onChange: (key, value) => {
        if (!appState.selectedDocument) return
        const before = appState.selectedDocument.toString()
        if (!appState.selectedDocument.set("", key, value)) return
        const after = appState.selectedDocument.toString()
        commitText(appState.selectedPath, before, after)
        setSourceValue(after)
        populateBdaConfigInspector()
        updateDirty()
      },
    })
    return
  }
  if (bdaAppearancePart(appState.selectedPath)?.kind === "panel" && info) {
    const panelName = appState.selectedPath.split("/").pop()?.replace(/\.ini$/i, "") ?? ""
    const panel = info.appearance.panels.get(panelName)
    const selectedKeys = selectedBdaKeyNames().flatMap((name) => {
      const key = panel?.keys.get(name)
      return key ? [{ name, key }] : []
    })
    bdaConfigFieldsGroup.hidden = false
    renderBdaLayoutEditor(bdaConfigFields, {
      appearance: info.appearance,
      panelName,
      keys: selectedKeys,
      scope: appState.selectedCandidate ? "candidate" : "panel",
      resolver: visualResolver(),
      editable: isEditing(),
      onStyleChange: (ref, property, value) => { updateBdaRefs([ref], property, value) },
      onPanelPropertyChange: (property, value) => { updateSelectedBdaPanelProperty(property, value) },
      onStyleRefChange: (paths, ref, owner) => { updateBdaAppearanceStyleRef(paths, ref, owner) },
      onStyleRefAction: (paths, ref, field, action, owner) => {
        if (action === "edit") openStyleReferenceEditor(bdaStyleID(ref))
        else openBdaStyleReferencePicker(paths, ref, field, owner)
      },
    })
    return
  }
  const bytes = appState.archive.isBdaConfig(appState.selectedPath) ? appState.archive.getBytes(appState.selectedPath) : undefined
  bdaConfigFieldsGroup.hidden = !bytes
  if (!bytes) return
  const update = (after: Uint8Array) => {
    commitBytes(appState.selectedPath, bytes, after)
    if (/appearanceConfig$/i.test(appState.selectedPath)) refreshBdaLayout(appState.layoutPath)
    refreshSelectedBdaSource()
    refreshPreview()
    populateBdaConfigInspector()
    updateDirty()
  }
  renderBdaConfigEditor(bdaConfigFields, {
    path: appState.selectedPath,
    bytes,
    resolver: visualResolver(),
    editable: isEditing(),
    onDesignWidth: (value) => update(updateBdaDesignWidth(bytes, value)),
    onAnimationEffect: (effectID, property, value) => update(updateBdaAnimationEffect(bytes, effectID, property, value)),
    onAnimationFrame: (sequence, frame, property, value) => update(
      updateBdaAnimationFrame(bytes, sequence, frame, property, value),
    ),
    onPickAnimationResource: (sequence, frame) => openImageResourceChooser((resourceID) => update(
      updateBdaAnimationFrame(bytes, sequence, frame, "resourceID", resourceID),
    )),
    animationView: {
      source: appState.archive,
      mode: appState.animationDesignMode, select: selectedAnimation, onSelect: selectAnimation,
      filter: (items) => keyAnimationItems(items, bdaKeyPlays),
      targets: { selected: selectedAnimationStyle(), onSelect: selectAnimationStyle },
    },
    keyboardPlayback: (id) => keyboardPlayback((key) => bdaKeyPlays(id, key)),
  })
}
