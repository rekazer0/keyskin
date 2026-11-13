import { element, iconButton } from "../dom-element"
import { createIcon } from "../icons"
import { fileMenu, pinnedToolbar } from "./dom"
import { appState } from "./state"

const storageKey = "pinned-toolbar-actions"

export function wirePinnedToolbar(): void {
  const state = appState.pinnedToolbar
  const sources = new Map([...fileMenu.querySelectorAll<HTMLButtonElement>(".ui-menu > button")].map(source => {
    const key = source.id || (source.dataset.exportFormat
      ? `export:${source.dataset.exportFormat}:${source.dataset.bdaPlatform ?? ""}`
      : source.dataset.appDialog ? `dialog:${source.dataset.appDialog}` : "tour")
    source.dataset.toolbarAction = key
    source.setAttribute("aria-keyshortcuts", "Alt+Enter")
    source.title = "拖到工具栏常驻，或按 Alt + Enter 添加"
    return [key, source] as const
  }))
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]")
    if (Array.isArray(saved)) state.actions = [...new Set(saved.filter((key): key is string => typeof key === "string" && sources.has(key)))]
  } catch { /* 损坏或不可用的本机存储不影响菜单动作。 */ }

  const label = (source: HTMLButtonElement) => source.getAttribute("aria-label") || source.querySelector("span:not([data-icon])")?.textContent?.trim() || ""
  const render = () => {
    pinnedToolbar.dataset.editing = String(state.editing)
    pinnedToolbar.setAttribute("aria-label", state.editing ? "常驻工具栏，编辑中" : "常驻工具栏")
    const items = new Map([...pinnedToolbar.querySelectorAll<HTMLElement>(".ui-pinned-tool")].map(item => [item.dataset.toolbarAction!, item]))
    for (const [key, item] of items) if (!state.actions.includes(key)) item.remove()
    for (const key of state.actions) {
      const source = sources.get(key)!
      const name = label(source)
      let item = items.get(key)
      if (!item) {
        item = element("div", "ui-pinned-tool")
        item.dataset.toolbarAction = key
        item.setAttribute("role", "group")
        const action = iconButton(source.querySelector<HTMLElement>("[data-icon]")!.dataset.icon!, name, () => {
          if (!state.editing && !state.suppressClick) source.click()
        })
        action.dataset.variant = "filled"
        action.setAttribute("aria-keyshortcuts", "F2")
        const remove = iconButton("x", `从工具栏移除${name}`, () => removeAction(key))
        remove.classList.add("ui-pinned-tool-remove")
        item.append(action, remove)
        pinnedToolbar.append(item)
      }
      const [action, remove] = item.querySelectorAll("button")
      item.setAttribute("aria-label", name)
      item.hidden = source.hidden
      action.title = name
      action.setAttribute("aria-label", name)
      action.disabled = source.disabled && !state.editing
      item.tabIndex = action.disabled ? 0 : -1
      remove.title = `从工具栏移除${name}`
      remove.setAttribute("aria-label", remove.title)
      remove.inert = !state.editing
      remove.setAttribute("aria-hidden", String(!state.editing))
    }
  }
  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(state.actions)) } catch { /* 存储不可用时仍可在当前窗口使用。 */ }
    render()
  }
  const addAction = (key: string) => {
    if (!state.actions.includes(key)) {
      state.actions.push(key)
      save()
    }
    fileMenu.open = false
  }
  const removeAction = (key: string) => {
    const index = state.actions.indexOf(key)
    state.actions = state.actions.filter(action => action !== key)
    if (!state.actions.length) state.editing = false
    save()
    const next = pinnedToolbar.children[Math.min(index, pinnedToolbar.children.length - 1)]
    ;(next?.querySelector("button") ?? fileMenu.querySelector("summary"))?.focus()
  }
  const edit = (enabled: boolean) => {
    state.editing = enabled
    render()
  }
  const cancelGesture = () => {
    window.clearTimeout(state.gesture?.timer)
    state.gesture?.preview?.remove()
    state.gesture = undefined
    pinnedToolbar.removeAttribute("data-drop-target")
  }
  const inToolbar = (x: number, y: number) => {
    const rect = pinnedToolbar.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  fileMenu.addEventListener("keydown", event => {
    const source = (event.target as Element).closest<HTMLButtonElement>("[data-toolbar-action]")
    if (event.altKey && event.key === "Enter" && source) {
      event.preventDefault()
      addAction(source.dataset.toolbarAction!)
      fileMenu.querySelector("summary")?.focus()
    }
  })
  pinnedToolbar.addEventListener("keydown", event => {
    const item = (event.target as Element).closest<HTMLElement>("[data-toolbar-action]")
    if (!item) return
    if (event.key === "F2") {
      event.preventDefault()
      const key = item.dataset.toolbarAction
      edit(true)
      pinnedToolbar.querySelector<HTMLElement>(`[data-toolbar-action="${key}"] button`)?.focus()
    } else if (state.editing && ["Delete", "Backspace"].includes(event.key)) {
      event.preventDefault()
      removeAction(item.dataset.toolbarAction!)
    }
  })
  document.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary) return
    cancelGesture()
    const target = event.target as Element
    if (state.editing && !pinnedToolbar.contains(target)) edit(false)
    const fromMenu = fileMenu.open && fileMenu.contains(target)
    // 禁用菜单项不接收指针事件，仍允许将它的入口固定到工具栏。
    const source = fromMenu ? [...sources.values()].find(source => {
      const rect = source.getBoundingClientRect()
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
    }) : target.closest<HTMLElement>(".ui-pinned-tool")
    if (!source || target.closest(".ui-pinned-tool-remove")) return
    if (fromMenu && event.pointerType === "mouse") event.preventDefault()
    const gesture = state.gesture = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      action: source.dataset.toolbarAction!, fromMenu,
      timer: undefined as number | undefined, preview: undefined as HTMLElement | undefined,
    }
    if (!fromMenu && !state.editing) gesture.timer = window.setTimeout(() => {
      state.suppressClick = true
      edit(true)
    }, 2000)
  }, true)
  document.addEventListener("pointermove", event => {
    const gesture = state.gesture
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6) {
      window.clearTimeout(gesture.timer)
      if (!gesture.fromMenu) return cancelGesture()
      if (!gesture.preview) {
        const preview = element("div", "ui-toolbar-drag-preview")
        preview.append(createIcon(sources.get(gesture.action)!.querySelector<HTMLElement>("[data-icon]")!.dataset.icon!))
        preview.setAttribute("aria-hidden", "true")
        document.body.append(preview)
        gesture.preview = preview
      }
    }
    if (!gesture.preview) return
    event.preventDefault()
    gesture.preview.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -50%)`
    pinnedToolbar.dataset.dropTarget = String(inToolbar(event.clientX, event.clientY))
  }, { passive: false })
  document.addEventListener("pointerup", event => {
    if (event.isPrimary) window.setTimeout(() => { state.suppressClick = false }, 0)
    const gesture = state.gesture
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.preview) {
      state.suppressClick = true
      if (inToolbar(event.clientX, event.clientY)) addAction(gesture.action)
    }
    cancelGesture()
  }, true)
  document.addEventListener("click", event => {
    if (!state.suppressClick) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
  document.addEventListener("pointercancel", () => {
    cancelGesture()
    state.suppressClick = false
  })
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || (!state.editing && !state.gesture)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    cancelGesture()
    state.suppressClick = false
    edit(false)
    fileMenu.querySelector("summary")?.focus()
  }, true)
  window.addEventListener("blur", () => {
    cancelGesture()
    state.suppressClick = false
    if (state.editing) edit(false)
  })
  pinnedToolbar.addEventListener("contextmenu", event => event.preventDefault())
  new MutationObserver(render).observe(fileMenu, { subtree: true, attributes: true, attributeFilter: ["disabled", "hidden", "aria-label"], childList: true, characterData: true })
  render()
}
