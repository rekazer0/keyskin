/*
 * 动画资源检查器的公共骨架（DESIGN.md §10「动画资源」）：手心 skin.json、百度 anim.ini 与 BDA animationConfig
 * 共用同一套分组——列表（选一个动画）→ 预览（播放器）→ 引用 → 参数分组。桌面宽度下列表放进左侧栏、
 * 播放器放到画布上（animation-workspace.ts），检查器只留引用与参数。
 * 这里只负责呈现与交互；读写配置、撤销与选择状态都由各格式的适配器通过回调完成。
 */
import { element, iconButton } from "./dom-element.ts"
import { createIcon } from "./icons.ts"
import { animationPlayer, type AnimationPlayerOptions } from "./animation-player.ts"
import { animationWorkspaceHosts } from "./animation-workspace.ts"
import { drawVisualPreview, type Visual } from "./atlas.ts"

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

/**
 * 编辑模式下在画布上选的按键：列表可以只留它们按下时播放的动画（`only`），也可以看全部再应用到它们。
 * `none`：它们一个都不播放，只能看全部；`total`：不筛选时的个数。
 */
export type AnimationKeyFilter = { label: string; only: boolean; none: boolean; total: number; toggle(): void; clear(): void }

/** 应用前要选的一项（时机、部位），呈现为一个下拉框。 */
export type AnimationChoice = { label: string; options: Array<[value: string, label: string]>; value: string; change(value: string): void }

/** Where an animation is played; each target opens that style or animation (or applies it, after `choices`). */
export type AnimationUse = {
  icon: string; title: string; detail: string
  choices?: AnimationChoice[]
  targets?: Array<{ label: string; icon?: string; title?: string; open(): void }>
}

type AnimationResourceView = {
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
  keyFilter?: AnimationKeyFilter
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

function actionButton(icon: string, label: string, onClick: () => void, disabled: boolean): HTMLButtonElement {
  const button = iconButton(icon, label, onClick)
  button.disabled = disabled
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
  // 第一行只有名称；第二行是类型、引用次数两个标签和时间摘要。
  const title = element("strong")
  title.textContent = item.title
  const meta = element("span", "ui-list-item-meta")
  const kind = element("span", "ui-badge")
  kind.textContent = item.kind
  meta.append(kind)
  if (item.uses) {
    const uses = element("span", "ui-badge")
    uses.dataset.uses = String(item.uses)
    uses.append(createIcon("link", 12), String(item.uses))
    uses.title = `${item.uses} 处引用`
    meta.append(uses)
  }
  const detail = element("small")
  detail.textContent = item.detail
  meta.append(detail)
  text.append(title, meta)
  option.title = `${item.title} · ${item.kind} · ${item.uses ? `${item.uses} 处引用` : "未使用"}\n${item.detail}`
  option.append(createIcon(item.icon, 14), text)
  if (item.problem) {
    option.dataset.problem = ""
    option.title = item.problem
    option.append(createIcon("circle-alert", 14))
  }
  return option
}

function listBox(view: AnimationResourceView, fill = false): HTMLElement {
  const noun = MODE_NOUN[view.mode]
  const list = element("div", "ui-listbox")
  if (fill) list.dataset.size = "fill"
  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", `${noun}列表`)
  const options = view.items.map((item) => listOption(item, item.id === view.selected))
  if (options.length) list.append(...options)
  else {
    const empty = element("p", "ui-listbox-empty")
    empty.textContent = view.create ? `还没有${noun}，用「新建」添加一个。` : `这份配置里没有${noun}。`
    list.append(empty)
  }
  list.addEventListener("click", (event) => {
    const option = (event.target as Element).closest<HTMLElement>("[data-animation-id]")
    if (option && option.getAttribute("aria-selected") !== "true") view.onSelect(option.dataset.animationId!)
  })
  list.addEventListener("keydown", (event) => {
    // Rows hidden by the sidebar search are skipped.
    const visible = view.items.filter((_, position) => !options[position]?.hidden)
    const index = visible.findIndex((item) => item.id === view.selected)
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1
      : event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : undefined
    if (next === undefined) return
    event.preventDefault()
    const item = visible[Math.max(0, Math.min(visible.length - 1, next))]
    if (!item || item.id === view.selected) return
    focus.list = true
    view.onSelect(item.id)
  })
  // Keep the selected row in view inside the list without scrolling the inspector itself.
  requestAnimationFrame(() => {
    const selected = list.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!selected || !list.isConnected) return
    if (selected.offsetTop < list.scrollTop) list.scrollTop = selected.offsetTop
    else if (selected.offsetTop + selected.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = selected.offsetTop + selected.offsetHeight - list.clientHeight
    if (focus.list) selected.focus()
    focus.list = false
  })
  return list
}

/** 「按键 N 的动效 | 全部」与取消选中按键的按钮。 */
function keyFilterBar(view: AnimationResourceView): HTMLElement[] {
  const filter = view.keyFilter
  if (!filter) return []
  const bar = element("div", "animation-key-filter")
  const group = element("span", "ui-segmented")
  group.dataset.size = "sm"
  group.dataset.fill = ""
  group.setAttribute("role", "group")
  group.setAttribute("aria-label", "动画列表范围")
  for (const [only, text] of [[true, `${filter.label} 的${MODE_NOUN[view.mode]}`], [false, "全部"]] as const) {
    const button = element("button")
    button.type = "button"
    button.textContent = text
    button.setAttribute("aria-pressed", String(only === filter.only))
    if (only && filter.none) {
      button.disabled = true
      button.title = `${filter.label} 按下时没有播放${MODE_NOUN[view.mode]}`
    }
    button.addEventListener("click", () => { if (only !== filter.only) filter.toggle() })
    group.append(button)
  }
  bar.append(group, iconButton("x", `取消选中${filter.label}`, filter.clear))
  return [bar]
}

/** 列表头部的数量；按键筛选时是「1 / 2 个」。 */
const countLabel = (view: AnimationResourceView) => view.keyFilter?.only ? `${view.items.length} / ${view.keyFilter.total} 个` : `${view.items.length} 个`

function listSection(view: AnimationResourceView): HTMLElement {
  const section = animationSection(MODE_NOUN[view.mode], view.sectionClass, countLabel(view))
  section.toggleAttribute("data-filter-keep", true)
  section.append(...keyFilterBar(view), listBox(view))
  const actions = listActions(view)
  if (actions) section.append(actions)
  section.append(...view.listRows ?? [])
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
    const control = element("label", "ui-input ui-select")
    const plus = element("span", "ui-input-affix")
    plus.append(createIcon("plus", 14))
    const select = element("select")
    select.setAttribute("aria-label", `新建${noun}`)
    select.disabled = !view.editable
    select.append(new Option(`新建${noun}…`, ""), ...view.create.options.map(([kind, label]) => new Option(label, kind)))
    select.addEventListener("change", () => { if (select.value) view.create!.run(select.value) })
    control.append(plus, select)
    bar.append(control)
  }
  const current = view.items.find((item) => item.id === view.selected)
  if (view.duplicate) bar.append(actionButton("copy", current ? `复制${current.title}` : `复制${noun}`, view.duplicate, !view.editable || !current))
  if (view.remove) {
    const remove = actionButton("trash-2", current ? `删除${current.title}` : `删除${noun}`, view.remove.run, !view.editable || !current || Boolean(view.remove.blocked))
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
  const section = animationSection("引用", view.sectionClass, view.uses.length ? `${view.uses.length} 处` : "未使用")
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
    if (!use.targets?.length) continue
    const targets = element("div", "animation-use-targets")
    for (const choice of use.choices ?? []) {
      const control = element("span", "ui-input ui-select")
      const select = element("select")
      select.setAttribute("aria-label", choice.label)
      select.append(...choice.options.map(([value, label]) => new Option(label, value, false, value === choice.value)))
      select.addEventListener("change", () => choice.change(select.value))
      control.append(select)
      targets.append(control)
    }
    for (const target of use.targets) {
      const button = element("button", "ui-button")
      button.type = "button"
      // 跟在下拉框后面的是「应用」：默认高度与下拉框对齐，不用 quiet
      if (!use.choices) {
        button.dataset.size = "sm"
        button.dataset.variant = "quiet"
      }
      button.title = target.title ?? `打开 ${target.label}`
      button.append(createIcon(target.icon ?? "arrow-up-right", 12), target.label)
      button.addEventListener("click", target.open)
      targets.append(button)
    }
    list.append(targets)
  }
  section.append(list)
  return section
}

/** The strip under the keyboard canvas on desktop: what is playing, the player and its warnings. */
function stageContent(view: AnimationResourceView, item: AnimationListItem | undefined): HTMLElement[] {
  if (!item) {
    const empty = element("p", "animation-stage-empty")
    empty.textContent = `选择左侧的${MODE_NOUN[view.mode]}即可在这里播放预览。`
    return [empty]
  }
  const heading = element("div", "animation-stage-heading")
  const title = element("strong")
  title.textContent = `${item.title} · ${item.kind}`
  const detail = element("small")
  detail.textContent = `${item.detail} · ${item.uses ? `${item.uses} 处引用` : "未使用"}`
  heading.append(title, detail)
  const player = view.player && animationPlayer(view.player)
  if (player) player.dataset.layout = "row"
  return [heading, ...player ? [player] : [], ...view.warnings ?? []]
}

/** Fills `container` with the list, and the selected animation's preview, uses and parameters. */
export function renderAnimationResource(container: HTMLElement, view: AnimationResourceView): void {
  const item = view.items.find((candidate) => candidate.id === view.selected)
  const hosts = animationWorkspaceHosts()
  if (hosts && view.mode !== "all") {
    hosts.setMode(view.mode === "particle", countLabel(view))
    hosts.library.replaceChildren(...keyFilterBar(view), listBox(view, true), ...[listActions(view)].filter((node) => node !== undefined))
    hosts.filter()
    hosts.stage.replaceChildren(...stageContent(view, item))
    const rows = view.listRows?.length ? [animationSection("配置", view.sectionClass)] : []
    rows[0]?.append(...view.listRows!)
    container.replaceChildren(...rows)
    if (item) container.append(usesSection(view), ...view.sections)
    return
  }
  container.replaceChildren(listSection(view))
  if (!item) return
  container.append(previewSection(view, item), usesSection(view), ...view.sections)
}

/** A slider beside a number field for values with a natural range; dragging previews, release commits once. */
export function sliderField(control: HTMLElement, input: HTMLInputElement, bounds: { min: number; max: number; step?: number }): HTMLElement {
  const field = element("span", "ui-slider-field")
  const range = element("input", "ui-slider")
  range.type = "range"
  range.min = String(bounds.min)
  range.step = String(bounds.step ?? 1)
  range.disabled = input.disabled
  range.setAttribute("aria-label", `${input.getAttribute("aria-label") ?? ""}滑块`)
  const sync = () => {
    const value = Number(input.value)
    range.max = String(Math.max(bounds.max, Number.isFinite(value) ? value : bounds.min))
    range.value = String(Number.isFinite(value) && input.value.trim() ? value : bounds.min)
  }
  sync()
  range.addEventListener("input", () => { input.value = range.value })
  range.addEventListener("change", () => input.dispatchEvent(new Event("change", { bubbles: true })))
  input.addEventListener("input", sync)
  field.append(range, control)
  return field
}

/**
 * An image reference drawn as the style card (DESIGN.md §10): the file or resource name on the left,
 * the picture on the right. Clicking the picture picks another one; the name stays editable.
 */
export function imageCard(options: {
  label: string
  value: string
  editable: boolean
  placeholder?: string
  load(): Promise<Visual | undefined> | undefined
  onChange(value: string): void
  pick?(): void
  /** A `<datalist>` id offering the files that fit. */
  list?: string
}): HTMLElement {
  const card = element("span", "style-reference-input image-reference-card")
  const row = element("span", "style-reference-row")
  const meta = element("span", "style-reference-meta")
  const name = element("input", "style-reference-number style-reference-name")
  name.value = options.value
  name.placeholder = options.placeholder ?? "未设置"
  name.disabled = !options.editable
  name.spellcheck = false
  name.setAttribute("aria-label", options.label)
  if (options.list) name.setAttribute("list", options.list)
  name.addEventListener("change", () => options.onChange(name.value.trim()))
  meta.append(name)
  const states = element("span", "style-picker-states")
  const picture = element("button", "style-picker-state")
  picture.type = "button"
  picture.disabled = !options.editable || !options.pick
  picture.title = options.pick ? `选择${options.label}` : options.label
  picture.setAttribute("aria-label", picture.title)
  // Twice the card's picture size, sharp on retina screens.
  const canvas = element("canvas")
  canvas.width = 304
  canvas.height = 152
  canvas.setAttribute("aria-hidden", "true")
  picture.append(canvas)
  if (options.pick) picture.addEventListener("click", options.pick)
  states.append(picture)
  row.append(meta, states)
  card.append(row)
  void options.load()?.then((visual) => { if (visual) drawVisualPreview(canvas, [visual], false) }).catch(() => {})
  return card
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
          actionButton("arrow-up", `上移${child.title}`, () => options.move!(index, -1), disabled || index === 0),
          actionButton("arrow-down", `下移${child.title}`, () => options.move!(index, 1), disabled || index === options.children.length - 1),
        )
        if (options.remove) actions.append(actionButton("x", `移除${child.title}`, () => options.remove!(index), disabled))
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
