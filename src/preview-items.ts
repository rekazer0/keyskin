// 画布与交互层共用的纯工具。
//
// 键的数据结构只有一份：`KeyRender`（由 IR 的布局树与按键容器算出）。
// 这个文件不再从 `IniDocument` 装配任何预览项——那会绕开 IR 造第二份真相。

import type { KeyRender as PreviewItem } from "./skin-model/build.ts"
import type { IniDocument } from "./ini.ts"

export type { KeyRender as PreviewItem } from "./skin-model/build.ts"

export type Rect = { x: number; y: number; width: number; height: number }

/**
 * 动态工具栏条的位置：`[ICONn]` 里 `KEY=F14` 且没被 PERSIST 隐藏的那个，
 * 按 `ANCHOR_TYPE` 的九宫格锚点摆到面板上。
 */
export function dynamicToolbarRect(
  document: IniDocument,
  panelWidth: number,
  panelHeight: number,
): Rect | undefined {
  const section = document.sections().find((name) =>
    /^ICON\d+$/i.test(name) && document.get(name, "KEY")?.trim().toUpperCase() === "F14" &&
    persistVisible(document.get(name, "PERSIST"), false)
  )
  if (!section) return
  const size = document.get(section, "SIZE")?.split(",").map(Number)
  const position = document.get(section, "POS")?.split(",").map(Number)
  const anchor = Number(document.get(section, "ANCHOR_TYPE"))
  if (
    !size || size.length !== 2 || size.some((value) => !Number.isFinite(value) || value <= 0) ||
    !position || position.length !== 2 || position.some((value) => !Number.isFinite(value))
  ) return
  const column = ((anchor - 1) % 3) + 1
  const row = Math.ceil(anchor / 3)
  return {
    x: (column === 2 ? panelWidth / 2 : column === 3 ? panelWidth : 0) + position[0],
    y: (row === 2 ? panelHeight / 2 : row === 3 ? panelHeight : 0) + position[1],
    width: size[0],
    height: size[1],
  }
}

/** 按下时要播放的动画样式：容器里各层声明的动画，外加面板自己的动画。 */
export function keyAnimationStyles(key: PreviewItem, panelStyle?: string): string[] {
  return [...new Set([...key.animStyles, panelStyle].filter((style): style is string => Boolean(style)))]
}

function previewBackground(theme: "light" | "dark"): string {
  return theme === "dark" ? "#1b1b1f" : "#f2f2f5"
}

export function previewSurfaceColor(theme: "light" | "dark", transparent: boolean): string | undefined {
  return transparent ? undefined : previewBackground(theme)
}

/** 一块铺满整板的按键：它画在底层，命中时让位给更小的键。 */
export function isFullPanelPreviewItem(
  item: Pick<PreviewItem, "rect">,
  panelWidth: number,
  panelHeight: number,
): boolean {
  return item.rect.x <= 0 && item.rect.y <= 0 &&
    item.rect.x + item.rect.width >= panelWidth &&
    item.rect.y + item.rect.height >= panelHeight
}

/** 背景与整板面板样式相同时不重复画一整块图。 */
export function shouldDrawItemBackground(
  item: PreviewItem,
  panelStyle: string,
  panelWidth: number,
  panelHeight: number,
): boolean {
  return !(item.backStyle === panelStyle && isFullPanelPreviewItem(item, panelWidth, panelHeight))
}

export function previewSelectionVisible(mode: "edit" | "preview", selected: boolean): boolean {
  return mode === "edit" && selected
}

/** 没有前景图层时画在键上的文本；文字层的内容由 IR 给出。 */
export function previewFallbackText(key: PreviewItem, hasForeground: boolean): string | undefined {
  if (hasForeground) return undefined
  return key.text
}

/**
 * 按键居中显示的字符：显示文本优先，其次文字层内容，最后取按下动作的文本。
 * 编辑器用它在源代码与画布之间按字符找回同一个键。
 */
export function previewCenter(item: PreviewItem): string {
  if (item.key.label) return item.key.label
  if (item.text) return item.text
  const action = item.key.actions?.press
  return action?.kind === "text" ? action.value : ""
}

export function isAdditiveSelection(event: Pick<MouseEvent, "shiftKey" | "metaKey" | "ctrlKey">): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey
}

export function isTouchLongPress(pointerType: string, duration: number, distance: number): boolean {
  return pointerType === "touch" && duration >= 500 && distance < 8
}

/** 选中一个段时，实际要处理的是它所属的整个键；列表单元格会跨多个段。 */
export function expandSections(keys: readonly PreviewItem[], sections: readonly string[]): string[] {
  const requested = new Set(sections)
  return keys.flatMap((render) =>
    render.key.visible === false ? [] : render.sections.some((section) => requested.has(section)) ? render.sections : []
  )
}

export function parseRect(value: string | undefined): Rect | undefined {
  const parts = value?.split(",").map(Number)
  if (!parts || parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return
  const [x, y, width, height] = parts
  return { x, y, width, height }
}

export function parseOffset(value: string | undefined): [number, number] | undefined {
  const parts = value?.split(",").map(Number)
  if (!parts || parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) return
  return [parts[0], parts[1]]
}

/** 背景与前景画在按键往里缩后的区域；选中与触摸仍按整键。 */
export function paddedRect(item: PreviewItem): Rect {
  const padding = item.key.padding
  if (!padding) return item.rect
  return {
    x: item.rect.x + padding.left,
    y: item.rect.y + padding.top,
    width: Math.max(0, item.rect.width - padding.left - padding.right),
    height: Math.max(0, item.rect.height - padding.top - padding.bottom),
  }
}

export function persistVisible(persist: string | undefined, composing: boolean): boolean {
  const value = persist?.trim()
  if (value === "0") return false
  if (value === "3") return true
  return composing === (value === "2")
}
