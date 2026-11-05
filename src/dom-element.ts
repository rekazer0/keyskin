import { createIcon } from "./icons.ts"

/** `document.createElement` with an optional class, for inspector rows built at run time. */
export function element<K extends keyof HTMLElementTagNameMap>(name: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(name)
  if (className) node.className = className
  return node
}

/** A square `.ui-icon-button` (DESIGN.md §9): the label is both its accessible name and its tooltip. */
export function iconButton(icon: string, label: string, onClick?: (event: MouseEvent) => void): HTMLButtonElement {
  const button = element("button", "ui-icon-button")
  button.type = "button"
  button.title = label
  button.setAttribute("aria-label", label)
  button.append(createIcon(icon, 14))
  if (onClick) button.addEventListener("click", onClick)
  return button
}

/** `.ui-empty`：居中的大图标，可选一行短字；能只放图标就只放图标。 */
export function emptyState(icon: string, text?: string): HTMLElement {
  const root = element("div", "ui-empty")
  root.append(createIcon(icon, 20))
  if (text) root.append(Object.assign(element("p"), { textContent: text }))
  return root
}

/**
 * `.ui-pane-header`：返回 + 标题 + 数量角标 + 尾部操作。返回按钮的名字固定为「返回」，去处写在悬停提示里。
 * 之后要改标题或数量时，改返回元素里的 `h2` 与 `.ui-badge`。
 */
export function paneHeader(options: { back?: { to: string; run(): void }; title: string; count?: string; actions?: HTMLElement[] }): HTMLElement {
  const header = element("header", "ui-pane-header")
  if (options.back) {
    const back = iconButton("arrow-left", "返回", options.back.run)
    back.title = `返回${options.back.to}`
    header.append(back)
  }
  const title = element("h2")
  title.textContent = options.title
  const count = element("span", "ui-badge")
  count.dataset.variant = "pill"
  count.textContent = options.count ?? ""
  count.hidden = !options.count
  header.append(title, count)
  if (options.actions?.length) {
    const actions = element("div", "ui-pane-header-actions")
    actions.append(...options.actions)
    header.append(actions)
  }
  return header
}

/**
 * `.ui-search`：放大镜前缀，有内容时尾部出现清除按钮。Esc 先清除内容；内容为空时失焦并把 Esc 交给外层
 * （例如关闭对话框）。取输入框用返回元素的 `querySelector("input")`。
 * 传入 `input` 时接管 HTML 里已写好的 `label.ui-input.ui-search`（含放大镜前缀），只补清除按钮与键盘行为。
 */
export function searchField(options: { label: string; onInput(query: string): void; input?: HTMLInputElement }): HTMLLabelElement {
  const input = options.input ?? element("input")
  let root = input.closest("label")
  if (!root) {
    root = element("label", "ui-input ui-search")
    const affix = element("span", "ui-input-affix")
    affix.append(createIcon("search", 14))
    root.append(affix, input)
  }
  input.type = "text"
  input.placeholder = "搜索"
  input.autocomplete = "off"
  input.spellcheck = false
  input.setAttribute("role", "searchbox")
  input.setAttribute("aria-label", options.label)
  const update = () => {
    clear.hidden = !input.value
    options.onInput(input.value.trim())
  }
  const clear = iconButton("x", "清除", () => {
    input.value = ""
    update()
    input.focus()
  })
  clear.dataset.size = "sm"
  clear.hidden = true
  input.addEventListener("input", update)
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing) return
    if (!input.value) {
      input.blur()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    input.value = ""
    update()
  })
  root.append(clear)
  return root
}

type ToolbarAction = { label: string; run(): void; disabled?: boolean; title?: string }

/** `.ui-list-toolbar`：列表的新建 / 复制 / 删除。新建有多个种类时传入现成的下拉（带 plus 前缀）。 */
export function listToolbar(actions: { create?: ToolbarAction | HTMLElement; duplicate?: ToolbarAction; remove?: ToolbarAction }): HTMLElement {
  const bar = element("div", "ui-list-toolbar")
  for (const [icon, action] of [["plus", actions.create], ["copy", actions.duplicate], ["trash-2", actions.remove]] as const) {
    if (!action) continue
    if (action instanceof HTMLElement) {
      bar.append(action)
      continue
    }
    const button = iconButton(icon, action.label, action.run)
    button.dataset.listAction = icon === "copy" ? "duplicate" : icon === "trash-2" ? "remove" : "create"
    button.disabled = Boolean(action.disabled)
    if (action.title) button.title = action.title
    bar.append(button)
  }
  return bar
}

const listActionBars = new WeakMap<HTMLElement, HTMLElement>()

/**
 * 列表获得焦点时 Delete / Backspace 点工具条的删除（`[data-list-action="remove"]`），⌘/Ctrl D 点复制；
 * 按钮禁用或隐藏时按键也无效。工具条每次重建时重复调用即可，监听只挂一次。
 */
export function bindListActionKeys(list: HTMLElement, bar: HTMLElement): void {
  const bound = listActionBars.has(list)
  listActionBars.set(list, bar)
  if (bound) return
  list.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || (event.target as Element).closest("input, textarea, select, [contenteditable]")) return
    const mod = event.metaKey || event.ctrlKey
    const action = !mod && (event.key === "Delete" || event.key === "Backspace") ? "remove"
      : mod && !event.shiftKey && event.key.toLowerCase() === "d" ? "duplicate" : undefined
    const button = action && listActionBars.get(list)?.querySelector<HTMLButtonElement>(`[data-list-action="${action}"]`)
    if (!button) return
    event.preventDefault()
    if (!button.disabled && !button.hidden && !button.closest("[hidden]")) button.click()
  })
}

/** 快捷键按平台写 ⌘ 或 Ctrl：`shortcutLabel("Z", true)` → ⇧⌘Z / Ctrl Shift Z；非字母键之间留空格（⌘ 单击）。 */
export function shortcutLabel(key: string, shift = false): string {
  const mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "")
  if (!mac) return ["Ctrl", shift && "Shift", key].filter(Boolean).join(" ")
  return `${shift ? "⇧" : ""}⌘${/^[!-~]+$/.test(key) ? "" : " "}${key}`
}

/** HTML 里写 `data-shortcut="F"`（或 `shift+Z`、`单击`）：kbd 填快捷键，其余元素在 title 后补「（快捷键）」。 */
export function hydrateShortcuts(root: ParentNode = document): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-shortcut]"))) {
    const [key, shift] = (el.dataset.shortcut ?? "").split("+").reverse()
    const label = shortcutLabel(key ?? "", shift === "shift")
    if (el.tagName === "KBD") el.textContent = label
    else el.title = `${el.title}（${label}）`
    delete el.dataset.shortcut
  }
}

/**
 * 列表框 / 网格（role=listbox，子项 role=option + aria-selected）的方向键、Home、End。
 * 网格里上下键按列数跳行；选中项不变时什么也不做。
 */
export function bindListboxKeys(list: HTMLElement, onSelect: (option: HTMLElement) => void): void {
  list.addEventListener("keydown", (event) => {
    // 嵌套的列表框（例如资源网格里的音效列表）已经处理过这次按键。
    if (event.defaultPrevented) return
    const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')].filter((option) => !option.hidden)
    if (!options.length) return
    const index = options.findIndex((option) => option.getAttribute("aria-selected") === "true")
    const columns = options.filter((option) => option.offsetTop === options[0]!.offsetTop).length || 1
    const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns } as Record<string, number>)[event.key]
    const next = step !== undefined ? (index < 0 ? 0 : index + step)
      : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : undefined
    if (next === undefined) return
    event.preventDefault()
    const option = options[Math.max(0, Math.min(options.length - 1, next))]!
    if (option.getAttribute("aria-selected") !== "true") onSelect(option)
  })
}

/** `<details>` 菜单的键盘：方向键 / Home / End 在可用项之间移动，Esc 收起并把焦点还给 summary。 */
export function bindMenuKeys(menu: HTMLDetailsElement): void {
  const summary = menu.querySelector("summary")!
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      event.stopPropagation()
      menu.open = false
      summary.focus()
      return
    }
    const items = [...menu.querySelectorAll<HTMLButtonElement>(":scope > :not(summary) button:not(:disabled)")]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? (index < 0 ? items.length - 1 : index - 1)
      : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : undefined
    if (next === undefined || !items.length) return
    event.preventDefault()
    menu.open = true
    items[(next + items.length) % items.length]!.focus()
  })
}
