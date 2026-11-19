// 属性视图：从模型生成可展示的字段，供检查器渲染。
//
// 检查器以前按格式各自决定显示什么字段。现在统一从模型派生：字段名、值、类型都由模型给出，
// 格式差异只体现在「这个格式有没有这个能力」，不再体现在字段表上。
import type { SkinBoard } from "./board.ts"
import type { SkinKey } from "./key.ts"
import type { SkinModel } from "./model.ts"
import type { SkinStyle } from "./style.ts"
import type { SkinMotion } from "./motion.ts"
import { motionNodeKinds } from "./motion.ts"
import { cachedLayout } from "./layout-cache.ts"
import { findKey } from "./edit.ts"

export type PropertyKind =
  | "number"
  | "text"
  | "boolean"
  | "choice"
  | "style"
  | "image"
  | "action"
  | "readonly"

/** 一个可展示的属性；`value` 为空表示这一项没有配置。 */
export type PropertyView = {
  /** 稳定键：同一对象上同一属性始终用同一个键，便于比较与定位。 */
  key: string
  label: string
  kind: PropertyKind
  value?: string | number | boolean
  /** `choice` 的候选。 */
  options?: readonly string[]
  /** 补充说明，例如来源或单位。 */
  note?: string
  /** 只读属性由模型派生，改动要经过对应操作。 */
  readOnly?: boolean
}

function numberView(key: string, label: string, value: number | undefined, note?: string): PropertyView {
  return { key, label, kind: "number", ...(value !== undefined ? { value } : {}), ...(note ? { note } : {}) }
}

function styleView(key: string, label: string, value: string | undefined): PropertyView {
  return { key, label, kind: "style", ...(value !== undefined ? { value } : {}) }
}

/** 按键的几何；矩形来自布局树的派生缓存，客户端排布的板不可改。 */
export function keyGeometry(model: SkinModel, boardId: string, keyId: string): PropertyView[] {
  const found = findKey(model, boardId, keyId)
  if (!found) return []
  const { board, key } = found
  const editable = board.geometry === "document"
  const note = editable ? undefined : "几何由客户端决定，不能在这里改"
  const rect = cachedLayout(board)?.get(key.id)
  return [
    { ...numberView("x", "X", rect?.position.x, note), readOnly: !editable },
    { ...numberView("y", "Y", rect?.position.y, note), readOnly: !editable },
    { ...numberView("width", "宽", rect?.size.width, note), readOnly: !editable },
    { ...numberView("height", "高", rect?.size.height, note), readOnly: !editable },
    { ...numberView("touch.x", "触摸 X", key.touchRect?.position.x, note), readOnly: !editable },
    { ...numberView("touch.y", "触摸 Y", key.touchRect?.position.y, note), readOnly: !editable },
    { ...numberView("touch.width", "触摸宽", key.touchRect?.size.width, note), readOnly: !editable },
    { ...numberView("touch.height", "触摸高", key.touchRect?.size.height, note), readOnly: !editable },
  ]
}

const ACTION_LABELS: ReadonlyArray<[keyof SkinKey["actions"], string]> = [
  ["press", "点击"],
  ["long-press", "长按"],
  ["swipe-up", "上滑"],
  ["swipe-down", "下滑"],
  ["swipe-left", "左滑"],
  ["swipe-right", "右滑"],
]

/** 动作码：模型里的动作是语义对象，这里换成可读的短写。 */
export function actionText(action: SkinKey["actions"][keyof SkinKey["actions"]]): string | undefined {
  if (!action) return
  switch (action.kind) {
    case "text": return action.value === " " ? "空格" : action.value
    case "delete": return action.forward ? "前向删除" : "删除"
    case "enter": return "回车"
    case "candidate-page": return action.direction === "up" ? "候选上页" : "候选下页"
    case "case": return action.mode === "title" ? "首字母大写" : "大写锁定"
    case "switch": return action.board === "symbol" ? "符号" : action.board === "number" ? "数字" : "切换"
    case "open-app": return "打开应用"
    case "system": return action.code
  }
}

/** 按键的手势动作；没配置的格子也给出来，便于界面显示「+」。 */
export function keyActions(model: SkinModel, boardId: string, keyId: string): PropertyView[] {
  const found = findKey(model, boardId, keyId)
  if (!found) return []
  return ACTION_LABELS.map(([event, label]) => {
    const action = found.key.actions[event]
    const text = actionText(action)
    return {
      key: `action.${event}`,
      label,
      kind: "action" as const,
      ...(text !== undefined ? { value: text } : {}),
      ...(action ? { note: action.kind } : {}),
    }
  })
}

/** 按键的样式引用。 */
export function keyStyleRefs(model: SkinModel, boardId: string, keyId: string): PropertyView[] {
  const found = findKey(model, boardId, keyId)
  if (!found) return []
  const style = found.key.style
  const views = [
    styleView("style.back", "背景", style.back),
    styleView("style.pressedBack", "按下背景", style.pressedBack),
  ]
  style.fore.forEach((item, index) => views.push(styleView(`style.fore.${index}`, `前景 ${index + 1}`, item)))
  if (!style.fore.length) views.push({ key: "style.fore", label: "前景", kind: "style" })
  if (style.text) views.push(styleView("style.text", "文字", style.text))
  if (style.icon) views.push(styleView("style.icon", "图标", style.icon))
  return views
}

/** 按键引用的状态段；定义在板上，这里按引用取出来展示。 */
export function keyStates(model: SkinModel, boardId: string, keyId: string): PropertyView[] {
  const found = findKey(model, boardId, keyId)
  if (!found) return []
  const { board, key } = found
  const refs = key.stateRefs
  if (!refs?.length) return []
  const states = refs.flatMap((ref, index) => {
    const override = board.tips?.get(ref.section)
    if (!override) return []
    return [{
      key: `state.${index}`,
      label: `状态 ${ref.state}`,
      kind: "readonly" as const,
      value: [
        override.style?.back ? `背景 ${override.style.back}` : "",
        actionText(override.actions?.press) ?? "",
      ].filter(Boolean).join(" · "),
      note: "皮肤状态下的另一套样式",
    }]
  })
  return states
}

/** 一个对象的完整字段列表：几何、动作、样式、状态。 */
export function keyProperties(model: SkinModel, boardId: string, keyId: string): PropertyView[] {
  return [
    ...keyGeometry(model, boardId, keyId),
    ...keyActions(model, boardId, keyId),
    ...keyStyleRefs(model, boardId, keyId),
    ...keyStates(model, boardId, keyId),
  ]
}

/** 板的字段：尺寸、种类、几何来源与按键数。 */
export function boardProperties(model: SkinModel, boardId: string): PropertyView[] {
  const board: SkinBoard | undefined = model.boards.find((item) => item.id === boardId)
  if (!board) return []
  const geometryNote = board.geometry === "document" ? "由文档决定" : board.geometry === "client" ? "由客户端决定" : "由骨架决定"
  return [
    numberView("size.width", "宽", board.size.width, geometryNote),
    numberView("size.height", "高", board.size.height, geometryNote),
    { key: "kind", label: "板种类", kind: "readonly", value: board.kind },
    { key: "geometry", label: "几何来源", kind: "readonly", value: board.geometry },
    { key: "keys", label: "按键数", kind: "readonly", value: board.keys.length },
    { key: "orientation", label: "方向", kind: "readonly", value: board.orientation },
  ]
}

/** 板的面板组件摘要：候选栏、气泡、列表、工具栏、背景。 */
export function panelProperties(model: SkinModel, boardId: string): PropertyView[] {
  const board = model.boards.find((item) => item.id === boardId)
  if (!board) return []
  const views: PropertyView[] = []
  if (board.backdrop?.style) views.push(styleView("panel.backdrop", "面板背景", board.backdrop.style))
  if (board.candidate) {
    views.push(styleView("panel.candidate", "候选栏背景", board.candidate.style))
    if (board.candidate.cellStyle) views.push(styleView("panel.candidate.cell", "候选格", board.candidate.cellStyle))
    views.push({ key: "panel.candidate.icons", label: "候选栏图标", kind: "readonly", value: board.candidate.icons?.length ?? 0 })
  }
  if (board.hint) views.push(styleView("panel.hint", "气泡背景", board.hint.style))
  if (board.list) {
    views.push(styleView("panel.list", "列表背景", board.list.style))
    if (board.list.cellSize) {
      views.push(numberView("panel.list.cell.width", "格子宽", board.list.cellSize.width))
      views.push(numberView("panel.list.cell.height", "格子高", board.list.cellSize.height))
    }
  }
  if (board.toolbar) views.push({ key: "panel.toolbar", label: "工具栏按钮", kind: "readonly", value: board.toolbar.items.length })
  if (board.input) views.push(styleView("panel.input", "输入条背景", board.input.style))
  return views
}

/** 样式的字段：图层数量与各层摘要。 */
export function styleProperties(model: SkinModel, styleId: string): PropertyView[] {
  const style: SkinStyle | undefined = model.styles.get(styleId)
  if (!style) return []
  const views: PropertyView[] = [{ key: "style.id", label: "编号", kind: "readonly", value: styleId }]
  const describe = (layers: SkinStyle["normal"], prefix: string, label: string) => {
    layers.forEach((layer, index) => {
      const text = layer.kind === "image" || layer.kind === "icon"
        ? `图片 ${layer.image}`
        : layer.kind === "color"
          ? `颜色 ${layer.value}`
          : layer.kind === "sound"
            ? `音效 ${layer.file}`
            : layer.kind === "text"
              ? `文字 ${layer.text ?? ""}`
              : layer.kind === "border"
                ? `边框 ${layer.color}`
                : `渐变 ${layer.stops.length} 段`
      views.push({ key: `${prefix}.${index}`, label: `${label} ${index + 1}`, kind: "readonly", value: text })
    })
  }
  describe(style.normal, "normal", "正常")
  if (style.pressed?.length) describe(style.pressed, "pressed", "按下")
  if (style.disabled?.length) describe(style.disabled, "disabled", "禁用")
  return views
}

/** 动效的字段：节点类型、时长、绑定数。 */
export function motionProperties(model: SkinModel, motionId: string): PropertyView[] {
  const motion: SkinMotion | undefined = model.motions.get(motionId)
  if (!motion) return []
  const kinds = [...new Set(motionNodeKinds(motion.root))]
  return [
    { key: "motion.id", label: "编号", kind: "readonly", value: motion.id },
    { key: "motion.kind", label: "类型", kind: "readonly", value: kinds.join("、") },
    numberView("motion.duration", "时长", motion.timeline.duration, "秒"),
    numberView("motion.delay", "延迟", motion.timeline.delay, "秒"),
    numberView("motion.repeat", "重复", motion.timeline.repeat),
    { key: "motion.bindings", label: "绑定数", kind: "readonly", value: motion.bindings.length },
  ]
}

/** 整份模型的摘要，供状态栏与导出提示。 */
export type ModelSummary = {
  boards: number
  keys: number
  styles: number
  images: number
  motions: number
  sounds: number
  main: { width: number; height: number } | undefined
}

export function summarizeModel(model: SkinModel): ModelSummary {
  const main = model.boards.find((board) => board.kind === "main") ?? model.boards[0]
  return {
    boards: model.boards.length,
    keys: model.boards.reduce((total, board) => total + board.keys.length, 0),
    styles: model.styles.size,
    images: model.images.size,
    motions: model.motions.size,
    sounds: model.sounds.size,
    main: main ? { width: main.size.width, height: main.size.height } : undefined,
  }
}
