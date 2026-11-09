import { type AnimationStyleItem, type AnimationStyleList } from "../animation-inspector.ts"
import { section } from "./property-rows"
import { PALM_ANIMATION_EVENTS } from "../palm/sxi-animation.ts"
import { element } from "../dom-element.ts"
import { styleCard } from "../style-card.ts"
import { asObject } from "../palm/sxi-ini.ts"
import { styleConfigPath } from "./config-context"
import { documentFields, selectedKeyName, selectedKeyContext, selectedKeyPreview, mode } from "./dom"
import { createIcon } from "../icons.ts"
import { writeSxiValue } from "./sxi-fields"
import { isEditing } from "./edit-history"
import { selectedAnimationStyle, selectAnimationStyle, previewStyleAnimation, openAnimation, animationSelectionContext } from "./animation-resource"
import { selectFile } from "./navigation"
import { layoutLabel } from "./file-tree"
import { styleAnimationPlayers, styleAnimationSummary } from "./legacy-animation-inspector"
import { renderStyleResourceDetail } from "./resource-inspector"
import { addStyle, canAddStyle, duplicateStyle, removeStyle, styleConfigDocument, styleKind } from "./style-picker"
import { styleUsages } from "./style-references"
import { openPalmSkin, sxiPointer } from "./sxi-documents"
import { palmStyle, palmStylePointer } from "./sxi-styles"
import { syncInspectorRows } from "../inspector-shell.ts"
import { appState } from "./state"
import { palmStyleAnimationStates } from "./style-card-preview"

/** The same card component and samplers as the style configuration gallery. */
export function animationStyleCard(item: AnimationStyleItem): HTMLElement {
  const styles = styleConfigDocument()
  const kind = styleKind(item.id, styles)
  const note = `${item.count} 个动画 · ${item.detail}`
  const card = styleCard({
    id: item.id, label: item.title, kind,
    animationPreview: true,
    summary: styles ? styleAnimationSummary(item.id, styles) : item.detail,
    animation: () => appState.archive?.format === "sxi" ? palmStyleAnimationStates(item.id, () => {}).map(state => state.content) : styles ? styleAnimationPlayers(item.id, styles, true) : [],
    note,
  })
  card.title = `${item.title} · ${note}`
  card.addEventListener("mouseenter", () => previewStyleAnimation([item.id]))
  return card
}

/** 样式列表的新建 / 复制 / 删除：新样式按下时播放 `pressAnimation`（选中的动画），这样才会出现在这份列表里。 */
export function animationStyleActions(pressAnimation: number | undefined): Pick<AnimationStyleList, "create" | "duplicate" | "remove"> {
  if (!canAddStyle()) return {}
  const id = selectedAnimationStyle()
  const uses = id ? styleUsages(id).length : 0
  const show = (created: string | undefined) => { if (created) selectAnimationStyle(created) }
  return {
    create: pressAnimation === undefined ? undefined : () => show(addStyle(pressAnimation)),
    duplicate: () => { if (id) show(duplicateStyle(id)) },
    remove: { run: () => { if (id && removeStyle(id)) selectAnimationStyle(undefined) }, blocked: uses ? `被 ${uses} 处引用` : undefined },
  }
}

/** Replaces only the parameter inspector, never the workspace lists or keyboard. */
export function populateAnimationStyleInspector(): void {
  if (!appState.animationStyleEditing || appState.animationDesignMode === "all" || appState.archive?.format === "bda") return
  const id = selectedAnimationStyle()
  if (!id) return
  const container = documentFields
  const fields = element("div")
  void renderStyleResourceDetail({ container: fields, id, refresh: populateAnimationStyleInspector })
  const lists = Array.from(container.children).filter(node => node.querySelector(".ui-listbox"))
  container.replaceChildren(...lists, ...Array.from(fields.children))
  const bindings = section("触发动画")
  if (appState.archive?.format === "sxi") {
    for (const [event, eventLabel] of PALM_ANIMATION_EVENTS) {
      const animation = asObject(palmStyle(id)?.s_5)?.[event]
      const row = element("div", "ui-field")
      row.dataset.inspectorRowKey = JSON.stringify([palmStylePointer(id), "s_5", event])
      const label = element("span")
      label.textContent = eventLabel
      const control = element("span", "ui-input")
      const input = element("input")
      input.type = "number"
      input.min = "1"
      input.step = "1"
      input.placeholder = "未设置"
      input.value = animation === undefined ? "" : String(animation)
      input.disabled = !isEditing()
      input.setAttribute("aria-label", `${eventLabel}动画编号`)
      input.addEventListener("change", () => {
        const target = palmStylePointer(id)
        if (!target || !isEditing() || !input.checkValidity()) return
        writeSxiValue([target], ["s_5", event], input.value === "" ? undefined : Number(input.value))
      })
      control.append(input)
      if (animation !== undefined) {
        const button = element("button", "ui-button")
        button.type = "button"
        button.textContent = `动画 ${animation}`
        button.addEventListener("click", () => {
          const pointer = sxiPointer(appState.selectedPath)!
          const themed = asObject(openPalmSkin()?.[pointer[0]])
          const table = { ...asObject(asObject(themed?.s_info)?.ss_2), ...asObject(asObject(themed?.[pointer[1]])?.ss_2) }
          openAnimation(appState.selectedPath, Boolean(asObject(table[String(animation)])?.a4), String(animation))
        })
        control.append(button)
      }
      row.append(label, control)
      bindings.append(row)
    }
  }
  const usage = section("应用于")
  // 位置是「文件 · [段] 键」：按布局文件分组，一行一个布局，点击切到那个布局的同一动画视图。
  const view = appState.animationDesignMode
  const layouts = new Map<string, string[]>()
  for (const location of styleUsages(id)) {
    const [path, ...rest] = location.split(" · ")
    layouts.set(path, [...layouts.get(path) ?? [], rest.join(" · ")])
  }
  if (!layouts.size) usage.append(Object.assign(element("p", "ui-field-note"), { textContent: "未使用" }))
  for (const [path, refs] of layouts) {
    const keys = [...new Set(refs.map(ref => /^\[(.+?)\]/.exec(ref)?.[1] ?? ref))]
    const row = element("button", "ui-list-item")
    row.type = "button"
    row.title = `${path}\n${refs.join("\n")}`
    const text = element("span", "ui-list-item-text")
    const title = element("strong")
    title.textContent = appState.archive?.format === "sxi" ? path : layoutLabel(path.split("/").pop()!)
    const detail = element("small")
    detail.textContent = `${keys.length} 处 · ${keys.join("、")}`
    text.append(title, detail)
    row.append(createIcon("keyboard", 14), text)
    // 手心的位置都在 skin.json 里，不是能单独打开的布局。
    if (appState.archive?.format === "sxi") row.disabled = true
    else if (path === appState.selectedPath) row.setAttribute("aria-current", "true")
    else row.addEventListener("click", () => {
      selectFile(path, "overview", view)
      selectAnimationStyle(id)
    })
    usage.append(row)
  }
  if (bindings.childElementCount > 1) container.append(bindings)
  container.append(usage)
  selectedKeyName.textContent = `STYLE${id}`
  selectedKeyContext.textContent = styleConfigPath()
  selectedKeyPreview.replaceChildren(createIcon("paintbrush", 16))
  syncInspectorRows(JSON.stringify([appState.selectedPath, appState.selectedKeySections, mode.value, animationSelectionContext()]))
}
