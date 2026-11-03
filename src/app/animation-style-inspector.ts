import { animationPlayer } from "../animation-player.ts"
import { animationSection, type AnimationStyleItem } from "../animation-inspector.ts"
import { element } from "../dom-element.ts"
import { styleCard } from "../style-card.ts"
import { IniDocument } from "../ini.ts"
import { palmPreviewClip } from "../palm/palm-preview-clip.ts"
import { asObject, type Json } from "../palm/sxi-ini.ts"
import { PalmStyles } from "../palm/palm-styles.ts"
import { palmFieldLabel } from "../palm/palm-labels.ts"
import { visualResolver } from "./bda-documents"
import { styleConfigPath } from "./config-context"
import { documentFields, selectedKeyName, selectedKeyContext, selectedKeyPreview, theme, mode } from "./dom"
import { createIcon } from "../icons.ts"
import { writeSxiValue } from "./sxi-fields"
import { isEditing } from "./edit-history"
import { selectedAnimationStyle, previewStyleAnimation, openAnimation, animationSelectionContext } from "./animation-resource"
import { styleAnimationPlayers, styleAnimationSummary } from "./legacy-animation-inspector"
import { renderStyleResourceDetail } from "./resource-inspector"
import { styleConfigDocument, styleKind, styleKinds } from "./style-picker"
import { isStyleReferenceKey } from "./style-references"
import { openPalmSkin, palmTheme, sxiPointer } from "./sxi-documents"
import { palmStyleLocation } from "../palm/palm-style-edit.ts"
import { palmStyle, palmStylePointer } from "./sxi-styles"
import { syncInspectorRows } from "../inspector-shell.ts"
import { appState } from "./state"

const PALM_EVENTS: Record<string, string> = { "1": "按下", "2": "松开", "3": "显示", "4": "隐藏", "5": "长按" }

function palmPlayers(id: string): HTMLElement[] {
  const skin = openPalmSkin()
  const pointer = sxiPointer(appState.selectedPath)
  if (!skin || !pointer) return []
  const themed = asObject(skin[pointer[0]])
  const table = { ...asObject(asObject(themed?.s_info)?.ss_2), ...asObject(asObject(themed?.[pointer[1]])?.ss_2) }
  const bindings = asObject(palmStyle(id)?.s_5)
  const resolver = visualResolver()
  return [...new Set(Object.values(bindings ?? {}).map(String))].map(animation => animationPlayer({
    clip: palmPreviewClip(table, animation), key: `${appState.selectedPath}|${animation}`, resolver, thumbnail: true,
    readFile: resolver instanceof PalmStyles ? file => resolver.bytes(file) : undefined,
  }))
}

/** The same card component and samplers as the style configuration gallery. */
export function animationStyleCard(item: AnimationStyleItem): HTMLElement {
  const styles = styleConfigDocument()
  const kind = styleKind(item.id, styles)
  const card = styleCard({
    id: item.id, label: item.title, kind, kindLabel: styleKinds[kind].label, kindIcon: styleKinds[kind].icon,
    animationPreview: true,
    summary: styles ? styleAnimationSummary(item.id, styles) : item.detail,
    animation: () => appState.archive?.format === "sxi" ? palmPlayers(item.id) : styles ? styleAnimationPlayers(item.id, styles, true) : [],
  })
  const detail = element("small", "ui-field-note")
  detail.textContent = `${item.count} 个动画 · ${item.detail}`
  card.append(detail)
  card.title = `${item.title} · ${detail.textContent}`
  card.addEventListener("mouseenter", () => previewStyleAnimation([item.id]))
  return card
}

/** Actual reference locations, including layouts not currently shown on the canvas. */
function usageLocations(id: string): string[] {
  const archive = appState.archive
  if (!archive) return []
  const locations: string[] = []
  if (archive.format === "sxi") {
    const skin = openPalmSkin()
    const walk = (value: Json, path: string[]) => {
      if (Array.isArray(value)) { value.forEach((item, index) => walk(item, [...path, String(index)])); return }
      const object = asObject(value)
      if (!object) return
      for (const [key, child] of Object.entries(object)) {
        if (/^(?:base_(?:b|f|s|ba|fa|a|pa)|asi)$/.test(key) && [child].flat().map(String).includes(id)) {
          locations.push(`skin.json · ${[...path, key].join(".")}（${palmFieldLabel(key)}）`)
        } else walk(child, [...path, key])
      }
    }
    const selected = palmStylePointer(id, skin)?.join(".")
    for (const orientation of ["port", "land"] as const) {
      if (skin && palmStyleLocation(skin, palmTheme(), orientation, id)?.join(".") === selected) {
        walk(asObject(skin[palmTheme()])?.[`${orientation}_layout`], [palmTheme(), `${orientation}_layout`])
      }
    }
    return locations
  }
  for (const path of archive.names()) {
    if (!path.startsWith(`${theme.value}/`) || !/\.(ini|cnd|pop)$/i.test(path) || !archive.isText(path)) continue
    const local = /^(.*\/skin\/(?:port|land))\//.exec(path)?.[1]
    const effectiveStyles = local && archive.isText(`${local}/res/default.css`) ? `${local}/res/default.css` : `${theme.value}/skin/res/default.css`
    if (styleConfigPath() !== effectiveStyles) continue
    const document = path === appState.layoutPath && appState.layoutDocument ? appState.layoutDocument : IniDocument.parse(archive.getText(path))
    for (const { section, key, value } of document.entries()) {
      if (isStyleReferenceKey(key) && value.split(",").map(part => part.trim()).includes(id)) locations.push(`${path} · [${section}] ${key}`)
    }
  }
  return locations
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
  const bindings = animationSection("触发动画", "document-property-section")
  if (appState.archive?.format === "sxi") {
    for (const [event, eventLabel] of Object.entries(PALM_EVENTS)) {
      const animation = asObject(palmStyle(id)?.s_5)?.[event]
      const row = element("div", "ui-field document-property-field")
      row.dataset.inspectorRowKey = JSON.stringify([palmStylePointer(id), "s_5", event])
      const label = element("span")
      label.textContent = eventLabel
      const control = element("span", "ui-input")
      const input = element("input")
      input.type = "number"
      input.min = "1"
      input.step = "1"
      input.placeholder = "未配置"
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
  const usage = animationSection("应用于", "document-property-section")
  const locations = usageLocations(id)
  for (const location of locations.length ? locations : ["未被应用"]) {
    const note = element("p", "ui-field-note")
    note.textContent = location
    usage.append(note)
  }
  if (bindings.childElementCount > 1) container.append(bindings)
  container.append(usage)
  selectedKeyName.textContent = `STYLE${id}`
  selectedKeyContext.textContent = styleConfigPath()
  selectedKeyPreview.replaceChildren(createIcon("paintbrush", 16))
  syncInspectorRows(JSON.stringify([appState.selectedPath, appState.selectedKeySections, mode.value, animationSelectionContext()]))
}
