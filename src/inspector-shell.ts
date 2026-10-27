/*
 * 检查器的通用交互（结构规范见 DESIGN.md §10）：
 *   · 分组标题悬停时提示对应的配置字段；
 *   · 筛选框按标签、属性名过滤属性行，换选择对象后仍然生效；
 *   · 本次选择后改过的属性行带标记，点标记恢复这一行，对象头里的「重置」一次恢复全部；
 *   · 数值的标签与单位前缀可以左右拖动调整（交互在 number-input-wheel.ts，这里只标出把手）；
 *   · 未选对象时的空状态、手势行的「已配置」状态。
 * 只负责呈现，不写配置：恢复也是把输入框改回基线再派发 input / change，由各模块写回。
 */

import { createIcon } from "./icons"
import { scrubbableField } from "./number-input-wheel"

type InspectorInput = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
type Row = { el: HTMLElement; inputs: InspectorInput[] }

const SECTION_HINTS: Record<string, string> = {
  布局: "VIEW_RECT / PADDING",
  样式: "BACK_STYLE / FORE_STYLE / SOUND_STYLE",
  文字: "SHOW / FONT_* / NM_COLOR / HL_COLOR",
  手势: "CENTER / HOLD / UP / DOWN / LEFT / RIGHT",
  皮肤信息: "Info.txt",
  候选栏与工具栏: "CAND",
}
const SECTION_SELECTOR = ":is(.inspector-group, .document-property-section, .bda-inspector-section)"
/** 一条属性行：筛选、改动标记和恢复都以它为单位。 */
const ROW_SELECTOR = ".ui-field, .document-property-field, .bda-text-field, .bda-readonly-field, .bda-range-field, .bda-color-field, .fore-style-reference-field, .inspector-gesture"
const SCRUB_HANDLES = ".ui-input > .ui-input-affix, .ui-field > span:first-child, .document-field-caption"
const baselines = new WeakMap<HTMLElement, string>()
const keyedBaselines = new Map<string, string>()
let rows: Row[] = []
let filterQuery = ""

function inspector(): HTMLElement | null {
  return document.getElementById("quick-inspector")
}

function valueOf(input: InspectorInput): string {
  return input instanceof HTMLInputElement && input.type === "checkbox" ? String(input.checked) : input.value
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

function headedSections(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SECTION_SELECTOR)).filter((section) => section.querySelector(":scope > h3"))
}

function decorateSections(): void {
  const root = inspector()
  if (!root) return
  for (const section of headedSections(root)) {
    const heading = section.querySelector<HTMLElement>(":scope > h3")
    if (heading && !heading.title) heading.title = SECTION_HINTS[sectionName(section)] ?? ""
  }
  for (const handle of Array.from(root.querySelectorAll<HTMLElement>(SCRUB_HANDLES))) {
    handle.toggleAttribute("data-scrub", Boolean(scrubbableField(handle)))
  }
}

/* —— 筛选：按标签文字、属性名（INI 键）与分组名过滤属性行 —— */
function filterInput(): HTMLInputElement | null {
  return document.getElementById("inspector-filter") as HTMLInputElement | null
}

function rowText(row: HTMLElement): string {
  const parts = [row.textContent ?? "", row.title, row.dataset.documentKey ?? ""]
  for (const input of Array.from(row.querySelectorAll<HTMLElement>("input, select, textarea"))) {
    parts.push(input.getAttribute("aria-label") ?? "", ...Object.values(input.dataset).map(String))
  }
  return parts.join(" ").toLowerCase()
}

function applyFilter(): void {
  const root = inspector()
  if (!root) return
  const query = filterQuery.trim().toLowerCase()
  root.toggleAttribute("data-filtering", Boolean(query))
  let matches = 0
  for (const section of headedSections(root)) {
    const sectionHit = !query || sectionName(section).toLowerCase().includes(query)
    const sectionRows = Array.from(section.querySelectorAll<HTMLElement>(ROW_SELECTOR))
    // 分组内的子标题也是分组名（手心动画按「时间与曲线」「液体外观」等再分），命中时整块保留。
    const blockHits = Array.from(section.querySelectorAll<HTMLElement>(".ui-subsection"))
      .filter((block) => block.querySelector(":scope > h4")?.textContent?.toLowerCase().includes(query))
    const hits = new Set(sectionRows.filter((row) => sectionHit || rowText(row).includes(query)
      || Boolean(query) && blockHits.some((block) => block.contains(row))))
    // 外层行没命中、里面的子行命中时，外层也要留着。
    for (const row of hits) {
      for (let outer = row.parentElement?.closest<HTMLElement>(ROW_SELECTOR); outer && section.contains(outer); outer = outer.parentElement?.closest<HTMLElement>(ROW_SELECTOR)) hits.add(outer)
    }
    for (const row of sectionRows) {
      row.toggleAttribute("data-filter-miss", !hits.has(row))
      if (query && hits.has(row)) row.closest("details")?.setAttribute("open", "")
    }
    for (const details of Array.from(section.querySelectorAll("details"))) {
      details.toggleAttribute("data-filter-miss", !sectionRows.some((row) => hits.has(row) && details.contains(row)))
    }
    for (const block of Array.from(section.querySelectorAll(".ui-subsection"))) {
      block.toggleAttribute("data-filter-miss", Boolean(query) && !sectionHit && ![...hits].some((row) => block.contains(row)))
    }
    const visibleHits = [...hits].filter((row) => !isHidden(row, section)).length
    section.toggleAttribute("data-filter-miss", Boolean(query) && !sectionHit && visibleHits === 0)
    if (!isHidden(section, root)) matches += visibleHits
  }
  const empty = root.querySelector<HTMLElement>(".inspector-filter-empty")
  if (empty) {
    empty.hidden = !query || matches > 0
    empty.textContent = `没有与“${filterQuery.trim()}”匹配的属性`
  }
}

function setFilterOpen(open: boolean): void {
  const root = inspector()
  const input = filterInput()
  if (!root || !input) return
  root.toggleAttribute("data-filter-open", open)
  if (open) {
    input.focus()
    input.select()
    return
  }
  input.value = ""
  filterQuery = ""
  applyFilter()
}

function bindFilter(root: HTMLElement): void {
  const input = filterInput()
  if (!input) return
  input.addEventListener("input", () => {
    filterQuery = input.value
    applyFilter()
  })
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    if (input.value) {
      input.value = ""
      filterQuery = ""
      applyFilter()
    } else {
      setFilterOpen(false)
      input.blur()
    }
  })
  input.addEventListener("blur", () => { if (!input.value) setFilterOpen(false) })
  const openButton = root.querySelector(".inspector-filter-open")
  // 按下时不让输入框失焦，否则空输入会先因 blur 收起、再被 click 重新打开。
  openButton?.addEventListener("pointerdown", (event) => event.preventDefault())
  openButton?.addEventListener("click", () => setFilterOpen(!root.hasAttribute("data-filter-open")))
  root.querySelector(".inspector-filter-close")?.addEventListener("pointerdown", (event) => {
    // 先于输入框失焦处理，避免按钮在点击前被收起。
    event.preventDefault()
    setFilterOpen(false)
  })
  // 属性视图打开时 Ctrl/⌘ + F 筛选属性；源代码视图里仍是查找（editing-controls.ts）。
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
    if (root.hidden || !root.getClientRects().length) return
    event.preventDefault()
    setFilterOpen(true)
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
  for (const input of Array.from(root.querySelectorAll<InspectorInput>("input, select, textarea"))) {
    if (input.id === "inspector-filter") continue
    const el = input.closest<HTMLElement>(ROW_SELECTOR) ?? input.closest("label")
    if (!el) continue
    grouped.set(el, [...(grouped.get(el) ?? []), input])
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
  if (reset) {
    reset.hidden = count === 0
    reset.title = `本次选择后改了 ${count} 项，点击全部恢复`
    const badge = document.createElement("span")
    badge.className = "inspector-changes"
    badge.textContent = `已改 ${count}`
    reset.replaceChildren(badge, "重置")
  }
  const root = inspector()
  if (!root) return
  for (const section of headedSections(root)) {
    section.querySelector(":scope > h3")?.toggleAttribute("data-modified", Boolean(section.querySelector(":scope > :not(h3) [data-modified], :scope > [data-modified]:not(h3)")))
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
  for (const row of rows.filter((item) => item.el.hasAttribute("data-modified"))) revertRow(row)
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
  syncGestures()
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
  hint.textContent = "在画布或左侧概览中选择按键、面板或样式，属性会显示在这里。"
  const shortcuts = document.createElement("dl")
  const mac = /Mac/.test(navigator.platform)
  for (const [label, key] of [["撤销", mac ? "⌘Z" : "Ctrl Z"], ["重做", mac ? "⇧⌘Z" : "Ctrl Shift Z"], ["筛选属性", mac ? "⌘F" : "Ctrl F"], ["保存皮肤", mac ? "⌘S" : "Ctrl S"]]) {
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
function syncGestures(): void {
  for (const grid of Array.from(document.querySelectorAll<HTMLElement>("#quick-inspector .inspector-gestures"))) {
    const cells = Array.from(grid.querySelectorAll<HTMLElement>("[data-gesture]"))
    for (const cell of cells) {
      const code = cell.querySelector<HTMLInputElement>("input")?.value ?? ""
      cell.classList.toggle("configured", Boolean(code && code !== "None"))
    }
    const count = grid.closest(SECTION_SELECTOR)?.querySelector(".inspector-gesture-count")
    if (count) count.textContent = `${cells.filter((cell) => cell.classList.contains("configured")).length} / ${cells.length}`
  }
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
      decorateSections()
      if (filterQuery) applyFilter()
    })
  })
  for (const view of Array.from(document.querySelectorAll("#quick-inspector, #resource-inspector"))) {
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
/** 渲染出新值后调用：换了选择对象就重拍基线，否则只清掉已回到基线的标记（撤销 / 重做不触发 input）。 */
export function syncInspectorRows(context: string): void {
  const fresh = context !== selectionContext
  selectionContext = context
  if (fresh) keyedBaselines.clear()
  collectRows()
  for (const row of rows) {
    if (fresh) baselines.set(row.el, rowValue(row))
    if (fresh && row.el.dataset.inspectorRowKey) keyedBaselines.set(row.el.dataset.inspectorRowKey, rowValue(row))
    if (row.el.dataset.inspectorValue !== undefined) markRow(row, !fresh && rowValue(row) !== baselines.get(row.el))
    else if (fresh || rowValue(row) === baselines.get(row.el)) markRow(row, false)
  }
  updateStatus()
  syncGestures()
}
