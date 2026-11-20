// 模型编辑：按键、样式、动作、板与资源的不可变更新。
//
// 编辑器最终要改模型而不是直接改 INI。这一层只做「输入旧模型与改动，输出新模型」，
// 不碰归档、不碰撤销栈，便于测试，也让每种格式共用同一套编辑语义。
import type { Board } from "./board.ts"
import type { HitArea, KeyContainer, Key } from "./key.ts"
import type { SkinModel } from "./model.ts"
import type { SkinStyle } from "./style.ts"
import type { KeyEvent, KeyAction, SkinMeta } from "./types.ts"
import type { Rect } from "taffy-layout"
import { setNodeRect, type LayoutBox } from "./layout.ts"
import { cachedLayout } from "./layout-cache.ts"

/** 找不到目标时返回原模型，调用方据此判断是否真的有改动。 */
function unchanged(model: SkinModel): SkinModel {
  return model
}

function replaceBoard(model: SkinModel, boardId: string, next: Board): SkinModel {
  const index = model.boards.findIndex((board) => board.id === boardId)
  if (index < 0) return unchanged(model)
  const boards = model.boards.slice()
  boards[index] = next
  return { ...model, boards }
}

function replaceKey(board: Board, keyId: string, next: Key): Board | undefined {
  const index = board.keys.findIndex((key) => key.id === keyId)
  if (index < 0) return
  const keys = board.keys.slice()
  keys[index] = next
  return { ...board, keys }
}

/** 找到按键与它所在的板；找不到返回 undefined。 */
export function findKey(model: SkinModel, boardId: string, keyId: string): { board: Board; key: Key } | undefined {
  const board = model.boards.find((item) => item.id === boardId)
  const key = board?.keys.find((item) => item.id === keyId)
  return board && key ? { board, key } : undefined
}

export type KeyPatch = {
  /** 几何补丁；几何只落在布局树上，按键本身不带矩形。 */
  rect?: LayoutBox
  hitArea?: HitArea
  /** 内边距；传 null 表示清掉。 */
  padding?: Rect<number> | null
  /** 层定义补丁；传整个容器表示整层替换。 */
  container?: KeyContainer
  actions?: Partial<Record<KeyEvent, KeyAction | null>>
}

/** 改一个按键；返回新模型，原模型不动。 */
export function patchKey(model: SkinModel, boardId: string, keyId: string, patch: KeyPatch): SkinModel {
  const found = findKey(model, boardId, keyId)
  if (!found) return unchanged(model)
  const { board, key } = found

  const actions: Partial<Record<KeyEvent, KeyAction>> = { ...key.actions }
  for (const [event, action] of Object.entries(patch.actions ?? {}) as Array<[KeyEvent, KeyAction | null]>) {
    if (action === null) delete actions[event]
    else actions[event] = action
  }

  const container: KeyContainer = patch.container ?? key.container

  const next: Key = {
    ...key,
    ...(patch.hitArea ? { hitArea: patch.hitArea } : {}),
    ...(patch.padding === null ? { padding: undefined } : patch.padding ? { padding: patch.padding } : {}),
    actions,
    container,
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
/** 两个矩形是否等价。 */
function sameRect(left: LayoutBox, right: LayoutBox): boolean {
  return left.position.x === right.position.x
    && left.position.y === right.position.y
    && left.size.width === right.size.width
    && left.size.height === right.size.height
}

/** 移动按键：改布局树里对应节点的矩形，按键本身不带几何。 */
export function moveKey(model: SkinModel, boardId: string, keyId: string, rect: LayoutBox): SkinModel {
  const board = model.boards.find((item) => item.id === boardId)
  if (!board) return model
  // 几何没变就不动树：树结构会变，但用户看到的位置没变，不该记成一次改动。
  const current = cachedLayout(board)?.get(keyId)
  if (current && sameRect(current, rect)) return model
  return {
    ...model,
    boards: model.boards.map((item) => item.id === boardId ? { ...item, layout: setNodeRect(item.layout, keyId, rect) } : item),
  }
}

/**
 * 改按键容器里的层引用；传 null 表示清掉该层。
 * 这是对容器各槽位的编辑入口，不再暴露扁平的样式键。
 */
export function setKeyContainer(model: SkinModel, boardId: string, keyId: string, next: KeyContainer): SkinModel {
  return patchKey(model, boardId, keyId, { container: next })
}

/** 给按键绑定一个事件的动作；传 null 解除。 */
export function setKeyAction(model: SkinModel, boardId: string, keyId: string, event: KeyEvent, action: KeyAction | null): SkinModel {
  return patchKey(model, boardId, keyId, { actions: { [event]: action } })
}

/** 新增按键；id 已存在时不改动。 */
export function addKey(model: SkinModel, boardId: string, key: Key): SkinModel {
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
      const container = key.container
      const fore = container.fore.filter((layer) => layer.style !== styleId && layer.anim !== styleId)
      const back = container.back && (container.back.style === styleId || container.back.pressed === styleId || container.back.anim === styleId)
        ? undefined
        : container.back
      const text = container.text?.style === styleId ? undefined : container.text
      const icon = container.icon === styleId ? undefined : container.icon
      const press = container.press === styleId ? undefined : container.press
      // 这个样式没被这一层引用，保持原样。
      if (back === container.back && text === container.text && icon === container.icon && press === container.press && fore.length === container.fore.length) {
        return key
      }
      return {
        ...key,
        container: {
          ...(back ? { back } : {}),
          fore,
          ...(text ? { text } : {}),
          ...(icon ? { icon } : {}),
          ...(press ? { press } : {}),
        },
      }
    }),
  }))

  const motions = new Map(model.motions)
  for (const [id, motion] of motions) {
    const existing = motion.bindings ?? []
    const bindings = existing.filter((binding) => binding.target !== `style:${styleId}`)
    if (bindings.length !== existing.length) motions.set(id, { ...motion, bindings })
  }

  return { ...model, styles, boards, motions }
}

/** 换板的面板背景样式引用；传 null 表示清掉。 */
export function setBoardBackdrop(model: SkinModel, boardId: string, style: string | null): SkinModel {
  const board = model.boards.find((item) => item.id === boardId)
  if (!board) return model
  const { backdrop: _removed, ...rest } = board
  return replaceBoard(model, boardId, style === null ? rest : { ...rest, backdrop: style })
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
  const next = replaceBoard(model, boardId, { ...board, container: { kind: "known", size } })
  return board.kind === "main" ? { ...next, meta: { ...next.meta, resolution: size } } : next
}
