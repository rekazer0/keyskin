import { element } from "../dom-element.ts"
import { createIcon } from "../icons.ts"
import { IniDocument } from "../ini.ts"
import { isListCell } from "../layout.ts"
import { STYLE_ANIM_FIELDS, STYLE_ANIM_FIELD_LABELS } from "../legacy-animation.ts"
import { readAnimationBinding, writeAnimationBindings } from "../legacy-animation-binding.ts"
import { bindDialog } from "./ask"
import { preview } from "./canvas-interaction"
import { currentSkinState, styleConfigPath } from "./config-context"
import { canvasWrap, candidateArea, candidateComposition, previewCanvas, previewPanelViewport, toolbarStrip } from "./dom"
import { commitTextChanges, isEditing } from "./edit-history"
import { showStatus } from "./file-operations"
import { requestEditMode } from "./mobile-layout"
import { palmDropBinding } from "./sxi-animation-drop"
import { pickAnimationKeys, selectAnimation } from "./animation-resource"
import { appState } from "./state"

const componentNames = { PANEL: "键盘背景", SWITCH: "工具栏", CAND: "候选栏" } as const
type Component = keyof typeof componentNames
type Target = { path: string; sections: string[]; label: string; rects: DOMRect[] }
const active = () => preview.animationView && (appState.archive?.format === "bdi" || appState.archive?.format === "bds" || appState.archive?.format === "sxi")

function componentTarget(section: Component): Target | undefined {
  const panel = section === "PANEL"
  const path = panel ? appState.layoutPath : toolbarStrip.dataset.path
  if (!path) return
  return { path, sections: [section], label: componentNames[section], rects: [(panel ? previewCanvas : candidateArea).getBoundingClientRect()] }
}

function keyTarget(sections: string[], hit: string): Target | undefined {
  const bySection = new Map(preview.keys.map(key => [key.section, key.rect]))
  const box = previewCanvas.getBoundingClientRect(), sx = box.width / preview.panelWidth, sy = box.height / preview.surfaceHeight
  const rects: DOMRect[] = []
  // 命中键放在最上层，只在这里显示整组的数量标签。
  for (const section of [...sections.filter(section => section !== hit), hit]) {
    const rect = bySection.get(section)
    if (!rect) return
    rects.push(new DOMRect(box.left + rect.x * sx, box.top + rect.y * sy, rect.width * sx, rect.height * sy))
  }
  return { path: appState.layoutPath, sections, rects, label: sections.length > 1 ? `已选的 ${sections.length} 个按键` : isListCell(hit) ? "候选列表" : `按键 ${hit.replace(/^KEY/, "")}` }
}

function selection(): Target | undefined {
  const component = canvasWrap.dataset.animationComponent as Component | undefined
  if (component) return componentTarget(component)
  const keys = appState.animationKeys
  if (keys.length) return keyTarget(keys, keys[0])
}

function targetAt(event: PointerEvent): Target | undefined {
  const node = document.elementFromPoint(event.clientX, event.clientY)
  if (node && candidateArea.contains(node)) return componentTarget(toolbarStrip.contains(node) && candidateComposition.hidden ? "SWITCH" : "CAND")
  if (node && previewPanelViewport.contains(node)) {
    const hit = preview.hit(preview.point(event))?.section
    return hit ? keyTarget(appState.animationKeys.includes(hit) ? appState.animationKeys : [hit], hit) : componentTarget("PANEL")
  }
  if (node === canvasWrap) return selection()
}

const triggerDetails = {
  PRESS_ANIM: ["pointer", "触碰目标时播放"], RELEASE_ANIM: ["hand", "抬起手指时播放"],
  SHOW_ANIM: ["eye", "目标出现时播放"], HIDE_ANIM: ["eye-off", "目标离开时播放"],
  FIRST_PRESS_PANEL_ANIM: ["keyboard", "面板首次被按下时播放"],
}

function legacyDropBinding(id: string, target: Target) {
  const { archive } = appState
  if (!archive?.isText(target.path) || !appState.selectedDocument?.sections().includes(`ANIM${id}`)) return
  const path = styleConfigPath(), state = currentSkinState()
  const before = archive.getText(target.path), styleBefore = archive.isText(path) ? archive.getText(path) : undefined
  const layout = IniDocument.parse(before), styles = IniDocument.parse(styleBefore ?? "")
  const targets = [...new Set(target.sections.map(section => isListCell(section) ? "LIST" : section))].map(section => ({ section, state, field: "ANIM_STYLE" as const }))
  for (const { section } of targets) {
    if (layout.sections().includes(section)) continue
    if (!(section in componentNames)) return
    layout.appendSection(section, [])
  }
  if (target.sections[0] === "PANEL" && !layout.get("PANEL", "ANIM_STYLE") && preview.panelAnimationStyle) layout.set("PANEL", "ANIM_STYLE", preview.panelAnimationStyle)
  return {
    options: STYLE_ANIM_FIELDS.map(event => ({ event, label: STYLE_ANIM_FIELD_LABELS[event], replacing: targets.filter(t => {
      const value = readAnimationBinding(layout, styles, t, event).animation
      return value && value !== "0" && value !== id
    }).length })),
    apply(event: string) {
      if (path !== styleConfigPath() || before !== archive.getText(target.path) || styleBefore !== (archive.isText(path) ? archive.getText(path) : undefined)) return showStatus("目标已变化，请重新拖动动画")
      const next = writeAnimationBindings(layout.toString(), styleBefore ?? "", targets, event, id, STYLE_ANIM_FIELD_LABELS[event])
      commitTextChanges([{ path: target.path, before, after: next.layout }, { path, before: styleBefore, after: next.styles }])
    },
  }
}

function chooseTrigger(id: string, target: Target): void {
  if (!isEditing()) return requestEditMode()
  const { archive, selectedPath, layoutPath } = appState, state = currentSkinState()
  const palm = archive?.format === "sxi", before = palm && archive.getText("skin.json")
  const binding = palm ? palmDropBinding(id, target.path, target.sections) : legacyDropBinding(id, target)
  if (!binding) return showStatus("找不到当前布局中的动画或目标，请重新选择")
  const dialog = element("dialog", "ui-dialog"), form = element("form"), header = element("header", "ui-dialog-header"), heading = element("div")
  dialog.dataset.size = "sm"
  dialog.setAttribute("aria-label", "应用动画")
  form.method = "dialog"
  heading.append(Object.assign(element("h2"), { textContent: "应用动画" }), Object.assign(element("p"), { textContent: `动画 ${id} → ${target.label}` }))
  header.append(heading)
  const body = element("div", "ui-dialog-body"), list = element("div", "ui-listbox")
  list.dataset.size = "fill"
  list.setAttribute("role", "radiogroup")
  list.setAttribute("aria-label", "触发方式")
  let selected = binding.options[target.sections[0] in componentNames ? 2 : 0].event
  for (const [index, { event, label, replacing }] of binding.options.entries()) {
    const row = element("label", "ui-list-item"), text = element("span", "ui-list-item-text"), input = element("input")
    const [icon, description] = palm && event === "5" ? ["timer", "按住目标时播放"] : triggerDetails[STYLE_ANIM_FIELDS[index]]
    text.append(Object.assign(element("strong"), { textContent: label }), Object.assign(element("small"), { textContent: replacing ? `将替换 ${replacing} 处已有的${label}动画` : description }))
    input.type = "radio"; input.name = "trigger"; input.checked = event === selected
    input.addEventListener("change", () => { selected = event })
    row.append(createIcon(icon, 16), text, input); list.append(row)
  }
  body.dataset.layout = "stack"
  body.append(Object.assign(element("strong"), { textContent: "触发方式" }), list)
  const footer = element("footer", "ui-dialog-footer"), cancel = Object.assign(element("button", "ui-button"), { value: "cancel", textContent: "取消" })
  const apply = Object.assign(element("button", "ui-button"), { value: "apply", textContent: "应用" }); apply.dataset.variant = "primary"
  footer.append(cancel, apply); form.append(header, body, footer); dialog.append(form); bindDialog(dialog)
  dialog.addEventListener("close", () => {
    dialog.remove()
    if (dialog.returnValue !== "apply" || !isEditing()) return
    const changed = archive !== appState.archive || selectedPath !== appState.selectedPath || layoutPath !== appState.layoutPath
      || state !== currentSkinState() || (palm ? before !== archive.getText("skin.json") : !appState.selectedDocument?.sections().includes(`ANIM${id}`))
    if (changed) return showStatus("目标已变化，请重新拖动动画")
    binding.apply(selected)
  }, { once: true })
  document.body.append(dialog); dialog.showModal(); cancel.focus()
}

export function wireAnimationDrop(): void {
  const markers: HTMLElement[] = [], label = element("span", "ui-badge")
  const showTarget = (target?: Target) => {
    const rects = target?.rects ?? []
    while (markers.length > rects.length) markers.pop()!.remove()
    rects.forEach(({ left, top, width, height }, i) => {
      const marker = markers[i] ??= element("div", "animation-drop-target")
      Object.assign(marker.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
      if (!marker.isConnected) document.body.append(marker)
    })
    if (target) {
      label.textContent = target.label
      const anchor = markers[markers.length - 1]
      if (label.parentNode !== anchor) anchor.append(label)
    }
  }
  const ghost = element("span", "ui-badge animation-drag-ghost")
  let drag: { pointer: number; x: number; y: number; id: string; card: HTMLElement; moved: boolean } | undefined
  const clear = () => { showTarget(); ghost.remove(); if (drag) delete drag.card.dataset.dragging; drag = undefined }
  const cardFor = (event: Event) => active() && event.target instanceof Element ? event.target.closest<HTMLElement>("#animation-library [data-animation-draggable]") : null
  document.addEventListener("pointerdown", event => {
    const card = cardFor(event), id = card?.dataset.animationDraggable
    if (event.button !== 0 || !card || !id) return
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, id, card, moved: false }
  })
  document.addEventListener("pointermove", event => {
    if (!drag || drag.pointer !== event.pointerId) return
    if (!drag.card.isConnected || !active()) return clear()
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return
    if (!drag.moved) {
      if (drag.card.getAttribute("aria-selected") !== "true") selectAnimation(drag.card.dataset.animationId!)
      if (!drag.card.isConnected) return clear()
      drag.moved = true
      drag.card.setPointerCapture(event.pointerId)
      drag.card.dataset.dragging = ""
      ghost.textContent = `动画 ${drag.id}`
      document.body.append(ghost)
    }
    ghost.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`
    showTarget(targetAt(event))
  })
  document.addEventListener("pointerup", event => {
    if (!drag || drag.pointer !== event.pointerId) return
    const { id, moved, card } = drag, target = moved && active() && targetAt(event)
    clear()
    if (!moved) return
    const suppress = (click: Event) => click.stopImmediatePropagation()
    card.addEventListener("click", suppress, { capture: true, once: true })
    setTimeout(() => card.removeEventListener("click", suppress, true), 0)
    if (target) chooseTrigger(id, target)
  })
  document.addEventListener("pointercancel", clear); window.addEventListener("blur", clear)
  document.addEventListener("keydown", event => { if (drag && event.key === "Escape") { event.stopImmediatePropagation(); clear() } }, true)
  document.addEventListener("keydown", event => {
    if (!event.altKey || event.key !== "Enter") return
    const card = cardFor(event)
    if (!card) return
    const selected = selection()
    if (selected) { event.preventDefault(); event.stopPropagation(); chooseTrigger(card.dataset.animationDraggable!, selected) }
  }, true)
  // 在动画页预选整条栏时不跳出到 .cnd 的属性检查器。
  candidateArea.addEventListener("pointerdown", event => { if (active() && isEditing() && event.button === 0) event.stopPropagation() }, true)
  canvasWrap.addEventListener("click", event => {
    if (!active() || !isEditing() || !(event.target instanceof Element)) return
    if (candidateArea.contains(event.target)) {
      event.stopPropagation(); pickAnimationKeys([])
      canvasWrap.dataset.animationComponent = toolbarStrip.contains(event.target) && candidateComposition.hidden ? "SWITCH" : "CAND"
    } else if (event.target === previewCanvas && !preview.hit(preview.point(event)) && !appState.animationKeys.length) canvasWrap.dataset.animationComponent = "PANEL"
    else delete canvasWrap.dataset.animationComponent
  }, true)
}
