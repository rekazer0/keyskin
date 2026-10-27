import { sourceKeyLabels } from "../config-labels.ts"
import { IniDocument } from "../ini.ts"
import { visualResolver, isBdaLayoutPath, currentBdaAppearance, bdaAppearancePart, refreshBdaLayout, refreshSelectedBdaSource } from "./bda-documents"
import { thumbnailRecycler, drawVisualPreview } from "../atlas.ts"
import { documentFields, documentFieldsGroup, skinFields, toolbarFields, bdaConfigFields, bdaConfigFieldsGroup } from "./dom"
import { appState } from "./state"
import { preview } from "./canvas-interaction"
import { isToolbarPath, effectiveToolbarSections, isSkinInfoPath, setSourceValue, effectiveKeySection, currentSkinState } from "./config-context"
import { parseLegacyParticleEmitter } from "../preview-animation.ts"
import { commitText, updateDirty, isEditing, commitBytes } from "./edit-history"
import { refreshPreview } from "./preview-render"
import { isStyleReferenceKey, decorateStyleReferenceInput, openStyleReferenceEditor, openBdaStyleReferencePicker } from "./style-references"
import { syncMobileInspectorGroups } from "./mobile-layout"
import { bdaPanelKeyName, bdaStyleID } from "../bda.ts"
import { updateBdaDesignWidth, updateBdaAnimationFrame, updateBdaAnimationEffect } from "../bda-encode.ts"
import { renderBdaMetadataEditor, renderBdaLayoutEditor, renderBdaConfigEditor } from "../bda-editor.ts"
import { updateBdaRefs, updateSelectedBdaPanelProperty, updateBdaAppearanceStyleRef } from "./key-inspector"
import { openImageResourceChooser } from "./resource-inspector"
import { populateSsfInspector } from "./ssf-inspector"
import { populateSxiInspector } from "./sxi-inspector"
import { populateLegacyAnimationInspector } from "./legacy-animation-inspector"
import { disconnectSsfThumbnails } from "./ssf-fields"

export const documentFieldLabels: Record<string, string> = {
  BACK_STYLE: "背景样式",
  FORE_STYLE: "前景样式",
  CELL_STYLE: "单元格样式",
  VIEW_RECT: "显示区域",
  PADDING: "内边距",
  SIZE: "尺寸",
  TYPE: "类型",
  LAYOUT_NAME: "布局名称",
  Style: "皮肤风格",
  SkinType: "加载主题（0支持/1不支持）",
  SkinFlags: "半屏手写高度",
  Abilities: "功能标识（音效/动效等）",
  SupportPatch: "动态补丁支持",
  CoupleSkinName: "配套皮肤名",
  AtomSkinName: "主题目录",
  KEY_NUM: "按键数量",
  TIP_NUM: "补丁数量",
  LIST_NUM: "列表数量",
  LIST_ORDER: "列表排列方向（0竖排/1横排）",
  CELL_SIZE: "单元格尺寸",
  GRID: "网格",
  POS: "位置",
  NO_BLUR: "精确输入模式",
  OFFSET_NUM: "偏移数量",
  INPUT_STYLE: "输入码样式",
  SCAND_STYLE: "云输入样式",
  FONT_NAME: "字体名称",
  FONT_SIZE: "字号",
  FONT_CLEARTYPE: "字体平滑",
  NM_COLOR: "正常颜色",
  HL_COLOR: "按下颜色",
  SHOW: "显示内容",
  INFO: "说明",
  ANIM_STYLE: "整体动画样式（全景动效）",
  PRESS_ANIM: "按下动画",
  SHOW_ANIM: "显示动画",
  EVENT1: "动画事件",
  ANIM_NUM: "动画数量",
  CATEGORY: "动画类别",
  LIFE: "粒子寿命范围",
  EMIT_REGION: "发射区域",
  TOTAL_NUMBER: "粒子总数",
  BIRTH_RATE: "发射速率",
  EMIT_TYPE: "发射方式",
  PARTICLE_IMAGE: "粒子图片样式",
  VELOCITY: "初速度范围",
  VELOCITY_DIRECTION: "初速度方向范围",
  ACCELERATION: "加速度范围",
  ACCELERATION_DIRECTION: "加速度方向范围",
  INIT_SCALE: "初始缩放范围",
  SCALE_SPEED: "缩放速度范围",
  INIT_ROTATE: "初始旋转范围",
  ROTATE_SPEED: "旋转速度范围",
  INIT_ALPHA: "初始透明度范围",
  ALPHA_SPEED: "透明度速度范围",
  DURATION: "持续时间",
  DELAY: "延迟时间",
  REMOVE: "结束后移除",
  INTPOL: "插值方式",
  FROM: "起始值",
  TO: "结束值",
  FROM_PX: "起始位移",
  TO_PX: "结束位移",
  PIVOT: "变换中心",
  BUILD_NUM: "组合动画数量",
  BUILD_LIST: "组合动画列表",
  BUILD_METHOD: "组合播放方式",
  REPEAT_CNT: "重复次数",
  REPEAT_MODE: "重复方式",
  // 以下键只出现在文档配置节（LIST / BAR / SWITCH / CAND / ICON…），此前都显示为英文原名。
  NAMES: "列表名称",
  VALUES: "列表值",
  NAME: "事件名称（NAME）",
  VERSION: "Logo 模式（1=二次元）",
  TEXT_STYLE: "图标文字颜色样式（logo/emoji）",
  BACK_ANIM_STYLE: "背景动画样式",
  FORE_ANIM_STYLE: "前景动画样式",
  HW_FORE_STYLE: "手写笔刷颜色样式",
  ANIM_LEVEL: "动画显示层级（0下/1上）",
  ICON_NUM: "图标数量",
  ICON_INDEX: "图标序号",
  BACK_ICON: "背景图标",
  ARROW_ICON: "箭头图标",
  ICON_UP: "上划气泡图标",
  ICON_DN: "下划气泡图标",
  ICON_LT: "左划气泡图标",
  ICON_RT: "右划气泡图标",
  ANCHOR_TYPE: "锚点类型",
  PERSIST: "显示时机",
  CELL_W: "候选字间距",
  FIRST_GAP: "首项间距",
  NML_BACK_STYLE: "普通背景样式",
  SEL_BACK_STYLE: "选中背景样式",
  NML_FONT_STYLE: "普通文字样式",
  SEL_FONT_STYLE: "选中文字样式",
  HLINE_STYLE: "横线样式",
  VLINE_STYLE: "竖线样式",
  SCROLL_SIDE: "滚动条位置",
  SYM_LAYOUT: "符号面板布局",
  EVENT_NUM: "事件数量（EVENT_NUM）",
  IDLE_TIME: "屏保触发时间（ms）",
  FIX_SIZE: "图标固定大小（iOS）",
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

export const documentPairFieldLabels: Record<string, [string, string]> = {
  SIZE: ["宽度", "高度"],
  POS: ["横向", "纵向"],
  CELL_SIZE: ["宽度", "高度"],
  FIX_SIZE: ["宽度", "高度"],
}

export const documentQuadFieldLabels: Record<string, [string, string, string, string]> = {
  VIEW_RECT: ["横向", "纵向", "宽度", "高度"],
  NON_SPLIT_PANEL_REGION: ["横向", "纵向", "宽度", "高度"],
  PADDING: ["左", "上", "右", "下"],
}

/** 成对 / 四格数值框里的前缀，与按键布局区的 X / Y / W / H 一致。 */
const documentPartAffixes: Record<string, string> = {
  横向: "X", 纵向: "Y", 宽度: "W", 高度: "H", 左: "←", 上: "↑", 右: "→", 下: "↓",
}

export const documentSwitchFields = new Set(["NO_BLUR"])

export const documentNumericFields = new Set([
  "KEY_NUM", "TIP_NUM", "LIST_NUM", "OFFSET_NUM", "ANIM_NUM", "BUILD_NUM",
  "REPEAT_CNT", "FONT_SIZE", "BORDER_SIZE", "STYLE_NUM", "TILE_NUM", "VERSION",
  "CELL_W", "FIRST_GAP", "ICON_NUM", "ICON_INDEX", "EVENT_NUM", "ANCHOR_TYPE",
  "PERSIST", "SCROLL_SIDE", "HINT_TYPE", "ANIM_LEVEL", "HOLDFLAG",
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
  const known = documentFieldLabels[key] ?? sourceKeyLabels[key]
  if (known) return known
  const layout = key.match(/^([A-Z0-9_]+)_LAYOUT$/)
  if (layout) {
    const id = layout[1].toLowerCase()
    const name = layoutIDLabels[id] ?? id.replaceAll("_", " ")
    return /[A-Za-z0-9]$/.test(name) ? `${name} 布局` : `${name}布局`
  }
  return key
}

export function translatedSectionLabel(section: string): string {
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

export function isHiddenConfigEntry(section: string, key: string, showTips = false): boolean {
  if (/^OFFSET\d*$/i.test(section) || /^OFFSET(?:_|\d|$)/i.test(key)) return true
  return !showTips && (/^TIP\d*$/i.test(section) || /^TIP(?:_|\d|$)/i.test(key))
}

export const particleFieldGroups = [
  ["发射", ["PARTICLE_IMAGE", "LIFE", "EMIT_REGION", "TOTAL_NUMBER", "BIRTH_RATE", "EMIT_TYPE"]],
  ["运动", ["VELOCITY", "VELOCITY_DIRECTION", "ACCELERATION", "ACCELERATION_DIRECTION"]],
  ["外观", ["INIT_SCALE", "SCALE_SPEED", "INIT_ROTATE", "ROTATE_SPEED", "INIT_ALPHA", "ALPHA_SPEED"]],
] as const

export const particlePairFields = new Set<string>(particleFieldGroups.flatMap(([, keys]) => keys).filter((key) =>
  !["PARTICLE_IMAGE", "EMIT_REGION", "TOTAL_NUMBER", "BIRTH_RATE", "EMIT_TYPE"].includes(key),
))

export function isParticleSection(document: IniDocument, section: string): boolean {
  return document.get(section, "CATEGORY")?.trim() === "3" || Boolean(document.get(section, "PARTICLE_IMAGE")?.trim())
}

export async function renderParticleImages(container: HTMLElement, value: string): Promise<void> {
  const resolver = visualResolver()
  const styleIDs = value.split(",").map((item) => item.trim()).filter(Boolean)
  const thumbnail = thumbnailRecycler(container)
  container.replaceChildren()
  if (!resolver) return
  const visuals = await Promise.all(styleIDs.map((styleID) => resolver.resolve(styleID, false).catch(() => undefined)))
  if (!container.isConnected) return
  container.replaceChildren(...styleIDs.map((styleID, index) => {
    const item = document.createElement("span")
    item.className = "particle-image-preview"
    const canvas = thumbnail(56, 56)
    drawVisualPreview(canvas, [visuals[index]], false)
    const caption = document.createElement("small")
    caption.textContent = styleID
    item.append(canvas, caption)
    return item
  }))
}

export function particleNumberStep(key: string): string {
  // 手册第 180 页：EMIT_REGION 与缩放/速度一样是相对坐标，允许小数。
  return key === "EMIT_REGION" || /SCALE|VELOCITY|ACCELERATION/.test(key) ? "0.1" : "1"
}

export function populateDocumentInspector(): void {
  disconnectSsfThumbnails()
  documentFields.replaceChildren()
  if (appState.archive?.format === "ssf") {
    documentFieldsGroup.hidden = !populateSsfInspector(documentFields)
    return
  }
  if (appState.archive?.format === "sxi") {
    documentFieldsGroup.hidden = !populateSxiInspector(documentFields)
    return
  }
  // 旧版百度皮肤的 anim.ini 有自己的可视化动效检查器，不再按通用 INI 行展开。
  if (appState.archive?.format !== "bda" && /(^|\/)anim\.ini$/i.test(appState.selectedPath) && populateLegacyAnimationInspector(documentFields)) {
    documentFieldsGroup.hidden = false
    return
  }
  const hasSelection = appState.selectedPath === appState.layoutPath && appState.selectedKeySections.length > 0
  if (appState.archive?.format === "bda" || !appState.selectedDocument || hasSelection || !appState.archive?.isText(appState.selectedPath)) {
    documentFieldsGroup.hidden = true
    appState.particlePreviewSection = ""
    preview.setParticlePreview()
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
  documentFieldsGroup.hidden = entries.length === 0
  if (!entries.length) {
    appState.particlePreviewSection = ""
    preview.setParticlePreview()
    return
  }

  const sections = [...new Set(entries.map((entry) => entry.section))]
  const particleSections = sections.filter((section) => isParticleSection(appState.selectedDocument!, section))
  if (!particleSections.includes(appState.particlePreviewSection)) appState.particlePreviewSection = particleSections[0] ?? ""
  preview.setParticlePreview(
    appState.particlePreviewSection ? parseLegacyParticleEmitter(appState.selectedDocument, appState.particlePreviewSection) : undefined,
  )
  const update = (section: string, key: string, value: string): boolean => {
    if (!appState.selectedDocument || appState.selectedPath !== documentFieldsGroup.dataset.path) return false
    const before = appState.selectedDocument.toString()
    if (!appState.selectedDocument.set(section, key, value)) return false
    const text = appState.selectedDocument.toString()
    commitText(appState.selectedPath, before, text)
    setSourceValue(text)
    if (appState.selectedPath === appState.layoutPath) appState.layoutDocument = appState.selectedDocument
    refreshPreview()
    if (section === appState.particlePreviewSection) {
      preview.setParticlePreview(parseLegacyParticleEmitter(appState.selectedDocument, section))
    }
    updateDirty()
    return true
  }
  const renderEntry = (entry: typeof entries[number], specialized = false): HTMLElement => {
    const label = document.createElement("label")
    label.className = "document-property-field"
    if (isStyleReferenceKey(entry.key)) label.classList.add("style-reference-field")
    if (specialized) label.classList.add("particle-property-field")
    if (entry.value.length > 18 || /(?:RECT|IMG|PADDING|ORDER|LIST|SOURCE|FONT_NAME)/.test(entry.key)) {
      label.classList.add("wide")
    }
    label.dataset.documentKey = entry.key
    const caption = document.createElement("span")
    caption.className = "document-field-caption"
    const captionLabel = translatedConfigLabel(entry.key)
    // 译文之外的原始键名保留在悬停提示里，属性行始终能对应回 ini 的键。
    caption.title = captionLabel === entry.key ? entry.key : `${captionLabel}（${entry.key}）`
    const captionName = document.createElement("span")
    captionName.className = "document-field-name"
    captionName.textContent = captionLabel
    caption.append(captionName)
    label.append(caption)

    if (specialized && (particlePairFields.has(entry.key) || entry.key === "EMIT_REGION")) {
      const count = entry.key === "EMIT_REGION" ? 4 : 2
      const values = entry.value.split(",").map((value) => value.trim())
      while (values.length < count) values.push(values.at(-1) ?? "0")
      const row = document.createElement("span")
      row.className = `particle-range-inputs particle-range-${count}`
      // 手册第 180 页：EMIT_REGION=left,top,right,bottom（相对 location），不是 X/Y/W/H。
      const names = count === 4 ? ["左", "上", "右", "下"] : ["最小", "最大"]
      for (let index = 0; index < count; index += 1) {
        const input = document.createElement("input")
        input.type = "number"
        input.step = particleNumberStep(entry.key)
        input.value = values[index]
        input.placeholder = names[index]
        input.setAttribute("aria-label", `${translatedConfigLabel(entry.key)}${names[index]}`)
        input.disabled = !isEditing()
        input.addEventListener("change", () => {
          values[index] = input.value
          update(entry.section, entry.key, values.join(","))
        })
        row.append(input)
      }
      label.append(row)
      return label
    }

    const partLabels: readonly string[] | undefined = documentPairFieldLabels[entry.key] ?? documentQuadFieldLabels[entry.key]
    const partValues = entry.value.split(",").map((value) => value.trim())
    if (!specialized && partLabels && partValues.length === partLabels.length) {
      const row = document.createElement("span")
      row.className = "ui-field-pair"
      partLabels.forEach((name, index) => {
        const box = document.createElement("span")
        box.className = "ui-input"
        const affix = document.createElement("span")
        affix.className = "ui-input-affix"
        affix.textContent = documentPartAffixes[name]
        affix.title = name
        const input = document.createElement("input")
        input.type = "number"
        input.step = "1"
        input.value = partValues[index] ?? ""
        input.disabled = !isEditing()
        input.setAttribute("aria-label", `${translatedConfigLabel(entry.key)} ${name}`)
        input.addEventListener("change", () => {
          partValues[index] = input.value
          update(entry.section, entry.key, partValues.join(","))
        })
        box.append(affix, input)
        row.append(box)
      })
      label.append(row)
      return label
    }

    if (!specialized && documentSwitchFields.has(entry.key)) {
      const input = document.createElement("input")
      input.type = "checkbox"
      input.setAttribute("role", "switch")
      input.checked = !["0", "false", "off", ""].includes(entry.value.trim().toLowerCase())
      input.disabled = !isEditing()
      input.setAttribute("aria-label", translatedConfigLabel(entry.key))
      const control = document.createElement("span")
      control.className = "document-switch-control"
      input.addEventListener("change", () => update(entry.section, entry.key, input.checked ? "1" : "0"))
      control.append(input)
      label.classList.add("document-switch-field")
      label.append(control)
      return label
    }

    const input = document.createElement("input")
    input.value = entry.value
    input.classList.add("document-property-input")
    input.title = `${translatedConfigLabel(entry.key)}：${entry.value}`
    input.disabled = !isEditing()
    input.setAttribute("aria-label", translatedConfigLabel(entry.key))
    // 值不是数字时保持文本输入：number 输入框会清空显示，用户一编辑就丢原值。
    if (documentNumericFields.has(entry.key) && looksNumeric(entry.value)) {
      input.type = "number"
      input.step = "1"
      input.inputMode = "numeric"
    }
    if (specialized && ["TOTAL_NUMBER", "BIRTH_RATE"].includes(entry.key)) {
      const value = Math.max(Number(entry.value) || 1, entry.key === "BIRTH_RATE" ? 0.1 : 1)
      input.type = "number"
      input.min = entry.key === "BIRTH_RATE" ? "0.1" : "1"
      input.step = entry.key === "BIRTH_RATE" ? "0.1" : "1"
      const row = document.createElement("span")
      row.className = "particle-slider-input"
      const slider = document.createElement("input")
      slider.type = "range"
      slider.min = input.min
      slider.max = String(Math.max(entry.key === "BIRTH_RATE" ? 20 : 1000, value * 2))
      slider.step = input.step
      slider.value = String(value)
      slider.disabled = input.disabled
      slider.addEventListener("input", () => { input.value = slider.value })
      slider.addEventListener("change", () => update(entry.section, entry.key, slider.value))
      input.addEventListener("input", () => {
        if (Number(input.value) > Number(slider.max)) slider.max = String(Number(input.value) * 2)
        slider.value = input.value
      })
      input.addEventListener("change", () => update(entry.section, entry.key, input.value))
      row.append(slider, input)
      label.classList.add("wide")
      label.append(row)
      return label
    }
    input.addEventListener("change", () => update(entry.section, entry.key, input.value))
    label.append(input)
    if (specialized && entry.key === "PARTICLE_IMAGE") {
      const previews = document.createElement("span")
      previews.className = "particle-image-previews"
      void renderParticleImages(previews, input.value)
      input.addEventListener("input", () => void renderParticleImages(previews, input.value))
      label.append(previews)
    } else {
      decorateStyleReferenceInput(input, entry.key)
    }
    return label
  }
  for (const section of sections) {
    const sectionPanel = document.createElement("section")
    sectionPanel.className = "document-property-section"
    const sectionEntries = entries.filter((item) => item.section === section)
    const particle = isParticleSection(appState.selectedDocument, section)
    if (particle) sectionPanel.classList.add("particle-property-section")
    const sectionLabel = particle
      ? `粒子动效 ${section.replace(/^ANIM/, "")}（${section}）`
      : section ? translatedSectionLabel(section) : "基本信息"
    const sectionName = sectionLabel.replace(/\s*[（(][^）)]*[）)]\s*$/, "")
    sectionPanel.dataset.inspectorGroupLabel = sectionName
    const heading = document.createElement("h3")
    heading.className = "document-section-heading"
    const title = document.createElement("span")
    title.className = "document-section-title"
    title.textContent = sectionName
    heading.append(title)
    if (section && sectionName !== section) {
      const code = document.createElement("span")
      code.className = "document-section-code"
      code.textContent = section
      heading.append(code)
    }
    sectionPanel.append(heading)
    if (particle) {
      const toolbar = document.createElement("div")
      toolbar.className = "particle-preview-toolbar"
      const status = document.createElement("span")
      status.textContent = section === appState.particlePreviewSection ? "正在画布预览" : "可在键盘画布中预览"
      const replay = document.createElement("button")
      replay.type = "button"
      replay.textContent = section === appState.particlePreviewSection ? "重新播放" : "在画布预览"
      replay.addEventListener("click", () => {
        if (!appState.selectedDocument) return
        appState.particlePreviewSection = section
        preview.setParticlePreview(parseLegacyParticleEmitter(appState.selectedDocument, section))
        populateDocumentInspector()
        syncMobileInspectorGroups()
      })
      toolbar.append(status, replay)
      sectionPanel.append(toolbar)
      const used = new Set<string>()
      for (const [name, keys] of particleFieldGroups) {
        const grouped = keys.flatMap((key) => sectionEntries.filter((entry) => entry.key === key))
        if (!grouped.length) continue
        grouped.forEach((entry) => used.add(entry.key))
        const fieldset = document.createElement("fieldset")
        fieldset.className = "particle-property-group"
        const legend = document.createElement("legend")
        legend.textContent = name
        const grid = document.createElement("div")
        grid.className = "document-property-grid"
        grid.append(...grouped.map((entry) => renderEntry(entry, true)))
        fieldset.append(legend, grid)
        sectionPanel.append(fieldset)
      }
      const advanced = sectionEntries.filter((entry) => !used.has(entry.key))
      if (advanced.length) {
        const advancedSection = document.createElement("section")
        advancedSection.className = "particle-advanced-properties"
        const heading = document.createElement("h4")
        heading.textContent = `高级参数（${advanced.length}）`
        const grid = document.createElement("div")
        grid.className = "document-property-grid"
        grid.append(...advanced.map((entry) => renderEntry(entry)))
        advancedSection.append(heading, grid)
        sectionPanel.append(advancedSection)
      }
      documentFields.append(sectionPanel)
      continue
    }
    const grid = document.createElement("div")
    grid.className = "document-property-grid"
    grid.append(...sectionEntries.map((entry) => renderEntry(entry)))
    sectionPanel.append(grid)
    documentFields.append(sectionPanel)
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
  })
}
