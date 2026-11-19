// 布局树：把模型里已经推导好的 LayoutNode 直接画出来。
//
// 结构复用文件树：有子节点的是可折叠的 `.nav-group`，叶子是 `.ui-list-item`。
// 点按键与在画布上点它等价——先同步画布选中，再走同一条界面回调。
//
// 渲染分两档：模型换了（打开、编辑、切板）才重建 DOM 并保留折叠与滚动；
// 只是选中变了就改 `aria-selected`，不碰结构。渲染状态属于容器自己，不放在模块上。
import type { LayoutBox, LayoutNode } from "@/skin-model/layout.ts"
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
function rectText(rects: ReadonlyMap<string, LayoutBox>, keyId: string): string | undefined {
  const rect = rects.get(keyId)
  if (!rect) return
  const { position, size } = rect
  return `${Math.round(position.x)},${Math.round(position.y)} ${Math.round(size.width)}×${Math.round(size.height)}`
}

/** 把选中标记同步到现有节点上；DOM 结构不动。 */
function syncSelection(container: HTMLElement): void {
  const selected = new Set(appState.selectedKeySections)
  for (const item of container.querySelectorAll<HTMLElement>("[data-layout-node]")) {
    const id = item.dataset.layoutNode
    item.setAttribute("aria-selected", String(id !== undefined && selected.has(id)))
  }
}

/** 按键叶子。 */
function keyItem(node: LayoutNode, rect: string, container: HTMLElement): HTMLElement {
  const item = document.createElement("button")
  item.type = "button"
  item.className = "ui-list-item nav-item"
  item.dataset.layoutNode = node.id
  item.append(...contentOf(node, "key", rect))
  item.addEventListener("click", () => {
    preview.setSelected([node.id])
    preview.onSelect([node.id])
    syncSelection(container)
  })
  return item
}

/** 容器：可折叠分组。第一层展开，更深的默认折叠，26 键一次铺开会看不出结构。 */
function groupOf(node: LayoutNode, role: string, open: boolean, keyIds: ReadonlySet<string>, rects: ReadonlyMap<string, LayoutBox>, container: HTMLElement, state: TreeState): HTMLElement {
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
  for (const child of node.children ?? []) body.append(renderNode(child, node, keyIds, role === "board", container, state, rects))
  group.append(summary, body)
  return group
}

function renderNode(node: LayoutNode, root: LayoutNode, keyIds: ReadonlySet<string>, open: boolean, container: HTMLElement, state: TreeState, rects: ReadonlyMap<string, LayoutBox>): HTMLElement {
  const role = node === root ? "board" : keyIds.has(node.id) ? "key" : "container"
  if (role === "key") {
    const rect = rectText(rects, node.id)
    if (rect) return keyItem(node, rect, container)
  }
  return groupOf(node, role, open, keyIds, rects, container, state)
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
  const board = model?.boards.find((item) => item.id === appState.layoutPath)
  const scrollTop = container.scrollTop
  if (!board) {
    container.replaceChildren()
    const empty = document.createElement("p")
    empty.className = "ui-empty"
    empty.textContent = skinModel.current.state === "unavailable" ? "这份皮肤解析失败，布局不可用" : "这个文件没有布局"
    container.append(empty)
    return
  }
  // 矩形由布局树算出来，和画布、导出用的是同一份。
  const rects = await computeLayout(board.layout, board.size)
  const keyIds = new Set(board.keys.map((key) => key.id))
  container.replaceChildren(renderNode(board.layout, board.layout, keyIds, true, container, state, rects))
  syncSelection(container)
  container.scrollTop = scrollTop
}
