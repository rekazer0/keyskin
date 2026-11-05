/*
 * 动画资源检查器的公共骨架（DESIGN.md §10「动画资源」）：手心 skin.json、百度 anim.ini 与 BDA animationConfig
 * 共用同一套分组——列表（选一个动画）→ 预览（播放器）→ 参数分组。桌面宽度下列表放进左侧栏、
 * 播放器放到画布上（animation-workspace.ts），检查器只留参数分组。
 * 这里只负责呈现与交互；读写配置、撤销与选择状态都由各格式的适配器通过回调完成。
 */
import { bindListActionKeys, bindListboxKeys, element, emptyState, iconButton, listToolbar } from "./dom-element.ts"
import { createIcon } from "./icons.ts"
import { animationPlayer, type AnimationPlayerOptions } from "./animation-player.ts"
import { animationWorkspaceHosts } from "./animation-workspace.ts"
import { styleCard } from "./style-card.ts"
import { section } from "./app/property-rows.ts"

export type AnimationMode = "all" | "motion" | "particle"

export type AnimationListItem = {
  /** Stable within the document: Palm's table key, `ANIM3`, a BDA `kind:key`. */
  id: string
  title: string
  info?: string
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

/** 侧栏第二份列表的一行：引用了动画的样式（BDA 是绑定着动画的目标）。 */
export type AnimationStyleItem = {
  /** 样式编号或目标名，同一份文件里唯一。 */
  id: string
  /** 行标题，如 `STYLE12`。 */
  title: string
  /** 时机或类型说明，如「按下 · 松开」。 */
  detail: string
  /** 当前入口下引用的动画个数。 */
  count: number
}
/** 侧栏的第二份列表：样式（BDI/BDS、手心）或目标（BDA），只列引用了动画的那些。 */
export type AnimationStyleList = {
  /** 列表叫什么：样式 / 目标。 */
  noun: string
  /** 行首图标，与动画行同一套 Lucide。 */
  icon: string
  items: AnimationStyleItem[]
  selected?: string
  onSelect(id: string): void
  card?(item: AnimationStyleItem): HTMLElement
  /** 底部工具条，与动画列表同一套：新建（按下播放选中的动画）/ 复制 / 删除选中的样式。 */
  create?(): void
  duplicate?(): void
  remove?: { run(): void; blocked?: string }
}
export type AnimationStyleFilter = { label: string; clear(): void }

type AnimationResourceView = {
  listOwner?: HTMLElement
  listContext?: string
  listSource?: object
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
  /** 侧栏第二份列表：引用了动画的样式（BDA 是目标）。 */
  styles?: AnimationStyleList
  /** 列表被一个样式筛住时的说明与清除。 */
  styleFilter?: AnimationStyleFilter
  /** Document-level rows under the list (BDA design width, ANIM_NUM warnings). */
  listRows?: HTMLElement[]
  thumbnail?(id: string): AnimationPlayerOptions
  player?: AnimationPlayerOptions
  /** Problems with the selected animation, under the player. */
  warnings?: HTMLElement[]
  sections: HTMLElement[]
}

const MODE_NOUN: Record<AnimationMode, string> = { all: "动画", motion: "动效", particle: "粒子" }

/** Keyboard selection rebuilds the inspector; the new list takes the focus back. */
const focus = { list: false }

export function animationModeTitle(mode: AnimationMode): string {
  return mode === "particle" ? "粒子设计" : mode === "motion" ? "动效设计" : "动画"
}

function actionButton(icon: string, label: string, onClick: () => void, disabled: boolean): HTMLButtonElement {
  const button = iconButton(icon, label, onClick)
  button.disabled = disabled
  return button
}

function listOption(view: AnimationResourceView, item: AnimationListItem, selected: boolean): HTMLElement {
  const card = styleCard({
    id: item.id, label: item.title, kind: "anim", kindLabel: item.kind, kindIcon: item.icon,
    info: item.info,
    summary: item.problem ?? item.detail,
    animation: () => {
      const player = view.thumbnail?.(item.id)
      return player ? [animationPlayer({ ...player, thumbnail: true, direct: undefined, keyboard: undefined })] : []
    },
    uses: item.uses,
    note: item.detail,
  })
  delete card.dataset.styleId
  card.dataset.animationId = item.id
  card.setAttribute("aria-selected", String(selected))
  card.tabIndex = selected ? 0 : -1
  card.title = `${item.title} · ${item.kind} · ${item.uses ? `${item.uses} 处引用` : "未使用"}\n${item.problem ?? item.detail}`
  if (item.problem) card.dataset.problem = ""
  return card
}

type OptionBoxState = {
  signature: string
  source?: object
  list: HTMLElement
  rows: Map<string, HTMLElement>
  items: Array<{ id: string }>
  selected?: string
  onSelect(id: string): void
}
const optionBoxStates = new WeakMap<HTMLElement, Map<string, OptionBoxState>>()

function optionBox<T extends { id: string }>(options: {
  items: T[]
  selected: string | undefined
  label: string
  empty: string
  dataKey: "animationId" | "styleId"
  row(item: T, selected: boolean): HTMLElement
  onSelect(id: string): void
  fill: boolean
  owner: HTMLElement
  context: string
  source?: object
}): HTMLElement {
  const states = optionBoxStates.get(options.owner) ?? new Map<string, OptionBoxState>()
  optionBoxStates.set(options.owner, states)
  const signature = JSON.stringify([options.context, options.label, options.items.map(item => item.id)])
  let state = states.get(options.dataKey)
  const changedSelection = !state || state.selected !== options.selected
  if (!state || state.source !== options.source || state.signature !== signature) {
    const list = element("div", "ui-listbox")
    list.setAttribute("role", "listbox")
    const rows = new Map<string, HTMLElement>()
    for (const item of options.items) rows.set(item.id, options.row(item, item.id === options.selected))
    if (rows.size) list.append(...rows.values())
    else list.append(emptyState("list", options.empty))
    state = { signature, source: options.source, list, rows, items: options.items, selected: options.selected, onSelect: options.onSelect }
    states.set(options.dataKey, state)
    const current = state
    list.addEventListener("click", (event) => {
      const attribute = options.dataKey === "animationId" ? "data-animation-id" : "data-style-id"
      const row = (event.target as Element).closest<HTMLElement>(`[${attribute}]`)
      if (row) current.onSelect(row.dataset[options.dataKey]!)
    })
    bindListboxKeys(list, (row) => {
      focus.list = true
      current.onSelect(row.dataset[options.dataKey]!)
    })
  }
  state.items = options.items
  state.selected = options.selected
  state.onSelect = options.onSelect
  state.list.setAttribute("aria-label", options.label)
  if (options.fill) state.list.dataset.size = "fill"
  else delete state.list.dataset.size
  for (const item of options.items) {
    const row = state.rows.get(item.id)!
    row.setAttribute("aria-selected", String(item.id === options.selected))
    row.tabIndex = item.id === options.selected || options.selected === undefined ? 0 : -1
  }
  if (changedSelection || focus.list) requestAnimationFrame(() => {
    const selected = state!.list.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!selected || !state!.list.isConnected) return
    if (selected.offsetTop < state!.list.scrollTop) state!.list.scrollTop = selected.offsetTop
    else if (selected.offsetTop + selected.offsetHeight > state!.list.scrollTop + state!.list.clientHeight) state!.list.scrollTop = selected.offsetTop + selected.offsetHeight - state!.list.clientHeight
    if (focus.list) selected.focus()
    focus.list = false
  })
  return state.list
}

function syncChildren(parent: HTMLElement, children: HTMLElement[]): void {
  for (const child of [...parent.children]) if (!children.includes(child as HTMLElement)) child.remove()
  children.forEach((child, index) => {
    if (parent.children[index] !== child) parent.insertBefore(child, parent.children[index] ?? null)
  })
}


function listBox(view: AnimationResourceView, fill = false): HTMLElement {
  const noun = MODE_NOUN[view.mode]
  return optionBox({ owner: view.listOwner!, context: view.listContext!, source: view.listSource, items: view.items, selected: view.selected, label: `${noun}列表`,
    empty: `没有${noun}`,
    dataKey: "animationId", row: (item, selected) => listOption(view, item, selected), onSelect: view.onSelect, fill })
}

function styleOption(styles: AnimationStyleList, item: AnimationStyleItem, selected: boolean, noun: string): HTMLElement {
  if (styles.card) {
    const card = styles.card(item)
    card.dataset.styleId = item.id
    card.setAttribute("role", "option")
    card.setAttribute("aria-selected", String(selected))
    card.tabIndex = selected || !styles.selected ? 0 : -1
    return card
  }
  const option = element("button", "ui-list-item")
  option.type = "button"
  option.setAttribute("role", "option")
  option.setAttribute("aria-selected", String(selected))
  option.tabIndex = selected ? 0 : -1
  option.dataset.styleId = item.id
  const text = element("span", "ui-list-item-text")
  const title = element("strong")
  title.textContent = item.title
  const meta = element("span", "ui-list-item-meta")
  const count = element("span", "ui-badge")
  count.append(createIcon("link", 14), String(item.count))
  count.title = `${item.count} 个${noun}`
  meta.append(count)
  const detail = element("small")
  detail.textContent = item.detail
  meta.append(detail)
  text.append(title, meta)
  option.title = `${item.title} · ${item.count} 个${noun}${item.detail ? `\n${item.detail}` : ""}`
  option.append(createIcon(styles.icon, 14), text)
  return option
}

function styleListBox(view: AnimationResourceView, fill = false): HTMLElement | undefined {
  const styles = view.styles
  if (!styles) return undefined
  const noun = MODE_NOUN[view.mode]
  return optionBox({ owner: view.listOwner!, context: view.listContext!, source: view.listSource, items: styles.items, selected: styles.selected, label: `${styles.noun}列表`,
    empty: `没有引用${noun}的${styles.noun}`, dataKey: "styleId",
    row: (item, selected) => styleOption(styles, item, selected, noun),
    onSelect: (id) => { styles.onSelect(id); if (!styles.card) animationWorkspaceHosts()?.show("animations") }, fill })
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

/** 列表被一个样式（目标）筛住时的说明与「清除」。 */
function styleFilterBar(view: AnimationResourceView): HTMLElement[] {
  const filter = view.styleFilter
  if (!filter) return []
  const bar = element("div", "animation-style-filter")
  const note = element("span", "animation-style-filter-note")
  note.append(createIcon("list-filter", 14), Object.assign(element("span"), { textContent: `${filter.label} 的${MODE_NOUN[view.mode]}` }))
  bar.append(note, iconButton("x", `清除${filter.label}筛选`, filter.clear))
  return [bar]
}

/** 列表头部的数量；按键筛选时是「1 / 2 个」。 */
const countLabel = (view: AnimationResourceView) => view.keyFilter?.only ? `${view.items.length} / ${view.keyFilter.total}` : String(view.items.length)

function listSection(view: AnimationResourceView): HTMLElement {
  const list = listBox(view)
  const node = section(MODE_NOUN[view.mode], [...keyFilterBar(view), list], { className: view.sectionClass, count: countLabel(view) })
  node.toggleAttribute("data-filter-keep", true)
  const actions = listActions(view)
  if (actions) {
    node.append(actions)
    bindListActionKeys(list, actions)
  }
  node.append(...view.listRows ?? [])
  return node
}

/** 窄屏里排在动画列表下面的样式列表；桌面宽度下它在左侧栏的第二份列表里。 */
function styleSection(view: AnimationResourceView): HTMLElement | undefined {
  const styles = view.styles
  const list = styleListBox(view)
  if (!styles || !list) return undefined
  const actions = styleActions(view)
  if (actions) bindListActionKeys(list, actions)
  return section(styles.noun, [list, ...actions ? [actions] : []], { className: view.sectionClass, count: String(styles.items.length) })
}

type ListActions = Pick<AnimationResourceView, "create" | "duplicate" | "remove" | "editable"> & { noun: string; current?: string }

const listActions = (view: AnimationResourceView) => actionsToolbar({ ...view, noun: MODE_NOUN[view.mode], current: view.items.find((item) => item.id === view.selected)?.title })

function styleActions(view: AnimationResourceView): HTMLElement | undefined {
  const styles = view.styles
  if (!styles) return
  return actionsToolbar({ noun: styles.noun, editable: view.editable, current: styles.items.find((item) => item.id === styles.selected)?.title,
    create: styles.create && { options: [["style", styles.noun]], run: styles.create }, duplicate: styles.duplicate, remove: styles.remove })
}

function actionsToolbar(view: ListActions): HTMLElement | undefined {
  if (!view.create && !view.duplicate) return
  const { noun, current } = view
  let create: HTMLElement | undefined
  const plus = element("span", "ui-input-affix")
  plus.append(createIcon("plus", 14))
  // 只有一种可新建时是同样外观的宽按钮，点一下就新建；多种时是下拉，两处操作栏长得一样。
  if (view.create?.options.length === 1) {
    const [kind, label] = view.create.options[0]
    const button = element("button", "ui-input")
    button.type = "button"
    button.dataset.listAction = "create"
    button.disabled = !view.editable
    const text = element("span")
    text.textContent = `新建${label}`
    button.append(plus, text)
    button.addEventListener("click", () => view.create!.run(kind))
    create = button
  } else if (view.create) {
    create = element("label", "ui-input ui-select")
    const select = element("select")
    select.setAttribute("aria-label", `新建${noun}`)
    select.disabled = !view.editable
    select.append(new Option(`新建${noun}`, ""), ...view.create.options.map(([kind, label]) => new Option(label, kind)))
    select.addEventListener("change", () => { if (select.value) view.create!.run(select.value) })
    create.append(plus, select)
  }
  return listToolbar({
    create,
    duplicate: view.duplicate && { label: current ? `复制${current}` : `复制${noun}`, run: view.duplicate, disabled: !view.editable || !current },
    remove: view.remove && { label: current ? `删除${current}` : `删除${noun}`, run: view.remove.run, disabled: !view.editable || !current || Boolean(view.remove.blocked), title: view.remove.blocked },
  })
}

function previewSection(view: AnimationResourceView, item: AnimationListItem): HTMLElement {
  return section("预览", [...view.player ? [animationPlayer(view.player)] : [], ...view.warnings ?? []], { className: view.sectionClass, code: `${item.title} · ${item.kind}` })
}

/** The strip under the keyboard canvas on desktop: what is playing, the player and its warnings. */
function stageContent(view: AnimationResourceView, item: AnimationListItem | undefined): HTMLElement[] {
  if (!item) {
    return [emptyState("play")]
  }
  const heading = element("div", "animation-stage-heading")
  const icon = element("span", "animation-stage-icon")
  icon.append(createIcon(item.icon, 14))
  const title = element("strong")
  title.textContent = item.title
  const kind = element("span", "ui-badge")
  kind.textContent = item.kind
  const detail = element("small", "animation-stage-meta")
  detail.textContent = `${item.detail} · ${item.uses ? `${item.uses} 处引用` : "未使用"}`
  heading.append(icon, title, kind, detail)
  const player = view.player && animationPlayer(view.player)
  if (player) player.dataset.layout = "row"
  return [heading, ...player ? [player] : [], ...view.warnings ?? []]
}

/** Fills `container` with the list, and the selected animation's preview and parameters. */
export function renderAnimationResource(container: HTMLElement, view: AnimationResourceView): void {
  const item = view.items.find((candidate) => candidate.id === view.selected)
  const hosts = animationWorkspaceHosts()
  view.listOwner = container
  view.listContext = JSON.stringify([view.mode, view.player?.key])
  if (hosts && view.mode !== "all") {
    hosts.setMode(view.mode === "particle", countLabel(view))
    hosts.setStyles(view.styles?.noun, view.styles?.items.length ?? 0)
    const list = listBox(view, true)
    const actions = listActions(view)
    if (actions) bindListActionKeys(list, actions)
    syncChildren(hosts.library, [...keyFilterBar(view), ...styleFilterBar(view), list, ...actions ? [actions] : []])
    const styles = styleListBox(view, true)
    const styleToolbar = styles && styleActions(view)
    if (styles && styleToolbar) bindListActionKeys(styles, styleToolbar)
    syncChildren(hosts.styles, styles ? [styles, ...styleToolbar ? [styleToolbar] : []] : [])
    hosts.filter()
    hosts.stage.replaceChildren(...stageContent(view, item))
    container.replaceChildren(...view.listRows?.length ? [section("配置", view.listRows, { className: view.sectionClass })] : [])
    if (item) container.append(...view.sections)
    return
  }
  container.replaceChildren(listSection(view))
  const styles = styleSection(view)
  if (styles) container.append(styles)
  if (!item) return
  container.append(previewSection(view, item), ...view.sections)
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
    select.append(new Option("添加子动画", ""), ...options.add.options.map(([id, label]) => new Option(label, id)))
    select.addEventListener("change", () => { if (select.value) options.add!.run(select.value) })
    control.append(select)
    block.append(control)
  }
  return block
}
