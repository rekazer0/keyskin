// 字段改动 → 模型操作。
//
// 检查器把改后的值交回来时，要按字段归属分派到对应的编辑操作：几何走 `moveKey`，
// 容器各层走 `setKeyContainer`，动作走 `setKeyAction`。分派规则只在这里定义一次，
// 界面不必知道每种字段该怎么改模型。
import { setKeyAction, setKeyContainer, patchKey, findKey } from "./edit.ts"
import { actionText } from "./inspect.ts"
import type { SkinModel } from "./model.ts"
import type { KeyAction, KeyEvent } from "./types.ts"
import type { LayoutBox } from "./layout.ts"
import { setNodeRect } from "./layout.ts"
import { cachedLayout } from "./layout-cache.ts"

/** 手势字段名到事件。 */
const EVENTS: Readonly<Record<string, KeyEvent>> = {
  "action.press": "press",
  "action.long-press": "long-press",
  "action.swipe-up": "swipe-up",
  "action.swipe-down": "swipe-down",
  "action.swipe-left": "swipe-left",
  "action.swipe-right": "swipe-right",
}

/** 样式槽位字段名到容器里的槽位。 */
const STYLE_SLOTS: Readonly<Record<string, "back" | "pressedBack" | "text" | "icon" | "fore">> = {
  "style.back": "back",
  "style.pressedBack": "pressedBack",
  "style.text": "text",
  "style.icon": "icon",
  "style.fore.0": "fore",
  "style.fore": "fore",
}

/** 动作文本 → 动作。空串表示解除绑定。 */
export function actionOfText(text: string): KeyAction | undefined {
  const trimmed = text.trim()
  if (!trimmed) return
  if (trimmed === "空格") return { kind: "text", value: " " }
  if (trimmed === "删除") return { kind: "delete" }
  if (trimmed === "前向删除") return { kind: "delete", forward: true }
  if (trimmed === "回车") return { kind: "enter" }
  if (trimmed === "候选上页") return { kind: "candidate-page", direction: "up" }
  if (trimmed === "候选下页") return { kind: "candidate-page", direction: "down" }
  if (trimmed === "大写锁定") return { kind: "case", mode: "lock" }
  if (trimmed === "首字母大写") return { kind: "case", mode: "title" }
  if (trimmed === "符号") return { kind: "switch", board: "symbol" }
  if (trimmed === "数字") return { kind: "switch", board: "number" }
  if (/^F\d+$/.test(trimmed)) return { kind: "system", code: trimmed }
  return { kind: "text", value: trimmed }
}

/** 字段改动能否落到模型上；界面据此决定是否提交。 */
export function canApplyField(fieldKey: string): boolean {
  const geometry = fieldKey.replace(/^touch\./, "")
  return geometry === "x" || geometry === "y" || geometry === "width" || geometry === "height"
    || fieldKey in EVENTS
    || fieldKey in STYLE_SLOTS
}

export type FieldChange = {
  boardId: string
  keyId: string
  /** `PropertyView.key`。 */
  field: string
  value: string | number | boolean | undefined
}

/**
 * 把一次字段改动应用到模型。
 * 不支持或值不合法时返回原模型，调用方据此判断是否真的改了。
 */
export function applyFieldChange(model: SkinModel, change: FieldChange): SkinModel {
  const { boardId, keyId, field, value } = change
  const event = EVENTS[field]
  if (event) {
    const action = typeof value === "string" ? actionOfText(value) : undefined
    return setKeyAction(model, boardId, keyId, event, action ?? null)
  }

  const slot = STYLE_SLOTS[field]
  if (slot) {
    const found = findKey(model, boardId, keyId)
    if (!found) return model
    const text = typeof value === "string" ? value.trim() : value === undefined ? "" : String(value)
    const container = found.key.container
    if (slot === "fore") {
      // 前景是层栈；改它就是把整个栈换掉，不保留旧层。
      return setKeyContainer(model, boardId, keyId, {
        ...container,
        fore: text ? [{ style: text }] : [],
      })
    }
    if (slot === "back") {
      return setKeyContainer(model, boardId, keyId, {
        ...container,
        back: text ? { ...container.back, style: text } : undefined,
      })
    }
    if (slot === "pressedBack") {
      return setKeyContainer(model, boardId, keyId, {
        ...container,
        back: text ? { ...container.back, style: container.back?.style ?? text, pressed: text } : { ...container.back, style: container.back?.style ?? "", pressed: undefined },
      })
    }
    if (slot === "icon") {
      return setKeyContainer(model, boardId, keyId, { ...container, ...(text ? { icon: text } : { icon: undefined }) })
    }
    return setKeyContainer(model, boardId, keyId, {
      ...container,
      text: text
        ? { ...container.text, style: text }
        : container.text ? { ...container.text, style: undefined } : undefined,
    })
  }

  return moveGeometry(model, boardId, keyId, field, value)
}

/** 几何字段：改布局树里对应节点，矩形由树重新算出。 */
function moveGeometry(model: SkinModel, boardId: string, keyId: string, field: string, value: string | number | boolean | undefined): SkinModel {
  if (typeof value !== "number" || !Number.isFinite(value)) return model
  const board = model.boards.find((item) => item.id === boardId)
  const key = board?.keys.find((item) => item.id === keyId)
  if (!board || !key) return model
  // 显示区由布局树给出；触摸区相对显示区内缩，编辑时先还原成像素再改回。
  const display = cachedLayout(board)?.get(key.layoutId) ?? { position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }
  const touchArea: LayoutBox = key.hitArea?.kind === "inset"
    ? {
      position: { x: display.position.x + key.hitArea.edges.left, y: display.position.y + key.hitArea.edges.top },
      size: {
        width: display.size.width - key.hitArea.edges.left - key.hitArea.edges.right,
        height: display.size.height - key.hitArea.edges.top - key.hitArea.edges.bottom,
      },
    }
    : key.hitArea?.kind === "none"
      ? { position: { ...display.position }, size: { width: 0, height: 0 } }
      : { position: { ...display.position }, size: { ...display.size } }
  const current: LayoutBox = field.startsWith("touch.") ? touchArea : display
  const next: LayoutBox = {
    position: { ...current.position },
    size: { ...current.size },
  }
  const target = field.replace(/^touch\./, "")
  if (target === "x") next.position.x = value
  else if (target === "y") next.position.y = value
  else if (target === "width") next.size.width = value
  else if (target === "height") next.size.height = value
  else return model
  return field.startsWith("touch.")
    ? patchKey(model, boardId, keyId, {
      hitArea: {
        kind: "inset",
        edges: {
          left: next.position.x - display.position.x,
          top: next.position.y - display.position.y,
          right: display.position.x + display.size.width - (next.position.x + next.size.width),
          bottom: display.position.y + display.size.height - (next.position.y + next.size.height),
        },
      },
    })
    // 绘制几何写进布局树，按键上没有几何可写。
    : { ...model, boards: model.boards.map((item) => item.id === boardId ? { ...item, layout: setNodeRect(item.layout, keyId, next) } : item) }
}

/** 一次改动能改哪些字段的清单，供界面做只读判定。 */
export function editableFields(): string[] {
  return [...Object.keys(EVENTS), ...Object.keys(STYLE_SLOTS), "x", "y", "width", "height", "touch.x", "touch.y", "touch.width", "touch.height"]
}

export { actionText }
