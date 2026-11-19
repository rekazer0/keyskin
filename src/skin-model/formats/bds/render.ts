// BDS 的渲染投影：只读板，不回文档。
//
// 按键的几何来自布局树，样式引用来自按键容器与板上各组件自己的字段；
// 具体样式（图集、切图、文字度量）由编辑器的解析器去取，这里只出引用。
import type { SkinBoard } from "@/skin-model/board.ts"
import { containerWithState, stateMatches, type KeyRender } from "@/skin-model/build.ts"
import { computeLayout } from "@/skin-model/layout.ts"

/** 一块板的渲染投影；同一位置同一动作的按键段在真机上是一个键。 */
export async function bdsRenders(board: SkinBoard, state?: number): Promise<KeyRender[]> {
  const rects = await computeLayout(board.layout, board.size)
  const groups = new Map<string, typeof board.keys>()
  for (const key of board.keys) {
    const rect = rects.get(key.id)
    // 布局树里没有这个键就没有几何。
    if (!rect) continue
    const { position, size } = rect
    const signature = [position.x, position.y, size.width, size.height, pressOf(key)].join("|")
    groups.set(signature, [...(groups.get(signature) ?? []), key])
  }
  const keys = [...groups.values()].map((members) => {
    const key = members[members.length - 1]
    const { position, size } = rects.get(key.id)!
    // 状态覆盖写在板的提示池里；按键只记状态名与段号。
    const ref = state === undefined ? undefined : key.stateRefs?.find((each) => stateMatches(each.state, state))
    const override = ref ? board.tips?.get(ref.section)?.container : undefined
    const container = containerWithState(key.container, override)
    return renderOf(
      key.id,
      { x: position.x, y: position.y, width: size.width, height: size.height },
      container,
      {
        sections: members.flatMap((each) => each.sections ?? [each.id]),
        key,
        ...(key.foreRect
          ? { foreRect: { x: key.foreRect.position.x, y: key.foreRect.position.y, width: key.foreRect.size.width, height: key.foreRect.size.height } }
          : {}),
        editable: key.editable ?? true,
        visible: key.visible !== false,
      },
    )
  })
  // 板上其余组件同样是可画的一块，一起进渲染列表。
  return [...keys, ...componentRenders(board)]
}

/** 组件：面板、候选栏、列表、更多菜单、气泡。几何都在板上。 */
function componentRenders(board: SkinBoard): KeyRender[] {
  const components: KeyRender[] = []
  const push = (id: string, box: { position: { x: number; y: number }; size: { width: number; height: number } } | undefined, style: string | undefined, fore: string | undefined, text?: string) => {
    if (!box) return
    const container = {
      ...(style ? { back: { style } } : {}),
      fore: fore ? [{ style: fore }] : [],
      ...(text ? { text: { content: text } } : {}),
    }
    components.push(renderOf(id, { x: box.position.x, y: box.position.y, width: box.size.width, height: box.size.height }, container, {
      sections: [id],
      editable: false,
      visible: true,
    }))
  }
  push("PANEL", board.backdrop?.viewRect, board.backdrop?.style, board.backdrop?.foreStyle)
  for (const [index, bar] of (board.candidates ?? []).entries()) {
    push(board.candidates?.length === 1 ? "CAND" : `CAND${index + 1}`, bar.viewRect, bar.style, undefined)
  }
  push("LIST", board.list?.viewRect, board.list?.style, board.list?.foreStyle)
  push("MORE", board.more?.viewRect, undefined, board.more?.foreStyle)
  push("HINT", board.hint?.viewRect, board.hint?.style, board.hint?.foreStyle)
  return components
}

/** 一个渲染项；样式引用由容器给，样式本身不在这里解析。 */
function renderOf(
  id: string,
  rect: { x: number; y: number; width: number; height: number },
  container: KeyRender["container"],
  extra: Partial<KeyRender> & { sections: readonly string[] },
): KeyRender {
  const foreStyles = container.fore.flatMap((layer) => (layer.style ? [layer.style] : []))
  return {
    key: extra.key ?? { id, actions: {}, container },
    section: id,
    sections: extra.sections,
    rect,
    container,
    ...(extra.foreRect ? { foreRect: extra.foreRect } : {}),
    ...(container.back?.style ? { backStyle: container.back.style } : {}),
    ...(container.back?.pressed ? { highlightBackStyle: container.back.pressed } : {}),
    foreStyles,
    ...(container.text?.content ? { text: container.text.content } : {}),
    animStyles: [
      ...new Set([
        ...container.fore.flatMap((layer) => (layer.anim ? [layer.anim] : [])),
        ...(container.back?.anim ? [container.back.anim] : []),
        ...(container.press ? [container.press] : []),
      ]),
    ],
    editable: extra.editable ?? true,
    visible: extra.visible !== false,
    fore: [],
    layers: [],
  }
}

/** 按键按下时执行的动作文本，用来区分同位置但动作不同的键。 */
function pressOf(key: SkinBoard["keys"][number]): string {
  const action = key.actions.press
  if (!action) return ""
  return action.kind === "text" ? action.value : `${action.kind}:${"code" in action ? action.code : ""}`
}
