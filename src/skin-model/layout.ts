// 布局：taffy 树。
//
// 节点样式直接使用 taffy 的 StylePropertyValues；读取结果使用 LayoutPropertyValues；
// 属性名校验使用 StyleProperty/LayoutProperty。IR 不再定义任何布局长度、枚举或定位类型。
import { Display, FlexDirection, Position, Style, TaffyTree, loadTaffy } from "taffy-layout"
import type { LayoutProperty, LayoutPropertyValues, StyleProperty, StylePropertyValues } from "taffy-layout"

export type LayoutRect = { x: number; y: number; width: number; height: number }

/** 布局节点：`style` 是 taffy 的属性对象，`id` 是 IR 的稳定标识。 */
export type LayoutNode = {
  id: string
  style: StylePropertyValues
  children?: LayoutNode[]
}

export type LayoutBoard = LayoutNode

let loading: Promise<void> | undefined

async function ready(): Promise<void> {
  loading ??= loadTaffy().then(() => undefined, (error: unknown) => {
    loading = undefined
    throw error
  })
  await loading
}

/** 样式对象里出现的属性名；用于序列化与校验。 */
export function styleProperties(style: StylePropertyValues): StyleProperty[] {
  return Object.keys(style) as StyleProperty[]
}

/** 读取结果里的属性名；用于把计算值写成 IR 的矩形。 */
export const LAYOUT_RECT_PROPERTIES: readonly LayoutProperty[] = ["position", "size"]

function build(tree: TaffyTree, node: LayoutNode, ids: Set<string>): bigint {
  if (ids.has(node.id)) throw new Error(`布局节点 id 重复：${node.id}`)
  ids.add(node.id)
  const style = new Style(node.style)
  try {
    const children = (node.children ?? []).map((child) => build(tree, child, ids))
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
  try {
    const position: LayoutPropertyValues["position"] = layout.get("position")
    const size: LayoutPropertyValues["size"] = layout.get("size")
    out.set(node.id, {
      x: Math.round(parentX + position.x),
      y: Math.round(parentY + position.y),
      width: Math.round(size.width),
      height: Math.round(size.height),
    })
    for (const [index, child] of (node.children ?? []).entries()) {
      collect(tree, tree.getChildAtIndex(nodeId, index), child, parentX + position.x, parentY + position.y, out)
    }
  } finally {
    layout.free()
  }
}

/** 计算一棵布局树，返回每个节点相对板的矩形；坐标按整数输出。 */
export async function computeLayout(board: LayoutBoard, container: { width: number; height: number }): Promise<Map<string, LayoutRect>> {
  await ready()
  const tree = new TaffyTree()
  try {
    const boardId = build(tree, board, new Set())
    const rootStyle = new Style({
      position: Position.Relative,
      size: { width: container.width, height: container.height },
    })
    try {
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
export function absoluteBoard(rects: ReadonlyArray<{ id: string } & LayoutRect>): LayoutBoard {  return {
    id: "",
    style: {
      display: Display.Flex,
      flexDirection: FlexDirection.Column,
      size: { width: "100%", height: "100%" },
    },
    children: rects.map((rect) => ({
      id: rect.id,
      style: {
        position: Position.Absolute,
        inset: { left: rect.x, top: rect.y, right: "auto", bottom: "auto" },
        size: { width: rect.width, height: rect.height },
      },
    })),
  }
}

/** 把某个按键钉到板坐标的指定位置：从原父容器摘出，作为根的绝对定位子项。 */
export function setNodeRect(node: LayoutNode, id: string, rect: LayoutRect): LayoutNode {
  if (node.id === id) {
    return {
      ...node,
      style: {
        ...node.style,
        position: Position.Absolute,
        inset: { left: rect.x, top: rect.y, right: "auto", bottom: "auto" },
        size: { width: rect.width, height: rect.height },
      },
    }
  }
  const detached = detachNode(node, id)
  if (!detached) return node
  return {
    ...detached,
    children: [
      ...(detached.children ?? []),
      {
        id,
        style: {
          position: Position.Absolute,
          inset: { left: rect.x, top: rect.y, right: "auto", bottom: "auto" },
          size: { width: rect.width, height: rect.height },
        },
      },
    ],
  }
}

function detachNode(node: LayoutNode, id: string): LayoutNode | undefined {
  if (!node.children) return
  if (node.children.some((child) => child.id === id)) {
    return { ...node, children: node.children.filter((child) => child.id !== id) }
  }
  let detached: LayoutNode | undefined
  const children = node.children.map((child) => {
    if (detached) return child
    const next = detachNode(child, id)
    if (!next) return child
    detached = next
    return next
  })
  return detached ? { ...node, children } : undefined
}
