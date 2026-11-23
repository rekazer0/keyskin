import { confirmDeletion } from "./ask"
import { appState } from "./state"
import { preview, source, toolbarPreview } from "./canvas-interaction"
import { normalizeKeySections } from "../ini.ts"
import { canvasEditable, commitText, updateDirty } from "./edit-history"
import { isToolbarPath, setSourceValue, scrollSelectedSource } from "./config-context"
import { populateKeyInspector, updateSelectedKey } from "./key-inspector"
import { selectFile } from "./navigation"
import { updateSourceHighlight, updateInspectorView } from "./source-panel"
import { refreshPreview, syncCandidateSelection } from "./preview-render"
import { type LayoutRect, isListCell, listCellRect, applyLayoutAction as transformLayout, type LayoutAction, mergeLayoutRects, setExactGap, moveRects, translatedTouchRect } from "../layout.ts"
import { copyPalmKeys, deletePalmKeys, mergePalmKeys, palmKeyRects, writePalmKeyRects } from "./sxi-keys"

/** A Palm board has no layout document: its keys are edited in skin.json (sxi-keys.ts). */
const palmBoard = () => appState.archive?.format === "sxi"

/** After a Palm key edit: the canvas shows `sections` selected. */
function selectPalmKeys(sections: string[]): void {
  appState.selectedKeySections = sections
  preview.setSelected(sections)
  populateKeyInspector()
  updateSourceHighlight()
}

export function copySelectedKeys(): void {
  if (!canvasEditable()) return
  if (palmBoard()) return selectPalmKeys(copyPalmKeys(appState.selectedKeySections))
  if (!appState.archive || !appState.layoutDocument || !appState.selectedKeySections.length) return
  const before = appState.layoutDocument.toString()
  const occupied = new Set(appState.layoutDocument.sections())
  let number = Math.max(0, ...[...occupied].flatMap((section) => {
    const value = section.match(/^KEY(\d+)$/)?.[1]
    return value ? [Number(value)] : []
  })) + 1
  const copies: string[] = []
  const copyBySource = new Map<string, string>()
  for (const section of preview.expandSections(appState.selectedKeySections)) {
    while (occupied.has(`KEY${number}`)) number += 1
    const target = `KEY${number++}`
    const entries = appState.layoutDocument.entries(section).map(({ key, value }) => {
      if (key === "TOUCH_RECT") return { key, value: translatedTouchRect(value, 18, 0) ?? value }
      if (key !== "VIEW_RECT") return { key, value }
      const rect = value.split(",").map(Number)
      if (rect.length === 4 && rect.every(Number.isFinite)) rect[0] += 18
      return { key, value: rect.join(",") }
    })
    appState.layoutDocument.appendSection(target, entries)
    occupied.add(target)
    copies.push(target)
    copyBySource.set(section, target)
  }
  const renamed = normalizeKeySections(appState.layoutDocument)
  const text = appState.layoutDocument.toString()
  commitText(appState.layoutPath, before, text)
  if (appState.selectedPath === appState.layoutPath) setSourceValue(text)
  appState.selectedKeySections = appState.selectedKeySections.flatMap((section) => {
    const copy = copyBySource.get(section)
    return copy ? [renamed.get(copy) ?? copy] : []
  })
  preview.setDocument(appState.layoutDocument)
  preview.setSelected(copies.map((copy) => renamed.get(copy) ?? copy))
  populateKeyInspector()
  updateSourceHighlight()
  updateDirty()
}

export async function deleteSelectedKeys(): Promise<void> {
  const { archive, layoutPath, selectedKeySections } = appState
  if (!canvasEditable() || !selectedKeySections.length) return
  const revision = archive?.revision
  if (!await confirmDeletion(`删除 ${selectedKeySections.length} 个按键？`) || appState.archive !== archive || archive?.revision !== revision
    || appState.layoutPath !== layoutPath || appState.selectedKeySections !== selectedKeySections || !canvasEditable()) return
  if (palmBoard()) {
    deletePalmKeys(appState.selectedKeySections)
    return selectPalmKeys([])
  }
  if (!appState.archive || !appState.layoutDocument || !appState.selectedKeySections.length) return
  const before = appState.layoutDocument.toString()
  if (!appState.layoutDocument.removeSections(preview.expandSections(appState.selectedKeySections))) return
  normalizeKeySections(appState.layoutDocument)
  const text = appState.layoutDocument.toString()
  commitText(appState.layoutPath, before, text)
  if (appState.selectedPath === appState.layoutPath) setSourceValue(text)
  appState.selectedKeySections = []
  preview.setDocument(appState.layoutDocument)
  preview.setSelected([])
  refreshPreview()
  populateKeyInspector()
  updateSourceHighlight()
  updateDirty()
}

/** 取消按键、工具栏与候选栏的选择，检查器回到所在面板的属性。 */
export function selectParentObject(): void {
  // A selected .cnd file implies whole-bar selection even after the explicit selection is cleared.
  if (appState.layoutPath && isToolbarPath(appState.selectedPath)) selectFile(appState.layoutPath, appState.sidebarView, "document", true)
  else source.commit()
  appState.selectedKeySections = []
  appState.selectedToolbarSections = []
  appState.selectedCandidate = false
  preview.setSelected([])
  toolbarPreview.setSelected([])
  if (appState.inspectorTab !== "source") appState.inspectorTab = "properties"
  syncCandidateSelection()
  updateInspectorView()
  populateKeyInspector()
  updateSourceHighlight()
  scrollSelectedSource()
}

export function selectedRects(): LayoutRect[] {
  if (palmBoard()) return palmKeyRects(appState.selectedKeySections)
  if (!appState.layoutDocument) return []
  const document = appState.layoutDocument
  return appState.selectedKeySections.flatMap((section) => {
    if (isListCell(section)) {
      const rect = listCellRect(document, section)
      return rect ? [rect] : []
    }
    const values = document.get(section, "VIEW_RECT")?.split(",").map(Number)
    if (!values || values.length !== 4 || values.some((value) => !Number.isFinite(value))) return []
    const [x, y, width, height] = values
    return [{ section, x, y, width, height }]
  })
}

/** A geometry edit, including both rectangles for a whole-key move, is one undo step. */
export function resizeSelectedKeys(rects: LayoutRect[], move = false, coalesce = false): void {
  if (!canvasEditable() || ["bda", "ssf"].includes(appState.archive?.format ?? "")) return
  if (palmBoard()) return writePalmKeyRects(rects, coalesce)
  const document = appState.layoutDocument
  if (!document) return
  const before = document.toString()
  for (const { section, x, y, width, height } of rects) {
    if (move) {
      const [oldX, oldY] = (document.get(section, "VIEW_RECT") ?? "").split(",").map(Number)
      const touch = translatedTouchRect(document.get(section, "TOUCH_RECT"), Math.round(x) - oldX, Math.round(y) - oldY)
      if (touch !== undefined) document.set(section, "TOUCH_RECT", touch)
    }
    document.set(section, "VIEW_RECT", [x, y, width, height].map(Math.round).join(","))
  }
  commitKeyGeometry(before, coalesce)
}

export function commitKeyGeometry(before: string, coalesce = false): void {
  const document = appState.layoutDocument!
  const text = document.toString()
  commitText(appState.layoutPath, before, text, coalesce)
  if (appState.selectedPath === appState.layoutPath) setSourceValue(text)
  preview.setDocument(document)
  populateKeyInspector()
  updateDirty()
}

export function applyLayoutAction(action: string): void {
  if (!canvasEditable()) return
  if (!appState.archive || !appState.layoutDocument && !palmBoard()) return
  if (action === "merge") {
    mergeSelectedKeys()
    return
  }
  const real = selectedRects().filter((rect) => !isListCell(rect.section))
  const rects = transformLayout(real, action as LayoutAction)
  if (rects.length < 2) return
  resizeSelectedKeys(rects, !["same-width", "same-height"].includes(action))
}

function mergeSelectedKeys(): void {
  if (!canvasEditable()) return
  if (!appState.archive || !appState.layoutDocument && !palmBoard()) return
  const rects = selectedRects().filter((rect) => !isListCell(rect.section))
  if (rects.length !== 2) return
  if (palmBoard()) return selectPalmKeys([mergePalmKeys(rects[0], rects[1])])
  if (!appState.layoutDocument) return
  const before = appState.layoutDocument.toString()
  const merged = mergeLayoutRects(rects[0], rects[1])
  appState.layoutDocument.set(merged.section, "VIEW_RECT", [merged.x, merged.y, merged.width, merged.height].map(Math.round).join(","))
  if (!appState.layoutDocument.removeSections([rects[1].section])) return
  const renamed = normalizeKeySections(appState.layoutDocument)
  const text = appState.layoutDocument.toString()
  commitText(appState.layoutPath, before, text)
  if (appState.selectedPath === appState.layoutPath) setSourceValue(text)
  appState.selectedKeySections = [renamed.get(merged.section) ?? merged.section]
  preview.setDocument(appState.layoutDocument)
  preview.setSelected(appState.selectedKeySections)
  populateKeyInspector()
  updateSourceHighlight()
  updateDirty()
}

export function applyExactGap(field: HTMLInputElement): void {
  if (!canvasEditable()) return
  if (!appState.archive || !appState.layoutDocument && !palmBoard()) return
  const gap = Number(field.value)
  if (!Number.isFinite(gap)) return
  const rects = setExactGap(
    selectedRects().filter((rect) => !isListCell(rect.section)),
    field.dataset.gapField === "horizontal" ? "horizontal" : "vertical",
    gap,
  )
  if (rects.length < 2) return
  resizeSelectedKeys(rects, true)
}

export function moveSelectedKeys(
  deltaX: number,
  deltaY: number,
  sections: readonly string[] = appState.selectedKeySections,
  coalesce = false,
): void {
  if (!canvasEditable()) return
  if (palmBoard()) {
    const rects = moveRects(palmKeyRects(sections), deltaX, deltaY)
    if (rects.length) writePalmKeyRects(rects, coalesce)
    return
  }
  if (!appState.archive || !appState.layoutDocument) return
  const rects = moveRects(sections.flatMap((section) => {
    const values = appState.layoutDocument?.get(section, "VIEW_RECT")?.split(",").map(Number)
    if (!values || values.length !== 4 || values.some((value) => !Number.isFinite(value))) return []
    const [x, y, width, height] = values
    return [{ section, x, y, width, height }]
  }), deltaX, deltaY)
  if (rects.length) resizeSelectedKeys(rects, true, coalesce)
}

/**
 * The element a key event is really meant for. Events from a shadow root (the AI composer
 * is deep-chat's contenteditable) reach window retargeted to the host, so look inside it.
 */
export function keyEventElement(target: EventTarget | null): Element | null {
  let element = target instanceof Element ? target : null
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement
  return element
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  return Boolean(keyEventElement(target)?.closest("input, textarea, select, button, [contenteditable]"))
}

export function isMixedKeyGeometry(field: HTMLInputElement): boolean {
  return canvasEditable() && field.value === "" && field.placeholder === "混合"
    && ["x", "y", "width", "height"].includes(field.dataset.keyField ?? "")
}

export function nudgeMixedKeyGeometry(field: HTMLInputElement, steps: number): void {
  if (!isMixedKeyGeometry(field)) return
  const name = field.dataset.keyField
  if (name === "x" || name === "y") {
    moveSelectedKeys(name === "x" ? steps : 0, name === "y" ? steps : 0)
  } else updateSelectedKey(field, steps)
}
