// BDA 的布局配置 ↔ IR 板与按键。
//
// 几何只有一处来源：布局里每个键的 `{position,size}` 交给 absoluteBoard 建树，矩形由
// computeLayout 算出，不在这里保存。未建模的字段（第二个矩形、可变键的字符串、`#4` 的三个
// float、`#6` 的两个数）按原始 protobuf 字段进板的 `extra`，写回时原样输出。
import { type BdaLayout, type BdaLayoutExtras, type BdaLayoutKey, type BdaLayoutKeyboard, type BdaLayoutBar, type BdaLayoutVariant, type BdaCandidateElement, type BdaPanel, type BdaRect, type ProtoField, type BdaStyleRef } from "@/bda.ts"
import { encodeFields } from "@/skin-model/formats/bda/appearance.ts"
import { actionOf, actionValue } from "@/skin-model/formats/bds/index.ts"
import type { Board, ContainerSize } from "@/skin-model/board.ts"
import { containerOf as boardContainerOf } from "@/skin-model/board.ts"
import type { Key, KeyContainer } from "@/skin-model/key.ts"
import { absoluteBoard, type LayoutBox } from "@/skin-model/layout.ts"
import type { BoardKind } from "@/skin-model/types.ts"
import type { Orientation, Theme } from "@/skin-model/types.ts"

/** 板 `extra` 里保存布局原文的键：键盘级内容与每个键的未建模字段。 */
export const KEYBOARD_EXTRA = "bda.keyboard"
const KEY_EXTRAS = "bda.keyParts"
export const PANEL_EXTRA = "bda.panel"

/** 键盘级、IR 没有对应概念的原文。 */
type BdaKeyboardExtra = {
  variants: BdaLayoutVariant[]
  extras?: BdaLayoutExtras
  grid?: readonly [number, number]
  flag?: number
  parts: readonly ProtoField[]
}

/** 单个键里 IR 没有对应概念的原文。 */
type BdaKeyExtra = {
  /** 读取时的矩形；与布局算出的值一致时，`#1` 按原始字段写回。 */
  rect?: BdaRect
  rectField?: ProtoField
  variant?: number
  parts: readonly ProtoField[]
}

/* —— protobuf 写入 —— */

const encoder = new TextEncoder()

function varint(number: number, value: number | undefined): ProtoField[] {
  return value === undefined ? [] : [{ number, wire: 0, varint: value >>> 0 }]
}

function fixed32(number: number, value: number | undefined): ProtoField[] {
  if (value === undefined) return []
  const buffer = new ArrayBuffer(4)
  new DataView(buffer).setFloat32(0, value, true)
  return [{ number, wire: 5, fixed32: new DataView(buffer).getUint32(0, true) }]
}

function bytesField(number: number, value: Uint8Array | undefined): ProtoField[] {
  return value === undefined ? [] : [{ number, wire: 2, bytes: value }]
}

function message(number: number, fields: ProtoField[]): ProtoField[] {
  return fields.length ? bytesField(number, encodeFields(fields)) : []
}

function string(number: number, value: string | undefined): ProtoField[] {
  return value === undefined ? [] : bytesField(number, encoder.encode(value))
}

/** 原样写回解码时保留的字段；它们已经是 proto 字段，不再解释。 */
function passthrough(fields: readonly ProtoField[]): ProtoField[] {
  return fields.map((field) => ({ ...field }))
}

function layoutBarFields(bar: BdaLayoutBar): ProtoField[] {
  return [
    ...string(1, bar.name),
    ...message(2, passthrough(bar.body)),
  ]
}

function variantFields(variant: BdaLayoutVariant): ProtoField[] {
  return [
    ...string(1, variant.name),
    ...message(2, variant.bars.flatMap((bar) => message(1, layoutBarFields(bar)))),
  ]
}

function candidateFields(candidate: BdaCandidateElement): ProtoField[] {
  return [
    ...string(1, candidate.name),
    ...message(2, passthrough(candidate.body)),
  ]
}

function extrasFields(extras: BdaLayoutExtras): ProtoField[] {
  return [
    ...fixed32(1, extras.floats[0]),
    ...fixed32(2, extras.floats[1]),
    ...fixed32(3, extras.floats[2]),
    ...(extras.inset ? passthrough([extras.inset]) : []),
    ...extras.candidates.flatMap((candidate) => message(5, candidateFields(candidate))),
    ...passthrough(extras.parts),
  ]
}

/** 原始 `#1` 与布局算出的矩形一致时，原样写回；不一致说明位置被改过，写新值。 */
function rectFieldOf(extra: BdaKeyExtra, rect: LayoutBox | undefined): ProtoField[] {
  const same = extra.rect && rect
    && extra.rect.x === rect.position.x
    && extra.rect.y === rect.position.y
    && extra.rect.width === rect.size.width
    && extra.rect.height === rect.size.height
  if (same && extra.rectField) return passthrough([extra.rectField])
  if (!rect) return []
  return message(1, [
    ...message(1, [...varint(1, rect.position.x), ...varint(2, rect.position.y)]),
    ...message(2, [...varint(1, rect.size.width), ...varint(2, rect.size.height)]),
  ])
}

/** 一个键的原文：`#1`/`#8` 由 IR 决定，其余按字段号写回。 */
function keyFields(name: string, rect: LayoutBox | undefined, action: string | undefined, extra: BdaKeyExtra): ProtoField[] {
  return [
    ...string(1, name),
    ...message(2, [
      ...rectFieldOf(extra, rect),
      ...passthrough(extra.parts),
      ...string(8, action),
      ...varint(11, extra.variant),
    ]),
  ]
}

function keyboardFields(keyboard: BdaLayoutKeyboard): ProtoField[] {
  return [
    ...string(1, keyboard.name),
    ...message(2, [
      ...keyboard.variants.flatMap((variant) => message(1, variantFields(variant))),
      ...keyboard.keys.flatMap((key) => message(2, keyFields(key.name, key.rect ? { position: { x: key.rect.x, y: key.rect.y }, size: { width: key.rect.width, height: key.rect.height } } : undefined, key.action, { rect: key.rect, rectField: key.rectField, variant: key.variant, parts: key.parts }))),
      ...passthrough(keyboard.parts),
      ...(keyboard.extras ? message(4, extrasFields(keyboard.extras)) : []),
      ...(keyboard.grid ? message(6, [...varint(1, keyboard.grid[0]), ...varint(2, keyboard.grid[1])]) : []),
      ...(keyboard.canvas ? message(7, [...varint(1, keyboard.canvas.width), ...varint(2, keyboard.canvas.height)]) : []),
      ...varint(8, keyboard.flag),
    ]),
  ]
}

/** 布局配置：顶层只有键盘。 */
export function encodeBdaLayout(layout: BdaLayout): Uint8Array {
  return encodeFields(layout.keyboards.flatMap((keyboard) => message(1, keyboardFields(keyboard))))
}

/* —— 读：布局 + 外观面板 → 板 —— */

/** 板种类按键盘名推断；BDA 的键盘名是输入法固定的那一组。 */
export function bdaBoardKind(name: string): BoardKind {
  const lower = name.toLowerCase()
  if (/^sym|^sel_|^symbol/.test(lower)) return "symbol"
  if (/^num|^dial|^def_9$|_9_?pad$|_9$/.test(lower)) return "number"
  if (/^bh/.test(lower)) return "stroke"
  if (/^hw/.test(lower)) return "other"
  if (/^cand/.test(lower)) return "candidate"
  if (/^(?:py|en|def|email|net|url)/.test(lower)) return "main"
  return "other"
}

/** 状态变体的基础键名：`KEY_F38_S34` → `KEY_F38`。 */
function baseKeyName(name: string): string {
  return name.replace(/_S\d+$/i, "")
}

type LayoutReadOptions = {
  theme: Theme
  orientation: Orientation
  /** 外观里的面板表；布局与外观靠键盘名对齐。 */
  panels: ReadonlyMap<string, BdaPanel>
  /** 外观声明或布局画布给出的设计宽度。 */
  designWidth?: number
  styleName: (ref: BdaStyleRef) => string
}

/** 按键容器：背景一层、前景若干层，按下态的高亮背景单独一格。 */
function containerOf(panel: BdaPanel | undefined, name: string, styleName: (ref: BdaStyleRef) => string): KeyContainer {
  const entry = panel?.keys.get(name)
  if (!entry) return { fore: [] }
  return {
    ...(entry.backStyle || entry.backStyleState
      ? {
        back: {
          ...(entry.backStyle ? { style: styleName(entry.backStyle) } : {}),
          ...(entry.backStyleState ? { pressed: styleName(entry.backStyleState) } : {}),
        },
      }
      : {}),
    fore: entry.foreStyles.flatMap((ref, index) => {
      const offset = entry.foreStyleOffsets[index]
      return [{
        style: styleName(ref),
        ...(offset ? { offset: { x: offset.x, y: offset.y } } : {}),
      }]
    }),
  }
}

function keyOf(key: BdaLayoutKey, panel: BdaPanel | undefined, options: LayoutReadOptions): Key {
  const action = actionOf(key.action)
  return {
    id: key.name,
    layoutId: key.rect ? key.name : baseKeyName(key.name),
    actions: action ? { press: action } : {},
    container: containerOf(panel, key.name, options.styleName),
  }
}

/** 布局画布；没有 `#7` 时几何由骨架提供，容器就是未知——不用设计宽度与零高度编一个。 */
function keyboardContainer(keyboard: BdaLayoutKeyboard): ContainerSize {
  return keyboard.canvas ? { kind: "known", size: keyboard.canvas } : { kind: "unknown" }
}

/**
 * 布局配置 → 板。
 * 每个键盘一块板；变体键与基础键共用布局节点，几何仍由 computeLayout 给出。
 */
export function boardsOfLayout(layout: BdaLayout, options: LayoutReadOptions): Board[] {
  return layout.keyboards.map((keyboard) => {
    const panel = options.panels.get(keyboard.name)
    const placed = keyboard.keys.flatMap((key) => (key.rect
      ? [{
        id: key.name,
        position: { x: key.rect.x, y: key.rect.y },
        size: { width: key.rect.width, height: key.rect.height },
      }]
      : []))
    const keyboardExtra: BdaKeyboardExtra = {
      variants: keyboard.variants,
      ...(keyboard.extras ? { extras: keyboard.extras } : {}),
      ...(keyboard.grid ? { grid: keyboard.grid } : {}),
      ...(keyboard.flag !== undefined ? { flag: keyboard.flag } : {}),
      parts: keyboard.parts,
    }
    const keyExtras = new Map<string, BdaKeyExtra>(keyboard.keys.map((key) => [
      key.name,
      {
        ...(key.rect ? { rect: key.rect } : {}),
        ...(key.rectField ? { rectField: key.rectField } : {}),
        ...(key.variant !== undefined ? { variant: key.variant } : {}),
        parts: key.parts,
      },
    ]))
    const extra = new Map<string, unknown>([
      [KEYBOARD_EXTRA, keyboardExtra],
      [KEY_EXTRAS, keyExtras],
      ...(panel ? [[PANEL_EXTRA, panel] as [string, unknown]] : []),
    ])
    return {
      id: `${options.theme}/${options.orientation}/${keyboard.name}`,
      kind: bdaBoardKind(keyboard.name),
      theme: options.theme,
      orientation: options.orientation,
      geometry: keyboard.canvas ? { kind: "document" } : { kind: "client", basis: "bda" },
      container: keyboardContainer(keyboard),
      layout: absoluteBoard(placed),
      ...(panel?.backStyle ? { backdrop: options.styleName(panel.backStyle) } : {}),
      keys: keyboard.keys.map((key) => keyOf(key, panel, options)),
      extra,
    }
  })
}

/* —— 写：板 → 布局 —— */

/** 从板的 `extra` 取键盘原文；模型不是 BDA 来的就重建一个空的。 */
function keyboardExtraOf(board: Board): BdaKeyboardExtra {
  const value = board.extra?.get(KEYBOARD_EXTRA)
  return value === undefined
    ? { variants: [], parts: [] }
    : value as BdaKeyboardExtra
}

function keyExtrasOf(board: Board): ReadonlyMap<string, BdaKeyExtra> {
  const value = board.extra?.get(KEY_EXTRAS)
  return value === undefined ? new Map() : value as ReadonlyMap<string, BdaKeyExtra>
}

/** 板 id 的叶子名就是键盘名；板 id 有路径（`/`）与 SXI 的命名空间（`:`）两种写法。 */
export function keyboardNameOf(board: Board): string {
  return (board.id.split(/[/:]/).pop() ?? board.id).replace(/\.ini$/i, "")
}

/**
 * 板 → 布局配置。
 * 矩形来自每个板的布局计算结果；变体键没有 `#1`，只写动作与 `#11`。
 */
export function layoutOfBoards(boards: readonly Board[], rects: ReadonlyMap<string, ReadonlyMap<string, LayoutBox>>): BdaLayout {
  return {
    keyboards: boards.map((board) => {
      const extra = keyboardExtraOf(board)
      const keyExtras = keyExtrasOf(board)
      const placed = rects.get(board.id) ?? new Map<string, LayoutBox>()
      const container = boardContainerOf(board)
      return {
        name: keyboardNameOf(board),
        variants: extra.variants,
        keys: board.keys.map((key) => {
          const keyExtra = keyExtras.get(key.id)
          // 变体键的几何继承基础键：只有 `layoutId` 指向某个布局节点时才写 `#1`。
          const rect = key.layoutId === key.id ? placed.get(key.id) : undefined
          return {
            name: key.id,
            ...(rect ? { rect: { x: rect.position.x, y: rect.position.y, width: rect.size.width, height: rect.size.height } } : {}),
            ...(keyExtra?.rectField ? { rectField: keyExtra.rectField } : {}),
            ...actionSurface(key),
            ...(keyExtra?.variant !== undefined ? { variant: keyExtra.variant } : {}),
            parts: keyExtra?.parts ?? [],
          }
        }),
        ...(extra.extras ? { extras: extra.extras } : {}),
        ...(extra.grid ? { grid: extra.grid } : {}),
        // 容器未知时不写 canvas：那块板的几何来自骨架，不把「不知道」写成 0。
        ...(container ? { canvas: { width: container.width, height: container.height } } : {}),
        ...(extra.flag !== undefined ? { flag: extra.flag } : {}),
        parts: extra.parts,
      }
    }),
  }
}

/** 按键动作用按下的动作码写回；没有动作就不写 `#8`。 */
function actionSurface(key: Key): { action?: string } {
  const code = actionValue(key.actions.press)
  return code ? { action: code } : {}
}

/** 面板随板走；写回外观时按板取。 */
export function panelOf(board: Board): BdaPanel | undefined {
  const value = board.extra?.get(PANEL_EXTRA)
  return value === undefined ? undefined : value as BdaPanel
}
