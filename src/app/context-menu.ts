import { bindMenuKeys, element } from "../dom-element"

export function openActionMenu(row: HTMLElement, x: number, y: number, label: string, actions: Iterable<HTMLButtonElement>): void {
  document.querySelector<HTMLDetailsElement>('.ui-menu[data-variant="context"]:popover-open')?.hidePopover()
  const menu = element("details", "ui-menu")
  menu.dataset.variant = "context"
  menu.popover = "manual"
  menu.open = true
  const summary = element("summary")
  summary.hidden = true
  const items = element("div")
  items.setAttribute("role", "menu")
  items.setAttribute("aria-label", label)
  for (const action of actions) {
    const item = element("button", "ui-list-item")
    item.type = "button"
    item.setAttribute("role", "menuitem")
    item.disabled = action.disabled
    const icon = action.querySelector(".ui-icon")?.cloneNode(true)
    if (icon) item.append(icon)
    item.append(action.title || action.getAttribute("aria-label") || "")
    item.addEventListener("click", () => { menu.hidePopover(); row.focus(); action.click() })
    items.append(item)
  }
  menu.append(summary, items)
  bindMenuKeys(menu, row)
  const listeners = new AbortController()
  document.addEventListener("pointerdown", event => {
    if (!menu.contains(event.target as Node)) menu.hidePopover()
  }, { capture: true, signal: listeners.signal })
  menu.addEventListener("toggle", () => {
    if (!menu.matches(":popover-open")) { listeners.abort(); menu.remove() }
  })
  document.body.append(menu)
  menu.showPopover()
  menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth))}px`
  menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight))}px`
  items.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
}
