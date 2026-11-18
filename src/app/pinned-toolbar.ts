import { element, iconButton } from "../dom-element"
import { createIcon } from "../icons"
import { pinnedToolbar, workspaceNavigation, workspaceToolsDialog } from "./dom"
import { appState } from "./state"

const storageKey = "pinned-toolbar-actions"

export function wirePinnedToolbar(): void {
  const state = appState.pinnedToolbar
  const slot = pinnedToolbar.parentElement!
  const grid = workspaceToolsDialog.querySelector<HTMLElement>(".ui-tool-grid")!
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("#project-actions > button, #share-dialog #save, #share-dialog #mobile-share, #share-dialog #adb-share, #share-export, #recent-files, #welcome-recent-open, [data-file-action], #workspace-navigation [data-settings-entry='settings'], .welcome-note [data-start-tour]"), ...workspaceToolsDialog.querySelectorAll<HTMLButtonElement>("[data-workspace-tool]")]
  const sources = new Map(buttons.map(source => {
    const key = source.dataset.workspaceTool || source.dataset.fileAction || (source.id === "welcome-recent-open" ? "open" : source.id) || (source.dataset.settingsEntry ? `dialog:${source.dataset.settingsEntry}` : "tour")
    source.dataset.toolbarAction = key
    source.setAttribute("aria-keyshortcuts", "Alt+Enter")
    return [key, source] as const
  }))
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]")
    if (Array.isArray(saved)) state.actions = [...new Set(saved.filter((key): key is string => typeof key === "string" && sources.has(key)))]
  } catch { /* 损坏或不可用的本机存储不影响菜单动作。 */ }

  const label = (source: HTMLButtonElement) => source.getAttribute("aria-label") || source.querySelector("span:not([data-icon])")?.textContent?.trim() || source.textContent?.trim() || ""
  const render = () => {
    pinnedToolbar.dataset.editing = String(state.editing)
    pinnedToolbar.setAttribute("aria-label", state.editing ? "常驻工具栏，编辑中" : "常驻工具栏")
    const items = new Map([...pinnedToolbar.querySelectorAll<HTMLElement>(".ui-pinned-tool")].map(item => [item.dataset.toolbarAction!, item]))
    for (const [key, item] of items) if (!state.actions.includes(key)) item.remove()
    for (const [index, key] of state.actions.entries()) {
      const source = sources.get(key)!
      const name = label(source)
      let item = items.get(key)
      if (!item) {
        item = element("div", "ui-pinned-tool")
        item.dataset.toolbarAction = key
        item.setAttribute("role", "group")
        const action = iconButton((source.dataset.toolbarIcon ?? source.querySelector<HTMLElement>("[data-icon]")!.dataset.icon!), name, () => {
          if (!state.editing && !state.suppressClick) source.click()
        })
        action.dataset.variant = "filled"
        action.setAttribute("aria-keyshortcuts", "F2 Alt+ArrowLeft Alt+ArrowRight")
        const remove = iconButton("x", `从工具栏移除${name}`, () => removeAction(key))
        remove.classList.add("ui-pinned-tool-remove")
        item.append(action, remove)
        pinnedToolbar.append(item)
      }
      if (pinnedToolbar.children[index] !== item) pinnedToolbar.insertBefore(item, pinnedToolbar.children[index] ?? null)
      const [action, remove] = item.querySelectorAll("button")
      item.setAttribute("aria-label", name)
      item.hidden = source.hidden
      action.title = name
      action.setAttribute("aria-label", name)
      action.disabled = !state.editing && (source.disabled || source.getAttribute("aria-disabled") === "true")
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
  const visibleItems = (except: string) => [...pinnedToolbar.querySelectorAll<HTMLElement>(".ui-pinned-tool:not([hidden])")].filter(item => item.dataset.toolbarAction !== except)
  const placeAction = (key: string, before?: string) => {
    const next = state.actions.filter(action => action !== key)
    next.splice(before ? next.indexOf(before) : next.length, 0, key)
    if (next.every((action, index) => action === state.actions[index])) return
    state.actions = next
    save()
  }
  const removeAction = (key: string, dropped = false) => {
    const index = state.actions.indexOf(key)
    state.actions = state.actions.filter(action => action !== key)
    if (!state.actions.length) state.editing = false
    save()
    const next = pinnedToolbar.children[Math.min(index, pinnedToolbar.children.length - 1)]
    const fallback = workspaceToolsDialog.open ? grid.querySelector<HTMLButtonElement>(`[data-toolbar-action="${key}"]`) ?? grid.querySelector("button")
      : workspaceNavigation.querySelector<HTMLButtonElement>('[data-workspace-page="overview"]')
    ;((!dropped && next?.querySelector<HTMLElement>("button:enabled")) || fallback)?.focus()
  }
  const edit = (enabled: boolean) => {
    state.editing = enabled
    render()
  }
  const spotlight = (dialog: HTMLDialogElement) => {
    dialog.dataset.toolbarSpotlight = "true"
    const rect = slot.getBoundingClientRect()
    const x = Math.floor(rect.left), y = Math.floor(rect.top)
    for (const [axis, value] of Object.entries({ x, y, w: Math.ceil(rect.right) - x, h: Math.ceil(rect.bottom) - y })) {
      dialog.style.setProperty(`--toolbar-spotlight-${axis}`, `${value}px`)
    }
  }
  const updateSpotlight = () => {
    if (workspaceToolsDialog.open) spotlight(workspaceToolsDialog)
    const dialog = state.gesture?.preview?.closest("dialog")
    if (dialog?.open && dialog !== workspaceToolsDialog) spotlight(dialog)
  }
  new ResizeObserver(updateSpotlight).observe(slot)
  window.addEventListener("resize", updateSpotlight)
  new MutationObserver(() => {
    // 同一个工具栏进入原生模态的焦点范围，弹窗外的其余界面仍不可操作。
    if (workspaceToolsDialog.open) {
      spotlight(workspaceToolsDialog)
      workspaceToolsDialog.append(pinnedToolbar)
    } else {
      if (pinnedToolbar.parentElement === workspaceToolsDialog) cancelGesture()
      slot.append(pinnedToolbar)
      delete workspaceToolsDialog.dataset.toolbarSpotlight
    }
  }).observe(workspaceToolsDialog, { attributes: true, attributeFilter: ["open"] })
  const clearInsertion = () => pinnedToolbar.querySelector("[data-insert]")?.removeAttribute("data-insert")
  const cancelGesture = () => {
    window.clearTimeout(state.gesture?.timer)
    const preview = state.gesture?.preview
    const dialog = preview?.closest("dialog")
    if (dialog && dialog !== workspaceToolsDialog) delete dialog.dataset.toolbarSpotlight
    preview?.remove()
    state.gesture = undefined
    pinnedToolbar.removeAttribute("data-drop-target")
    clearInsertion()
    delete grid.dataset.dropTarget
  }
  const hit = (element: HTMLElement, x: number, y: number) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }
  const overGrid = (event: PointerEvent) => workspaceToolsDialog.open
    && grid.contains(document.elementFromPoint(event.clientX, event.clientY))
  const insertionAt = (items: HTMLElement[], x: number) => items.find(item => {
    const { left, width } = item.getBoundingClientRect()
    return x < left + width / 2
  })

  document.addEventListener("keydown", event => {
    const source = (event.target as Element).closest<HTMLButtonElement>("button[data-toolbar-action]")
    if (event.altKey && event.key === "Enter" && source) {
      event.preventDefault()
      if (!state.actions.includes(source.dataset.toolbarAction!)) placeAction(source.dataset.toolbarAction!)
    }
  })
  pinnedToolbar.addEventListener("keydown", event => {
    const item = (event.target as Element).closest<HTMLElement>("[data-toolbar-action]")
    if (!item) return
    const key = item.dataset.toolbarAction!
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault()
      const visible = [...pinnedToolbar.querySelectorAll<HTMLElement>(".ui-pinned-tool:not([hidden])")]
      const index = visible.indexOf(item)
      const left = event.key === "ArrowLeft"
      if (left ? index > 0 : index < visible.length - 1) {
        placeAction(key, visible[index + (left ? -1 : 2)]?.dataset.toolbarAction)
        ;(item.querySelector<HTMLElement>("button:enabled") ?? item).focus()
      }
    } else if (event.key === "F2") {
      event.preventDefault()
      edit(true)
      pinnedToolbar.querySelector<HTMLElement>(`[data-toolbar-action="${key}"] button`)?.focus()
    } else if (state.editing && event.key === "Delete" && !event.repeat) {
      event.preventDefault()
      removeAction(item.dataset.toolbarAction!)
    }
  })
  document.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary) return
    cancelGesture()
    const target = event.target as Element
    if (state.editing && !pinnedToolbar.contains(target)) edit(false)
    const pinned = target.closest<HTMLElement>(".ui-pinned-tool")
    const dialog = target.closest("dialog")
    const source = pinned ?? target.closest<HTMLButtonElement>("button[data-toolbar-action]") ?? buttons.find(button =>
      button.disabled && button.closest("dialog") === dialog && hit(button, event.clientX, event.clientY))
    if (!source || target.closest(".ui-pinned-tool-remove")) return
    if (!pinned && event.pointerType === "mouse") event.preventDefault()
    const gesture = state.gesture = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      action: source.dataset.toolbarAction!, source,
      timer: undefined as number | undefined, preview: undefined as HTMLElement | undefined,
    }
    if (pinned && !state.editing) gesture.timer = window.setTimeout(() => {
      state.suppressClick = true
      edit(true)
    }, 2000)
  }, true)
  document.addEventListener("pointermove", event => {
    const gesture = state.gesture
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6) {
      window.clearTimeout(gesture.timer)
      if (!gesture.preview) {
        const preview = element("div", "ui-toolbar-drag-preview")
        preview.append(createIcon((sources.get(gesture.action)!.dataset.toolbarIcon ?? sources.get(gesture.action)!.querySelector<HTMLElement>("[data-icon]")!.dataset.icon!)))
        preview.setAttribute("aria-hidden", "true")
        const dialog = gesture.source.closest("dialog")
        ;(dialog ?? document.body).append(preview)
        if (dialog) spotlight(dialog)
        gesture.source.setPointerCapture(event.pointerId)
        gesture.preview = preview
      }
    }
    if (!gesture.preview) return
    event.preventDefault()
    gesture.preview.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -50%)`
    const inside = hit(pinnedToolbar, event.clientX, event.clientY)
    pinnedToolbar.dataset.dropTarget = String(inside)
    clearInsertion()
    grid.dataset.dropTarget = String(pinnedToolbar.contains(gesture.source) && overGrid(event))
    if (inside) {
      const items = visibleItems(gesture.action)
      const before = insertionAt(items, event.clientX)
      const edge = before ?? items.at(-1)
      if (edge) edge.dataset.insert = before ? "before" : "after"
    }
  }, { passive: false, capture: true })
  document.addEventListener("pointerup", event => {
    if (event.isPrimary) window.setTimeout(() => { state.suppressClick = false }, 0)
    const gesture = state.gesture
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.preview) {
      state.suppressClick = true
      if (hit(pinnedToolbar, event.clientX, event.clientY)) {
        const before = insertionAt(visibleItems(gesture.action), event.clientX)
        placeAction(gesture.action, before?.dataset.toolbarAction)
      } else if (pinnedToolbar.contains(gesture.source) && overGrid(event)) {
        removeAction(gesture.action, true)
      }
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
    state.suppressClick ||= Boolean(state.gesture?.preview)
    cancelGesture()
    edit(false)
    if (!document.querySelector("dialog[open]")) workspaceNavigation.querySelector<HTMLButtonElement>('[data-workspace-page="overview"]')?.focus()
  }, true)
  window.addEventListener("blur", () => {
    cancelGesture()
    state.suppressClick = false
    if (state.editing) edit(false)
  })
  pinnedToolbar.addEventListener("contextmenu", event => event.preventDefault())
  const observer = new MutationObserver(render)
  for (const source of sources.values()) observer.observe(source, { attributes: true, attributeFilter: ["disabled", "hidden", "aria-label", "aria-disabled"] })
  render()
}
