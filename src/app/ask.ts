import { element, iconButton, bindListboxKeys, searchField, emptyState } from "../dom-element.ts"
import { closeDialog } from "../motion.ts"

type AskAction = { value: string; label: string; variant?: "primary" | "quiet" | "danger" }

export function openRenameDialog(name: string, commit: (name: string) => void): void {
  const dialog = element("dialog", "ui-dialog")
  dialog.dataset.size = "sm"
  dialog.setAttribute("aria-label", "重命名")
  const form = element("form", "ui-form")
  form.method = "dialog"
  const header = element("header", "ui-dialog-header")
  header.append(Object.assign(element("h2"), { textContent: "重命名" }))
  const body = element("div", "ui-dialog-body")
  const input = element("input", "ui-input")
  input.value = name
  input.setAttribute("aria-label", "名称")
  input.spellcheck = false
  const error = element("p", "ui-field-error")
  error.setAttribute("role", "alert")
  body.append(input, error)
  const footer = element("footer", "ui-dialog-footer")
  const cancel = element("button", "ui-button")
  cancel.type = "button"
  cancel.textContent = "取消"
  cancel.addEventListener("click", () => closeDialog(dialog, "cancel"))
  const save = element("button", "ui-button")
  save.textContent = "重命名"
  save.dataset.variant = "primary"
  footer.append(cancel, save)
  form.append(header, body, footer)
  form.addEventListener("submit", event => {
    event.preventDefault()
    try {
      const next = input.value.trim()
      if (!next || next === "." || next === ".." || /[\\/:\x00-\x1f]/.test(next)) {
        throw new Error("请输入有效名称，不能包含路径分隔符或控制字符")
      }
      commit(next)
      closeDialog(dialog)
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : String(reason)
      input.focus()
    }
  })
  dialog.append(form)
  bindDialog(dialog)
  dialog.addEventListener("close", () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
  cancel.focus()
}

/**
 * .ui-dialog 的统一行为（DESIGN.md §7）：头部加关闭按钮，Esc / 点遮罩 / 关闭按钮都走 cancel（默认以 "cancel" 关闭）；
 * 表单提交（method=dialog）以提交按钮的 value 播放退出动效后关闭。表单自己的 submit 处理先 preventDefault 时不接管。
 */
export function bindDialog(dialog: HTMLDialogElement, cancel: () => void = () => closeDialog(dialog, "cancel")): void {
  const header = dialog.querySelector(".ui-dialog-header")
  if (header && dialog.dataset.variant !== "operation" && !dialog.matches(".picker-dialog, .ui-mobile-sheet, .ui-image-editor")) {
    const back = iconButton("arrow-left", "返回上一页", cancel)
    back.classList.add("ui-mobile-back")
    header.prepend(back)
  }
  header?.append(iconButton("x", "关闭", cancel))
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault()
    cancel()
  })
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) cancel()
  })
  dialog.addEventListener("submit", (event) => {
    if (event.defaultPrevented || (event.target as Element).closest("dialog") !== dialog) return
    event.preventDefault()
    closeDialog(dialog, (event.submitter as HTMLButtonElement | null)?.value ?? "")
  })
}

/**
 * 删除与不可撤销操作统一使用（DESIGN.md §7）：一个 .ui-dialog[data-size=sm]，标题、可选的一句说明和一排按钮。
 * 返回被点按钮的 value；Esc、点遮罩或右上角关闭都算 "cancel"。有「取消」时焦点先落在它上面，否则落在主按钮。
 */
export function ask(options: { title: string; prompt?: string; detail?: string; deletion?: boolean; actions: AskAction[] }): Promise<string> {
  const dialog = element("dialog", "ui-dialog")
  dialog.dataset.size = "sm"
  dialog.dataset.variant = "ask"
  if (options.deletion) dialog.dataset.deleteConfirmation = ""
  if (options.prompt) dialog.dataset.layout = "confirmation"
  dialog.setAttribute("aria-label", options.title)
  const form = element("form")
  form.method = "dialog"
  const text = element("div")
  const title = element("h2")
  title.textContent = options.title
  text.append(title)
  const header = element("header", "ui-dialog-header")
  header.append(text)
  form.append(header)
  const body = element("div", "ui-dialog-body")
  const card = element("section", "ui-confirmation-card")
  if (options.detail || options.prompt) {
    body.tabIndex = 0
    if (options.prompt) card.append(Object.assign(element("h3"), { textContent: options.prompt }))
    ;(options.prompt ? card : body).append(Object.assign(element("p"), { textContent: options.detail ?? "" }))
    if (options.prompt) body.append(card)
    form.append(body)
  }
  const footer = element("footer", "ui-dialog-footer")
  for (const action of options.actions) {
    const button = element("button", "ui-button")
    button.value = action.value
    button.textContent = action.label
    if (action.variant) button.dataset.variant = action.variant
    if (options.prompt && action.value !== "cancel") card.append(button)
    else footer.append(button)
  }
  form.append(footer)
  dialog.append(form)
  bindDialog(dialog)
  document.body.append(dialog)
  dialog.showModal()
  const buttons = [...footer.querySelectorAll("button")]
  ;(buttons.find((button) => button.value === "cancel") ?? buttons.find((button) => button.dataset.variant === "primary") ?? buttons[0])?.focus({ preventScroll: true })
  return new Promise((resolve) => dialog.addEventListener("close", () => {
    dialog.remove()
    resolve(dialog.returnValue || "cancel")
  }, { once: true }))
}

export async function confirmDeletion(title: string, detail = "删除后可撤销恢复。"): Promise<boolean> {
  if (document.querySelector('dialog[open][data-delete-confirmation]')) return false
  return await ask({ title, detail, deletion: true, actions: [
    { value: "cancel", label: "取消" }, { value: "delete", label: "删除", variant: "danger" },
  ] }) === "delete"
}

/** Select an existing resource without writing until confirmation. */
export function chooseReferenceValue(label: string, current: string, choices: ReadonlyArray<readonly [string, string, (() => HTMLElement)?]>, commit: (value: string) => void): void {
  const title = label === "样式" ? "全部样式" : `选择${label}`
  const dialog = element("dialog", "ui-dialog")
  dialog.dataset.size = label === "样式" ? "lg" : "sm"
  dialog.setAttribute("aria-label", title)
  const form = element("form")
  form.method = "dialog"
  const header = element("header", "ui-dialog-header")
  header.append(Object.assign(element("h2"), { textContent: title }))
  const body = element("div", "ui-dialog-body")
  const list = element("div", "ui-listbox")
  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", label)
  let selected = choices.some(([value]) => value === current) ? current : undefined
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
    const visible = choices.filter(([value, title]) => `${value} ${title}`.toLowerCase().includes(query.trim().toLowerCase()))
    const focus = visible.find(([value]) => value === selected)?.[0] ?? visible[0]?.[0]
    list.replaceChildren(...visible.map(([value, title, build]) => {
      const row = build?.() ?? Object.assign(element("button", "ui-list-item"), { type: "button", textContent: title })
      row.dataset.value = value
      row.setAttribute("role", "option")
      row.setAttribute("aria-selected", String(value === selected))
      row.tabIndex = value === focus ? 0 : -1
      row.addEventListener("click", () => select(row))
      row.addEventListener("dblclick", () => apply.click())
      if (!build) row.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); select(row); apply.click() } })
      return row
    }))
    if (!list.childElementCount) list.append(emptyState("search", "没有可选内容"))
  }
  bindListboxKeys(list, select)
  const footer = element("footer", "ui-dialog-footer")
  const cancel = Object.assign(element("button", "ui-button"), { textContent: "取消", value: "cancel" })
  const apply = Object.assign(element("button", "ui-button"), { textContent: "应用", value: "apply", disabled: !selected })
  apply.dataset.variant = "primary"
  footer.append(cancel, apply)
  body.dataset.layout = "stack"
  body.append(searchField({ label: `搜索${label}`, onInput: render }), list)
  form.append(header, body, footer)
  dialog.append(form)
  bindDialog(dialog)
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "apply" && selected !== undefined && choices.some(([value]) => value === selected)) commit(selected)
    dialog.remove()
  }, { once: true })
  document.body.append(dialog)
  render()
  dialog.showModal()
  cancel.focus()
}
