// BDA 按键的「文字」字段：编辑选中按键的主文字层或其后的提示文字层；只有图片前景的按键在第一次
// 修改时新建一个文字样式，追加到它的 foreStyles 末尾。
import { type BdaPanel, type BdaStyleRef, bdaStyleRef } from "../bda.ts"
import { addBdaStyle, updateBdaStyle } from "../bda-encode.ts"
import { element } from "../dom-element.ts"
import { appState } from "./state"
import { effectiveKeySection } from "./config-context"
import { currentBdaAppearance, refreshBdaLayout, refreshSelectedBdaSource, bdaAppearancePart } from "./bda-documents"
import { selectedBdaKeyNames } from "./document-inspector"
import { commitBytes, isEditing, updateDirty } from "./edit-history"
import { showStatus } from "./file-operations"
import { populateKeyInspector, withBdaPanelRefs } from "./key-inspector"
import { refreshPreview } from "./preview-render"
import { keyTextLayerSwitch } from "./dom"

/** The selected keys' text layers as the canvas draws them (a state key's in its state): main, then hints. */
function selectedBdaTextLayers(): { label: BdaStyleRef[]; hint: BdaStyleRef[] } {
  const layout = appState.layoutDocument
  const layers = { label: [] as BdaStyleRef[], hint: [] as BdaStyleRef[] }
  if (appState.archive?.format !== "bda" || !layout) return layers
  for (const section of appState.selectedKeySections) {
    const texts = (layout.get(effectiveKeySection(section), "FORE_STYLE") ?? "").split(",")
      .map(bdaStyleRef).filter((ref): ref is BdaStyleRef => ref?.type === "text")
    layers.label.push(...texts.slice(0, 1))
    layers.hint.push(...texts.slice(1))
  }
  return layers
}

export function selectedBdaTextRefs(): BdaStyleRef[] {
  const layers = selectedBdaTextLayers()
  return appState.bdaTextLayer === "hint" && layers.hint.length ? layers.hint : layers.label
}

function selectedPanel(): BdaPanel | undefined {
  const name = appState.selectedPath.split("/").pop()?.replace(/\.ini$/i, "") ?? ""
  return currentBdaAppearance()?.appearance.panels.get(name)
}

/** Whether a text edit can give the selected keys a text layer they lack. */
export function canCreateBdaKeyText(): boolean {
  const panel = selectedPanel()
  return Boolean(isEditing() && panel && bdaAppearancePart(appState.selectedPath)?.kind === "panel"
    && selectedBdaKeyNames().some((name) => panel.keys.has(name)))
}

/** 主文字 / 提示文字 switch, shown when a selected key has text after its main text. */
export function renderBdaTextLayerSwitch(): void {
  const layers = selectedBdaTextLayers()
  keyTextLayerSwitch.replaceChildren()
  keyTextLayerSwitch.hidden = !layers.hint.length
  if (!layers.hint.length) return
  const current = appState.bdaTextLayer === "hint" ? "hint" : "label"
  for (const [layer, label] of [["label", "主文字"], ["hint", "提示文字"]] as const) {
    const button = element("button")
    button.type = "button"
    button.textContent = label
    button.setAttribute("aria-pressed", String(layer === current))
    button.addEventListener("click", () => {
      appState.bdaTextLayer = layer
      populateKeyInspector()
    })
    keyTextLayerSwitch.append(button)
  }
}

/** The text a new layer shows: a letter or symbol key's own character; a function key starts empty. */
function keyCharacter(name: string): string {
  const action = name.replace(/^KEY_/, "").replace(/_S\d+$/, "")
  return [...action].length === 1 ? action : ""
}

/**
 * Gives every selected key without text a text layer with `property` set: one style per key (each
 * shows its own character), copied from the panel's most used key text so size and colour match.
 */
export function createBdaKeyText(property: string, value: string): void {
  const info = currentBdaAppearance()
  const part = bdaAppearancePart(appState.selectedPath)
  const panel = selectedPanel()
  if (!info || part?.kind !== "panel" || !panel || !value.trim() || !isEditing()) return
  const counts = new Map<number, number>()
  for (const key of panel.keys.values()) {
    const text = key.foreStyles.find((ref) => ref.type === "text")
    if (text) counts.set(text.key, (counts.get(text.key) ?? 0) + 1)
  }
  const copyFrom = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  let bytes = info.bytes
  let blank = false
  try {
    for (const name of selectedBdaKeyNames()) {
      const key = panel.keys.get(name)
      if (!key || key.foreStyles.some((ref) => ref.type === "text")) continue
      const added = addBdaStyle(bytes, "text", copyFrom)
      const character = keyCharacter(name)
      blank ||= !character
      bytes = updateBdaStyle(updateBdaStyle(added.bytes, added.ref, "CONTENT_TEXT", character), added.ref, property, value)
      bytes = withBdaPanelRefs(info.path, bytes, part, [["keys", name, "foreStyles", String(key.foreStyles.length)]], added.ref)
    }
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error))
    return
  }
  if (bytes === info.bytes) return
  commitBytes(info.path, info.bytes, bytes)
  refreshBdaLayout(appState.layoutPath)
  refreshSelectedBdaSource()
  refreshPreview()
  populateKeyInspector()
  updateDirty()
  showStatus(blank ? "已新建文字层；功能键请在「显示文字」里填写要显示的内容" : "已新建文字层")
}
