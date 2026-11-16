import { bindListboxKeys, element, emptyState, searchField } from "../dom-element.ts"
import { closeDialog } from "../motion.ts"
import { actionDescription, knownFunctionCodes, knownSkinStates } from "../actions.ts"
import { bindDialog } from "./ask"
import { isEditing } from "./edit-history"
import { requestEditMode } from "./mobile-layout"

/** 选择与手输动作码走原输入事件，沿用各格式的绑定和撤销。 */
export function wireGestureRecording(root: HTMLElement): void {
  root.addEventListener("keydown", event => {
    const target = event.target as HTMLElement
    if (target.matches(".inspector-gesture > [role=button]") && ["Enter", " "].includes(event.key)) {
      event.preventDefault()
      target.click()
    }
  })
  root.addEventListener("click", event => {
    const target = event.target as Element
    const cell = target.closest<HTMLElement>(".inspector-gesture")
    const input = cell?.querySelector<HTMLInputElement>("input")
    if (!cell || !input || target.closest("input, button")) return
    event.preventDefault()
    if (!isEditing()) { requestEditMode(); return }
    if (input.disabled || input.readOnly) return
    const dialog = element("dialog", "ui-dialog")
    dialog.dataset.size = "sm"
    dialog.setAttribute("aria-label", "选择动作码")
    const form = element("form")
    form.addEventListener("submit", event => { event.preventDefault(); apply.click() })
    const header = element("header", "ui-dialog-header")
    const heading = element("div")
    heading.append(Object.assign(element("h2"), { textContent: "选择动作码" }))
    header.append(heading)
    const body = element("div", "ui-dialog-body")
    const code = element("input", "ui-input")
    code.setAttribute("aria-label", "动作码")
    code.value = input.value
    code.placeholder = "未设置"
    code.autocomplete = "off"
    code.spellcheck = false
    const list = element("div", "ui-listbox")
    list.setAttribute("role", "listbox")
    list.setAttribute("aria-label", "全部动作码")
    const codes = [...new Set(["", input.value, ...knownFunctionCodes, ...knownSkinStates.map(state => `S${state}`)])]
    const choose = (row: HTMLElement) => {
      code.value = row.dataset.actionCode ?? ""
      for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
        option.setAttribute("aria-selected", String(option === row))
        option.tabIndex = option === row ? 0 : -1
      }
      row.focus()
    }
    const render = (query = "") => {
      const visible = codes.filter(value => `${value} ${actionDescription(value)}`.toLowerCase().includes(query.toLowerCase()))
      list.replaceChildren(...visible.map((value, index) => {
        const row = element("button", "ui-list-item")
        row.type = "button"
        row.dataset.actionCode = value
        row.setAttribute("role", "option")
        row.setAttribute("aria-selected", String(value === code.value))
        row.tabIndex = value === code.value || index === 0 && !visible.includes(code.value) ? 0 : -1
        row.textContent = value ? `${value} · ${actionDescription(value) || value}` : "未设置"
        row.addEventListener("click", () => choose(row))
        row.addEventListener("dblclick", () => apply.click())
        row.addEventListener("keydown", event => {
          if (event.key === "Enter") { event.preventDefault(); choose(row); apply.click() }
        })
        return row
      }))
      if (!visible.length) list.append(emptyState("search-x"))
    }
    const search = searchField({ label: "搜索动作码", onInput: render })
    code.addEventListener("input", () => render(search.querySelector("input")!.value.trim()))
    bindListboxKeys(list, choose)
    body.append(search, list, code)
    const footer = element("footer", "ui-dialog-footer")
    const cancel = Object.assign(element("button", "ui-button"), { type: "button", textContent: "取消" })
    cancel.addEventListener("click", () => closeDialog(dialog, "cancel"))
    const apply = Object.assign(element("button", "ui-button"), { type: "button", textContent: "绑定" })
    apply.dataset.variant = "primary"
    apply.addEventListener("click", () => closeDialog(dialog, "apply"))
    footer.append(cancel, apply)
    form.append(header, body, footer)
    dialog.append(form)
    bindDialog(dialog)
    dialog.addEventListener("close", () => {
      if (dialog.returnValue === "apply" && input.isConnected && !input.disabled && !input.readOnly && isEditing()) {
        input.value = code.value.trim()
        input.dispatchEvent(new Event("input", { bubbles: true }))
        if (input.isConnected) input.dispatchEvent(new Event("change", { bubbles: true }))
      }
      dialog.remove()
    }, { once: true })
    render()
    document.body.append(dialog)
    dialog.showModal()
    cancel.focus()
  })
}
