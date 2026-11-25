/*
 * 检查器的通用交互（结构规范见 DESIGN.md §10）：
 *   · 分组标题悬停时提示对应的配置字段；
 *   · 筛选框按标签、属性名过滤属性行，换选择对象后仍然生效（带 data-filter-keep 的对象列表不参与筛选）；
 *   · 本次选择后改过的属性行与分组标题带标记（只是标记），分类栏底部的「已改 n · 重置」一次恢复全部；
 *   · 数值的标签与单位前缀可以左右拖动调整（交互在 number-input-wheel.ts，这里只标出把手）；
 *   · 未选对象时的空状态、手势行的「已配置」状态。
 * 只负责呈现，不写配置：恢复也是把输入框改回基线再派发 input / change，由各模块写回。
 */

import { playEnter } from "./motion"
import { createIcon } from "./icons"
import { searchField, shortcutLabel } from "./dom-element"
import { scrubbableField } from "./number-input-wheel"
import { styleReferenceAddButton } from "./style-card"

type InspectorInput = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
type Row = { el: HTMLElement; inputs: InspectorInput[] }

const SECTION_HINTS: Record<string, string> = {
  布局: "VIEW_RECT / PADDING",
  样式: "BACK_STYLE / FORE_STYLE",
  音效: "SOUND_STYLE",
  动画: "ANIM_STYLE / BACK_ANIM_STYLE / FORE_ANIM_STYLE / PRESS_STYLE",
  文字: "SHOW / FONT_* / NM_COLOR / HL_COLOR",
  手势: "CENTER / HOLD / UP / DOWN / LEFT / RIGHT",
  皮肤信息: "Info.txt",
  候选栏与工具栏: "CAND",
}
const SECTION_SELECTOR = ".ui-section"
/** 一条属性行：筛选、改动标记和恢复都以它为单位。 */
const ROW_SELECTOR = ".ui-field, .inspector-gesture, .ui-toolbar-icon"
const VALUE_CONTROLS = 'input:not([type=file]):not([type=color]):not([type=range]):not([data-config-derived]), select:not([data-config-derived]), textarea:not([data-config-derived])'
const EDITABLE_CONTROL = 'input:not(:disabled):not([readonly]), select:not(:disabled), textarea:not(:disabled):not([readonly]), button:not(:disabled):not([data-config-add])'
const SCRUB_HANDLES = ".ui-input > .ui-input-affix, .ui-field > span:first-child, .document-field-caption"
let baselines = new WeakMap<HTMLElement, string>()
const keyedBaselines = new Map<string, string>()
let rows: Row[] = []
let filterQuery = ""

function inspector(): HTMLElement | null {
  return document.getElementById("quick-inspector")
}

function valueOf(input: InspectorInput): string {
  return input instanceof HTMLInputElement && input.type === "checkbox" ? String(input.checked) : input.value
}

function emptyConfigValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === "string") return !value.trim()
  if (Array.isArray(value)) return value.every(emptyConfigValue)
  return false
}

function emptyRow(row: HTMLElement, values?: NodeListOf<InspectorInput>): boolean {
  if (row.dataset.configEmpty !== undefined) return row.dataset.configEmpty === "true"
  if (row.dataset.inspectorValue !== undefined) return emptyConfigValue(JSON.parse(row.dataset.inspectorValue))
  values ??= row.querySelectorAll<InspectorInput>(VALUE_CONTROLS)
  return values.length > 0 && Array.from(values).every(input => !("placeholder" in input && input.placeholder.includes("混合")) && emptyConfigValue(valueOf(input)))
}

function focusFirstControl(container: HTMLElement): void {
  Array.from(container.querySelectorAll<HTMLElement>('.ui-field input:not([type=hidden]):not(:disabled), .ui-field select:not(:disabled), .ui-field textarea:not(:disabled), .ui-field button:not(:disabled)'))
    .find(control => control.getClientRects().length > 0)?.focus()
}

function sectionFields(section: HTMLElement): HTMLElement[] {
  return Array.from(section.querySelectorAll<HTMLElement>(".ui-field"))
    .filter(row => row.closest(".ui-section") === section && row.dataset.supported !== "false" && !isHidden(row, section))
}

/** 整组未配置时只留标题和添加入口；展开只改变界面，不创建默认配置。 */
function syncEmptySections(fresh = false): void {
  for (const section of document.querySelectorAll<HTMLElement>("#quick-inspector .ui-section, #resource-inspector .ui-section")) {
    const heading = section.querySelector<HTMLElement>(":scope > h3")
    if (!heading || !(/动画$|文字|字体/.test(sectionName(section)) || section.querySelector(".ui-typography-preview"))) continue
    const fields = sectionFields(section)
    const empty = fields.length > 0 && fields.every(row => emptyRow(row))
    if (fresh || !empty) section.removeAttribute("data-config-section-expanded")
    const pending = empty && !section.hasAttribute("data-config-section-expanded")
    section.toggleAttribute("data-config-section-pending", pending)
    let add = heading.querySelector<HTMLButtonElement>("[data-config-section-add]")
    if (!pending) { add?.remove(); continue }
    if (!add) {
      add = styleReferenceAddButton(`添加${sectionName(section)}`, () => {
        section.setAttribute("data-config-section-expanded", "")
        section.removeAttribute("data-config-section-pending")
        add?.remove()
        // 普通空字段直接显示控件，资源引用仍保留原来的选择入口。
        for (const row of sectionFields(section)) {
          row.setAttribute("data-config-expanded", "")
          row.removeAttribute("data-config-pending")
          row.querySelector("[data-config-add]")?.remove()
        }
        focusFirstControl(section)
      })
      add.dataset.configSectionAdd = ""
      add.setAttribute("aria-expanded", "false")
      heading.append(add)
    }
    add.disabled = !fields.some(row => row.querySelector(EDITABLE_CONTROL))
  }
}

/** 空配置复用引用字段的添加入口；展开只改变界面，提交仍由原控件负责。 */
function syncEmptyFields(root: HTMLElement, fresh = false): void {
  for (const row of root.querySelectorAll<HTMLElement>(".ui-field")) {
    const soundPicker = row.querySelector<HTMLElement>('.ui-style-ref[data-variant="sound"] .ui-style-state')
    if (row.classList.contains("style-reference-field") && !soundPicker || row.dataset.supported === "false"
      || row.querySelector('.ui-list-toolbar, .ui-field-pair[data-variant="colors"]')) continue
    const caption = row.firstElementChild
    if (!(caption instanceof HTMLElement) || caption.matches("input, select, textarea")) continue
    const values = row.dataset.inspectorValue === undefined ? row.querySelectorAll<InspectorInput>(VALUE_CONTROLS) : undefined
    if (values?.length === 0) continue
    const empty = emptyRow(row, values)
    let add = caption.querySelector<HTMLButtonElement>("[data-config-add]")
    if (fresh || !empty) row.removeAttribute("data-config-expanded")
    const pending = empty && !row.hasAttribute("data-config-expanded")
    row.toggleAttribute("data-config-pending", pending)
    if (!pending) { add?.remove(); continue }
    if (!add) {
      const label = caption.querySelector(".document-field-name")?.textContent ?? caption.textContent ?? "配置"
      add = styleReferenceAddButton(`添加${label.trim()}`, () => {
        if (soundPicker) { soundPicker.click(); return }
        row.setAttribute("data-config-expanded", "")
        row.removeAttribute("data-config-pending")
        add?.remove()
        focusFirstControl(row)
      })
      add.dataset.configAdd = ""
      // 部分旧行是 label，不能让添加按钮的点击再触发开关或第一个选项。
      add.addEventListener("click", event => event.preventDefault())
      caption.append(add)
    }
    add.disabled = !row.querySelector(EDITABLE_CONTROL)
  }
}

function isHidden(el: Element, within: Element): boolean {
  const hidden = el.closest("[hidden]")
  return Boolean(hidden && within.contains(hidden))
}

/* —— 分组标题 —— */
function sectionName(section: HTMLElement): string {
  return section.dataset.inspectorGroupLabel
    || section.querySelector(":scope > h3 .document-section-title")?.textContent?.trim()
    || section.querySelector(":scope > h3")?.textContent?.replace(/\s+/g, " ").trim()
    || ""
}

function sectionHeadings(root: HTMLElement) {
  return root.querySelectorAll<HTMLElement>(".ui-section > h3")
}

function decorateSections(): void {
  const root = inspector()
  if (!root) return
  for (const heading of sectionHeadings(root)) {
    if (heading.title) continue
    const name = sectionName(heading.parentElement!)
    // 分区动画分组按分区命名（面板动画、列表动画…），沿用「动画」的字段说明。
    heading.title = SECTION_HINTS[name] ?? (/动画$/.test(name) ? SECTION_HINTS["动画"] : "")
  }
  for (const handle of root.querySelectorAll<HTMLElement>(SCRUB_HANDLES)) {
    handle.toggleAttribute("data-scrub", Boolean(scrubbableField(handle)))
  }
}

/* —— 筛选：按标签文字、属性名（INI 键）与分组名过滤属性行 —— */
function rowText(row: HTMLElement): string {
  const parts = [row.textContent ?? "", row.title, row.dataset.documentKey ?? ""]
  for (const input of row.querySelectorAll<HTMLElement>("input, select, textarea")) {
    parts.push(input.getAttribute("aria-label") ?? "", ...Object.values(input.dataset).map(String))
  }
  return parts.join(" ").toLowerCase()
}

function applyFilter(): void {
  const root = inspector()
  if (!root) return
  const query = filterQuery
  const empty = root.querySelector<HTMLElement>(".inspector-filter-empty")
  root.toggleAttribute("data-filtering", Boolean(query))
  if (!query) {
    if (empty) empty.hidden = true
    for (const miss of root.querySelectorAll("[data-filter-miss]")) miss.removeAttribute("data-filter-miss")
    return
  }
  let matches = 0
  for (const heading of sectionHeadings(root)) {
    const section = heading.parentElement!
    const sectionHit = sectionName(section).toLowerCase().includes(query)
    const sectionRows = Array.from(section.querySelectorAll<HTMLElement>(ROW_SELECTOR))
    // 分组内的子标题也是分组名（手心动画按「时间与曲线」「液体外观」等再分），命中时整块保留。
    const blocks = Array.from(section.querySelectorAll<HTMLElement>(".ui-subsection"))
    const blockHits = blocks.filter((block) => block.querySelector(":scope > h4")?.textContent?.toLowerCase().includes(query))
    const hits = new Set(sectionRows.filter((row) => sectionHit || rowText(row).includes(query)
      || blockHits.some((block) => block.contains(row))))
    // 外层行没命中、里面的子行命中时，外层也要留着。
    for (const row of hits) {
      for (let outer = row.parentElement?.closest<HTMLElement>(ROW_SELECTOR); outer && section.contains(outer); outer = outer.parentElement?.closest<HTMLElement>(ROW_SELECTOR)) hits.add(outer)
    }
    for (const row of sectionRows) {
      row.toggleAttribute("data-filter-miss", !hits.has(row))
      if (hits.has(row)) row.closest("details")?.setAttribute("open", "")
    }
    for (const details of section.querySelectorAll("details")) {
      details.toggleAttribute("data-filter-miss", !sectionRows.some((row) => hits.has(row) && details.contains(row)))
    }
    for (const block of blocks) {
      block.toggleAttribute("data-filter-miss", !sectionHit && ![...hits].some((row) => block.contains(row)))
    }
    const visibleHits = [...hits].filter((row) => !isHidden(row, section)).length
    // 对象选择器（动画列表）不是属性：筛选时留着，才能换一个对象继续筛。
    section.toggleAttribute("data-filter-miss", !sectionHit && visibleHits === 0 && !section.hasAttribute("data-filter-keep"))
    if (!isHidden(section, root)) matches += visibleHits
  }
  if (empty) empty.hidden = matches > 0
}

function bindFilter(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>("#inspector-filter")
  const toggle = root.querySelector<HTMLButtonElement>(".inspector-filter-open")
  if (!input || !toggle) return
  const setOpen = (open: boolean) => {
    root.toggleAttribute("data-filter-open", open)
    toggle.setAttribute("aria-expanded", String(open))
    if (open) { input.focus(); input.select() }
    else if (input.value) {
      input.value = ""
      input.dispatchEvent(new Event("input"))
    }
  }
  const search = searchField({ input, label: "筛选属性", onInput(query) {
    filterQuery = query.toLowerCase()
    applyFilter()
  } })
  search.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    toggle.focus()
  })
  search.addEventListener("focusout", event => {
    if (!input.value && !search.contains(event.relatedTarget as Node | null)) setOpen(false)
  })
  toggle.addEventListener("pointerdown", event => event.preventDefault())
  toggle.addEventListener("click", () => setOpen(!root.hasAttribute("data-filter-open")))
  // 属性视图打开时 Ctrl/⌘ + F 筛选属性；源代码视图里仍是查找（editing-controls.ts）。
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
    if (root.hidden || !root.getClientRects().length) return
    event.preventDefault()
    setOpen(true)
  })
}

/* —— 改动标记与恢复：侧栏底部显示「已改 n · 重置」 —— */
function resetButton(): HTMLButtonElement | null {
  const rail = document.querySelector<HTMLElement>(".inspector-rail")
  if (!rail) return null
  let reset = rail.querySelector<HTMLButtonElement>(".inspector-reset")
  if (!reset) {
    reset = document.createElement("button")
    reset.type = "button"
    reset.className = "inspector-reset"
    reset.hidden = true
    reset.addEventListener("click", resetAll)
    rail.append(reset)
  }
  return reset
}

function rowValue(row: Row): string {
  return row.el.dataset.inspectorValue ?? JSON.stringify(row.inputs.map(valueOf))
}

function collectRows(): void {
  const root = inspector()
  if (!root) return
  const grouped = new Map<HTMLElement, InspectorInput[]>()
  for (const input of root.querySelectorAll<InspectorInput>("input, select, textarea")) {
    if (input.id === "inspector-filter") continue
    if (input.hasAttribute("data-config-derived")) continue
    const el = input.closest<HTMLElement>(ROW_SELECTOR) ?? input.closest("label")
    if (!el) continue
    const inputs = grouped.get(el)
    if (inputs) inputs.push(input)
    else grouped.set(el, [input])
  }
  // 分段这类只有按钮的行（field()）靠自己记下的值参与改动标记与重置。
  for (const el of root.querySelectorAll<HTMLElement>("[data-inspector-value]")) {
    if (el.matches(ROW_SELECTOR) && !grouped.has(el)) grouped.set(el, [])
  }
  rows = Array.from(grouped, ([el, inputs]) => {
    const row = { el, inputs }
    const key = el.dataset.inspectorRowKey
    if (key && keyedBaselines.has(key)) baselines.set(el, keyedBaselines.get(key)!)
    if (!baselines.has(el)) baselines.set(el, rowValue(row))
    if (key && !keyedBaselines.has(key)) keyedBaselines.set(key, baselines.get(el)!)
    return row
  })
}

function markRow(row: Row, modified: boolean): void {
  row.el.toggleAttribute("data-modified", modified)
  let dot = row.el.querySelector<HTMLElement>(":scope > .inspector-modified")
  if (modified && !dot) {
    dot = document.createElement("span")
    dot.className = "inspector-modified"
    dot.title = "本次选择后已修改"
    // 绝对定位在行左侧的留白里，追加在末尾，不打乱标签列。
    row.el.append(dot)
  }
  if (dot) dot.hidden = !modified
}

function updateStatus(): void {
  const count = rows.filter((row) => row.el.hasAttribute("data-modified")).length
  const reset = resetButton()
  const label = `重置本次修改的 ${count} 项属性`
  if (reset && reset.getAttribute("aria-label") !== label) {
    reset.hidden = count === 0
    reset.setAttribute("aria-label", label)
    reset.title = `本次选择后改了 ${count} 项，点击全部恢复`
    const badge = document.createElement("span")
    badge.className = "inspector-changes"
    badge.textContent = `已改 ${count}`
    reset.replaceChildren(createIcon("undo-2"), badge, "重置")
  }
  const root = inspector()
  if (!root) return
  for (const heading of sectionHeadings(root)) {
    heading.toggleAttribute("data-modified", Boolean(heading.parentElement!.querySelector(":scope > :not(h3) [data-modified], :scope > [data-modified]:not(h3)")))
  }
}

function revertRow(row: Row): void {
  if (row.el.dataset.inspectorValue !== undefined) {
    row.el.dispatchEvent(new CustomEvent("inspector-reset", { cancelable: true, detail: baselines.get(row.el) }))
    return
  }
  const values = JSON.parse(baselines.get(row.el) ?? "[]") as string[]
  const restore = () => row.inputs.forEach((input, index) => {
    if (input instanceof HTMLInputElement && input.type === "checkbox") input.checked = values[index] === "true"
    else input.value = values[index] ?? ""
  })
  // 组合字段（X/Y、色块 + 色值 + 透明度）：每派发一个分量前都把所有分量写回基线，
  // 前一个分量写回配置后检查器会重绘，其余分量会被刷成配置里的当前值。
  for (const input of row.inputs) {
    restore()
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }
  markRow(row, false)
}

function resetAll(): void {
  for (const row of rows.filter(item => item.el.hasAttribute("data-modified"))) {
    // 上一行写回可能重建整组；用新行的回调，避免旧快照覆盖刚恢复的兄弟字段。
    const key = row.el.dataset.inspectorRowKey
    const current = row.el.isConnected ? row : key ? rows.find(item => item.el.dataset.inspectorRowKey === key) : undefined
    if (current?.el.hasAttribute("data-modified")) revertRow(current)
  }
  updateStatus()
}

function onInspectorInput(event: Event): void {
  const target = event.target as Element | null
  if (target?.id === "inspector-filter") return
  const rowEl = target?.closest?.(ROW_SELECTOR) ?? target?.closest?.("label")
  const row = rows.find((candidate) => candidate.el === rowEl)
  if (!row) return
  markRow(row, rowValue(row) !== baselines.get(row.el))
  updateStatus()
  const grid = target?.closest(".inspector-gestures")
  if (grid) syncGestures(grid)
}

/** 标签被截断时悬停显示全文。 */
function revealTruncatedLabel(event: Event): void {
  const label = (event.target as Element | null)?.closest?.<HTMLElement>(".ui-field > span:first-child, .document-field-caption, .bda-style-reference-label")
  if (!label || label.title || label.scrollWidth <= label.clientWidth) return
  label.title = label.textContent?.trim() ?? ""
}

/* —— 空状态与手势 —— */
function renderEmptyState(): void {
  const pane = inspector()?.closest(".source")
  if (!pane || pane.querySelector(".inspector-empty")) return
  const empty = document.createElement("section")
  empty.className = "inspector-empty"
  const title = document.createElement("strong")
  title.textContent = "未选择对象"
  const hint = document.createElement("p")
  hint.textContent = "在画布或左侧概览中选择按键、面板或样式，属性会显示在这里"
  const shortcuts = document.createElement("dl")
  for (const [label, key] of [["撤销", shortcutLabel("Z")], ["重做", shortcutLabel("Z", true)], ["筛选属性", shortcutLabel("F")], ["保存皮肤", shortcutLabel("S")]]) {
    const term = document.createElement("dt")
    term.textContent = label
    const value = document.createElement("dd")
    value.textContent = key
    shortcuts.append(term, value)
  }
  empty.append(createIcon("mouse-pointer-2", 20), title, hint, shortcuts)
  pane.append(empty)
}

/** 每个手势十字（百度的静态分组、手心检查器生成的分组）各自统计已配置数。 */
function syncGestures(grid: Element): void {
  const cells = grid.querySelectorAll<HTMLElement>("[data-gesture]")
  let configured = 0
  for (const cell of cells) {
    const input = cell.querySelector<HTMLInputElement>("input")
    const code = input?.value ?? ""
    const active = Boolean(code && code !== "None")
    cell.dataset.configured = String(active)
    if (active) configured++
    const caption = cell.querySelector<HTMLElement>(":scope > span")
    if (caption && input) {
      caption.setAttribute("role", "button")
      caption.tabIndex = input.disabled || input.readOnly ? -1 : 0
      caption.setAttribute("aria-disabled", String(input.disabled || input.readOnly))
      caption.setAttribute("aria-label", `选择${caption.textContent?.trim()}动作码`)
      caption.setAttribute("aria-haspopup", "dialog")
    }
  }
  const count = grid.closest(SECTION_SELECTOR)?.querySelector(".inspector-gesture-count")
  const text = `${configured} / ${cells.length}`
  if (count && count.textContent !== text) count.textContent = text
}

// WebKit 不会按位图内存及时触发 GC；移除的缩略图主动释放，同步复用的画布保留。
function releaseRemovedCanvases(records: MutationRecord[]): void {
  for (const record of records) {
    for (const node of record.removedNodes) {
      if (!(node instanceof Element) || node.isConnected) continue
      const canvases = node instanceof HTMLCanvasElement ? [node] : node.querySelectorAll("canvas")
      for (const canvas of canvases) {
        if (canvas.isConnected) continue
        canvas.width = 0
        canvas.height = 0
      }
    }
  }
}

export function initInspectorShell(): void {
  renderEmptyState()
  decorateSections()
  collectRows()
  const root = inspector()
  if (!root) return
  bindFilter(root)
  root.addEventListener("pointerover", revealTruncatedLabel)
  root.addEventListener("pointerdown", collectRows, true)
  root.addEventListener("focusin", collectRows)
  root.addEventListener("input", onInspectorInput, true)
  root.addEventListener("change", onInspectorInput, true)

  let scheduled = false
  const observer = new MutationObserver((records) => {
    releaseRemovedCanvases(records)
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      syncEmptyFields(root)
      const styleFields = document.getElementById("style-detail-fields")
      if (styleFields) syncEmptyFields(styleFields)
      syncEmptySections()
      decorateSections()
      if (filterQuery) applyFilter()
    })
  })
  for (const view of document.querySelectorAll("#quick-inspector, #resource-inspector")) {
    observer.observe(view, { childList: true, subtree: true })
  }
}

export function setInspectorKind(kind: "bds" | "bda" | ""): void {
  for (const el of [inspector(), document.querySelector(".source")]) {
    if (!el) continue
    if (kind) el.setAttribute("data-inspector-kind", kind)
    else el.removeAttribute("data-inspector-kind")
  }
}

let selectionContext = ""
let selectionDocument: object | undefined
/** 渲染出新值后调用：换了选择对象就重拍基线，否则按当前值同步标记（撤销 / 重做不触发 input）。 */
export function syncInspectorRows(context: string, document?: object): void {
  const fresh = context !== selectionContext || document !== selectionDocument
  // 换了选择对象：整块内容淡入，说明检查器里已经是另一个对象（首次填充不算）
  if (fresh && selectionContext) playEnter(inspector())
  selectionContext = context
  selectionDocument = document
  if (fresh) {
    baselines = new WeakMap()
    keyedBaselines.clear()
  }
  collectRows()
  for (const row of rows) markRow(row, rowValue(row) !== baselines.get(row.el))
  updateStatus()
  const root = inspector()
  if (root) syncEmptyFields(root, fresh)
  syncEmptySections(fresh)
  root?.querySelectorAll(".inspector-gestures").forEach(syncGestures)
}
