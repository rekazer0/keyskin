// 池式布局推导（worklist）：键先进池，按"网格归约 → 行合并 → 列合并 → 残差"四个阶段
// 反复从池中取出可合并的子集，合并后放回，直到池只剩一个根。
//
// 入参是每个键在 taffy 里的已计算布局（position + size），出参是 taffy 样式树；
// 全流程不另建矩形结构。合并不可逆，每阶段池内元素数单调下降。
import { AlignItems, Display, FlexDirection, Position } from "taffy-layout"
import type { Size, StylePropertyValues } from "taffy-layout"
import { absoluteBoard, computeLayout, type LayoutBox, type LayoutNode } from "@/skin-model/layout.ts"
import { layoutCost } from "./cost.ts"
import { resolveDeriveOptions, type DeriveOptions, type DeriveOverrides } from "./options.ts"

export type DeriveKind = "grid" | "flex-row" | "flex-column" | "relative" | "absolute"

export type DeriveResult = {
  layout: LayoutNode
  kind: DeriveKind
  cost: number
  /** 没被任何行列或网格吸收、只能绝对定位的键；导入时据此说明损失。 */
  residual: string[]
}

/** 键的标识加上它在板上的已计算布局。 */
type KeyBox = { id: string } & LayoutBox

/** 池中的一项：单个键，或已合并的组（布局相对自身原点构造）。 */
type PoolItem = {
  id: string
  kind: "key" | "row" | "column" | "grid" | "residual"
  keys: KeyBox[]
  bounds: LayoutBox
  layout: LayoutNode
}

/** 合并结果：新组，以及实际并入的项；未并入的项留在池里。 */
type GroupedItems = { group: PoolItem; used: PoolItem[] }

const xOf = (box: LayoutBox) => box.position.x
const yOf = (box: LayoutBox) => box.position.y
const widthOf = (box: LayoutBox) => box.size.width
const heightOf = (box: LayoutBox) => box.size.height
const rightOf = (box: LayoutBox) => box.position.x + box.size.width
const bottomOf = (box: LayoutBox) => box.position.y + box.size.height

function boxOf(x: number, y: number, width: number, height: number): LayoutBox {
  return { position: { x, y }, size: { width, height } }
}

function boundsOf(keys: readonly KeyBox[]): LayoutBox {
  const x = Math.min(...keys.map(xOf))
  const y = Math.min(...keys.map(yOf))
  return boxOf(
    x,
    y,
    Math.max(...keys.map(rightOf)) - x,
    Math.max(...keys.map(bottomOf)) - y,
  )
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

/** 一项在给定轴上与其他项的重叠个数。 */
function overlapCount(item: PoolItem, others: readonly PoolItem[], axis: "x" | "y", tolerance: number): number {
  const start = (value: PoolItem) => axis === "x" ? xOf(value.bounds) : yOf(value.bounds)
  const end = (value: PoolItem) => axis === "x" ? rightOf(value.bounds) : bottomOf(value.bounds)
  return others.filter((other) => start(other) < end(item) - tolerance && start(item) < end(other) - tolerance).length
}

/**
 * 取最大不重叠子集：反复移除与其他项重叠最多的项（面积大者优先），
 * 覆盖整行的背景键因此被留下，而不是把整行的键挤掉。
 */
function withoutOverlap(sorted: readonly PoolItem[], axis: "x" | "y", tolerance: number): PoolItem[] {
  let chosen = [...sorted]
  while (chosen.length >= 2) {
    let worst = 0
    let worstIndex = -1
    let worstArea = 0
    for (const [index, item] of chosen.entries()) {
      const count = overlapCount(item, chosen.filter((other) => other !== item), axis, tolerance)
      const area = widthOf(item.bounds) * heightOf(item.bounds)
      if (count > worst || (count === worst && count > 0 && area > worstArea)) {
        worst = count
        worstIndex = index
        worstArea = area
      }
    }
    if (worst === 0) return chosen
    chosen = chosen.filter((_, index) => index !== worstIndex)
  }
  return chosen
}

function itemOf(key: KeyBox): PoolItem {
  return {
    id: key.id,
    kind: "key",
    keys: [key],
    bounds: key,
    layout: { id: key.id, style: { size: key.size } },
  }
}

/**
 * 行合并：先按 y 起点分成行带，只在同一行带内合并（跨行键因此不会把别行拖下水）；
 * 与已选项重叠的键留在池里，其余按间隙用 gap 或 margin-left。
 */
function rowGroup(id: string, items: readonly PoolItem[], tolerance: number): GroupedItems | undefined {
  let best: PoolItem[] | undefined
  for (const band of bandsOf(items, "y", tolerance)) {
    if (band.items.length < 2) continue
    const used = withoutOverlap(band.items, "x", tolerance)
    if (used.length < 2) continue
    if (!best || used.length > best.length) best = used
  }
  if (!best) return
  const used = [...best].sort((left, right) => xOf(left.bounds) - xOf(right.bounds))
  const gaps = used.slice(1).map((item, index) => xOf(item.bounds) - rightOf(used[index].bounds))
  const uniform = allNear(gaps, tolerance)
  const keys = used.flatMap((item) => item.keys)
  const bounds = boundsOf(keys)
  const height = Math.max(...used.map((item) => heightOf(item.bounds)))
  const children = used.map((item, index) => {
    const margin = !uniform && index > 0 ? { left: gaps[index - 1], right: 0, top: 0, bottom: 0 } : undefined
    return { ...item.layout, style: { ...item.layout.style, flexShrink: 0, ...(margin ? { margin } : {}) } }
  })
  const gap = median(gaps)
  const style: StylePropertyValues = {
    display: Display.Flex,
    flexDirection: FlexDirection.Row,
    alignItems: AlignItems.Start,
    size: { width: widthOf(bounds), height },
    ...(uniform && Math.abs(gap) > tolerance / 2 ? { gap: { width: gap, height: 0 } } : {}),
  }
  return { group: { id, kind: "row", keys, bounds, layout: { id, style, children } }, used }
}

/**
 * 列合并：候选是横向区间互相重叠的项（上下堆叠关系）；纵向重叠的项留在池里。
 * 纵向间隙一致时用 gap，不均匀时用 margin-top，横向差异用 margin-left。
 */
function columnGroup(id: string, items: readonly PoolItem[], tolerance: number): GroupedItems | undefined {
  let best: PoolItem[] | undefined
  for (const cluster of overlapClusters(items, "x")) {
    if (cluster.length < 2) continue
    const used = withoutOverlap(cluster, "y", tolerance)
    if (used.length < 2) continue
    if (!best || used.length > best.length) best = used
  }
  if (!best) return
  const used = [...best].sort((left, right) => yOf(left.bounds) - yOf(right.bounds))
  const gaps = used.slice(1).map((item, index) => yOf(item.bounds) - bottomOf(used[index].bounds))
  const uniform = allNear(gaps, tolerance)
  const keys = used.flatMap((item) => item.keys)
  const bounds = boundsOf(keys)
  const children = used.map((item, index) => {
    const left = xOf(item.bounds) - xOf(bounds)
    const top = !uniform && index > 0 ? gaps[index - 1] : 0
    return {
      ...item.layout,
      style: {
        ...item.layout.style,
        flexShrink: 0,
        ...(near(left, 0, tolerance) && near(top, 0, tolerance) ? {} : { margin: { left, right: 0, top, bottom: 0 } }),
      },
    }
  })
  const gap = median(gaps)
  const style: StylePropertyValues = {
    display: Display.Flex,
    flexDirection: FlexDirection.Column,
    alignItems: AlignItems.Start,
    size: { width: widthOf(bounds), height: heightOf(bounds) },
    ...(uniform && Math.abs(gap) > tolerance / 2 ? { gap: { width: 0, height: gap } } : {}),
  }
  return { group: { id, kind: "column", keys, bounds, layout: { id, style, children } }, used }
}

/** 按轴的起点把项聚成带（行或列）。 */
function bandsOf(items: readonly PoolItem[], axis: "x" | "y", tolerance: number): Array<{ start: number; items: PoolItem[] }> {
  const startOf = (item: PoolItem) => axis === "x" ? xOf(item.bounds) : yOf(item.bounds)
  const sorted = [...items].sort((left, right) => startOf(left) - startOf(right))
  const bands: Array<{ start: number; items: PoolItem[] }> = []
  for (const item of sorted) {
    const band = bands.find((candidate) => near(candidate.start, startOf(item), tolerance))
    if (band) band.items.push(item)
    else bands.push({ start: startOf(item), items: [item] })
  }
  return bands.sort((left, right) => left.start - right.start)
}

/** 一项在网格里跨越的轨道数与起始轨道。 */
function placementOf(
  item: PoolItem,
  bands: ReadonlyArray<{ start: number }>,
  tracks: readonly number[],
  gap: number,
  axis: "x" | "y",
  tolerance: number,
): { index: number; span: number } | undefined {
  const start = axis === "x" ? xOf(item.bounds) : yOf(item.bounds)
  const extent = axis === "x" ? widthOf(item.bounds) : heightOf(item.bounds)
  const index = bands.findIndex((band) => near(band.start, start, tolerance))
  if (index < 0) return
  let span = 1
  let covered = tracks[index]
  while (covered < extent - tolerance && index + span < bands.length) {
    covered += gap + tracks[index + span]
    span++
  }
  return Math.abs(covered - extent) <= tolerance ? { index, span } : undefined
}

/**
 * 网格归约：行列带交叉，键可按 range 跨行跨列。
 * 轨道尺寸取带内中位尺寸；带宽、间隙与总尺寸必须与键区一致，否则交给后续阶段。
 */
function gridGroup(id: string, items: readonly PoolItem[], size: Size<number>, tolerance: number): PoolItem | undefined {
  if (items.length < 4) return
  const rows = bandsOf(items, "y", tolerance)
  const columns = bandsOf(items, "x", tolerance)
  if (rows.length < 2 || columns.length < 2) return
  const rowTracks = rows.map((row) => median(row.items.map((item) => heightOf(item.bounds))))
  const columnTracks = columns.map((column) => median(column.items.map((item) => widthOf(item.bounds))))
  const gapY = median(rows.slice(1).map((row, index) => row.start - (rows[index].start + rowTracks[index])))
  const gapX = median(columns.slice(1).map((column, index) => column.start - (columns[index].start + columnTracks[index])))
  if (gapX < -tolerance || gapY < -tolerance) return
  const bounds = boundsOf(items.flatMap((item) => item.keys))
  if (widthOf(bounds) > size.width + tolerance || heightOf(bounds) > size.height + tolerance) return
  const totalWidth = columnTracks.reduce((sum, track) => sum + track, 0) + gapX * (columnTracks.length - 1)
  const totalHeight = rowTracks.reduce((sum, track) => sum + track, 0) + gapY * (rowTracks.length - 1)
  if (!near(totalWidth, widthOf(bounds), tolerance) || !near(totalHeight, heightOf(bounds), tolerance)) return
  const occupied = new Set<string>()
  const children: LayoutNode[] = []
  for (const item of items) {
    const row = placementOf(item, rows, rowTracks, gapY, "y", tolerance)
    const column = placementOf(item, columns, columnTracks, gapX, "x", tolerance)
    if (!row || !column) return
    for (let r = row.index; r < row.index + row.span; r++) {
      for (let c = column.index; c < column.index + column.span; c++) {
        const cell = `${r},${c}`
        if (occupied.has(cell)) return
        occupied.add(cell)
      }
    }
    children.push({
      ...item.layout,
      style: {
        ...item.layout.style,
        flexShrink: 0,
        gridRow: { start: row.index + 1, end: { span: row.span } },
        gridColumn: { start: column.index + 1, end: { span: column.span } },
      },
    })
  }
  const style: StylePropertyValues = {
    display: Display.Grid,
    gridTemplateColumns: columnTracks.map((track) => ({ min: track, max: track })),
    gridTemplateRows: rowTracks.map((track) => ({ min: track, max: track })),
    gap: { width: gapX, height: gapY },
    size: { width: totalWidth, height: totalHeight },
  }
  return {
    id,
    kind: "grid",
    keys: items.flatMap((item) => item.keys),
    bounds,
    layout: { id, style, children },
  }
}

/** 残差：剩余项收进一个铺满板的相对容器，子项按板坐标绝对定位。 */
function residualGroup(id: string, items: readonly PoolItem[], size: Size<number>): PoolItem {
  const keys = items.flatMap((item) => item.keys)
  const bounds = boundsOf(keys)
  const children: LayoutNode[] = items.map((item) => ({
    ...item.layout,
    style: {
      ...item.layout.style,
      position: Position.Absolute,
      inset: { left: xOf(item.bounds), top: yOf(item.bounds), right: "auto", bottom: "auto" },
    },
  }))
  const style: StylePropertyValues = {
    position: Position.Relative,
    display: Display.Block,
    size: { width: size.width, height: size.height },
  }
  return { id, kind: "residual", keys, bounds, layout: { id, style, children } }
}

/** 面积达到这个比例的键视为整板背景，不参与排布推导。 */
const BACKGROUND_AREA_RATIO = 0.8

function isBackground(key: KeyBox, size: Size<number>): boolean {
  return widthOf(key) * heightOf(key) >= size.width * size.height * BACKGROUND_AREA_RATIO
}

/** 背景键与剩余结构合成一根：背景绝对定位，其余结构整体绝对定位在原位。 */
function backgroundContainer(
  id: string,
  background: readonly KeyBox[],
  rest: { layout: LayoutNode; keys: readonly KeyBox[] } | undefined,
  size: Size<number>,
): LayoutNode {
  const children: LayoutNode[] = background.map((key) => ({
    id: key.id,
    style: {
      position: Position.Absolute,
      inset: { left: xOf(key), top: yOf(key), right: "auto", bottom: "auto" },
      size: key.size,
    },
  }))
  if (rest?.keys.length) {
    const bounds = boundsOf(rest.keys)
    children.push({
      ...rest.layout,
      style: {
        ...rest.layout.style,
        position: Position.Absolute,
        inset: { left: xOf(bounds), top: yOf(bounds), right: "auto", bottom: "auto" },
      },
    })
  }
  return {
    id,
    style: { position: Position.Relative, display: Display.Block, size: { width: size.width, height: size.height } },
    children,
  }
}

function boxMatches(actual: LayoutBox | undefined, expected: KeyBox, tolerance: number): boolean {
  return actual !== undefined
    && near(xOf(actual), xOf(expected), tolerance)
    && near(yOf(actual), yOf(expected), tolerance)
    && near(widthOf(actual), widthOf(expected), tolerance)
    && near(heightOf(actual), heightOf(expected), tolerance)
}

async function verifies(layout: LayoutNode, keys: readonly KeyBox[], size: Size<number>, tolerance: number): Promise<boolean> {
  try {
    const computed = await computeLayout(layout, size)
    return keys.every((key) => boxMatches(computed.get(key.id), key, tolerance))
  } catch {
    return false
  }
}

/** 按一个轴上的区间重叠聚类：返回彼此不重叠的簇。 */
function overlapClusters(items: readonly PoolItem[], axis: "x" | "y"): PoolItem[][] {
  const start = (item: PoolItem) => axis === "x" ? xOf(item.bounds) : yOf(item.bounds)
  const end = (item: PoolItem) => axis === "x" ? rightOf(item.bounds) : bottomOf(item.bounds)
  const sorted = [...items].sort((left, right) => start(left) - start(right))
  const clusters: Array<{ from: number; to: number; items: PoolItem[] }> = []
  for (const item of sorted) {
    const cluster = clusters.find((candidate) => start(item) < candidate.to && candidate.from < end(item))
    if (cluster) {
      cluster.items.push(item)
      cluster.from = Math.min(cluster.from, start(item))
      cluster.to = Math.max(cluster.to, end(item))
    } else {
      clusters.push({ from: start(item), to: end(item), items: [item] })
    }
  }
  return clusters.map((cluster) => cluster.items)
}

/** 在池里反复合并，直到某个阶段不再产生新组。 */
function mergePhase(
  pool: readonly PoolItem[],
  tolerance: number,
  id: string,
  group: (id: string, items: PoolItem[], tolerance: number) => GroupedItems | undefined,
  counter: { value: number },
): PoolItem[] {
  let current = [...pool]
  while (true) {
    const created = group(`${id}:${counter.value}`, current, tolerance)
    if (!created) return current
    counter.value++
    current = [...current.filter((item) => !created.used.includes(item)), created.group]
  }
}

/** 池式推导主流程。 */
export async function derivePool(
  id: string,
  keys: readonly KeyBox[],
  size: Size<number>,
  overrides?: DeriveOverrides,
): Promise<DeriveResult> {
  const options: DeriveOptions = resolveDeriveOptions(overrides)
  const tolerance = Math.max(0, options.tolerance)
  if (!keys.length) return { layout: absoluteBoard([]), kind: "absolute", cost: 0, residual: [] }

  // 整板背景键是背景层，不参与排布；先分离，再做池式合并。
  const background = keys.filter((key) => isBackground(key, size))
  if (background.length) {
    const rest = keys.filter((key) => !isBackground(key, size))
    const derived = rest.length ? await derivePool(id, rest, size, overrides) : undefined
    const root = backgroundContainer(id, background, derived ? { layout: derived.layout, keys: rest } : undefined, size)
    if (await verifies(root, keys, size, tolerance)) {
      return {
        layout: root,
        kind: derived && derived.kind !== "absolute" ? derived.kind : "relative",
        cost: layoutCost(root, options.weights),
        residual: derived?.residual ?? [],
      }
    }
  }

  let pool: PoolItem[] = keys.map(itemOf)
  const counter = { value: 0 }
  // 每个阶段结束后留一份快照；验证失败时逐级降级，而不是整树回退。
  const snapshots: PoolItem[][] = []

  // 阶段一：网格归约。
  const grid = gridGroup(`${id}:grid`, pool, size, tolerance)
  if (grid) pool = [grid]
  snapshots.push(pool)

  // 阶段二：行合并。
  if (pool.length > 1) {
    pool = mergePhase(pool, tolerance, `${id}:row`, rowGroup, counter)
    snapshots.push(pool)
  }

  // 阶段三：列合并。
  if (pool.length > 1) {
    pool = mergePhase(pool, tolerance, `${id}:column`, columnGroup, counter)
    snapshots.push(pool)
  }

  for (let index = snapshots.length - 1; index >= 0; index--) {
    const snapshot = snapshots[index]
    const root = rootOf(snapshot, id, size, tolerance)
    if (!await verifies(root, keys, size, tolerance)) continue
    return {
      layout: root,
      kind: kindOf(snapshot),
      cost: layoutCost(root, options.weights),
      residual: residualOf(snapshot),
    }
  }
  const fallback = absoluteBoard(keys)
  return {
    layout: fallback,
    kind: "absolute",
    cost: layoutCost(fallback, options.weights),
    residual: keys.map((key) => key.id),
  }
}

/** 池里仍是单键的项，就是没有被行列或网格吸收的键。 */
function residualOf(pool: readonly PoolItem[]): string[] {
  return pool.filter((item) => item.kind === "key").flatMap((item) => item.keys.map((key) => key.id))
}

/** 一根：单组用铺满板的框加 padding 表达整体偏移，多组收进残差容器。 */
function rootOf(pool: readonly PoolItem[], id: string, size: Size<number>, tolerance: number): LayoutNode {
  if (pool.length !== 1) return residualGroup(`${id}:residual`, pool, size).layout
  const only = pool[0]
  if (near(xOf(only.bounds), 0, tolerance) && near(yOf(only.bounds), 0, tolerance)) return only.layout
  return {
    id: `${id}:frame`,
    style: {
      display: Display.Block,
      size: { width: size.width, height: size.height },
      padding: { left: xOf(only.bounds), top: yOf(only.bounds), right: 0, bottom: 0 },
    },
    children: [only.layout],
  }
}

function kindOf(pool: readonly PoolItem[]): DeriveKind {
  if (pool.length !== 1) return "relative"
  return pool[0].kind === "grid" ? "grid"
    : pool[0].kind === "column" ? "flex-column"
      : pool[0].kind === "row" ? "flex-row"
        : "relative"
}
