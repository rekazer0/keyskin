// 搜狗键盘的结构：皮肤包里没有坐标，几何在客户端骨架里（`public/sogou-template.bds`）。
//
// 读取时骨架给出两样东西：容器尺寸（`[PANEL] SIZE`）与每个键的矩形。矩形不写进模型——
// IR 的几何只有布局树这一处表达。这里从键的相邻关系推出结构：同一 y 的键是一行，
// 行内宽度比例决定 flex 增长，行内间距决定偏移。树里只出现相对量，没有按键坐标。
import { Display, FlexDirection } from "taffy-layout"
import type { LayoutBoard, LayoutNode } from "@/skin-model/layout.ts"
import type { Size } from "taffy-layout"

/** 骨架里的一个键：段名、动作与它占的矩形（矩形只用于推结构，不进模型）。 */
export type SkeletonKey = {
  /** 皮肤里的段名（`SSF_SECTION`）；没有时退回 `KEYn`。 */
  id: string
  /** 骨架自带的按键类，皮肤用它决定读到哪一段。 */
  section?: string
  /** 客户端的默认动作（`CENTER`）。 */
  action: string
  /** 骨架为这个键指定的背景/前景类。 */
  background?: string
  foreground?: string
  rect: { x: number; y: number; width: number; height: number }
}

export type SkeletonLayout = {
  container: Size<number>
  keys: SkeletonKey[]
  /** 布局树的容器节点 id；板本身的 id 由调用方决定。 */
  board: LayoutBoard
}

/** 同一行的判定容差：骨架的行内键 y 相同，个别布局有 1px 抖动。 */
const ROW_TOLERANCE = 2

type Row = { y: number; height: number; keys: SkeletonKey[] }

function median(values: readonly number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** 按键按 y 聚成行，行内按 x 排序。y 相同的键在客户端就是一行。 */
function rowsOf(keys: readonly SkeletonKey[]): Row[] {
  const rows: Row[] = []
  for (const key of [...keys].sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x)) {
    const row = rows.find((each) => Math.abs(each.y - key.rect.y) <= ROW_TOLERANCE)
    if (row) {
      row.keys.push(key)
      row.height = Math.max(row.height, key.rect.height)
    } else {
      rows.push({ y: key.rect.y, height: key.rect.height, keys: [key] })
    }
  }
  for (const row of rows) row.keys.sort((left, right) => left.rect.x - right.rect.x)
  return rows.sort((left, right) => left.y - right.y)
}

/**
 * 从骨架矩形推出一棵 flex 树。
 *
 * 根是纵向的行栈：行高按比例分配（`flexGrow`），行间距用 `gap`，上下留白用 `padding`。
 * 每行是横向的键行：键宽按比例分配（`flexGrow`），键间距用 `marginLeft`，
 * 行右留白用 `paddingRight`。所有值都是骨架里的相对关系，容器换成别的宽度时按比例缩放。
 */
export function flexBoardOf(keys: readonly SkeletonKey[], container: Size<number>): LayoutBoard {
  const rows = rowsOf(keys)
  const rowGaps = rows.slice(1).map((row, index) => row.y - (rows[index].y + rows[index].height))
  const rowGap = Math.round(median(rowGaps))
  const last = rows[rows.length - 1]
  const top = rows[0]?.y ?? 0
  const bottom = last ? container.height - (last.y + last.height) : 0
  const children: LayoutNode[] = rows.map((row, index) => {
    const lastKey = row.keys[row.keys.length - 1]
    return {
      id: rowNodeId(index),
      style: {
        display: Display.Flex,
        flexDirection: FlexDirection.Row,
        flexGrow: row.height,
        padding: { left: 0, right: container.width - (lastKey.rect.x + lastKey.rect.width), top: 0, bottom: 0 },
      },
      children: row.keys.map((key, keyIndex) => {
        const previous = row.keys[keyIndex - 1]
        const marginLeft = previous ? key.rect.x - (previous.rect.x + previous.rect.width) : key.rect.x
        return { id: key.id, style: { flexGrow: key.rect.width, height: "100%" as const, marginLeft } }
      }),
    }
  })
  return {
    id: "",
    style: {
      display: Display.Flex,
      flexDirection: FlexDirection.Column,
      size: { width: "100%", height: "100%" },
      padding: { left: 0, right: 0, top, bottom },
      gap: { width: 0, height: rowGap },
    },
    children,
  }
}

/** 行节点 id 与键 id 同处一棵树，前缀保证不会撞名。 */
export function rowNodeId(index: number): string {
  return `row:${index}`
}

/**
 * 推出的树能不能还原骨架矩形。
 *
 * 少数布局（`py_9_big_enter` 的大回车跨两行）不是纯行结构，flex 行会算出不同高度；
 * 这里如实返回误差，由读取方记录，不修改树去凑数。
 */
export function layoutFit(
  rects: Map<string, { position: { x: number; y: number }; size: { width: number; height: number } }>,
  keys: readonly SkeletonKey[],
): { exact: boolean; maxError: number } {
  let maxError = 0
  for (const key of keys) {
    const rect = rects.get(key.id)
    if (!rect) {
      maxError = Number.POSITIVE_INFINITY
      continue
    }
    maxError = Math.max(
      maxError,
      Math.abs(rect.position.x - key.rect.x),
      Math.abs(rect.position.y - key.rect.y),
      Math.abs(rect.size.width - key.rect.width),
      Math.abs(rect.size.height - key.rect.height),
    )
  }
  return { exact: maxError <= 1, maxError }
}
