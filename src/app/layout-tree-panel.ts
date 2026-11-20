// 布局树：把模型里已经推导好的 LayoutNode 直接画出来。
//
// 结构复用文件树：有子节点的是可折叠的 `.nav-group`，叶子是 `.ui-list-item`。
// 点按键与在画布上点它等价——先同步画布选中，再走同一条界面回调。
//
// 渲染分两档：模型换了（打开、编辑、切板）才重建 DOM 并保留折叠与滚动；
// 只是选中变了就改 `aria-selected`，不碰结构。渲染状态属于容器自己，不放在模块上。
import type { LayoutBox, LayoutNode } from "@/skin-model/layout.ts"
import { containerOf, type Board } from "@/skin-model/board.ts"
import type { Key } from "@/skin-model/key.ts"
import { computeLayout } from "@/skin-model/layout.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import { describeNode } from "@/skin-model/layout-view.ts"
import { symbolSpan } from "../icons"
import { preview } from "./canvas-interaction"
import { appState } from "./state"
import { skinModel } from "./skin-model-state"

const ROLE_ICONS: Readonly<Record<string, string>> = {
  board: "keyboard",
  container: "layers",
  key: "key-round",
}

/** 一棵树的渲染状态：这份 DOM 对应哪个模型，以及用户手动改过的折叠。 */
type TreeState = {
  model: SkinModel | undefined
  open: Map<string, boolean>
}

const states = new WeakMap<HTMLElement, TreeState>()

function stateOf(container: HTMLElement): TreeState {
  let state = states.get(container)
  if (!state) {
    state = { model: undefined, open: new Map() }
    states.set(container, state)
  }
  return state
}

/** 一行内容：图标、节点名、布局摘要；按键再带推导出的矩形。 */
function contentOf(node: LayoutNode, role: string, rect?: string): HTMLElement[] {
  const label = document.createElement("span")
  label.className = "nav-label"
  label.textContent = node.id
  const meta = document.createElement("span")
  meta.className = "nav-meta"
  meta.textContent = rect ? `${describeNode(node)} · ${rect}` : describeNode(node)
  return [symbolSpan(ROLE_ICONS[role] ?? "box"), label, meta]
}

/** 按键的矩形来自布局树；不是按键时返回 undefined。 */
function rectText(rects: ReadonlyMap<string, LayoutBox>, nodeId: string): string | undefined {
  const rect = rects.get(nodeId)
  if (!rect) return
  const { position, size } = rect
  return `${Math.round(position.x)},${Math.round(position.y)} ${Math.round(size.width)}×${Math.round(size.height)}`
}

/** 把选中标记同步到现有节点上；DOM 结构不动。 */
function syncSelection(container: HTMLElement): void {
  const selected = new Set(appState.selectedKeySections)
  for (const item of container.querySelectorAll<HTMLElement>("[data-layout-node]")) {
    // 选中集合记的是按键的段名（section），布局节点 id 是 layoutId；变体键两者不同。
    const section = item.dataset.layoutSection
    item.setAttribute("aria-selected", String(section !== undefined && selected.has(section)))
  }
}

/** 按键叶子。点击与在画布上点它等价：先同步画布选中，再走同一条界面回调。 */
function keyItem(node: LayoutNode, key: Key, rect: string | undefined, container: HTMLElement): HTMLElement {
  const item = document.createElement("button")
  item.type = "button"
  item.className = "ui-list-item nav-item"
  item.dataset.layoutNode = node.id
  item.dataset.layoutSection = key.id
  item.append(...contentOf(node, "key", rect))
  item.addEventListener("click", () => {
    preview.setSelected([key.id])
    preview.onSelect([key.id])
    syncSelection(container)
  })
  return item
}

/** 容器：可折叠分组。第一层展开，更深的默认折叠，26 键一次铺开会看不出结构。 */
function groupOf(node: LayoutNode, role: string, open: boolean, keys: ReadonlyMap<string, Key>, rects: ReadonlyMap<string, LayoutBox>, container: HTMLElement, state: TreeState): HTMLElement {
  const group = document.createElement("details")
  group.className = "nav-group"
  group.open = state.open.get(node.id) ?? open
  group.addEventListener("toggle", () => state.open.set(node.id, group.open))
  const summary = document.createElement("summary")
  summary.className = "ui-list-item nav-section"
  summary.append(...contentOf(node, role))
  const marker = document.createElement("span")
  marker.className = "source-disclosure"
  summary.append(marker)
  const body = document.createElement("div")
  body.className = "nav-group-body"
  for (const child of node.children ?? []) body.append(renderNode(child, node, keys, role === "board", container, state, rects))
  group.append(summary, body)
  return group
}

function renderNode(node: LayoutNode, root: LayoutNode, keys: ReadonlyMap<string, Key>, open: boolean, container: HTMLElement, state: TreeState, rects: ReadonlyMap<string, LayoutBox>): HTMLElement {
  const key = node === root ? undefined : keys.get(node.id)
  // 按键按身份渲染成一行；没有几何时只显示样式摘要，不落进空的可折叠分组。
  if (key) return keyItem(node, key, rectText(rects, node.id), container)
  return groupOf(node, node === root ? "board" : "container", open, keys, rects, container, state)
}

/**
 * 当前布局对应的板。各格式的 `board.id` 构造不同，所以分三步：
 * 1. BDS 的 id 就是源文件路径，与 `layoutPath` 完全一致，先精确匹配；
 * 2. SSF 用 `板名@外观`（`py_26@status2`），只能比对去掉扩展名与 `@` 后缀的 basename；
 * 3. BDA / SXI 用 `主题/方向/键盘`，与 `layoutPath` 不同源，回退到第一块主键盘板。
 */
function currentBoard(model: SkinModel): Board | undefined {
  const path = appState.layoutPath
  const exact = model.boards.find((board) => board.id === path)
  if (exact) return exact
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")
  const byName = model.boards.find((board) => board.id.slice(board.id.lastIndexOf("/") + 1).replace(/@.*$/, "") === name)
  return byName ?? model.boards.find((board) => board.kind === "main")
}

/** 渲染当前板的布局树。模型没换就只同步选中，不重建。 */
export async function renderLayoutTree(container: HTMLElement): Promise<void> {
  const state = stateOf(container)
  const model = skinModel.model
  if (state.model === model && container.childElementCount > 0) {
    syncSelection(container)
    return
  }
  state.model = model
  const board = model ? currentBoard(model) : undefined
  const scrollTop = container.scrollTop
  // 没有板、或板没有布局树时用同一条空状态；模型还在读时不能说成「没有布局」。
  if (!board || !board.layout.children?.length) {
    container.replaceChildren()
    const empty = document.createElement("p")
    empty.className = "ui-empty"
    empty.textContent = !board
      ? skinModel.current.state === "unavailable" ? "这份皮肤解析失败，布局不可用"
        : skinModel.current.state === "loading" ? "正在读取布局…"
        : "这个文件没有布局"
      : "这块板没有布局树"
    container.append(empty)
    return
  }
  // 矩形由布局树算出来，和画布、导出用的是同一份。
  const size = containerOf(board)
  const rects = size ? await computeLayout(board.layout, size) : new Map<string, LayoutBox>()
  // 布局节点 id 是按键的 layoutId，不是按键名；变体键两者不同，没有 layoutId 的键没有几何。
  const keys = new Map(board.keys.flatMap((key) => key.layoutId === undefined ? [] : [[key.layoutId, key] as const]))
  container.replaceChildren(renderNode(board.layout, board.layout, keys, true, container, state, rects))
  syncSelection(container)
  container.scrollTop = scrollTop
}
