import { createIcon } from "./icons.ts"

/** `document.createElement` with an optional class, for inspector rows built at run time. */
export function element<K extends keyof HTMLElementTagNameMap>(name: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(name)
  if (className) node.className = className
  return node
}

/** A square `.ui-icon-button` (DESIGN.md §9): the label is both its accessible name and its tooltip. */
export function iconButton(icon: string, label: string, onClick?: () => void): HTMLButtonElement {
  const button = element("button", "ui-icon-button")
  button.type = "button"
  button.title = label
  button.setAttribute("aria-label", label)
  button.append(createIcon(icon, 14))
  if (onClick) button.addEventListener("click", onClick)
  return button
}
