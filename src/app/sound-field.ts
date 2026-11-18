import { bindDialog } from "./ask.ts"
import { element, bindListboxKeys, searchField, emptyState } from "../dom-element.ts"
import { styleReferenceCard, soundStyleSample } from "../style-card.ts"

/** 音效文件、引用、试听与移除共用卡片；选择和取消不改配置。 */
export function soundControl(spec: { value: string; files: readonly string[]; sample?: HTMLElement }, label: string, disabled: boolean, commit: (value: string) => void): HTMLElement {
  const files = [...new Set([spec.value, ...spec.files].filter(Boolean))]
  const name = element("input", "ui-style-ref-name")
  name.value = spec.value
  name.placeholder = "未设置"
  name.disabled = disabled
  name.setAttribute("aria-label", label)
  name.addEventListener("input", () => name.setCustomValidity(""))
  name.addEventListener("change", () => {
    const next = name.value.trim()
    name.setCustomValidity(next && !files.includes(next) ? "请选择皮肤内的音效文件" : "")
    if (name.reportValidity()) commit(next)
  })
  const choose = () => {
    if (disabled) return
    const dialog = element("dialog", "ui-dialog")
    dialog.dataset.size = "sm"
    dialog.setAttribute("aria-label", "选择音效")
    const form = element("form")
    form.method = "dialog"
    const header = element("header", "ui-dialog-header")
    header.append(Object.assign(element("h2"), { textContent: "选择音效" }))
    const body = element("div", "ui-dialog-body")
    const list = element("div", "ui-listbox")
    list.setAttribute("role", "listbox")
    list.setAttribute("aria-label", "音效文件")
    let selected: string | undefined = spec.value || undefined
    const select = (row: HTMLElement) => {
      selected = row.dataset.value!
      for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
        option.setAttribute("aria-selected", String(option === row))
        option.tabIndex = option === row ? 0 : -1
      }
      apply.disabled = false
      row.focus()
    }
    const render = (query = "") => {
      list.replaceChildren(...files.filter(file => file.toLowerCase().includes(query.toLowerCase())).map((file, index) => {
        const row = element("button", "ui-list-item")
        row.type = "button"
        row.dataset.value = file
        row.textContent = file
        row.setAttribute("role", "option")
        row.setAttribute("aria-selected", String(file === selected))
        row.tabIndex = file === selected || !selected && index === 0 ? 0 : -1
        row.addEventListener("click", () => select(row))
        row.addEventListener("dblclick", () => apply.click())
        row.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); select(row); apply.click() } })
        return row
      }))
      if (!list.childElementCount) list.append(emptyState("audio-lines"))
    }
    bindListboxKeys(list, select)
    const footer = element("footer", "ui-dialog-footer")
    const cancel = Object.assign(element("button", "ui-button"), { textContent: "取消", value: "cancel" })
    const apply = Object.assign(element("button", "ui-button"), { textContent: "应用", value: "apply", disabled: !selected })
    apply.dataset.variant = "primary"
    footer.append(cancel, apply)
    body.dataset.layout = "stack"
    body.append(searchField({ label: "搜索音效", onInput: render }), list)
    form.append(header, body, footer)
    dialog.append(form)
    bindDialog(dialog)
    dialog.addEventListener("close", () => {
      if (dialog.returnValue === "apply" && card.isConnected && selected !== undefined && files.includes(selected)) commit(selected)
      dialog.remove()
    }, { once: true })
    document.body.append(dialog)
    render()
    dialog.showModal()
    cancel.focus()
  }
  const sample = spec.sample ?? soundStyleSample(spec.value || undefined)
  sample.querySelector(".ui-style-sound-info > strong")?.remove()
  const card = styleReferenceCard({ name, states: [{ label: `选择${label}`, content: sample, onClick: disabled ? undefined : choose }], disabled,
    remove: { label: `移除${label}`, run: () => commit("") },
  })
  return card
}
