import { bindMenuKeys, element } from "../dom-element"
import { openRenameDialog } from "./ask"
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
  openRenameDialog(selection.path.split("/").pop()!, name => {
    if (appState.archive !== archive || !isEditing()) return
    const target = selection.path.slice(0, selection.path.lastIndexOf("/") + 1) + name
    if (target === selection.path) return
    if (archive.names().some(path => path.toLowerCase() === target.toLowerCase() || path.toLowerCase().startsWith(`${target.toLowerCase()}/`))) {
      throw new Error("已存在同名文件或文件夹")
    }
    const paths = sourcePaths(selection)
    if (!paths.length) throw new Error("原文件或文件夹已不存在")
    // shortcut: 不改写配置内的文件引用；需要资源重构时再按格式解析引用。
    commitBatch(paths.flatMap(path => [
      { kind: "bytes", path: target + path.slice(selection.path.length), after: archive.getBytes(path)!.slice() },
      { kind: "bytes", path, before: archive.getBytes(path)!.slice() },
    ]))
    refreshAfterSourceMutation(target + paths[0].slice(selection.path.length))
  })
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
