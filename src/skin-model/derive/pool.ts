// 池式布局推导（worklist）：键先进池，按"网格归约 → 行合并 → 列合并 → 残差"四个阶段
// 反复从池中取出可合并的子集，合并后放回，直到池只剩一个根。
//
// 合并不可逆，每阶段池内元素数单调下降；整树最后交给 taffy 验证，与输入不一致就回退绝对矩形。
import { AlignItems, Display, FlexDirection, Position } from "taffy-layout"
import type { StylePropertyValues } from "taffy-layout"
import { absoluteBoard, computeLayout, type LayoutNode, type LayoutRect } from "../layout.ts"
import type { Rect, Size } from "../types.ts"
import { layoutCost } from "./cost.ts"
import { resolveDeriveOptions, type DeriveOptions, type DeriveOverrides } from "./options.ts"

export type DeriveKind = "grid" | "flex-row" | "flex-column" | "relative" | "absolute"

export type DeriveResult = {
  layout: LayoutNode
  kind: DeriveKind
  cost: number
}

type KeyRect = { id: string } & Rect

/** 池中的一项：单个键，或已合并的组（布局相对自身原点构造）。 */
type PoolItem = {
  id: string
  kind: "key" | "row" | "column" | "grid" | "residual"
  keys: KeyRect[]
  bounds: Rect
  layout: LayoutNode
}

function boundsOf(keys: readonly KeyRect[]): Rect {
  const x = Math.min(...keys.map((key) => key.x))
  const y = Math.min(...keys.map((key) => key.y))
  return {
    x,
    y,
    width: Math.max(...keys.map((key) => key.x + key.width)) - x,
    height: Math.max(...keys.map((key) => key.y + key.height)) - y,
  }
}

function near(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance
}

function allNear(values: readonly number[], tolerance: number): boolean {
  return values.every((value) => near(value, values[0], tolerance))
}

function median(values: readonly number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function itemOf(key: KeyRect): PoolItem {
  return {
    id: key.id,
    kind: "key",
    keys: [key],
    bounds: { x: key.x, y: key.y, width: key.width, height: key.height },
    layout: { id: key.id, style: { size: { width: key.width, height: key.height } } },
  }
}

/** 行合并：同一 y 带、行高一致、水平间隙一致；行内高度不同则留给下一阶段。 */
function rowGroup(id: string, items: readonly PoolItem[], tolerance: number): PoolItem | undefined {
  if (items.length < 2) return
  const sorted = [...items].sort((left, right) => left.bounds.x - right.bounds.x)
  if (!allNear(sorted.map((item) => item.bounds.height), tolerance)) return
  const gaps = sorted.slice(1).map((item, index) => item.bounds.x - (sorted[index].bounds.x + sorted[index].bounds.width))
  if (!allNear(gaps, tolerance)) return
  const keys = sorted.flatMap((item) => item.keys)
  const bounds = boundsOf(keys)
  const gap = median(gaps)
  const style: StylePropertyValues = {
    display: Display.Flex,
    flexDirection: FlexDirection.Row,
    alignItems: AlignItems.Start,
    size: { width: bounds.width, height: sorted[0].bounds.height },
    ...(Math.abs(gap) > tolerance / 2 ? { gap: { width: gap, height: 0 } } : {}),
  }
  return { id, kind: "row", keys, bounds, layout: { id, style, children: sorted.map((item) => item.layout) } }
}

/**
 * 列合并：纵向间隙一致即可，横向差异用子项的 margin-left 表达（gap 表达纵向间距）。
 */
function columnGroup(id: string, items: readonly PoolItem[], tolerance: number): PoolItem | undefined {
  if (items.length < 2) return
  const sorted = [...items].sort((left, right) => left.bounds.y - right.bounds.y)
  const gaps = sorted.slice(1).map((item, index) => item.bounds.y - (sorted[index].bounds.y + sorted[index].bounds.height))
  if (!allNear(gaps, tolerance)) return
  const keys = sorted.flatMap((item) => item.keys)
  const bounds = boundsOf(keys)
  const gap = median(gaps)
  const children = sorted.map((item) => {
    const offset = item.bounds.x - bounds.x
    if (near(offset, 0, tolerance)) return item.layout
    return {
      ...item.layout,
      style: {
        ...item.layout.style,
        margin: { left: offset, right: 0, top: 0, bottom: 0 },
      },
    }
  })
  const style: StylePropertyValues = {
    display: Display.Flex,
    flexDirection: FlexDirection.Column,
    alignItems: AlignItems.Start,
    size: { width: bounds.width, height: bounds.height },
    ...(Math.abs(gap) > tolerance / 2 ? { gap: { width: 0, height: gap } } : {}),
  }
  return { id, kind: "column", keys, bounds, layout: { id, style, children } }
}

function placeInCell(item: PoolItem, row: number, column: number): LayoutNode {
  return {
    ...item.layout,
    style: {
      ...item.layout.style,
      gridRow: { start: row + 1, end: { span: 1 } },
      gridColumn: { start: column + 1, end: { span: 1 } },
    },
  }
}

/** 网格归约：行带与列带交叉，每格一项；列宽行高与间隙一致且总尺寸等于板。 */
function gridGroup(id: string, items: readonly PoolItem[], size: Size, tolerance: number): PoolItem | undefined {
  if (items.length < 4) return
  const rows: PoolItem[][] = []
  for (const item of [...items].sort((left, right) => left.bounds.y - right.bounds.y)) {
    const row = rows.find((candidate) => candidate.some((other) => near(other.bounds.y, item.bounds.y, tolerance)
      && near(other.bounds.height, item.bounds.height, tolerance)))
    if (row) row.push(item)
    else rows.push([item])
  }
  if (rows.length < 2 || rows.some((row) => row.length < 2)) return
  const columns: PoolItem[][] = []
  for (const item of [...items].sort((left, right) => left.bounds.x - right.bounds.x)) {
    const column = columns.find((candidate) => candidate.some((other) => near(other.bounds.x, item.bounds.x, tolerance)
      && near(other.bounds.width, item.bounds.width, tolerance)))
    if (column) column.push(item)
    else columns.push([item])
  }
  if (columns.length < 2 || columns.some((column) => column.length < 2)) return
  if (rows.length * columns.length !== items.length) return
  const rowBounds = rows.map((row) => boundsOf(row.flatMap((item) => item.keys)))
  const columnBounds = columns.map((column) => boundsOf(column.flatMap((item) => item.keys)))
  const gapX = median(columnBounds.slice(1).map((bounds, index) => bounds.x - (columnBounds[index].x + columnBounds[index].width)))
  const gapY = median(rowBounds.slice(1).map((bounds, index) => bounds.y - (rowBounds[index].y + rowBounds[index].height)))
  const totalWidth = columnBounds.reduce((sum, bounds) => sum + bounds.width, 0) + gapX * (columnBounds.length - 1)
  const totalHeight = rowBounds.reduce((sum, bounds) => sum + bounds.height, 0) + gapY * (rowBounds.length - 1)
  if (!near(totalWidth, size.width, tolerance) || !near(totalHeight, size.height, tolerance)) return
  if (!near(columnBounds[0].x, 0, tolerance) || !near(rowBounds[0].y, 0, tolerance)) return
  const children: LayoutNode[] = []
  for (const [rowIndex, row] of rows.entries()) {
    for (const item of row) {
      const columnIndex = columnBounds.findIndex((bounds) => near(item.bounds.x, bounds.x, tolerance))
      if (columnIndex < 0) return
      children.push(placeInCell(item, rowIndex, columnIndex))
    }
  }
  const style: StylePropertyValues = {
    display: Display.Grid,
    gridTemplateColumns: columnBounds.map((bounds) => ({ min: bounds.width, max: bounds.width })),
    gridTemplateRows: rowBounds.map((bounds) => ({ min: bounds.height, max: bounds.height })),
    gap: { width: gapX, height: gapY },
    size: { width: size.width, height: size.height },
  }
  return {
    id,
    kind: "grid",
    keys: items.flatMap((item) => item.keys),
    bounds: { x: 0, y: 0, width: size.width, height: size.height },
    layout: { id, style, children },
  }
}

/** 残差：剩余项收进一个铺满板的相对容器，子项按板坐标绝对定位。 */
function residualGroup(id: string, items: readonly PoolItem[], size: Size): PoolItem {
  const keys = items.flatMap((item) => item.keys)
  const bounds = boundsOf(keys)
  const children: LayoutNode[] = items.map((item) => ({
    ...item.layout,
    style: {
      ...item.layout.style,
      position: Position.Absolute,
      inset: { left: item.bounds.x, top: item.bounds.y, right: "auto", bottom: "auto" },
    },
  }))
  const style: StylePropertyValues = {
    position: Position.Relative,
    display: Display.Block,
    size: { width: size.width, height: size.height },
  }
  return { id, kind: "residual", keys, bounds, layout: { id, style, children } }
}

function rectMatches(actual: LayoutRect | undefined, expected: KeyRect, tolerance: number): boolean {
  return actual !== undefined
    && near(actual.x, expected.x, tolerance)
    && near(actual.y, expected.y, tolerance)
    && near(actual.width, expected.width, tolerance)
    && near(actual.height, expected.height, tolerance)
}

async function verifies(layout: LayoutNode, keys: readonly KeyRect[], size: Size, tolerance: number): Promise<boolean> {
  try {
    const computed = await computeLayout(layout, size)
    return keys.every((key) => rectMatches(computed.get(key.id), key, tolerance))
  } catch {
    return false
  }
}

/** 在池里反复合并，直到某个阶段不再产生新组。 */
function mergePhase(
  pool: PoolItem[],
  tolerance: number,
  id: string,
  bucketKey: (item: PoolItem) => string,
  group: (id: string, items: PoolItem[], tolerance: number) => PoolItem | undefined,
  counter: { value: number },
): { pool: PoolItem[]; merged: boolean } {
  let merged = false
  let changed = true
  while (changed) {
    changed = false
    const buckets = new Map<string, PoolItem[]>()
    for (const item of pool) {
      const key = bucketKey(item)
      const bucket = buckets.get(key) ?? []
      bucket.push(item)
      buckets.set(key, bucket)
    }
    for (const bucket of [...buckets.values()].sort((left, right) => right.length - left.length)) {
      if (bucket.length < 2) continue
      const created = group(`${id}:${counter.value}`, bucket, tolerance)
      if (!created) continue
      counter.value++
      pool = [...pool.filter((item) => !bucket.includes(item)), created]
      merged = true
      changed = true
      break
    }
  }
  return { pool, merged }
}

/** 池式推导主流程。 */
export async function derivePool(
  id: string,
  keys: readonly KeyRect[],
  size: Size,
  overrides?: DeriveOverrides,
): Promise<DeriveResult> {
  const options: DeriveOptions = resolveDeriveOptions(overrides)
  const tolerance = Math.max(0, options.tolerance)
  if (!keys.length) return { layout: absoluteBoard([]), kind: "absolute", cost: 0 }
  let pool: PoolItem[] = keys.map(itemOf)
  const counter = { value: 0 }

  // 阶段一：网格归约。
  const grid = gridGroup(`${id}:grid`, pool, size, tolerance)
  if (grid) pool = [grid]

  // 阶段二：行合并。
  if (pool.length > 1) {
    const result = mergePhase(pool, tolerance, `${id}:row`, (item) => `${Math.round(item.bounds.y)}|${Math.round(item.bounds.height)}`, rowGroup, counter)
    pool = result.pool
  }

  // 阶段三：列合并。
  if (pool.length > 1) {
    const result = mergePhase(pool, tolerance, `${id}:column`, (item) => `${Math.round(item.bounds.width)}`, columnGroup, counter)
    pool = result.pool
  }

  // 阶段四：残差。
  let root: LayoutNode
  if (pool.length === 1) root = pool[0].layout
  else root = residualGroup(`${id}:residual`, pool, size).layout

  if (!await verifies(root, keys, size, tolerance)) {
    const fallback = absoluteBoard(keys)
    return { layout: fallback, kind: "absolute", cost: layoutCost(fallback, options.weights) }
  }
  const finalKind: DeriveKind = pool.length === 1
    ? pool[0].kind === "grid" ? "grid"
      : pool[0].kind === "column" ? "flex-column"
        : pool[0].kind === "row" ? "flex-row"
          : "relative"
    : "relative"
  return { layout: root, kind: finalKind, cost: layoutCost(root, options.weights) }
}
