// 属性视图：从模型生成可展示的字段，供检查器渲染。
//
// 检查器以前按格式各自决定显示什么字段。现在统一从模型派生：字段名、值、类型都由模型给出，
// 格式差异只体现在「这个格式有没有这个能力」，不再体现在字段表上。
import type { Board } from "./board.ts"
import { containerOf } from "./board.ts"
import type { Key } from "./key.ts"
import type { SkinModel } from "./model.ts"
import type { SkinStyle } from "./style.ts"
import type { MotionNode } from "./motion.ts"
import { motionNodeKinds } from "./motion.ts"
import { cachedLayout } from "./layout-cache.ts"
import { findKey } from "./edit.ts"
import { boardPanels } from "./panel.ts"

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
  const editable = board.geometry.kind === "document"
  const note = key.layoutId === undefined
    ? "这个键只有样式，没有布局节点"
    : editable ? undefined : "几何由客户端决定，不能在这里改"
  const rect = key.layoutId === undefined ? undefined : cachedLayout(board)?.get(key.layoutId)
  // 触摸区按显示区还原成像素；same 就是显示区本身，none 是零面积。
  const touch = key.hitArea?.kind === "inset" && rect
    ? {
      x: rect.position.x + key.hitArea.edges.left,
      y: rect.position.y + key.hitArea.edges.top,
      width: rect.size.width - key.hitArea.edges.left - key.hitArea.edges.right,
      height: rect.size.height - key.hitArea.edges.top - key.hitArea.edges.bottom,
    }
    : key.hitArea?.kind === "none"
      ? { x: 0, y: 0, width: 0, height: 0 }
      : rect
        ? { x: rect.position.x, y: rect.position.y, width: rect.size.width, height: rect.size.height }
        : undefined
  return [
    { ...numberView("x", "X", rect?.position.x, note), readOnly: !editable },
    { ...numberView("y", "Y", rect?.position.y, note), readOnly: !editable },
    { ...numberView("width", "宽", rect?.size.width, note), readOnly: !editable },
    { ...numberView("height", "高", rect?.size.height, note), readOnly: !editable },
    { ...numberView("touch.x", "触摸 X", touch?.x, note), readOnly: !editable },
    { ...numberView("touch.y", "触摸 Y", touch?.y, note), readOnly: !editable },
    { ...numberView("touch.width", "触摸宽", touch?.width, note), readOnly: !editable },
    { ...numberView("touch.height", "触摸高", touch?.height, note), readOnly: !editable },
  ]
}

const ACTION_LABELS: ReadonlyArray<[keyof Key["actions"], string]> = [
  ["press", "点击"],
  ["long-press", "长按"],
  ["swipe-up", "上滑"],
  ["swipe-down", "下滑"],
  ["swipe-left", "左滑"],
  ["swipe-right", "右滑"],
]

/** 动作码：模型里的动作是语义对象，这里换成可读的短写。 */
export function actionText(action: Key["actions"][keyof Key["actions"]]): string | undefined {
  if (!action) return
  switch (action.kind) {
    case "text": return action.value === " " ? "空格" : action.value
    case "delete": return action.forward ? "前向删除" : "删除"
    case "enter": return "回车"
    case "candidate-page": return action.direction === "up" ? "候选上页" : "候选下页"
    case "case": return action.mode === "title" ? "首字母大写" : "大写锁定"
    case "switch": return action.board === "symbol" ? "符号" : action.board === "number" ? "数字" : "切换"
    case "open-app": return "打开应用"
    case "trigger": return action.event === "up" ? "短按动作" : "长按动作"
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
  const container = found.key.container
  const views = [
    styleView("style.back", "背景", container.back?.style),
    styleView("style.pressedBack", "按下背景", container.back?.pressed),
  ]
  container.fore.forEach((layer, index) => views.push(styleView(`style.fore.${index}`, `前景 ${index + 1}`, layer.style)))
  if (!container.fore.length) views.push({ key: "style.fore", label: "前景", kind: "style" })
  if (container.text?.style) views.push(styleView("style.text", "文字", container.text.style))
  if (container.icon) views.push(styleView("style.icon", "图标", container.icon))
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
    const override = boardPanels(board)?.tips?.get(ref.section)
    if (!override) return []
    return [{
      key: `state.${index}`,
      label: `状态 ${ref.state}`,
      kind: "readonly" as const,
      value: [
        override.container?.back?.style ? `背景 ${override.container.back.style}` : "",
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
  const board: Board | undefined = model.boards.find((item) => item.id === boardId)
  if (!board) return []
  const geometryNote = board.geometry.kind === "document" ? "由文档决定" : board.geometry.kind === "client" ? "由客户端决定" : "由骨架决定"
  const size = containerOf(board)
  return [
    numberView("size.width", "宽", size?.width, geometryNote),
    numberView("size.height", "高", size?.height, geometryNote),
    { key: "kind", label: "板种类", kind: "readonly", value: board.kind },
    { key: "geometry", label: "几何来源", kind: "readonly", value: board.geometry.kind },
    { key: "keys", label: "按键数", kind: "readonly", value: board.keys.length },
    { key: "orientation", label: "方向", kind: "readonly", value: board.orientation },
  ]
}

/** 板的面板组件摘要：候选栏、气泡、列表、工具栏、背景。 */
export function panelProperties(model: SkinModel, boardId: string): PropertyView[] {
  const board = model.boards.find((item) => item.id === boardId)
  if (!board) return []
  const views: PropertyView[] = []
  const panels = boardPanels(board)
  // 面板背景可能来自板的 StyleRef，也可能只写在面板组件里。
  const backdropStyle = board.backdrop ?? panels?.backdrop?.style
  if (backdropStyle) views.push(styleView("panel.backdrop", "面板背景", backdropStyle))
  // 候选栏可以有多个，逐个列出。
  for (const [index, candidate] of (panels?.candidates ?? []).entries()) {
    const suffix = index === 0 ? "" : `.${index + 1}`
    views.push(styleView(`panel.candidate${suffix}`, `候选栏背景${suffix}`, candidate.style))
    if (candidate.cellStyle) views.push(styleView(`panel.candidate${suffix}.cell`, "候选格", candidate.cellStyle))
    views.push({ key: `panel.candidate${suffix}.icons`, label: "候选栏图标", kind: "readonly", value: candidate.icons?.length ?? 0 })
  }
  if (panels?.hint) views.push(styleView("panel.hint", "气泡背景", panels.hint.style))
  if (panels?.list) {
    views.push(styleView("panel.list", "列表背景", panels.list.style))
    if (panels.list.cellSize) {
      views.push(numberView("panel.list.cell.width", "格子宽", panels.list.cellSize.width))
      views.push(numberView("panel.list.cell.height", "格子高", panels.list.cellSize.height))
    }
  }
  if (panels?.toolbar) views.push({ key: "panel.toolbar", label: "工具栏按钮", kind: "readonly", value: panels.toolbar.items.length })
  if (panels?.input) views.push(styleView("panel.input", "输入条背景", panels.input.style))
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
            ? `音效 ${layer.binding.sound}`
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
  const motion: MotionNode | undefined = model.motions.get(motionId)
  if (!motion) return []
  const kinds = [...new Set(motionNodeKinds(motion))]
  return [
    { key: "motion.id", label: "编号", kind: "readonly", value: motionId },
    { key: "motion.kind", label: "类型", kind: "readonly", value: kinds.join("、") },
    numberView("motion.duration", "时长", motion.timeline?.duration, "秒"),
    numberView("motion.delay", "延迟", motion.timeline?.delay, "秒"),
    numberView("motion.repeat", "重复", motion.timeline?.repeat),
    { key: "motion.bindings", label: "绑定数", kind: "readonly", value: motion.bindings?.length ?? 0 },
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
    sounds: model.sounds.length,
    main: main && containerOf(main) ? { width: containerOf(main)!.width, height: containerOf(main)!.height } : undefined,
  }
}
