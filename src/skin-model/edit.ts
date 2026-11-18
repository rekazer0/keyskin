// 模型编辑：按键、样式、动作、板与资源的不可变更新。
//
// 编辑器最终要改模型而不是直接改 INI。这一层只做「输入旧模型与改动，输出新模型」，
// 不碰归档、不碰撤销栈，便于测试，也让每种格式共用同一套编辑语义。
import type { SkinBoard } from "./board.ts"
import type { SkinKey, KeyStyleRefs } from "./key.ts"
import type { SkinModel } from "./model.ts"
import type { SkinStyle } from "./style.ts"
import type { KeyEvent, SkinAction, SkinMeta } from "./types.ts"
import type { Rect } from "taffy-layout"
import { setNodeRect, type LayoutBox } from "./layout.ts"

/** 找不到目标时返回原模型，调用方据此判断是否真的有改动。 */
function unchanged(model: SkinModel): SkinModel {
  return model
}

function replaceBoard(model: SkinModel, boardId: string, next: SkinBoard): SkinModel {
  const index = model.boards.findIndex((board) => board.id === boardId)
  if (index < 0) return unchanged(model)
  const boards = model.boards.slice()
  boards[index] = next
  return { ...model, boards }
}

function replaceKey(board: SkinBoard, keyId: string, next: SkinKey): SkinBoard | undefined {
  const index = board.keys.findIndex((key) => key.id === keyId)
  if (index < 0) return
  const keys = board.keys.slice()
  keys[index] = next
  return { ...board, keys }
}

/** 找到按键与它所在的板；找不到返回 undefined。 */
export function findKey(model: SkinModel, boardId: string, keyId: string): { board: SkinBoard; key: SkinKey } | undefined {
  const board = model.boards.find((item) => item.id === boardId)
  const key = board?.keys.find((item) => item.id === keyId)
  return board && key ? { board, key } : undefined
}

export type KeyPatch = {
  rect?: LayoutBox
  touchRect?: LayoutBox | null
  /** 内边距；传 null 表示清掉。 */
  padding?: Rect<number> | null
  style?: Partial<KeyStyleRefs>
  actions?: Partial<Record<KeyEvent, SkinAction | null>>
}

/** 改一个按键；返回新模型，原模型不动。 */
export function patchKey(model: SkinModel, boardId: string, keyId: string, patch: KeyPatch): SkinModel {
  const found = findKey(model, boardId, keyId)
  if (!found) return unchanged(model)
  const { board, key } = found

  const actions: Partial<Record<KeyEvent, SkinAction>> = { ...key.actions }
  for (const [event, action] of Object.entries(patch.actions ?? {}) as Array<[KeyEvent, SkinAction | null]>) {
    if (action === null) delete actions[event]
    else actions[event] = action
  }

  const style: KeyStyleRefs = {
    ...key.style,
    ...(patch.style ?? {}),
    // 前景层是数组，整体替换而不是合并，避免残留旧层。
    ...(patch.style?.fore ? { fore: [...patch.style.fore] } : {}),
  }

  const next: SkinKey = {
    ...key,
    ...(patch.rect ? { rect: patch.rect } : {}),
    ...(patch.touchRect === null ? { touchRect: undefined } : patch.touchRect ? { touchRect: patch.touchRect } : {}),
    ...(patch.padding === null ? { padding: undefined } : patch.padding ? { padding: patch.padding } : {}),
    actions,
    style,
  }
  // 几何有两份：按键上的矩形与布局树里的节点。只改一份的话，写回时用的是旧节点算出的位置。
  const layout = patch.rect ? setNodeRect(board.layout, keyId, patch.rect) : board.layout
  const nextBoard = (() => {
    const replaced = replaceKey(board, keyId, next)
    return replaced ? { ...replaced, layout } : undefined
  })()
  return nextBoard ? replaceBoard(model, boardId, nextBoard) : unchanged(model)
}

/** 移动按键到新的矩形；布局树的节点随之更新，几何来源仍是文档。 */
export function moveKey(model: SkinModel, boardId: string, keyId: string, rect: LayoutBox): SkinModel {
  return patchKey(model, boardId, keyId, { rect })
}

/** 改按键的样式引用；传 null 表示清掉该槽位。 */
export function setKeyStyle(model: SkinModel, boardId: string, keyId: string, style: Partial<Record<keyof KeyStyleRefs, string | null>>): SkinModel {
  const patch: Partial<KeyStyleRefs> = {}
  for (const [slot, value] of Object.entries(style)) {
    if (slot === "fore") {
      // 清空前景就是给一个空列表；非空时由调用方直接传整个数组。
      if (value === null) patch.fore = []
      continue
    }
    // 传 null 表示清掉这个槽位，必须真的写成 undefined，否则旧引用会留下。
    ;(patch as Record<string, string | undefined>)[slot] = value === null ? undefined : value
  }
  return patchKey(model, boardId, keyId, { style: patch })
}

/** 给按键绑定一个事件的动作；传 null 解除。 */
export function setKeyAction(model: SkinModel, boardId: string, keyId: string, event: KeyEvent, action: SkinAction | null): SkinModel {
  return patchKey(model, boardId, keyId, { actions: { [event]: action } })
}

/** 新增按键；id 已存在时不改动。 */
export function addKey(model: SkinModel, boardId: string, key: SkinKey): SkinModel {
  const board = model.boards.find((item) => item.id === boardId)
  if (!board || board.keys.some((item) => item.id === key.id)) return unchanged(model)
  return replaceBoard(model, boardId, { ...board, keys: [...board.keys, key] })
}

/** 删除按键；板里没有这个键时不动。 */
export function removeKey(model: SkinModel, boardId: string, keyId: string): SkinModel {
  const board = model.boards.find((item) => item.id === boardId)
  if (!board || !board.keys.some((item) => item.id === keyId)) return unchanged(model)
  return replaceBoard(model, boardId, { ...board, keys: board.keys.filter((item) => item.id !== keyId) })
}

/** 整块替换样式；样式名不存在时新增。 */
export function setStyle(model: SkinModel, styleId: string, style: SkinStyle): SkinModel {
  const styles = new Map(model.styles)
  styles.set(styleId, style)
  return { ...model, styles }
}

/** 删除样式，并把引用它的按键与动效绑定一起清掉，避免留下悬空引用。 */
export function removeStyle(model: SkinModel, styleId: string): SkinModel {
  if (!model.styles.has(styleId)) return unchanged(model)
  const styles = new Map(model.styles)
  styles.delete(styleId)

  const boards = model.boards.map((board) => ({
    ...board,
    keys: board.keys.map((key) => {
      const style = key.style
      const fore = style.fore.filter((item) => item !== styleId)
      if (style.back !== styleId && style.pressedBack !== styleId && style.text !== styleId && style.icon !== styleId && fore.length === style.fore.length) {
        return key
      }
      return {
        ...key,
        style: {
          fore,
          ...(style.back === styleId ? {} : { back: style.back }),
          ...(style.pressedBack === styleId ? {} : { pressedBack: style.pressedBack }),
          ...(style.text === styleId ? {} : { text: style.text }),
          ...(style.icon === styleId ? {} : { icon: style.icon }),
        },
      }
    }),
  }))

  const motions = new Map(model.motions)
  for (const [id, motion] of motions) {
    const bindings = motion.bindings.filter((binding) => binding.target !== `style:${styleId}`)
    if (bindings.length !== motion.bindings.length) motions.set(id, { ...motion, bindings })
  }

  return { ...model, styles, boards, motions }
}

/** 改皮肤元信息；未给出的字段保持不变。 */
export function setMeta(model: SkinModel, patch: Partial<SkinMeta>): SkinModel {
  const meta = { ...model.meta, ...patch }
  // 空串表示清掉这一项，不要留一个空字符串当成「有值」。
  for (const [key, value] of Object.entries(patch)) {
    if (value === "") delete (meta as Record<string, unknown>)[key]
  }
  return { ...model, meta }
}

/** 换一块板的尺寸；同时把模型记录的分辨率对齐到主板。 */
export function resizeBoard(model: SkinModel, boardId: string, size: { width: number; height: number }): SkinModel {
  const board = model.boards.find((item) => item.id === boardId)
  if (!board) return unchanged(model)
  const next = replaceBoard(model, boardId, { ...board, size })
  return board.kind === "main" ? { ...next, meta: { ...next.meta, resolution: size } } : next
}
