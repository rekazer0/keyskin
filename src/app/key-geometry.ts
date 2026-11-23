import { element } from "../dom-element.ts"
import { releaseOnRemove } from "../dom-lifecycle.ts"
import { isListCell } from "../layout.ts"
import type { Rect } from "../preview-items.ts"
import { mobilePortraitQuery, preview } from "./canvas-interaction"
import { keyLayoutFieldsGroup, quickInspector } from "./dom"
import { canvasEditable } from "./edit-history"
import { geometryPreview } from "./geometry-preview"
import { commitKeyGeometry, resizeSelectedKeys, selectedRects } from "./key-editing"
import { field } from "./property-rows"
import { appState } from "./state"

const rectParts = ({ x, y, width, height }: Rect) => [x, y, width, height]

export function renderKeyGeometry(hasSelection: boolean, showPadding: boolean, refresh: () => void): void {
  const group = keyLayoutFieldsGroup
  const padding = quickInspector.querySelector<HTMLElement>(".inspector-padding-section")!
  const fields = group.querySelector(".geometry-fields")!
  fields.append(padding)
  padding.hidden = !hasSelection || !showPadding
  group.querySelectorAll(":scope > .mobile-geometry-detail, :scope > .ui-geometry-preview, :scope > [data-key-touch]").forEach(node => node.remove())
  const sections = appState.selectedKeySections
  const keys = hasSelection ? preview.keys.filter(key => sections.includes(key.section)) : []
  const baidu = (appState.archive?.format === "bdi" || appState.archive?.format === "bds") && !sections.some(isListCell)
  const key = baidu && keys.length === 1 && sections.length === 1 ? keys[0] : undefined
  const heading = group.querySelector<HTMLElement>("[data-display-geometry]")!
  heading.hidden = !baidu || !keys.length
  heading.textContent = key?.touchRect ? "显示区域（实线）" : "显示区域"
  if (keys.length) {
    const editableRects = selectedRects()
    const editable = canvasEditable() && showPadding && editableRects.length === keys.length
    const geometry = geometryPreview(editable ? editableRects : keys.map(key => key.rect), editable
      ? rects => resizeSelectedKeys(rects.map((rect, index) => ({ ...rect, section: editableRects[index].section }))) : undefined)
    const detail = element("details", "ui-disclosure mobile-geometry-detail")
    detail.append(Object.assign(element("summary", "ui-button"), { textContent: showPadding ? "内边距与缩放" : "几何预览" }))
    heading.after(detail, geometry)
    const sync = () => {
      const mobile = mobilePortraitQuery.matches
      if (mobile) detail.append(geometry)
      else detail.after(geometry)
      if (showPadding) (mobile ? detail : geometry.querySelector(".ui-geometry-box")!).append(padding)
      detail.hidden = !mobile
      detail.open = false
    }
    sync()
    mobilePortraitQuery.addEventListener("change", sync)
    releaseOnRemove(detail, () => mobilePortraitQuery.removeEventListener("change", sync))
  }
  if (key && appState.layoutDocument) renderTouchRect(key.section, key.rect, Boolean(key.touchRect), refresh)
}

function renderTouchRect(section: string, view: Rect, hasGuide: boolean, refresh: () => void): void {
  const document = appState.layoutDocument!
  const raw = document.get(section, "TOUCH_RECT")
  const parts = raw?.split(",").map(value => value.trim())
  const saved = parts?.length === 4 && parts.every(value => value && Number.isFinite(Number(value))) ? parts : undefined
  const block = element("div", "ui-subsection")
  block.dataset.keyTouch = ""
  const enabled = canvasEditable()
  const commit = (next?: string) => {
    if (!canvasEditable() || appState.layoutDocument !== document || appState.selectedKeySections[0] !== section) return
    const before = document.toString()
    if (next === undefined) document.remove(section, "TOUCH_RECT")
    else document.set(section, "TOUCH_RECT", next)
    commitKeyGeometry(before)
  }
  const title = Object.assign(element("h4", "inspector-block-heading"), { textContent: hasGuide ? "触控区域（虚线）" : "触控区域", title: "TOUCH_RECT" })
  block.append(title, field({ key: "TOUCH_RECT", label: "跟随显示区域", editable: enabled, empty: false,
    rowKey: "TOUCH_RECT", baseline: raw ?? null, spec: { kind: "switch", checked: !saved },
    reset: baseline => commit(typeof baseline === "string" ? baseline : undefined),
    commit: follow => {
      commit(follow ? undefined : rectParts(view).join(","))
      keyLayoutFieldsGroup.querySelector<HTMLInputElement>('[data-key-touch] input[role="switch"]')?.focus({ preventScroll: true })
    },
  }))
  if (saved) for (const [label, affixes, start] of [["位置", ["X", "Y"], 0], ["尺寸", ["W", "H"], 2]] as const) {
    block.append(field({ key: "TOUCH_RECT", label, name: `触控区域${label}`, editable: enabled, rowKey: `TOUCH_RECT.${start}`,
      spec: { kind: "parts", affixes, values: saved.slice(start, start + 2) },
      commit: (next, edit) => {
        if (!block.isConnected) return
        const updated = [...saved]
        for (const index of edit.index === undefined ? [0, 1] : [edit.index]) {
          if (!next[index] || !Number.isFinite(Number(next[index]))) return refresh()
          const value = Math.round(Number(next[index]))
          updated[start + index] = String(start === 2 && edit.index !== undefined ? Math.max(1, value) : value)
        }
        commit(updated.join(","))
      },
    }))
  }
  keyLayoutFieldsGroup.append(block)
}
