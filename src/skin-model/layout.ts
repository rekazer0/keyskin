// 布局：taffy 树。
//
// 节点样式直接使用 taffy 的 StylePropertyValues；读取结果使用 LayoutPropertyValues；
// 属性名校验使用 StyleProperty/LayoutProperty。IR 不再定义任何布局长度、枚举或定位类型。
import { Display, FlexDirection, Position, Style, TaffyTree, loadTaffy } from "taffy-layout"
import type { LayoutProperty, LayoutPropertyValues, Point, Size, StyleProperty, StylePropertyValues } from "taffy-layout"

/** 节点的已计算布局：位置与尺寸都使用 taffy 的读取类型。 */
export type LayoutBox = Pick<LayoutPropertyValues, "position" | "size">

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
  parent: Point<number>,
  out: Map<string, LayoutBox>,
): void {
  const layout = tree.getLayout(nodeId)
  try {
    const position: LayoutPropertyValues["position"] = layout.get("position")
    const size: LayoutPropertyValues["size"] = layout.get("size")
    out.set(node.id, {
      position: { x: Math.round(parent.x + position.x), y: Math.round(parent.y + position.y) },
      size: { width: Math.round(size.width), height: Math.round(size.height) },
    })
    const origin: Point<number> = { x: parent.x + position.x, y: parent.y + position.y }
    for (const [index, child] of (node.children ?? []).entries()) {
      collect(tree, tree.getChildAtIndex(nodeId, index), child, origin, out)
    }
  } finally {
    layout.free()
  }
}

/** 计算一棵布局树，返回每个节点的板内位置与尺寸；坐标取整。 */
export async function computeLayout(board: LayoutBoard, container: Size<number>): Promise<Map<string, LayoutBox>> {
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
      const out = new Map<string, LayoutBox>()
      collect(tree, boardId, board, { x: 0, y: 0 }, out)
      return out
    } finally {
      rootStyle.free()
    }
  } finally {
    tree.free()
  }
}

/** 把一组盒子建成同一棵树的绝对节点。 */
export function absoluteBoard(boxes: ReadonlyArray<{ id: string } & LayoutBox>): LayoutBoard {
  return {
    id: "",
    style: {
      display: Display.Flex,
      flexDirection: FlexDirection.Column,
      size: { width: "100%", height: "100%" },
    },
    children: boxes.map((box) => ({
      id: box.id,
      style: {
        position: Position.Absolute,
        inset: { left: box.position.x, top: box.position.y, right: "auto", bottom: "auto" },
        size: box.size,
      },
    })),
  }
}

/** 把某个按键钉到板坐标的指定位置：从原父容器摘出，作为根的绝对定位子项。 */
export function setNodeRect(node: LayoutNode, id: string, box: LayoutBox): LayoutNode {
  if (node.id === id) {
    return {
      ...node,
      style: {
        ...node.style,
        position: Position.Absolute,
        inset: { left: box.position.x, top: box.position.y, right: "auto", bottom: "auto" },
        size: box.size,
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
          inset: { left: box.position.x, top: box.position.y, right: "auto", bottom: "auto" },
          size: box.size,
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

/**
 * 一组已计算矩形的包围盒：内容实际尺寸。
 * 容器只是可见尺寸，键可以超出它；超出的部分由这里给出，不在板上存第二份。
 */
export function layoutBounds(rects: ReadonlyMap<string, LayoutBox>): LayoutBox | undefined {
  if (!rects.size) return undefined
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const box of rects.values()) {
    left = Math.min(left, box.position.x)
    top = Math.min(top, box.position.y)
    right = Math.max(right, box.position.x + box.size.width)
    bottom = Math.max(bottom, box.position.y + box.size.height)
  }
  return { position: { x: left, y: top }, size: { width: right - left, height: bottom - top } }
}

/**
 * 内容在画布上的可见范围：上边取 0 与最上沿的较小者，下边不超过画布高度。
 * 渲染、导出与检查器共用这一份，避免各自对同一组矩形做一遍 reduce。
 */
export function contentBounds(
  items: ReadonlyArray<{ rect: { x: number; y: number; width: number; height: number } }>,
  surfaceHeight: number,
): { top: number; height: number } {
  if (!items.length) return { top: 0, height: surfaceHeight }
  const top = Math.max(0, Math.min(...items.map((item) => item.rect.y)))
  const bottom = Math.min(surfaceHeight, Math.max(...items.map((item) => item.rect.y + item.rect.height)))
  return { top, height: Math.max(0, bottom - top) }
}
