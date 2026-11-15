import { element } from "../dom-element"
import { createIcon } from "../icons"
import { closeDialog } from "../motion"
import { mobilePortraitQuery } from "./canvas-interaction"
import { bindDialog } from "./ask"
import { documentName, mobileShareButton } from "./dom"
import { appState } from "./state"

export function wireMobileShareReview(): void {
  let confirmed = false
  mobileShareButton.addEventListener("click", event => {
    if (!mobilePortraitQuery.matches || confirmed || !appState.archive) return
    event.stopImmediatePropagation()
    const dialog = element("dialog", "ui-dialog")
    dialog.setAttribute("aria-label", "分享皮肤")
    const form = element("form")
    form.method = "dialog"
    const header = element("header", "ui-dialog-header")
    header.append(Object.assign(element("h2"), { textContent: "分享皮肤" }))
    const body = element("div", "ui-dialog-body mobile-share-review")
    body.append(Object.assign(element("h1"), { textContent: "把皮肤带到输入法" }), Object.assign(element("p", "ui-field-note"), { textContent: "分享当前格式，保留原生数据" }))
    const file = element("div", "ui-mobile-file-choice")
    file.append(createIcon("file"), Object.assign(element("strong"), { textContent: documentName.textContent || "皮肤" }), Object.assign(element("small"), { textContent: appState.archive.format.toUpperCase() }))
    const note = element("p", "ui-field-note")
    note.textContent = "交给系统分享。保存到“文件”，或交给支持的目标应用，再按输入法的皮肤导入流程完成安装。系统菜单中显示的目标由设备决定。"
    body.append(file, note)
    const footer = element("footer", "ui-dialog-footer")
    const share = element("button", "ui-button")
    share.type = "button"
    share.dataset.variant = "primary"
    share.textContent = "继续，打开系统分享"
    share.addEventListener("click", () => {
      dialog.addEventListener("close", () => {
        confirmed = true
        try { mobileShareButton.click() } finally { confirmed = false }
      }, { once: true })
      closeDialog(dialog)
    })
    footer.append(share)
    form.append(header, body, footer)
    dialog.append(form)
    bindDialog(dialog)
    dialog.addEventListener("close", () => dialog.remove(), { once: true })
    document.body.append(dialog)
    dialog.showModal()
  }, { capture: true })
}
