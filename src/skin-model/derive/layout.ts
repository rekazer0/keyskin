// 布局推导：把按键矩形推导成 taffy 布局树。
//
// 先尝试网格（等列宽、等行高、等间距）；不行再按行容器（flex column + 每行 flex row）；
// 都不满足时保持绝对矩形。推导只用 taffy 的属性对象，不引入中间布局类型。
import { AlignItems, Display, FlexDirection } from "taffy-layout"
import type { StylePropertyValues } from "taffy-layout"
import { absoluteBoard, type LayoutNode } from "../layout.ts"
import type { Rect, Size } from "../types.ts"

type KeyRect = { id: string } & Rect

const TOLERANCE = 1

function rowsOf(keys: readonly KeyRect[]): KeyRect[][] {
  const sorted = [...keys].sort((left, right) => left.y - right.y || left.x - right.x)
  const rows: Array<{ y: number; items: KeyRect[] }> = []
  for (const key of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate.y - key.y) <= TOLERANCE)
    if (row) row.items.push(key)
    else rows.push({ y: key.y, items: [key] })
  }
  return rows.map((row) => row.items.sort((left, right) => left.x - right.x))
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

/** 网格推导：列宽、行高、列位、间距跨行一致，且总尺寸与板一致。 */
function gridLayout(id: string, rows: readonly KeyRect[][], size: Size): LayoutNode | undefined {
  const columns = rows[0].length
  if (!columns || rows.some((row) => row.length !== columns)) return
  const first = rows[0]
  const widths = first.map((key) => key.width)
  if (!equal(widths)) return
  if (!rows.every((row) => row.every((key, index) => Math.abs(key.width - widths[index]) <= TOLERANCE))) return
  const heights = rows.map((row) => row[0].height)
  if (!equal(heights)) return
  if (!rows.every((row) => row.every((key) => Math.abs(key.height - heights[0]) <= TOLERANCE))) return
  const xs = first.map((key) => key.x)
  if (!rows.every((row) => row.every((key, index) => Math.abs(key.x - xs[index]) <= TOLERANCE))) return
  const ys = rows.map((row) => row[0].y)
  for (const [rowIndex, row] of rows.entries()) {
    if (row.some((key) => Math.abs(key.y - ys[rowIndex]) > TOLERANCE)) return
  }
  const gapX = median(first.slice(1).map((key, index) => key.x - (first[index].x + first[index].width)))
  const gapY = median(rows.slice(1).map((row, index) => row[0].y - (rows[index][0].y + rows[index][0].height)))
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gapX * (columns - 1)
  const totalHeight = heights.reduce((sum, height) => sum + height, 0) + gapY * (rows.length - 1)
  if (Math.abs(first[0].x) > TOLERANCE || Math.abs(rows[0][0].y) > TOLERANCE) return
  if (Math.abs(totalWidth - size.width) > TOLERANCE || Math.abs(totalHeight - size.height) > TOLERANCE) return
  const style: StylePropertyValues = {
    display: Display.Grid,
    gridTemplateColumns: widths.map((width) => ({ min: width, max: width })),
    gap: { width: gapX, height: gapY },
    size: { width: size.width, height: size.height },
  }
  return {
    id,
    style,
    children: rows.flat().map((key) => ({ id: key.id, style: { size: { width: key.width, height: key.height } } })),
  }
}

/** 行容器推导：行内等间隙、行高与行间距一致。 */
function rowLayout(id: string, rows: readonly KeyRect[][], size: Size): LayoutNode | undefined {
  const heights = rows.map((row) => row[0].height)
  if (!equal(heights)) return
  if (!rows.every((row) => row.every((key) => Math.abs(key.height - heights[0]) <= TOLERANCE))) return
  const gaps = rows.map((row) => median(row.slice(1).map((key, index) => key.x - (row[index].x + row[index].width))))
  if (!equal(gaps)) return
  const starts = rows.map((row) => row[0].x)
  const totalHeight = heights.reduce((sum, height) => sum + height, 0) + median(rows.slice(1).map((row, index) => row[0].y - (rows[index][0].y + rows[index][0].height))) * (rows.length - 1)
  if (Math.abs(totalHeight - size.height) > TOLERANCE) return
  const gap = gaps[0]
  const children: LayoutNode[] = rows.map((row, index) => {
    const start = starts[index]
    const width = row.reduce((sum, key) => sum + key.width, 0) + gap * (row.length - 1)
    return {
      id: `${id}:row${index}`,
      style: {
        display: Display.Flex,
        flexDirection: FlexDirection.Row,
        alignItems: AlignItems.Start,
        gap: { width: gap, height: 0 },
        ...(start ? { padding: { left: start, top: 0, right: 0, bottom: 0 } } : {}),
        size: { width: start + width, height: row[0].height },
      },
      children: row.map((key) => ({ id: key.id, style: { size: { width: key.width, height: key.height } } })),
    }
  })
  return {
    id,
    style: {
      display: Display.Flex,
      flexDirection: FlexDirection.Column,
      alignItems: AlignItems.Start,
      gap: { width: 0, height: median(rows.slice(1).map((row, index) => row[0].y - (rows[index][0].y + rows[index][0].height))) },
      size: { width: size.width, height: size.height },
    },
    children,
  }
}

/** 把按键矩形推导成布局树；推导不了就保持绝对矩形。 */
export function deriveBoardLayout(id: string, keys: readonly KeyRect[], size: Size): LayoutNode {
  if (!keys.length) return absoluteBoard([])
  const rows = rowsOf(keys)
  return gridLayout(id, rows, size) ?? rowLayout(id, rows, size) ?? absoluteBoard(keys)
}
