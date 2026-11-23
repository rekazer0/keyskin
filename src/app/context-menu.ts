import { bindMenuKeys, element } from "../dom-element"

export function openActionMenu(row: HTMLElement, x: number, y: number, label: string, actions: Iterable<HTMLButtonElement>): void {
  const native = typeof HTMLElement.prototype.showPopover === "function"
  const previous = document.querySelector<HTMLDetailsElement>('.ui-menu[data-variant="context"][open]')
  if (previous) {
    if (native) previous.hidePopover()
    else previous.open = false
  }
  const menu = element("details", "ui-menu")
  menu.dataset.variant = "context"
  if (native) menu.popover = "manual"
  else menu.dataset.popoverFallback = ""
  menu.open = true
  const summary = element("summary")
  summary.hidden = true
  const items = element("div")
  items.setAttribute("role", "menu")
  items.setAttribute("aria-label", label)
  const close = () => { if (native) menu.hidePopover(); else menu.open = false }
  for (const action of actions) {
    const item = element("button", "ui-list-item")
    item.type = "button"
    item.setAttribute("role", "menuitem")
    item.disabled = action.disabled
    const icon = action.querySelector(".ui-icon")?.cloneNode(true)
    if (icon) item.append(icon)
    item.append(action.title || action.getAttribute("aria-label") || "")
    item.addEventListener("click", () => { close(); row.focus(); action.click() })
    items.append(item)
  }
  menu.append(summary, items)
  bindMenuKeys(menu, row)
  const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) close() }
  document.addEventListener("pointerdown", outside, true)
  menu.addEventListener("toggle", () => {
    if (native ? menu.matches(":popover-open") : menu.open) return
    document.removeEventListener("pointerdown", outside, true)
    menu.remove()
  })
  const host = native ? document.body : row.closest("dialog[open]") ?? document.body
  host.append(menu)
  if (native) menu.showPopover()
  menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth))}px`
  menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight))}px`
  items.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
}
