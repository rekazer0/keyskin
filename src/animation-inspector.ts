/*
 * 动画资源检查器的公共骨架（DESIGN.md §10「动画资源」）：手心 skin.json、百度 anim.ini 与 BDA animationConfig
 * 共用同一套分组——列表（选一个动画）→ 预览（播放器）→ 参数分组 → 引用。
 * 这里只负责呈现与交互；读写配置、撤销与选择状态都由各格式的适配器通过回调完成。
 */
import { element } from "./dom-element.ts"
import { createIcon } from "./icons.ts"
import { animationPlayer, type AnimationPlayerOptions } from "./animation-player.ts"

export type AnimationMode = "all" | "motion" | "particle"

export type AnimationListItem = {
  /** Stable within the document: Palm's table key, `ANIM3`, a BDA `kind:key`. */
  id: string
  title: string
  kind: string
  icon: string
  /** Timing summary shown under the title. */
  detail: string
  /** How many styles, bindings or combinations play it. */
  uses: number
  problem?: string
}

export type AnimationUse = { icon: string; title: string; detail: string }

export type AnimationResourceView = {
  mode: AnimationMode
  /** The section class the inspector shell and the category rail pick up in this container. */
  sectionClass: string
  items: AnimationListItem[]
  selected: string | undefined
  editable: boolean
  onSelect(id: string): void
  /** One option creates directly; several show a type menu. */
  create?: { options: Array<[kind: string, label: string]>; run(kind: string): void }
  duplicate?(): void
  remove?: { run(): void; blocked?: string }
  /** Document-level rows under the list (BDA design width, ANIM_NUM warnings). */
  listRows?: HTMLElement[]
  player?: AnimationPlayerOptions
  /** Problems with the selected animation, under the player. */
  warnings?: HTMLElement[]
  sections: HTMLElement[]
  uses: AnimationUse[]
}

const MODE_NOUN: Record<AnimationMode, string> = { all: "动画", motion: "动效", particle: "粒子" }

/** Keyboard selection rebuilds the inspector; the new list takes the focus back. */
const focus = { list: false }

export function animationModeTitle(mode: AnimationMode): string {
  return mode === "particle" ? "粒子设计" : mode === "motion" ? "动效设计" : "动画与动效"
}

export function animationSection(title: string, className: string, code = ""): HTMLElement {
  const section = element("section", `ui-section ${className}`)
  section.dataset.inspectorGroupLabel = title
  const heading = element("h3", "document-section-heading")
  const name = element("span", "document-section-title")
  name.textContent = title
  heading.append(name)
  if (code) {
    const detail = element("span", "document-section-code")
    detail.textContent = code
    heading.append(detail)
  }
  section.append(heading)
  return section
}

function iconButton(icon: string, label: string, onClick: () => void, disabled: boolean): HTMLButtonElement {
  const button = element("button", "ui-icon-button")
  button.type = "button"
  button.setAttribute("aria-label", label)
  button.title = label
  button.disabled = disabled
  button.append(createIcon(icon, 14))
  button.addEventListener("click", onClick)
  return button
}

function listOption(item: AnimationListItem, selected: boolean): HTMLButtonElement {
  const option = element("button", "ui-list-item")
  option.type = "button"
  option.setAttribute("role", "option")
  option.setAttribute("aria-selected", String(selected))
  option.tabIndex = selected ? 0 : -1
  option.dataset.animationId = item.id
  const text = element("span", "ui-list-item-text")
  const title = element("strong")
  title.textContent = `${item.title} · ${item.kind}`
  const detail = element("small")
  detail.textContent = item.detail
  text.append(title, detail)
  option.append(createIcon(item.icon, 14), text)
  if (item.uses) {
    const badge = element("span", "ui-badge")
    badge.textContent = String(item.uses)
    badge.title = `${item.uses} 处使用`
    option.append(badge)
  }
  if (item.problem) {
    option.dataset.problem = ""
    option.title = item.problem
    option.append(createIcon("circle-alert", 14))
  }
  return option
}

function listSection(view: AnimationResourceView): HTMLElement {
  const noun = MODE_NOUN[view.mode]
  const section = animationSection(noun, view.sectionClass, `${view.items.length} 个`)
  section.toggleAttribute("data-filter-keep", true)
  const list = element("div", "ui-listbox")
  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", `${noun}列表`)
  const options = view.items.map((item) => listOption(item, item.id === view.selected))
  if (options.length) list.append(...options)
  else {
    const empty = element("p", "ui-listbox-empty")
    empty.textContent = view.create ? `还没有${noun}，用下方的「新建」添加一个。` : `这份配置里没有${noun}。`
    list.append(empty)
  }
  list.addEventListener("click", (event) => {
    const option = (event.target as Element).closest<HTMLElement>("[data-animation-id]")
    if (option && option.getAttribute("aria-selected") !== "true") view.onSelect(option.dataset.animationId!)
  })
  list.addEventListener("keydown", (event) => {
    const index = view.items.findIndex((item) => item.id === view.selected)
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1
      : event.key === "Home" ? 0 : event.key === "End" ? view.items.length - 1 : undefined
    if (next === undefined) return
    event.preventDefault()
    const item = view.items[Math.max(0, Math.min(view.items.length - 1, next))]
    if (!item || item.id === view.selected) return
    focus.list = true
    view.onSelect(item.id)
  })
  section.append(list)
  const actions = listActions(view)
  if (actions) section.append(actions)
  section.append(...view.listRows ?? [])
  // Keep the selected row in view inside the list without scrolling the inspector itself.
  requestAnimationFrame(() => {
    const selected = list.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!selected || !list.isConnected) return
    if (selected.offsetTop < list.scrollTop) list.scrollTop = selected.offsetTop
    else if (selected.offsetTop + selected.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = selected.offsetTop + selected.offsetHeight - list.clientHeight
    if (focus.list) selected.focus()
    focus.list = false
  })
  return section
}

function listActions(view: AnimationResourceView): HTMLElement | undefined {
  if (!view.create && !view.duplicate && !view.remove) return
  const bar = element("div", "animation-list-actions")
  const noun = MODE_NOUN[view.mode]
  if (view.create?.options.length === 1) {
    const [kind, label] = view.create.options[0]
    const button = element("button", "ui-button")
    button.type = "button"
    button.dataset.variant = "quiet"
    button.disabled = !view.editable
    button.append(createIcon("plus", 14), Object.assign(element("span"), { textContent: `新建${label}` }))
    button.addEventListener("click", () => view.create!.run(kind))
    bar.append(button)
  } else if (view.create) {
    const control = element("span", "ui-input ui-select")
    const select = element("select")
    select.setAttribute("aria-label", `新建${noun}`)
    select.disabled = !view.editable
    select.append(new Option(`新建${noun}…`, ""), ...view.create.options.map(([kind, label]) => new Option(label, kind)))
    select.addEventListener("change", () => { if (select.value) view.create!.run(select.value) })
    control.append(select)
    bar.append(control)
  }
  const current = view.items.find((item) => item.id === view.selected)
  if (view.duplicate) bar.append(iconButton("copy", current ? `复制${current.title}` : `复制${noun}`, view.duplicate, !view.editable || !current))
  if (view.remove) {
    const remove = iconButton("trash-2", current ? `删除${current.title}` : `删除${noun}`, view.remove.run, !view.editable || !current || Boolean(view.remove.blocked))
    if (view.remove.blocked) remove.title = view.remove.blocked
    bar.append(remove)
  }
  return bar
}

function previewSection(view: AnimationResourceView, item: AnimationListItem): HTMLElement {
  const section = animationSection("预览", view.sectionClass, `${item.title} · ${item.kind}`)
  if (view.player) section.append(animationPlayer(view.player))
  section.append(...view.warnings ?? [])
  return section
}

function usesSection(view: AnimationResourceView): HTMLElement {
  const section = animationSection("引用", view.sectionClass, view.uses.length ? `${view.uses.length} 处` : "")
  if (!view.uses.length) {
    const empty = element("p", "inspector-group-subtitle")
    empty.textContent = view.mode === "particle" ? "还没有样式播放这个粒子。" : "还没有样式播放这个动画；在样式的动画事件里填入它的编号即可使用。"
    section.append(empty)
    return section
  }
  const list = element("div", "animation-use-list")
  for (const use of view.uses) {
    const row = element("div", "ui-list-item")
    const text = element("span", "ui-list-item-text")
    const title = element("strong")
    title.textContent = use.title
    const detail = element("small")
    detail.textContent = use.detail
    detail.title = use.detail
    text.append(title, detail)
    row.append(createIcon(use.icon, 14), text)
    list.append(row)
  }
  section.append(list)
  return section
}

/** Fills `container` with the list, and the selected animation's preview, parameters and uses. */
export function renderAnimationResource(container: HTMLElement, view: AnimationResourceView): void {
  container.replaceChildren(listSection(view))
  const item = view.items.find((candidate) => candidate.id === view.selected)
  if (!item) return
  container.append(previewSection(view, item), ...view.sections, usesSection(view))
}

/** A warning line under the player, with an optional fix. */
export function animationWarning(text: string, fix?: { label: string; run(): void; disabled: boolean }): HTMLElement {
  const warning = element("div", "animation-warning")
  warning.append(createIcon("circle-alert", 14), Object.assign(element("span"), { textContent: text }))
  if (fix) {
    const button = element("button", "ui-button")
    button.type = "button"
    button.dataset.variant = "quiet"
    button.dataset.size = "sm"
    button.textContent = fix.label
    button.disabled = fix.disabled
    button.addEventListener("click", fix.run)
    warning.append(button)
  }
  return warning
}

type ComboChild = { title: string; detail: string; missing?: boolean }

/** Children of a combination in play order; reordering and removal write back through the callbacks. */
export function comboList(options: {
  children: ComboChild[]
  editable: boolean
  empty: string
  move?(index: number, offset: -1 | 1): void
  remove?(index: number): void
  add?: { options: Array<[id: string, label: string]>; run(id: string): void }
}): HTMLElement {
  const block = element("div", "animation-combo")
  if (options.children.length) {
    const list = element("ol", "animation-combo-list")
    list.setAttribute("aria-label", "子动画")
    for (const [index, child] of options.children.entries()) {
      const row = element("li", "animation-combo-item")
      if (child.missing) row.dataset.missing = ""
      const order = element("span", "animation-combo-order")
      order.textContent = String(index + 1)
      const text = element("span", "ui-list-item-text")
      const title = element("strong")
      title.textContent = child.title
      const detail = element("small")
      detail.textContent = child.detail
      text.append(title, detail)
      row.append(order, text)
      if (options.move || options.remove) {
        const actions = element("span", "animation-combo-actions")
        const disabled = !options.editable
        if (options.move) actions.append(
          iconButton("arrow-up", `上移${child.title}`, () => options.move!(index, -1), disabled || index === 0),
          iconButton("arrow-down", `下移${child.title}`, () => options.move!(index, 1), disabled || index === options.children.length - 1),
        )
        if (options.remove) actions.append(iconButton("x", `移除${child.title}`, () => options.remove!(index), disabled))
        for (const button of actions.children) (button as HTMLElement).dataset.size = "sm"
        row.append(actions)
      }
      list.append(row)
    }
    block.append(list)
  } else {
    const empty = element("p", "inspector-group-subtitle")
    empty.textContent = options.empty
    block.append(empty)
  }
  if (options.add?.options.length) {
    const control = element("span", "ui-input ui-select")
    const select = element("select")
    select.setAttribute("aria-label", "添加子动画")
    select.disabled = !options.editable
    select.append(new Option("添加子动画…", ""), ...options.add.options.map(([id, label]) => new Option(label, id)))
    select.addEventListener("change", () => { if (select.value) options.add!.run(select.value) })
    control.append(select)
    block.append(control)
  }
  return block
}
