import { bindMenuKeys, element } from "../dom-element"
import { closeDialog } from "../motion"
import { bindDialog } from "./ask"
import { source } from "./canvas-interaction"
import { files, sourceFileToolbar, sourceRenameButton } from "./dom"
import { commitBatch, isEditing } from "./edit-history"
import { requestEditMode } from "./mobile-layout"
import { refreshAfterSourceMutation, sourcePaths, sourceSelection } from "./source-files"
import { appState } from "./state"

function renameSourceFile(): void {
  if (!isEditing()) { requestEditMode(); return }
  const archive = appState.archive, selection = sourceSelection()
  if (!archive || !selection) return
  source.commit()
  const dialog = element("dialog", "ui-dialog")
  dialog.dataset.size = "sm"
  dialog.setAttribute("aria-label", "重命名")
  const form = element("form", "ui-form")
  form.method = "dialog"
  const header = element("header", "ui-dialog-header")
  header.append(Object.assign(element("h2"), { textContent: "重命名" }))
  const body = element("div", "ui-dialog-body")
  const input = element("input", "ui-input")
  input.value = selection.path.split("/").pop()!
  input.setAttribute("aria-label", "名称")
  input.spellcheck = false
  const error = element("p", "ui-field-error")
  error.setAttribute("role", "alert")
  body.append(input, error)
  const footer = element("footer", "ui-dialog-footer")
  const cancel = element("button", "ui-button")
  cancel.type = "button"
  cancel.textContent = "取消"
  cancel.addEventListener("click", () => closeDialog(dialog, "cancel"))
  const save = element("button", "ui-button")
  save.textContent = "重命名"
  save.dataset.variant = "primary"
  footer.append(cancel, save)
  form.append(header, body, footer)
  form.addEventListener("submit", event => {
    event.preventDefault()
    if (appState.archive !== archive || !isEditing()) { closeDialog(dialog, "cancel"); return }
    const name = input.value.trim()
    if (!name || name === "." || name === ".." || /[\\/:\x00-\x1f]/.test(name)) {
      error.textContent = "请输入有效名称，不能包含路径分隔符或控制字符"
      input.focus()
      return
    }
    const target = selection.path.slice(0, selection.path.lastIndexOf("/") + 1) + name
    if (target === selection.path) { closeDialog(dialog); return }
    if (archive.names().some(path => path.toLowerCase() === target.toLowerCase() || path.toLowerCase().startsWith(`${target.toLowerCase()}/`))) {
      error.textContent = "已存在同名文件或文件夹"
      input.focus()
      return
    }
    const paths = sourcePaths(selection)
    if (!paths.length) { error.textContent = "原文件或文件夹已不存在"; return }
    // shortcut: 不改写配置内的文件引用；需要资源重构时再按格式解析引用。
    commitBatch(paths.flatMap(path => [
      { kind: "bytes", path: target + path.slice(selection.path.length), after: archive.getBytes(path)!.slice() },
      { kind: "bytes", path, before: archive.getBytes(path)!.slice() },
    ]))
    closeDialog(dialog)
    refreshAfterSourceMutation(target + paths[0].slice(selection.path.length))
  })
  dialog.append(form)
  bindDialog(dialog)
  dialog.addEventListener("close", () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
  cancel.focus()
}

/** 右键菜单直接调用工具栏按钮，操作顺序与禁用状态只有一个来源。 */
export function wireSourceFileMenu(): void {
  sourceRenameButton.addEventListener("click", renameSourceFile)
  const openMenu = (row: HTMLElement, x: number, y: number) => {
    document.querySelector<HTMLDetailsElement>('.ui-menu[data-variant="context"]')?.hidePopover()
    if (row.getAttribute("aria-selected") !== "true") row.click()
    const menu = element("details", "ui-menu")
    menu.dataset.variant = "context"
    menu.popover = "manual"
    menu.open = true
    const summary = element("summary")
    summary.hidden = true
    const items = element("div")
    items.setAttribute("role", "menu")
    items.setAttribute("aria-label", "源文件操作")
    for (const action of sourceFileToolbar.querySelectorAll<HTMLButtonElement>("button")) {
      const item = element("button", "ui-list-item")
      item.type = "button"
      item.setAttribute("role", "menuitem")
      item.disabled = action.disabled
      const icon = action.querySelector(".ui-icon")?.cloneNode(true)
      if (icon) item.append(icon)
      item.append(action.title || action.getAttribute("aria-label") || "")
      item.addEventListener("click", () => { menu.hidePopover(); action.click() })
      items.append(item)
    }
    menu.append(summary, items)
    bindMenuKeys(menu)
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape") { menu.hidePopover(); row.focus() }
    })
    const listeners = new AbortController()
    document.addEventListener("pointerdown", event => {
      if (!menu.contains(event.target as Node)) menu.hidePopover()
    }, { capture: true, signal: listeners.signal })
    menu.addEventListener("toggle", event => {
      if (event.target === menu && !menu.matches(":popover-open")) { listeners.abort(); menu.remove() }
    })
    document.body.append(menu)
    menu.showPopover()
    menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth))}px`
    menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight))}px`
    items.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
  }
  files.addEventListener("contextmenu", event => {
    const row = (event.target as Element).closest<HTMLElement>(".raw-files .source-tree-row")
    if (!row) return
    event.preventDefault()
    openMenu(row, event.clientX, event.clientY)
  })
  files.addEventListener("keydown", event => {
    const row = (event.target as Element).closest<HTMLElement>(".raw-files .source-tree-row")
    if (!row) return
    if (event.key === "F2" && !sourceRenameButton.disabled) { event.preventDefault(); sourceRenameButton.click() }
    if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") {
      event.preventDefault()
      const box = row.getBoundingClientRect()
      openMenu(row, box.left, box.bottom)
    }
  })
}
