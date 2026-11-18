// 推导成本：按树的结构统计各类节点，用权重折算成可比较的数值。
import type { LayoutNode } from "../layout.ts"
import type { DeriveWeights } from "./options.ts"

export type LayoutStats = {
  keys: number
  absolute: number
  relative: number
  containers: number
  margins: number
  depth: number
}

export function layoutStats(root: LayoutNode): LayoutStats {
  const stats: LayoutStats = { keys: 0, absolute: 0, relative: 0, containers: 0, margins: 0, depth: 0 }
  const visit = (node: LayoutNode, depth: number): void => {
    stats.depth = Math.max(stats.depth, depth)
    const children = node.children ?? []
    if (!children.length) stats.keys++
    else stats.containers++
    if (node.style.margin !== undefined) stats.margins++
    if (node.style.position === 1) stats.absolute++
    if (node.style.position === 0 && children.length) stats.relative++
    for (const child of children) visit(child, depth + 1)
  }
  visit(root, 0)
  return stats
}

export function layoutCost(root: LayoutNode, weights: DeriveWeights): number {
  const stats = layoutStats(root)
  return stats.absolute * weights.absolute
    + stats.relative * weights.relative
    + stats.margins * weights.margin
    + stats.containers * weights.container
    + stats.depth * weights.depth
}
