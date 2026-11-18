// 模型属性 → 检查器字段。
//
// `inspect.ts` 给出「这个对象有哪些属性、值是什么」，这里把它翻成检查器的 `FieldSpec`，
// 并给出写回模型的动作。两者之间隔着控件选择：数值用滑块还是输入框、选项用分段还是下拉，
// 都由属性的 `kind` 与候选数量决定，不看格式。
import type { FieldSpec } from "@/app/property-rows.ts"
import type { PropertyView } from "@/skin-model/inspect.ts"

/** 一个属性转成字段后，用户改值时该做什么。 */
export type FieldBinding = {
  view: PropertyView
  spec: FieldSpec
}

/** 数值是否适合滑块：只有位置与尺寸这类有明确范围的才用滑块。 */
function sliderRange(view: PropertyView): { min: number; max: number } | undefined {
  if (!/^(X|Y|宽|高|触摸)/.test(view.label)) return
  if (typeof view.value !== "number") return
  // 位置与尺寸的取值范围按键盘尺寸给，避免滑块过于灵敏。
  return /^(X|触摸 X)$/.test(view.label) ? { min: 0, max: 1080 }
    : /^(Y|触摸 Y)$/.test(view.label) ? { min: 0, max: 1200 }
      : { min: 0, max: 540 }
}

/** 属性 → 字段。只读属性输出 `readonly`，界面上不可编辑。 */
export function fieldOf(view: PropertyView): FieldSpec {
  if (view.readOnly) return { kind: "readonly", value: textOf(view) }
  switch (view.kind) {
    case "number": {
      const range = sliderRange(view)
      return {
        kind: "number",
        value: view.value === undefined ? "" : String(view.value),
        ...(range ? { min: range.min, max: range.max } : {}),
        step: 1,
      }
    }
    case "boolean":
      return { kind: "switch", checked: view.value === true }
    case "choice": {
      const options = (view.options ?? []).map((label): [string, string] => [label, label])
      if (!options.length) return { kind: "readonly", value: textOf(view) }
      return { kind: "choice", value: String(view.value ?? ""), options, layout: options.length > 4 ? "select" : undefined }
    }
    case "style":
      // 样式引用交给检查器的引用卡组件，`reference` 指明引用类型。
      return { kind: "style", value: String(view.value ?? ""), reference: view.key }
    case "image":
      return { kind: "image", value: String(view.value ?? ""), load: () => undefined }
    case "action":
      return { kind: "text", value: String(view.value ?? ""), placeholder: "动作码" }
    case "text":
      return { kind: "text", value: textOf(view) }
    case "readonly":
      return { kind: "readonly", value: textOf(view) }
  }
}

function textOf(view: PropertyView): string {
  if (view.value === undefined) return ""
  return typeof view.value === "boolean" ? (view.value ? "是" : "否") : String(view.value)
}

/** 一组属性 → 字段；顺序保持模型给出的顺序。 */
export function fieldsOf(views: readonly PropertyView[]): FieldBinding[] {
  return views.map((view) => ({ view, spec: fieldOf(view) }))
}

/** 字段改动 → 写回模型时需要的新值。数值字段会做一次解析，空串表示清空。 */
export function valueOfField(view: PropertyView, raw: string | boolean): string | number | boolean | undefined {
  if (typeof raw === "boolean") return raw
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (view.kind !== "number") return raw
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 按键几何的四个字段并成两行：X/Y 与宽/高。 */
export function geometryRows(views: readonly PropertyView[]): FieldBinding[][] {
  const byKey = new Map(views.map((view) => [view.key, view]))
  const rows: FieldBinding[][] = []
  const pair = (left: string, right: string): FieldBinding[] | undefined => {
    const a = byKey.get(left)
    const b = byKey.get(right)
    return a && b ? fieldsOf([a, b]) : undefined
  }
  const position = pair("x", "y")
  if (position) rows.push(position)
  const size = pair("width", "height")
  if (size) rows.push(size)
  const touchPosition = pair("touch.x", "touch.y")
  if (touchPosition) rows.push(touchPosition)
  const touchSize = pair("touch.width", "touch.height")
  if (touchSize) rows.push(touchSize)
  return rows
}
