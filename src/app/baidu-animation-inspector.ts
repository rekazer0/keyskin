// BDI/BDS anim.ini: edit existing animations without normalizing unrelated INI data.
import { element } from "../dom-element.ts"
import { animationPlayer } from "../animation-player.ts"
import { iniPreviewClip } from "../animation-preview-model.ts"
import { visualResolver } from "./bda-documents"
import { IniDocument } from "../ini.ts"
import { deferNumberInputRefresh } from "../number-input-wheel.ts"
import { syncInspectorRows } from "../inspector-shell.ts"
import { preview } from "./canvas-interaction"
import { setSourceValue } from "./config-context"
import { mode } from "./dom"
import { commitText, isEditing, updateDirty } from "./edit-history"
import { syncMobileInspectorGroups } from "./mobile-layout"
import { fieldCaption } from "./property-rows"
import { refreshPreview } from "./preview-render"
import { appState } from "./state"

type Options = readonly (readonly [string, string])[]
type Edit = (section: string, mutate: (document: IniDocument) => void) => void
const LABELS: Record<string, string> = {
  CATEGORY: "动画类别", TYPE: "变化属性", DURATION: "持续时间", DELAY: "延迟时间",
  REPEAT_CNT: "重复次数", REPEAT_MODE: "重复方式", REMOVE: "结束后移除", INTPOL: "插值方式",
  FROM: "起始值", TO: "结束值", FROM_PX: "起始位移（px）", TO_PX: "结束位移（px）",
  PIVOT: "变换中心（%）", PIVOT_PX: "变换中心（px）", BUILD_NUM: "组合动画数量",
  BUILD_LIST: "组合动画列表", BUILD_METHOD: "组合播放方式", ANIM_NUM: "动画数量",
  LIFE: "粒子寿命范围", EMIT_REGION: "发射区域", TOTAL_NUMBER: "粒子总数",
  BIRTH_RATE: "发射速率", EMIT_TYPE: "发射方式", PARTICLE_IMAGE: "粒子图片样式",
  VELOCITY: "初速度范围", VELOCITY_DIRECTION: "初速度方向范围", ACCELERATION: "加速度范围",
  ACCELERATION_DIRECTION: "加速度方向范围", INIT_SCALE: "初始缩放范围", SCALE_SPEED: "缩放速度范围",
  INIT_ROTATE: "初始旋转范围", ROTATE_SPEED: "旋转速度范围", INIT_ALPHA: "初始透明度范围",
  ALPHA_SPEED: "透明度速度范围", SOURCE_FILE: "图片序列", MODIFY: "帧修改方式",
  OFFSET: "画面偏移", LEVEL: "显示层级", REGION: "作用区域", PLAY_SPEED_RATE: "三段播放速率",
}
const CATEGORIES: Options = [["0", "属性变化"], ["1", "组合动画"], ["2", "帧动画"], ["3", "粒子动画"]]
const TYPES: Options = [["0", "透明度"], ["1", "旋转"], ["2", "位移"], ["3", "缩放"], ["4", "缩放（4）"]]
const CURVES: Options = [["0", "线性"], ["1", "缓入"], ["2", "缓出"], ["3", "平滑"], ["4", "弹跳"]]
const ENUMS: Record<string, Options> = {
  CATEGORY: CATEGORIES,
  BUILD_METHOD: [["0", "同时播放"], ["1", "顺序播放"], ["2", "随机播放"]],
  REPEAT_MODE: [["0", "从头重复"], ["1", "往返播放"]],
  INTPOL: CURVES,
  EMIT_TYPE: [["0", "发射模式 0"], ["1", "发射模式 1"]],
  MODIFY: [["0", "帧修改模式 0"], ["1", "帧修改模式 1"], ["2", "帧修改模式 2"]],
  LEVEL: [["0", "下层"], ["1", "上层"]],
  REGION: [0, 1, 2, 3, 4].map((value) => [String(value), `区域 ${value}`]),
}
const TIMING = ["DURATION", "DELAY", "REPEAT_CNT", "REPEAT_MODE", "REMOVE"]
const PARTICLE_RANGES = ["LIFE", "VELOCITY", "VELOCITY_DIRECTION", "ACCELERATION", "ACCELERATION_DIRECTION", "INIT_SCALE", "SCALE_SPEED", "INIT_ROTATE", "ROTATE_SPEED", "INIT_ALPHA", "ALPHA_SPEED"]
const NUMBERS = new Set(["DURATION", "DELAY", "REPEAT_CNT", "BUILD_NUM", "ANIM_NUM", "TOTAL_NUMBER", "BIRTH_RATE"])
const POINTS = new Set(["FROM_PX", "TO_PX", "PIVOT", "PIVOT_PX", "OFFSET"])
const numeric = (value: string): boolean => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())

function category(document: IniDocument, section: string): string {
  return document.get(section, "CATEGORY")?.trim()
    ?? (document.get(section, "BUILD_LIST") !== undefined ? "1" : document.get(section, "PARTICLE_IMAGE") !== undefined ? "3" : "0")
}

function fieldLabel(key: string, document: IniDocument, section: string): string {
  if (key === "TYPE" && category(document, section) !== "0") return "动画类型"
  if (["FROM", "TO"].includes(key) && category(document, section) === "0") {
    const name = key === "FROM" ? "起始" : "结束"
    const type = document.get(section, "TYPE")?.trim() ?? "0"
    return `${name}${({ "0": "透明度（0–255）", "1": "旋转（°）", "2": "位移（%）", "3": "缩放（%）", "4": "缩放（%）" } as Record<string, string>)[type] ?? "值"}`
  }
  return LABELS[key] ?? key
}

function optionsFor(key: string, document: IniDocument, section: string): Options | undefined {
  if (key === "TYPE") return category(document, section) === "0" ? TYPES : undefined
  return ENUMS[key]
}

function rowFor(path: string, section: string, key: string, document: IniDocument, edit: Edit): HTMLElement {
  const row = element("label", "ui-field document-property-field")
  const label = fieldLabel(key, document, section)
  fieldCaption(row, key, label)
  row.dataset.inspectorRowKey = JSON.stringify(["baidu-animation", path, section, key])
  // Raw strings (including missing versus empty) keep reset lossless across control/type changes.
  const keys = key === "BUILD_LIST" ? [key, "BUILD_NUM"] : [key]
  row.dataset.inspectorValue = JSON.stringify(keys.map((name) => document.get(section, name) ?? null))
  row.addEventListener("inspector-reset", (event) => {
    event.preventDefault()
    const baseline = JSON.parse((event as CustomEvent<string>).detail) as Array<string | null>
    edit(section, (latest) => keys.forEach((name, index) => {
      if (baseline[index] === null) latest.remove(section, name)
      else latest.set(section, name, baseline[index])
    }))
  })
  const saved = document.get(section, key)
  const value = saved ?? ""
  const write = (next: string) => edit(section, (latest) => {
    latest.set(section, key, next)
    if (key === "BUILD_LIST" && latest.get(section, "BUILD_NUM") !== undefined && /^\s*\d+(?:\s*,\s*\d+)*\s*$/.test(next)) {
      latest.set(section, "BUILD_NUM", String(next.split(",").length))
    }
  })
  const options = optionsFor(key, document, section)
  if (options) {
    const box = element("span", "ui-input ui-select")
    const select = element("select")
    select.disabled = !isEditing()
    select.setAttribute("aria-label", label)
    select.append(new Option("未设置", ""))
    for (const [id, text] of options) select.append(new Option(text, id))
    if (value && !options.some(([id]) => id === value)) select.append(new Option(`${value}（当前值）`, value))
    select.value = value
    select.addEventListener("change", () => {
      if (select.value) write(select.value)
      else edit(section, (latest) => latest.remove(section, key))
    })
    box.append(select)
    row.append(box)
    return row
  }
  // Nonstandard boolean spellings stay editable as raw text rather than being coerced on render.
  if (key === "REMOVE" && (saved === undefined || ["0", "1"].includes(value))) {
    const input = element("input", "ui-switch")
    input.type = "checkbox"
    input.setAttribute("role", "switch")
    input.setAttribute("aria-label", label)
    input.disabled = !isEditing()
    input.checked = value === "1"
    input.addEventListener("change", () => write(input.checked ? "1" : "0"))
    row.append(input)
    return row
  }
  const parts = value.split(",")
  const transformPoint = ["FROM", "TO"].includes(key) && category(document, section) === "0"
    && ["2", "3", "4"].includes(document.get(section, "TYPE")?.trim() ?? "")
  const axes = key === "EMIT_REGION" ? ["←", "↑", "→", "↓"]
    : POINTS.has(key) || transformPoint ? ["X", "Y"]
    : PARTICLE_RANGES.includes(key) ? ["最小", "最大"] : undefined
  if (axes && (saved === undefined || parts.length === axes.length && parts.every(numeric))) {
    const pair = element("span", "ui-field-pair")
    pair.dataset.columns = String(axes.length)
    axes.forEach((axis, index) => {
      const box = element("span", "ui-input")
      const affix = element("span", "ui-input-affix")
      affix.textContent = axis
      const input = numberInput(parts[index] ?? "", `${label} ${axis}`)
      input.addEventListener("change", () => {
        if (!input.value || !Number.isFinite(input.valueAsNumber)) return
        edit(section, (latest) => {
          // A wheel session may edit this component many times without rerendering. Never reuse
          // the other components from the render's closure, nor clobber a concurrent source edit.
          const current = latest.get(section, key)
          const values = current === undefined ? axes.map(() => "0") : current.split(",")
          if (values.length !== axes.length || !values.every(numeric)) return
          values[index] = input.value
          latest.set(section, key, values.join(","))
        })
      })
      box.append(affix, input)
      pair.append(box)
    })
    row.append(pair)
    return row
  }
  const box = element("span", "ui-input")
  const knownNumber = NUMBERS.has(key) || ["FROM", "TO"].includes(key) && category(document, section) === "0"
  const input = knownNumber && (saved === undefined || numeric(value))
    ? numberInput(value, label) : element("input")
  input.value = input.type === "number" ? value.trim() : value
  input.placeholder = "未设置"
  input.disabled = !isEditing()
  input.setAttribute("aria-label", label)
  input.addEventListener("change", () => write(input.value))
  box.append(input)
  if (["DURATION", "DELAY"].includes(key)) {
    const unit = element("span", "ui-input-affix")
    unit.textContent = "ms"
    box.append(unit)
  }
  row.append(box)
  return row
}

function numberInput(value: string, label: string): HTMLInputElement {
  const input = element("input")
  input.type = "number"
  input.step = "any"
  input.value = value.trim()
  input.placeholder = "未设置"
  input.disabled = !isEditing()
  input.setAttribute("aria-label", label)
  return input
}

function renderSection(path: string, document: IniDocument, section: string, edit: Edit): HTMLElement {
  const panel = element("section", "ui-section document-property-section")
  const animation = /^ANIM(\d+)$/i.exec(section)
  panel.dataset.inspectorGroupLabel = animation ? `动画 ${animation[1]}` : section || "基本信息"
  panel.dataset.animationSection = section
  const heading = element("h3", "document-section-heading")
  const title = element("span", "document-section-title")
  title.textContent = panel.dataset.inspectorGroupLabel
  const code = element("span", "document-section-code")
  code.textContent = section
  heading.append(title, code)
  panel.append(heading)
  const used = new Set<string>()
  const addGroup = (name: string, keys: string[], optional = false) => {
    const unique = [...new Set(keys)].filter((key) => !used.has(key) && (!optional || document.get(section, key) !== undefined))
    if (!unique.length) return
    const block = element("div", "ui-subsection")
    const subtitle = element("h4")
    subtitle.textContent = name
    const grid = element("div", "document-property-grid")
    for (const key of unique) {
      used.add(key)
      grid.append(rowFor(path, section, key, document, edit))
    }
    block.append(subtitle, grid)
    panel.append(block)
  }
  if (animation) {
    const kind = category(document, section)
    const summary = element("p", "inspector-group-subtitle")
    summary.textContent = CATEGORIES.find(([id]) => id === kind)?.[1] ?? `类别 ${kind}（保留原始参数）`
    panel.append(summary)
    const archive = appState.archive
    panel.append(animationPlayer({ clip: iniPreviewClip(document, section), resolver: visualResolver(),
      readFile: (file) => archive?.getBytes(`${path.slice(0, path.lastIndexOf("/") + 1)}${file}`) ?? archive?.getBytes(file) }))
    addGroup("动画设置", ["CATEGORY"])
    addGroup("动画类型", ["TYPE"], kind !== "0")
    addGroup("时间与循环", TIMING, !["0", "2", "3"].includes(kind))
    if (kind === "0") {
      addGroup("数值与曲线", ["INTPOL", ...(document.get(section, "FROM_PX") !== undefined || document.get(section, "TO_PX") !== undefined ? ["FROM_PX", "TO_PX"] : ["FROM", "TO"])])
      addGroup("变换中心", ["PIVOT", "PIVOT_PX"], true)
    } else if (kind === "1") {
      addGroup("组合播放", ["BUILD_METHOD", "BUILD_LIST", "BUILD_NUM"])
    } else if (kind === "2") {
      addGroup("帧序列", ["SOURCE_FILE", "MODIFY", "OFFSET", "LEVEL", "REGION", "PLAY_SPEED_RATE"], true)
    } else if (kind === "3") {
      addGroup("粒子发射", ["PARTICLE_IMAGE", "LIFE", "EMIT_REGION", "TOTAL_NUMBER", "BIRTH_RATE", "EMIT_TYPE"])
      addGroup("粒子运动", ["VELOCITY", "VELOCITY_DIRECTION", "ACCELERATION", "ACCELERATION_DIRECTION"])
      addGroup("粒子外观", ["INIT_SCALE", "SCALE_SPEED", "INIT_ROTATE", "ROTATE_SPEED", "INIT_ALPHA", "ALPHA_SPEED"])
    }
  }
  addGroup(animation ? "其他参数（保留原值）" : "配置", document.entries(section).map(({ key }) => key))
  return panel
}

/** Returns false for anything except an existing BDI/BDS anim.ini document. */
export function populateBaiduAnimationInspector(container: HTMLElement): boolean {
  const archive = appState.archive
  const path = appState.selectedPath
  if (!archive || !["bdi", "bds"].includes(archive.format) || !/(?:^|\/)anim\.ini$/i.test(path)
    || !appState.selectedDocument || !archive.isText(path)) return false
  const active = () => appState.archive === archive && appState.selectedPath === path
  const render = () => {
    if (!active()) return
    if (deferNumberInputRefresh(container, render)) return
    const document = IniDocument.parse(archive.getText(path))
    appState.selectedDocument = document
    const sections = document.sections()
    if (document.entries("").length) sections.unshift("")
    const visible = sections.filter((section) => !/^ANIM\d+$/i.test(section) || appState.animationDesignMode === "all"
      || (category(document, section) === "3") === (appState.animationDesignMode === "particle"))
    appState.particlePreviewSection = ""
    preview.setParticlePreview()
    container.replaceChildren(...visible.map((section) => renderSection(path, document, section, edit)))
    container.dataset.path = path
    syncMobileInspectorGroups()
    // This is the project's actual inspector-shell refresh export; use the same context as the
    // outer key inspector so its final sync doesn't reset the freshly collected baselines.
    syncInspectorRows(JSON.stringify([path, appState.selectedKeySections, mode.value]))
  }
  const edit: Edit = (section, mutate) => {
    if (!active() || !isEditing()) return
    const before = archive.getText(path)
    const latest = IniDocument.parse(before)
    if (section && !latest.sections().includes(section)) return
    mutate(latest)
    const after = latest.toString()
    if (before === after) return
    commitText(path, before, after)
    appState.selectedDocument = latest
    if (path === appState.layoutPath) appState.layoutDocument = latest
    setSourceValue(after)
    refreshPreview()
    updateDirty()
    render()
  }
  render()
  return true
}
