// 模型差异：比较两份模型，给出增删改的清单。
//
// 撤销栈现在存的是文件内容快照。模型化之后可以直接比较模型，得到「改了什么」，
// 用于改动标记、AI 设计预览与更细的撤销粒度。
import type { SkinBoard } from "./board.ts"
import type { SkinKey } from "./key.ts"
import type { SkinModel } from "./model.ts"
import type { SkinStyle } from "./style.ts"
import type { SkinMotion } from "./motion.ts"

/** 一类对象的差异：新增、删除、改动。 */
export type DiffSet = {
  added: string[]
  removed: string[]
  changed: string[]
}

function empty(): DiffSet {
  return { added: [], removed: [], changed: [] }
}

function isEmpty(set: DiffSet): boolean {
  return !set.added.length && !set.removed.length && !set.changed.length
}

/** 按键的可比较投影：几何、动作码与样式引用。 */
function keySignature(key: SkinKey): string {
  return JSON.stringify({
    rect: key.rect,
    touchRect: key.touchRect ?? null,
    padding: key.padding ?? null,
    actions: key.actions,
    style: key.style,
    motions: key.motions ?? null,
    sound: key.sound ?? null,
    label: key.label ?? null,
    overrides: key.overrides ?? null,
  })
}

/** 板自身的属性；按键单独比较，否则动一个键就会把整块板算成改动。 */
function boardSignature(board: SkinBoard): string {
  return JSON.stringify({
    kind: board.kind,
    geometry: board.geometry,
    size: board.size,
    backdrop: board.backdrop ?? null,
    candidate: board.candidate ?? null,
    hint: board.hint ?? null,
    list: board.list ?? null,
    toolbar: board.toolbar ?? null,
    input: board.input ?? null,
  })
}

function styleSignature(style: SkinStyle): string {
  return JSON.stringify(style)
}

function motionSignature(motion: SkinMotion): string {
  return JSON.stringify({
    root: motion.root,
    timeline: motion.timeline,
    bindings: motion.bindings,
  })
}

/** 两个键相同的映射 → 差异；值用签名比较，避免大对象深层比较的开销。 */
function diffMap<K, V>(before: ReadonlyMap<K, V>, after: ReadonlyMap<K, V>, signature: (value: V) => string): DiffSet {
  const result = empty()
  for (const [key, value] of before) {
    const next = after.get(key)
    if (next === undefined) result.removed.push(String(key))
    else if (signature(value) !== signature(next)) result.changed.push(String(key))
  }
  for (const key of after.keys()) {
    if (!before.has(key)) result.added.push(String(key))
  }
  return result
}

/** 按 id 比较的列表（板）；板内的按键改动记在 `keys` 里。 */
function diffBoards(before: readonly SkinBoard[], after: readonly SkinBoard[]): { boards: DiffSet; keys: DiffSet } {
  const boards = empty()
  const keys = empty()
  const beforeById = new Map(before.map((board) => [board.id, board]))
  const afterById = new Map(after.map((board) => [board.id, board]))
  for (const [id, board] of beforeById) {
    const next = afterById.get(id)
    if (!next) {
      boards.removed.push(id)
      for (const key of board.keys) keys.removed.push(`${id}/${key.id}`)
      continue
    }
    if (boardSignature(board) !== boardSignature(next)) boards.changed.push(id)
    const nextKeys = new Map(next.keys.map((key) => [key.id, key]))
    for (const key of board.keys) {
      const updated = nextKeys.get(key.id)
      if (!updated) keys.removed.push(`${id}/${key.id}`)
      else if (keySignature(key) !== keySignature(updated)) keys.changed.push(`${id}/${key.id}`)
    }
    for (const key of next.keys) {
      if (!board.keys.some((item) => item.id === key.id)) keys.added.push(`${id}/${key.id}`)
    }
  }
  for (const id of afterById.keys()) {
    if (beforeById.has(id)) continue
    boards.added.push(id)
    for (const key of afterById.get(id)!.keys) keys.added.push(`${id}/${key.id}`)
  }
  return { boards, keys }
}

export type ModelDiff = {
  boards: DiffSet
  keys: DiffSet
  styles: DiffSet
  images: DiffSet
  motions: DiffSet
  sounds: DiffSet
  /** 元信息是否变了（名称、作者、版本、分辨率）。 */
  meta: boolean
}

/** 比较两份模型。 */
export function diffModels(before: SkinModel, after: SkinModel): ModelDiff {
  const boards = diffBoards(before.boards, after.boards)
  return {
    boards: boards.boards,
    keys: boards.keys,
    styles: diffMap(before.styles, after.styles, styleSignature),
    images: diffMap(before.images, after.images, (image) => `${image.width}x${image.height}`),
    motions: diffMap(before.motions, after.motions, motionSignature),
    sounds: diffMap(before.sounds, after.sounds, (sound) => JSON.stringify(sound)),
    meta: JSON.stringify(before.meta) !== JSON.stringify(after.meta),
  }
}

/** 差异是否为空：没有任何增删改。 */
export function isEmptyDiff(diff: ModelDiff): boolean {
  return !diff.meta
    && isEmpty(diff.boards)
    && isEmpty(diff.keys)
    && isEmpty(diff.styles)
    && isEmpty(diff.images)
    && isEmpty(diff.motions)
    && isEmpty(diff.sounds)
}

const LABELS: ReadonlyArray<[keyof ModelDiff, string]> = [
  ["boards", "板"],
  ["keys", "按键"],
  ["styles", "样式"],
  ["images", "图片"],
  ["motions", "动效"],
  ["sounds", "音效"],
]

/** 差异的一句话摘要，供状态栏与撤销条目使用。 */
export function describeDiff(diff: ModelDiff): string {
  if (isEmptyDiff(diff)) return "没有改动"
  const parts: string[] = []
  if (diff.meta) parts.push("皮肤信息")
  for (const [key, label] of LABELS) {
    const set = diff[key]
    if (typeof set === "boolean" || isEmpty(set)) continue
    const segments: string[] = []
    if (set.added.length) segments.push(`新增 ${set.added.length}`)
    if (set.removed.length) segments.push(`删除 ${set.removed.length}`)
    if (set.changed.length) segments.push(`修改 ${set.changed.length}`)
    if (segments.length) parts.push(`${label} ${segments.join("、")}`)
  }
  return parts.join("；")
}

/** 改动的对象总数，用于撤销条目的数量角标。 */
export function diffSize(diff: ModelDiff): number {
  let total = diff.meta ? 1 : 0
  for (const [key] of LABELS) {
    const set = diff[key]
    if (typeof set === "boolean") continue
    total += set.added.length + set.removed.length + set.changed.length
  }
  return total
}
