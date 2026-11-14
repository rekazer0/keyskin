import { bindListboxKeys, element, emptyState, searchField } from "../dom-element.ts"
import { createIcon } from "../icons.ts"
import { closeDialog } from "../motion.ts"
import { pngSize } from "../ssf/ssf-png.ts"
import { isSoundPath, soundMimeType, soundPathForFilename } from "../sounds.ts"
import { styleTypeOptions } from "../style-card.ts"
import { appState } from "./state"
import { bindDialog } from "./ask"
import { availableStyleIDs, canAddStyle, removeUnusedStyles, styleConfigDocument, styleKind, styleSoundFile } from "./style-picker"
import { missingStyleReferences, openStyleReferenceEditor, styleUsages } from "./style-references"
import { isEditing } from "./edit-history"
import { requestEditMode } from "./mobile-layout"
import { selectFile } from "./navigation"
import { visualResolver } from "./bda-documents"
import { orientation, theme } from "./dom"
import { palmStyleImage } from "./sxi-styles"
import { styleConfigPath } from "./config-context"

type InventoryItem = { id: string; title: string; detail: string; status: "used" | "unused" | "missing" | "file"; icon: string; open?(): void }

function resourceInventoryItems(): InventoryItem[] {
  const archive = appState.archive
  if (!archive) return []
  const items: InventoryItem[] = archive.names().filter(path => archive.isImage(path) || isSoundPath(path)).map(path => {
    const bytes = archive.getBytes(path)!
    const size = pngSize(bytes)
    return { id: path, title: path, status: "file", icon: archive.isImage(path) ? "image" : "volume-2",
      detail: `${size ? `${size[0]} × ${size[1]} · ` : ""}${(bytes.length / 1024).toFixed(1)} KB`,
      open: () => selectFile(path, "overview", archive.isImage(path) ? "image" : "document"),
    }
  })
  // BDA 的二进制样式引用不使用 legacy 索引，不把其样式误标为未使用。
  if (["bdi", "bds", "sxi"].includes(archive.format)) for (const id of availableStyleIDs()) {
    const usages = styleUsages(id)
    items.push({ id: `style:${id}`, title: `样式 ${id}`, detail: `${styleTypeOptions.find(([value]) => value === styleKind(id))?.[1] ?? "样式"} · ${usages.length ? `${usages.length} 处引用` : "未使用"}`,
      status: usages.length ? "used" : "unused", icon: "palette", open: () => openStyleReferenceEditor(id) })
  }
  for (const { id, locations } of missingStyleReferences()) items.push({ id: `missing:${id}`, title: `缺失样式 ${id}`, detail: locations.join("；"), status: "missing", icon: "circle-alert" })
  const resolver = visualResolver()
  const styles = styleConfigDocument()
  const uses = new Map<string, string[]>()
  const addUse = (path: string, label: string) => uses.set(path, [...uses.get(path) ?? [], label])
  for (const id of availableStyleIDs()) {
    for (const pressed of [false, true]) {
      const path = resolver?.imagePath?.(id, pressed)
      const label = `样式 ${id} · ${pressed ? "按下" : "正常"}`
      if (path && (!resolver?.sourceSize || resolver.sourceSize(id, pressed))) { addUse(path, label); continue }
      const reference = archive.format === "sxi" ? palmStyleImage(id, pressed) : ["bdi", "bds"].includes(archive.format)
        ? (pressed ? styles?.get(`STYLE${id}`, "HL_IMG") : undefined) ?? styles?.get(`STYLE${id}`, "NM_IMG") : undefined
      if (reference?.trim()) items.push({ id: `missing-image:${id}:${pressed}`, title: `图片或切片缺失 · ${reference}`, detail: label, status: "missing", icon: "image-off", open: () => openStyleReferenceEditor(id) })
    }
    const sound = styleSoundFile(id, styles)
    if (!sound) continue
    const path = soundPathForFilename(archive.names(), theme.value, orientation.value, sound)
    if (path) addUse(path, `样式 ${id} · 音效`)
    else items.push({ id: `missing-sound:${id}`, title: `音效缺失 · ${sound}`, detail: `样式 ${id}`, status: "missing", icon: "volume-x", open: () => openStyleReferenceEditor(id) })
  }
  for (const item of items) if (uses.has(item.id)) {
    item.status = "used"
    item.detail += ` · 当前样式表 ${uses.get(item.id)!.length} 处引用`
  }
  return items
}

export function resourcePreflight(): { missing: string[]; unused: number; supported: boolean } {
  const items = resourceInventoryItems()
  return { missing: items.filter(item => item.status === "missing").map(item => `${item.title} · ${item.detail}`), unused: items.filter(item => item.status === "unused").length, supported: Boolean(appState.archive && ["bdi", "bds", "sxi"].includes(appState.archive.format)) }
}

/** 文件规格覆盖整个归档；引用与清理沿用当前样式表的跨布局检查。 */
export function openResourceInventory(): void {
  const archive = appState.archive
  if (!archive) return
  const dialog = element("dialog", "ui-dialog")
  dialog.dataset.variant = "ask"
  dialog.setAttribute("aria-label", "资源清单")
  const form = element("form")
  form.method = "dialog"
  const header = element("header", "ui-dialog-header")
  const heading = element("div")
  heading.append(Object.assign(element("h2"), { textContent: "资源清单" }), Object.assign(element("p"), {
    textContent: "图片与音效列出整个皮肤；样式使用状态与清理范围为当前样式表，包含适用的横竖屏布局。",
  }))
  header.append(heading)
  const body = element("div", "ui-dialog-body")
  const filters = element("div", "ui-segmented")
  filters.dataset.fill = ""
  filters.setAttribute("aria-label", "资源状态")
  const list = element("div", "ui-listbox")
  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", "资源清单")
  const summary = element("p", "ui-field-note")
  const footer = element("footer", "ui-dialog-footer")
  const status = element("span", "ui-dialog-status")
  const clean = Object.assign(element("button", "ui-button"), { type: "button", textContent: "清理未使用样式" })
  const close = Object.assign(element("button", "ui-button"), { type: "button", textContent: "关闭" })
  close.addEventListener("click", () => closeDialog(dialog))
  footer.append(status, clean, close)
  let filter = "all"
  let query = ""
  let selected = ""
  let items: InventoryItem[] = []
  const durations = new Map<string, string>()
  const audioLoads: (() => void)[] = []
  const choose = (row: HTMLElement) => {
    selected = row.dataset.inventoryId ?? ""
    for (const item of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      item.setAttribute("aria-selected", String(item === row))
      item.tabIndex = item === row ? 0 : -1
    }
  }
  const render = () => {
    const shown = items.filter(item => (filter === "all" || item.status === filter) && `${item.title} ${item.detail}`.toLowerCase().includes(query))
    if (!shown.some(item => item.id === selected)) selected = shown[0]?.id ?? ""
    list.replaceChildren(...shown.map(item => {
      const row = Object.assign(element("button", "ui-list-item"), { type: "button", title: `${item.title}\n${item.detail}` })
      row.dataset.inventoryId = item.id
      row.setAttribute("role", "option")
      row.setAttribute("aria-selected", String(selected === item.id))
      row.tabIndex = selected === item.id ? 0 : -1
      const text = element("span", "ui-list-item-text")
      text.append(Object.assign(element("strong"), { textContent: item.title }), Object.assign(element("small"), { textContent: item.detail }))
      row.append(createIcon(item.icon, 14), text)
      row.addEventListener("click", () => choose(row))
      const open = () => {
        if (!item.open || appState.archive !== archive) return
        closeDialog(dialog)
        item.open()
      }
      row.addEventListener("dblclick", open)
      row.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); open() } })
      return row
    }))
    if (!shown.length) list.append(emptyState("search-x"))
    summary.textContent = `${items.filter(item => !item.id.startsWith("style:") && item.status !== "missing").length} 个文件 · ${items.filter(item => item.id.startsWith("style:") && item.status === "used").length} 个已用样式 · ${items.filter(item => item.status === "unused").length} 个未用样式 · ${items.filter(item => item.status === "missing").length} 个缺失引用`
    clean.disabled = !canAddStyle() || !items.some(item => item.status === "unused")
  }
  const refresh = () => {
    if (appState.archive !== archive) { closeDialog(dialog); return }
    items = resourceInventoryItems()
    for (const item of items) if (durations.has(item.id)) item.detail += ` · ${durations.get(item.id)}`
    // shortcut: 原生可能隐式读取图片；补齐各格式隐式依赖索引后再开放文件清理。
    const scope = styleConfigPath()
    if (scope) heading.querySelector("p")!.textContent = `图片与音效列出整个皮肤；引用检查与可撤销清理范围：${scope}（含适用的横竖屏布局）。仅清理确认未使用的样式。`
    render()
  }
  for (const [value, label] of [["all", "全部"], ["used", "已用"], ["unused", "未用"], ["missing", "缺失"]]) {
    const button = Object.assign(element("button"), { type: "button", textContent: label })
    button.setAttribute("aria-pressed", String(value === filter))
    button.addEventListener("click", () => {
      filter = value
      for (const item of filters.children) item.setAttribute("aria-pressed", String(item === button))
      refresh()
    })
    filters.append(button)
  }
  clean.addEventListener("click", () => {
    if (!isEditing()) { requestEditMode(); return }
    if (appState.archive !== archive) { closeDialog(dialog); return }
    status.textContent = `已清理 ${removeUnusedStyles()} 个样式，可撤销恢复`
    refresh()
  })
  const search = searchField({ label: "搜索资源清单", onInput(value) { query = value.trim().toLowerCase(); render() } })
  bindListboxKeys(list, choose)
  body.append(search, filters, summary, list)
  form.append(header, body, footer)
  dialog.append(form)
  bindDialog(dialog)
  dialog.addEventListener("close", () => dialog.remove(), { once: true })
  document.body.append(dialog)
  refresh()
  dialog.showModal()
  close.focus()
  for (const item of items.filter(item => isSoundPath(item.id) && item.status !== "missing")) {
    const url = URL.createObjectURL(new Blob([archive.getBytes(item.id)! as BlobPart], { type: soundMimeType(item.id) }))
    const audio = new Audio()
    audio.preload = "metadata"
    const release = () => { audio.removeAttribute("src"); audio.load(); URL.revokeObjectURL(url) }
    audioLoads.push(release)
    audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(audio.duration)) durations.set(item.id, `${audio.duration.toFixed(2)} s`)
      if (dialog.open) refresh()
      release()
    }, { once: true })
    audio.addEventListener("error", () => { URL.revokeObjectURL(url) }, { once: true })
    audio.src = url
  }
  dialog.addEventListener("close", () => audioLoads.forEach(release => release()), { once: true })
}
