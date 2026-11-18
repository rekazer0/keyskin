// 布局推导：把按键矩形推导成 taffy 布局树。
//
// 递归识别行与列：先按投影重叠分成层（行/列），再对每层继续推导；单层时按几何判断主轴方向。
// 每个候选都先交给 taffy 计算并与输入矩形比对，通过才采用，否则保持绝对矩形。
import { AlignItems, Display, FlexDirection } from "taffy-layout"
import type { StylePropertyValues } from "taffy-layout"
import { absoluteBoard, computeLayout, type LayoutNode, type LayoutRect } from "../layout.ts"
import type { Rect, Size } from "../types.ts"

type KeyRect = { id: string } & Rect

const TOLERANCE = 1
const MAX_DEPTH = 6

function overlap(left: KeyRect, right: KeyRect, axis: "x" | "y"): boolean {
  return axis === "x"
    ? left.x < right.x + right.width && right.x < left.x + left.width
    : left.y < right.y + right.height && right.y < left.y + left.height
}

/** 按投影重叠聚成层：`y` 轴得到行，`x` 轴得到列。 */
function groupsAlong(keys: readonly KeyRect[], axis: "x" | "y"): KeyRect[][] {
  const sorted = [...keys].sort((left, right) => axis === "x" ? left.x - right.x : left.y - right.y)
  const groups: KeyRect[][] = []
  for (const key of sorted) {
    const group = groups.find((candidate) => candidate.some((item) => overlap(item, key, axis)))
    if (group) group.push(key)
    else groups.push([key])
  }
  return groups.map((group) => [...group].sort((left, right) => axis === "x" ? left.y - right.y : left.x - right.x))
}

function median(values: readonly number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function equal(values: readonly number[], tolerance = TOLERANCE): boolean {
  return values.every((value) => Math.abs(value - values[0]) <= tolerance)
}

function leaf(key: KeyRect): LayoutNode {
  return { id: key.id, style: { size: { width: key.width, height: key.height } } }
}

/** 网格候选：列宽、行高、列位、间距跨行一致。 */
function gridCandidate(id: string, keys: readonly KeyRect[], size: Size): LayoutNode | undefined {
  const rows = groupsAlong(keys, "y")
  if (!rows.length || rows.some((row) => row.length !== rows[0].length)) return
  const widths = rows[0].map((key) => key.width)
  if (!equal(widths)) return
  if (!rows.every((row) => row.every((key, index) => Math.abs(key.width - widths[index]) <= TOLERANCE))) return
  const heights = rows.map((row) => row[0].height)
  if (!equal(heights)) return
  if (!rows.every((row) => row.every((key) => Math.abs(key.height - heights[0]) <= TOLERANCE))) return
  const xs = rows[0].map((key) => key.x)
  if (!rows.every((row) => row.every((key, index) => Math.abs(key.x - xs[index]) <= TOLERANCE))) return
  const ys = rows.map((row) => row[0].y)
  if (!rows.every((row, index) => row.every((key) => Math.abs(key.y - ys[index]) <= TOLERANCE))) return
  const gapX = median(rows[0].slice(1).map((key, index) => key.x - (rows[0][index].x + rows[0][index].width)))
  const gapY = median(rows.slice(1).map((row, index) => row[0].y - (rows[index][0].y + rows[index][0].height)))
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gapX * (widths.length - 1)
  const totalHeight = heights.reduce((sum, height) => sum + height, 0) + gapY * (heights.length - 1)
  if (Math.abs(keys[0].x) > TOLERANCE || Math.abs(keys[0].y) > TOLERANCE) return
  if (Math.abs(totalWidth - size.width) > TOLERANCE || Math.abs(totalHeight - size.height) > TOLERANCE) return
  return {
    id,
    style: {
      display: Display.Grid,
      gridTemplateColumns: widths.map((width) => ({ min: width, max: width })),
      gap: { width: gapX, height: gapY },
      size: { width: size.width, height: size.height },
    },
    children: rows.flatMap((row) => row.map(leaf)),
  }
}

/** 一组键在给定方向上的间距；不一致时返回 undefined。 */
function gapAlong(keys: readonly KeyRect[], direction: "row" | "column"): number | undefined {
  if (keys.length < 2) return 0
  const gaps = direction === "row"
    ? keys.slice(1).map((key, index) => key.x - (keys[index].x + keys[index].width))
    : keys.slice(1).map((key, index) => key.y - (keys[index].y + keys[index].height))
  return equal(gaps) ? median(gaps) : undefined
}

function flexContainer(
  id: string,
  keys: readonly KeyRect[],
  direction: "row" | "column",
  children: LayoutNode[],
  gap: number,
): LayoutNode {
  const start = direction === "row" ? Math.min(...keys.map((key) => key.x)) : Math.min(...keys.map((key) => key.y))
  const end = direction === "row" ? Math.max(...keys.map((key) => key.x + key.width)) : Math.max(...keys.map((key) => key.y + key.height))
  const crossStart = direction === "row" ? Math.min(...keys.map((key) => key.y)) : Math.min(...keys.map((key) => key.x))
  const crossEnd = direction === "row" ? Math.max(...keys.map((key) => key.y + key.height)) : Math.max(...keys.map((key) => key.x + key.width))
  const style: StylePropertyValues = {
    display: Display.Flex,
    flexDirection: direction === "row" ? FlexDirection.Row : FlexDirection.Column,
    alignItems: AlignItems.Start,
    size: direction === "row"
      ? { width: end - Math.min(start, crossStart), height: crossEnd - crossStart }
      : { width: crossEnd - crossStart, height: end - Math.min(start, crossStart) },
    ...(gap ? { gap: direction === "row" ? { width: gap, height: 0 } : { width: 0, height: gap } } : {}),
    ...(start || crossStart
      ? { padding: direction === "row"
        ? { left: start, top: crossStart, right: 0, bottom: 0 }
        : { left: crossStart, top: start, right: 0, bottom: 0 } }
      : {}),
  }
  return { id, style, children }
}

/** 递归推导一组按键；无法用布局精确表达时返回 undefined。 */
function groupCandidate(id: string, keys: readonly KeyRect[], size: Size, depth: number): LayoutNode | undefined {
  if (depth > MAX_DEPTH) return
  if (keys.length === 1) return leaf(keys[0])
  const grid = gridCandidate(id, keys, size)
  if (grid) return grid
  for (const axis of ["y", "x"] as const) {
    const direction = axis === "y" ? "column" : "row"
    const layers = groupsAlong(keys, axis)
    if (layers.length < 2) continue
    const children = layers.map((layer, index) => groupCandidate(`${id}:${direction}${index}`, layer, size, depth + 1))
    if (!children.every((child): child is LayoutNode => child !== undefined)) continue
    const layerGaps = layers.slice(1).map((layer, index) => direction === "column"
      ? layer[0].y - (layers[index][0].y + layers[index][0].height)
      : layer[0].x - (layers[index][0].x + layers[index][0].width))
    if (!equal(layerGaps)) continue
    return flexContainer(id, keys, direction, children, median(layerGaps))
  }
  // 单层：按投影判断主轴方向。
  const direction = keys.every((key) => overlap(key, keys[0], "y")) ? "row" : keys.every((key) => overlap(key, keys[0], "x")) ? "column" : undefined
  if (!direction) return
  const sorted = [...keys].sort((left, right) => direction === "row" ? left.x - right.x : left.y - right.y)
  const gap = gapAlong(sorted, direction)
  if (gap === undefined) return
  return flexContainer(id, sorted, direction, sorted.map(leaf), gap)
}

function rectMatches(actual: LayoutRect | undefined, expected: KeyRect): boolean {
  return actual !== undefined
    && Math.abs(actual.x - expected.x) <= TOLERANCE
    && Math.abs(actual.y - expected.y) <= TOLERANCE
    && Math.abs(actual.width - expected.width) <= TOLERANCE
    && Math.abs(actual.height - expected.height) <= TOLERANCE
}

/** 把按键矩形推导成布局树；候选先经 taffy 计算验证，失败就保持绝对矩形。 */
export async function deriveBoardLayout(id: string, keys: readonly KeyRect[], size: Size): Promise<LayoutNode> {
  if (!keys.length) return absoluteBoard([])
  const candidate = groupCandidate(id, keys, size, 0)
  if (!candidate) return absoluteBoard(keys)
  try {
    const layout = await computeLayout(candidate, size)
    if (keys.every((key) => rectMatches(layout.get(key.id), key))) return candidate
  } catch {
    // 候选无法计算或与输入不一致时回退。
  }
  return absoluteBoard(keys)
}
