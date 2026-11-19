// 基于布局与样式构建渲染模型。
//
// 布局树用 taffy 计算每个按键的矩形；样式引用在模型样式表里解析成图层。
// 这是预览与导出共用的“板 → 可绘制按键”的路径。
import type { Board } from "./board.ts"
import type { KeyContainer, Key } from "./key.ts"
import { actionText } from "./inspect.ts"
import type { LayoutBox } from "./layout.ts"
import { boardPanels } from "./panel.ts"
import { computeLayout } from "./layout.ts"
import type { SkinModel } from "./model.ts"
import { resolveStyle, type SkinLayer, type SkinStyle } from "./style.ts"

/**
 * 渲染投影：画布与交互层读的唯一键结构。
 * 矩形由布局树算出，样式引用由容器给出，没有一处来自原文。
 */
export type KeyRender = {
  key: Key
  /** 段名；普通键就是 key.id。 */
  section: string
  /** 这个按键覆盖的段；列表单元格这类合成项会指向多个段。 */
  sections: readonly string[]
  /** 布局树算出的矩形。 */
  rect: { x: number; y: number; width: number; height: number }
  /** 当前状态下生效的容器；状态覆盖已经合进来。 */
  container: KeyContainer
  /** 前景图标的固定绘制区域；没有就是按前景图自身尺寸画。 */
  foreRect?: { x: number; y: number; width: number; height: number }
  backStyle?: string
  highlightBackStyle?: string
  foreStyles: string[]
  /** 键上显示的文本；文字层的 content。 */
  text?: string
  /** 整键相关动画样式集合，供按下/动画播放查表。 */
  animStyles: string[]
  editable: boolean
  visible: boolean
  back?: SkinStyle
  fore: SkinStyle[]
  /** 正常态最终绘制的图层：背景 + 前景。 */
  layers: SkinLayer[]
}

/** 布局树给的是 position/size，绘制层统一按 x/y/宽高读。 */
function rectOf(box: LayoutBox): { x: number; y: number; width: number; height: number } {
  return { x: box.position.x, y: box.position.y, width: box.size.width, height: box.size.height }
}

/** 按键在某个皮肤状态下的容器：状态覆盖只替换它声明的那几层。 */
function containerIn(container: KeyContainer, state: number | undefined, key: Key, board: Board): KeyContainer {
  if (state === undefined || !key.stateRefs?.length) return container
  // 状态覆盖按段号从板的池里取，不回到原文。
  const section = key.stateRefs.find((ref) => stateMatches(ref.state, state))?.section
  const override = section === undefined ? undefined : boardPanels(board)?.tips?.get(section)
  if (!override?.container) return container
  const patch = override.container
  return {
    ...container,
    ...(patch.back ? { back: { ...container.back, ...patch.back } } : {}),
    ...(patch.fore ? { fore: patch.fore } : {}),
    ...(patch.text ? { text: { ...container.text, ...patch.text } } : {}),
    ...(patch.icon ? { icon: patch.icon } : {}),
    ...(patch.press ? { press: patch.press } : {}),
  }
}

/** `S12` 这种状态名里的数字与当前状态比对。 */
export function stateMatches(name: string, state: number): boolean {
  const digits = /(\d+)$/.exec(name)
  return digits ? Number(digits[1]) === state : false
}

/** 把状态覆盖合进容器：覆盖只替换它声明的那几层。 */
export function containerWithState(container: KeyContainer, override: Partial<KeyContainer> | undefined): KeyContainer {
  if (!override) return container
  return {
    ...container,
    ...(override.back ? { back: { ...container.back, ...override.back } } : {}),
    ...(override.fore ? { fore: override.fore } : {}),
    ...(override.text ? { text: { ...container.text, ...override.text } } : {}),
    ...(override.icon ? { icon: override.icon } : {}),
    ...(override.press ? { press: override.press } : {}),
  }
}

/** 一块板的按键渲染数据；矩形来自布局树，图层来自按键容器各自的层。 */
export async function buildBoard(model: SkinModel, board: Board, state?: number): Promise<KeyRender[]> {
  const rects = await computeLayout(board.layout, board.container)
  // 同位置、同动作的几个段在真机上是一个键：只画一次，段名都留着。
  // 后者覆盖前者的样式，与同一按键在多个状态下重复定义时一致。
  const groups = new Map<string, Key[]>()
  for (const key of board.keys) {
    const rect = rects.get(key.id)
    // 布局树里没有这个键就没有几何；不给兜底值，缺了就是缺了。
    if (!rect) continue
    const signature = [rect.position.x, rect.position.y, rect.size.width, rect.size.height, actionText(key.actions.press) ?? ""].join("|")
    groups.set(signature, [...(groups.get(signature) ?? []), key])
  }
  return [...groups.values()].map((keys) => {
    const key = keys[keys.length - 1]
    const rect = rects.get(key.id)!
    const container = containerIn(key.container, state, key, board)
    const back = resolveStyle(model.styles, container.back?.style)
    const fore = container.fore.flatMap((layer) => {
      const style = resolveStyle(model.styles, layer.style)
      return style ? [style] : []
    })
    const layers = [...(back?.normal ?? []), ...fore.flatMap((style) => style.normal)]
    return {
      key,
      section: key.id,
      sections: keys.flatMap((each) => each.sections ?? [each.id]),
      rect: rectOf(rect),
      container,
      ...(key.foreground ? {
        foreRect: {
          x: rect.position.x + key.foreground.left * rect.size.width,
          y: rect.position.y + key.foreground.top * rect.size.height,
          width: (1 - key.foreground.left - key.foreground.right) * rect.size.width,
          height: (1 - key.foreground.top - key.foreground.bottom) * rect.size.height,
        },
      } : {}),
      ...(container.back?.style ? { backStyle: container.back.style } : {}),
      ...(container.back?.pressed ? { highlightBackStyle: container.back.pressed } : {}),
      foreStyles: container.fore.flatMap((layer) => (layer.style ? [layer.style] : [])),
      ...(container.text?.content ? { text: container.text.content } : {}),
      animStyles: [
        ...new Set([
          ...container.fore.flatMap((layer) => (layer.anim ? [layer.anim] : [])),
          ...(container.back?.anim ? [container.back.anim] : []),
          ...(container.press ? [container.press] : []),
        ]),
      ],
      editable: key.editable ?? true,
      visible: key.visible !== false,
      ...(back ? { back } : {}),
      fore,
      layers,
    }
  })
}
