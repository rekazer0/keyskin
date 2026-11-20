// BDS 的渲染投影：只读板，不回文档。
//
// 按键的几何来自布局树，样式引用来自按键容器与板上各组件自己的字段；
// 具体样式（图集、切图、文字度量）由编辑器的解析器去取，这里只出引用。
import type { Board } from "@/skin-model/board.ts"
import { containerOf } from "@/skin-model/board.ts"
import { containerWithState, stateMatches, type KeyRender } from "@/skin-model/build.ts"
import { computeLayout, type LayoutBox } from "@/skin-model/layout.ts"
import { boardPanels, type ListPanel } from "@/skin-model/panel.ts"

/** 一块板的渲染投影；同一位置同一动作的按键段在真机上是一个键。 */
export async function boardRenders(board: Board, state?: number): Promise<KeyRender[]> {
  const container = containerOf(board)
  // 容器未知就没有几何可算：这块板没有可画的键，不拿 0 去造一堆零矩形。
  if (!container) return []
  const rects = await computeLayout(board.layout, container)
  const groups = new Map<string, typeof board.keys>()
  for (const key of board.keys) {
    // 没有 layoutId 的键只有身份与样式，没有几何：不画、不命中。
    if (key.layoutId === undefined) continue
    const rect = rects.get(key.layoutId)
    // 布局树里没有这个键就没有几何。
    if (!rect) continue
    const { position, size } = rect
    const signature = [position.x, position.y, size.width, size.height, pressOf(key)].join("|")
    groups.set(signature, [...(groups.get(signature) ?? []), key])
  }
  const keys = [...groups.values()].map((members) => {
    const key = members[members.length - 1]
    // 分组时已经跳过没有 layoutId 的键，这里一定有节点。
    const { position, size } = rects.get(key.layoutId!)!
    // 状态覆盖写在板的提示池里；按键只记状态名与段号。
    const ref = state === undefined ? undefined : key.stateRefs?.find((each) => stateMatches(each.state, state))
    const override = ref ? boardPanels(board)?.tips?.get(ref.section)?.container : undefined
    const container = containerWithState(key.container, override)
    return renderOf(
      key.id,
      { x: position.x, y: position.y, width: size.width, height: size.height },
      container,
      {
        sections: members.flatMap((each) => each.sections ?? [each.id]),
        key,
        ...(key.foreground
          ? {
            foreRect: {
              x: position.x + key.foreground.left * size.width,
              y: position.y + key.foreground.top * size.height,
              width: (1 - key.foreground.left - key.foreground.right) * size.width,
              height: (1 - key.foreground.top - key.foreground.bottom) * size.height,
            },
          }
          : {}),
        editable: key.editable ?? true,
        visible: key.visible !== false,
      },
    )
  })
  // 板上其余组件同样是可画的一块，一起进渲染列表。
  return [...keys, ...componentRenders(board)]
}

/** 组件：面板、候选栏、列表、更多菜单、气泡。每种自己决定要画几块、画在哪。 */
function componentRenders(board: Board): KeyRender[] {
  return [
    ...panelRenders(board),
    ...candidateRenders(board),
    ...listRenders(board),
    ...moreRenders(board),
    ...hintRenders(board),
  ]
}

/** 面板背景：整板的底。 */
function panelRenders(board: Board): KeyRender[] {
  const backdrop = boardPanels(board)?.backdrop
  if (!backdrop?.viewRect) return []
  return [componentOf("PANEL", backdrop.viewRect, backdrop.style ?? board.backdrop, backdrop.foreStyle)]
}

/** 候选栏；一份布局里可以有多个 `[CAND]`，只有一个时沿用段名。 */
function candidateRenders(board: Board): KeyRender[] {
  const bars = boardPanels(board)?.candidates ?? []
  return bars.flatMap((bar, index) => {
    if (!bar.viewRect) return []
    const name = bars.length === 1 ? "CAND" : `CAND${index + 1}`
    return [componentOf(name, bar.viewRect, bar.style, undefined)]
  })
}

/** 列表容器；单元格由候选栏的格子样式决定，不单独成项。 */
function listRenders(board: Board): KeyRender[] {
  const list = boardPanels(board)?.list
  if (!list) return []
  const viewRect = list.layout?.viewRect ?? derivedListRect(list.layout)
  if (!viewRect) return []
  return [componentOf("LIST", viewRect, list.appearance?.style, list.appearance?.foreStyle)]
}

/**
 * 列表矩形：SXI 的原生 `rect` 优先；BDS 由 `offset` 与 `cellSize × count` 推导。
 *
 * 方向按 `LIST_ORDER`：`0` 与缺省都是纵向。三个样本（`py_9`/`bh`/`symbol`）纵向都贴底
 * （`py_9` 与 `bh` 算到 y=311，容器 312；`symbol` 到 y=299，容器 372），横向会压住按键区。
 * `padding` 不进外框：`bh` 的 `PADDING=2,0,2,0` 缩的是格子内容，外框仍是 `POS` 到
 * `POS + CELL_SIZE × LIST_NUM`。
 */
function derivedListRect(layout: ListPanel["layout"]): LayoutBox | undefined {
  const offset = layout?.offset
  const cell = layout?.cellSize
  const count = layout?.count
  if (!offset || !cell || !count) return undefined
  const vertical = layout.order === undefined || layout.order === "0"
  const size = vertical
    ? { width: cell.width, height: cell.height * count }
    : { width: cell.width * count, height: cell.height }
  return { position: { x: offset.x, y: offset.y }, size }
}

/** 更多菜单：只有一个前景样式，没有背景层。 */
function moreRenders(board: Board): KeyRender[] {
  const more = boardPanels(board)?.more
  if (!more?.viewRect) return []
  return [componentOf("MORE", more.viewRect, undefined, more.foreStyle)]
}

/** 提示气泡的外框；气泡里的字由 `paint/hint.ts` 按候选现画。 */
function hintRenders(board: Board): KeyRender[] {
  const hint = boardPanels(board)?.hint
  if (!hint?.viewRect) return []
  return [componentOf("HINT", hint.viewRect, hint.style, hint.foreStyle)]
}

/** 一个组件块的渲染项：几何、背景引用、前景引用，没有别的东西。 */
function componentOf(
  id: string,
  box: { position: { x: number; y: number }; size: { width: number; height: number } },
  style: string | undefined,
  fore: string | undefined,
): KeyRender {
  const container = {
    ...(style ? { back: { style } } : {}),
    fore: fore ? [{ style: fore }] : [],
  }
  return renderOf(id, { x: box.position.x, y: box.position.y, width: box.size.width, height: box.size.height }, container, {
    sections: [id],
    editable: false,
    visible: true,
  })
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
    key: extra.key ?? { id, layoutId: id, actions: {}, container },
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
function pressOf(key: Board["keys"][number]): string {
  const action = key.actions?.press
  if (!action) return ""
  return action.kind === "text" ? action.value : `${action.kind}:${"code" in action ? action.code : ""}`
}
