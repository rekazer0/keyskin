import { element, iconButton } from "../dom-element.ts"
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
export function bindDialog(dialog: HTMLDialogElement, cancel = () => closeDialog(dialog, "cancel")): void {
  dialog.querySelector(".ui-dialog-header")?.append(iconButton("x", "关闭", cancel))
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault()
    cancel()
  })
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) cancel()
  })
  dialog.addEventListener("submit", (event) => {
    if (event.defaultPrevented) return
    event.preventDefault()
    closeDialog(dialog, (event.submitter as HTMLButtonElement | null)?.value ?? "")
  })
}

/**
 * 只给撤销不了的操作用（DESIGN.md §7）：一个 .ui-dialog[data-size=sm]，标题、可选的一句说明和一排按钮。
 * 返回被点按钮的 value；Esc、点遮罩或右上角关闭都算 "cancel"。有「取消」时焦点先落在它上面，否则落在主按钮。
 */
export function ask(options: { title: string; detail?: string; actions: AskAction[] }): Promise<string> {
  const dialog = element("dialog", "ui-dialog")
  dialog.dataset.size = "sm"
  dialog.dataset.variant = "ask"
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
  if (options.detail) {
    const body = element("div", "ui-dialog-body")
    body.tabIndex = 0
    body.append(Object.assign(element("p"), { textContent: options.detail }))
    form.append(body)
  }
  const footer = element("footer", "ui-dialog-footer")
  for (const action of options.actions) {
    const button = element("button", "ui-button")
    button.value = action.value
    button.textContent = action.label
    if (action.variant) button.dataset.variant = action.variant
    footer.append(button)
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
