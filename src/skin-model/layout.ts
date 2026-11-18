// 布局：taffy 树。
//
// 节点按类型拆分：绝对矩形、布局叶子、flex 容器、grid 容器。每个变体只带自己该有的字段，
// 用 `kind` 收窄。布局是 IR 的唯一几何表示，不保存任何格式的坐标字段。
import { Display, FlexDirection, Position, Style, TaffyTree, loadTaffy } from "taffy-layout"

export type LayoutRect = { x: number; y: number; width: number; height: number }
export type LayoutLength = number | `${number}%` | "auto"
export type LayoutPadding = number | { left: number; top: number; right: number; bottom: number }
export type LayoutGap = number | { width: number; height: number }

/** 网格列定义：等分容器宽度，或每列固定宽度。 */
export type LayoutColumns = { equal: number } | { fixed: ReadonlyArray<LayoutLength> }

/** 绝对定位节点：矩形就是它的位置与尺寸，不参与父容器的排列。 */
export type LayoutAbsolute = {
  kind: "absolute"
  id: string
  rect: LayoutRect
  children?: LayoutAbsolute[]
}

/** 位置与尺寸由所在容器决定的叶子按键。 */
export type LayoutLeaf = {
  kind: "leaf"
  id: string
  width?: LayoutLength
  height?: LayoutLength
}

export type LayoutFlex = {
  kind: "flex"
  id: string
  direction?: "row" | "column"
  width?: LayoutLength
  height?: LayoutLength
  gap?: LayoutGap
  padding?: LayoutPadding
  children?: LayoutNode[]
}

export type LayoutGrid = {
  kind: "grid"
  id: string
  columns: LayoutColumns
  width?: LayoutLength
  height?: LayoutLength
  gap?: LayoutGap
  padding?: LayoutPadding
  children?: LayoutNode[]
}

export type LayoutNode = LayoutAbsolute | LayoutLeaf | LayoutFlex | LayoutGrid
export type LayoutBoard = LayoutNode

let loading: Promise<void> | undefined

async function ready(): Promise<void> {
  loading ??= loadTaffy().then(() => undefined, (error: unknown) => {
    loading = undefined
    throw error
  })
  await loading
}

function box(style: Style, node: LayoutFlex | LayoutGrid): void {
  if (node.width !== undefined) style.width = node.width
  if (node.height !== undefined) style.height = node.height
  if (node.gap !== undefined) {
    style.gap = typeof node.gap === "number" ? { width: node.gap, height: node.gap } : node.gap
  }
  if (node.padding !== undefined) {
    style.padding = typeof node.padding === "number"
      ? { left: node.padding, top: node.padding, right: node.padding, bottom: node.padding }
      : node.padding
  }
}

function buildStyle(node: LayoutNode): Style {
  const style = new Style()
  switch (node.kind) {
    case "absolute":
      style.position = Position.Absolute
      style.inset = { left: node.rect.x, top: node.rect.y, right: "auto", bottom: "auto" }
      style.size = { width: node.rect.width, height: node.rect.height }
      break
    case "leaf":
      if (node.width !== undefined) style.width = node.width
      if (node.height !== undefined) style.height = node.height
      break
    case "flex":
      style.position = Position.Relative
      style.display = Display.Flex
      style.flexDirection = node.direction === "row" ? FlexDirection.Row : FlexDirection.Column
      box(style, node)
      break
    case "grid":
      style.position = Position.Relative
      style.display = Display.Grid
      style.gridTemplateColumns = "equal" in node.columns
        ? [{ count: node.columns.equal, tracks: [{ min: "auto", max: "1fr" }] }]
        : node.columns.fixed.map((track) => ({ min: track, max: track }))
      box(style, node)
      break
  }
  return style
}

function childrenOf(node: LayoutNode): readonly LayoutNode[] {
  return node.kind === "leaf" ? [] : node.children ?? []
}

function build(tree: TaffyTree, node: LayoutNode, ids: Set<string>): bigint {
  if (ids.has(node.id)) throw new Error(`布局节点 id 重复：${node.id}`)
  ids.add(node.id)
  const style = buildStyle(node)
  try {
    const children = childrenOf(node).map((child) => build(tree, child, ids))
    return children.length ? tree.newWithChildren(style, children) : tree.newLeaf(style)
  } finally {
    style.free()
  }
}

function collect(
  tree: TaffyTree,
  nodeId: bigint,
  node: LayoutNode,
  parentX: number,
  parentY: number,
  out: Map<string, LayoutRect>,
): void {
  const layout = tree.getLayout(nodeId)
  const x = layout.x
  const y = layout.y
  const width = layout.width
  const height = layout.height
  layout.free()
  out.set(node.id, {
    x: Math.round(parentX + x),
    y: Math.round(parentY + y),
    width: Math.round(width),
    height: Math.round(height),
  })
  const children = childrenOf(node)
  for (const [index, child] of children.entries()) {
    collect(tree, tree.getChildAtIndex(nodeId, index), child, parentX + x, parentY + y, out)
  }
}

/** 计算一棵布局树，返回每个节点相对板的矩形；坐标按整数输出。 */
export async function computeLayout(board: LayoutBoard, container: { width: number; height: number }): Promise<Map<string, LayoutRect>> {
  await ready()
  const tree = new TaffyTree()
  try {
    const boardId = build(tree, board, new Set())
    const rootStyle = new Style()
    try {
      rootStyle.position = Position.Relative
      rootStyle.size = { width: container.width, height: container.height }
      const rootId = tree.newWithChildren(rootStyle, [boardId])
      tree.computeLayout(rootId, { width: container.width, height: container.height })
      const out = new Map<string, LayoutRect>()
      collect(tree, boardId, board, 0, 0, out)
      return out
    } finally {
      rootStyle.free()
    }
  } finally {
    tree.free()
  }
}

/** 把一组矩形建成同一棵树的绝对节点。 */
export function absoluteBoard(rects: ReadonlyArray<{ id: string } & LayoutRect>): LayoutBoard {
  return {
    kind: "flex",
    id: "",
    direction: "column",
    width: "100%",
    height: "100%",
    children: rects.map((rect) => ({ kind: "absolute", id: rect.id, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })),
  }
}
