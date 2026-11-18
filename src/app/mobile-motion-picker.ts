import { bindListboxKeys, element } from "../dom-element"
import { closeDialog } from "../motion"
import { IniDocument } from "../ini"
import { writeLegacyAnimationFields } from "../legacy-animation"
import { appState } from "./state"
import { bindDialog } from "./ask"
import { availableStyleIDs, styleConfigDocument, styleKind } from "./style-picker"
import { animationStyleCard } from "./animation-style-inspector"
import { styleAnimationSources, styleAnimationSummary } from "./legacy-animation-inspector"
import { legacyAnimationConfigPath } from "./config-context"
import { commitText, isEditing, updateDirty, updateHistoryButtons } from "./edit-history"
import { refreshPreview } from "./preview-render"
import { field } from "./property-rows"

/** 候选与时长只存草稿；确认后沿用引用字段，并合为一次撤销。 */
export function openMobileMotionPicker(input: HTMLInputElement, openLibrary: () => void): void {
  const archive = appState.archive
  const styles = styleConfigDocument()
  if (!archive || !styles || input.disabled) return
  const revision = archive.revision
  const selection = `${appState.selectedPath}|${appState.selectedKeySections.join(",")}`
  const path = legacyAnimationConfigPath()
  const config = path && archive.isText(path) ? IniDocument.parse(archive.getText(path)) : undefined
  let chosen = input.value.trim() || "0"
  let duration = ""
  let section = ""
  const dialog = element("dialog", "ui-dialog ui-mobile-sheet ui-mobile-motion-picker")
  dialog.setAttribute("aria-label", "选择动画")
  const form = element("form")
  form.method = "dialog"
  const header = element("header", "ui-dialog-header")
  const title = element("div")
  title.append(Object.assign(element("h2"), { textContent: "选择动画" }), Object.assign(element("p", "ui-field-note"), { textContent: "当前皮肤的动画样式" }))
  const library = Object.assign(element("button", "ui-button"), { type: "button", textContent: "全部样式" })
  library.addEventListener("click", () => closeDialog(dialog, "library"))
  header.append(title, library)
  const body = element("div", "ui-dialog-body")
  const list = element("div", "ui-mobile-motion-list")
  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", "动画")
  const parameters = element("div", "ui-mobile-motion-parameters")
  const sync = () => {
    for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      const selected = option.dataset.motionStyle === chosen
      option.setAttribute("aria-selected", String(selected))
      option.tabIndex = selected ? 0 : -1
    }
    const sources = chosen && styleAnimationSources(chosen, styles)?.sections
    section = sources && sources.length === 1 ? sources[0] : ""
    duration = section && config?.get(section, "DURATION") || ""
    parameters.replaceChildren()
    if (duration && Number.isFinite(Number(duration))) parameters.append(field({ key: "motion-duration", label: "时长", spec: { kind: "number", value: duration, min: 0, unit: "ms", step: 1, range: "duration" }, commit: value => { duration = String(value) } }), Object.assign(element("p", "ui-field-note"), { textContent: "修改时长会影响所有引用此动画的按键" }))
  }
  const ids = availableStyleIDs().filter(id => styleKind(id, styles) === "anim")
  for (const id of [...ids, "0"]) {
    const card = id === "0" ? element("button", "ui-list-item") : animationStyleCard({ id, title: styles.get(`STYLE${id}`, "INFO") || `样式 ${id}`, count: styleAnimationSources(id, styles)?.sections.length ?? 0, detail: styleAnimationSummary(id, styles) })
    if (card instanceof HTMLButtonElement) { card.type = "button"; card.textContent = "无" }
    card.dataset.motionStyle = id
    card.setAttribute("role", "option")
    card.addEventListener("click", () => { chosen = id; sync() })
    card.addEventListener("dblclick", () => form.requestSubmit(apply))
    card.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); form.requestSubmit(apply) } })
    list.append(card)
  }
  bindListboxKeys(list, option => option.click())
  const footer = element("footer", "ui-dialog-footer")
  const cancel = Object.assign(element("button", "ui-button"), { textContent: "取消", value: "cancel" })
  const apply = Object.assign(element("button", "ui-button"), { textContent: "应用", value: "apply" })
  apply.dataset.variant = "primary"
  footer.append(cancel, apply)
  body.append(list, parameters)
  form.append(header, body, footer)
  dialog.append(form)
  bindDialog(dialog)
  dialog.addEventListener("close", () => {
    // 引用卡传入的是槽位代理，不挂在 DOM；用文档版本与选区防止异步写错对象。
    const current = archive === appState.archive && archive.revision === revision && selection === `${appState.selectedPath}|${appState.selectedKeySections.join(",")}` && !input.disabled && isEditing()
    if (current && dialog.returnValue === "library") openLibrary()
    if (current && dialog.returnValue === "apply") {
      const depth = appState.undoStack.length
      if (path && section && duration !== "" && config && Number(duration) >= 0 && Number.isFinite(Number(duration))) {
        const before = archive.getText(path)
        const after = writeLegacyAnimationFields(before, section, { DURATION: duration })
        if (after !== before) commitText(path, before, after)
      }
      input.value = chosen
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new Event("change", { bubbles: true }))
      const changes = appState.undoStack.splice(depth)
      if (changes.length) appState.undoStack.push(changes.length === 1 ? changes[0] : { kind: "batch", changes })
      refreshPreview()
      updateDirty()
      updateHistoryButtons()
    }
    dialog.remove()
  }, { once: true })
  sync()
  document.body.append(dialog)
  dialog.showModal()
  cancel.focus()
  cancel.addEventListener("click", event => { event.preventDefault(); void closeDialog(dialog, "cancel") })
}
