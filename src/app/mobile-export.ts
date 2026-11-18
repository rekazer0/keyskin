import { exportTargets } from "./canvas-interaction"
import { $, mobileExportOpen, sharePage, mobileExportFormats, documentName, dirty, adbShareButton, canvasWrap, saveButton, fileOperationDialog, fileOperationClose, shareContent, shareTitle, shareBack, shareDocumentName, shareDocumentStatus, shareDocumentFormat, shareAdbAction, shareExport, shareExportName, shareResourceCheck } from "./dom"
import { currentExportFormat, saveArchive } from "./archive-io"
import { exportTargetUnavailable, runFileOperation } from "./file-operations"
import { type ExportFormat, exportName } from "../export.ts"
import { bdaPlatform, type BdaPlatform } from "../bda-platform.ts"
import { appState } from "./state"
import { element } from "../dom-element.ts"
import { playEnter, closeDialog } from "../motion"
import { openResourceInventory, resourcePreflight } from "./resource-inventory"

export function openSharePage(): void {
  canvasWrap.classList.remove("empty")
  sharePage.hidden = false
}

/** 桌面和手机共用页内分享工作区，不再打开格式选择弹窗。 */
export function wireMobileExport(): void {
  const summary = element("p", "ui-field-note")
  const details = element("details")
  details.append(Object.assign(element("summary"), { textContent: "查看缺失引用" }))
  const missing = element("ul")
  details.append(missing)
  const inventory = Object.assign(element("button", "ui-button"), { type: "button", textContent: "查看资源清单" })
  inventory.addEventListener("click", openResourceInventory)
  shareResourceCheck.append(summary, details, inventory)
  const submit = shareExport
  const selected = () => mobileExportFormats.find(input => input.checked && !input.disabled)
  const syncSelection = () => {
    const input = selected()
    submit.disabled = !input || saveButton.disabled
    shareExportName.textContent = input ? exportName(documentName.textContent ?? "皮肤", input.dataset.exportFormat as ExportFormat) : ""
  }
  const sync = () => {
    shareBack.disabled = appState.fileOperationRunning
    inventory.disabled = appState.fileOperationRunning
    mobileExportOpen.disabled = !appState.archive || exportTargets.every(input => input.disabled)
    for (const input of exportTargets) {
      const label = input.closest("label")!
      const format = input.dataset.exportFormat as ExportFormat
      const unavailable = exportTargetUnavailable(format)
      label.setAttribute("aria-disabled", String(input.disabled))
      label.title = unavailable ? `当前 ${appState.archive?.format.toUpperCase()} 格式暂不支持另存为 ${format.toUpperCase()}` : ""
      label.querySelector("small")!.textContent = `.${format}${unavailable ? " · 暂不支持" : ""}`
    }
    shareAdbAction.hidden = adbShareButton.hidden
    shareDocumentName.textContent = documentName.textContent
    shareDocumentStatus.textContent = dirty.hidden ? "所有修改已保存" : "有未保存的修改"
    shareDocumentFormat.textContent = appState.archive?.format.toUpperCase() ?? ""
    syncSelection()
  }
  const observer = new MutationObserver(sync)
  for (const input of [...exportTargets, saveButton, adbShareButton, dirty]) observer.observe(input, { attributes: true, attributeFilter: ["disabled", "hidden"] })
  observer.observe(documentName, { childList: true, characterData: true, subtree: true })
  const close = () => {
    if (appState.fileOperationRunning) return
    sharePage.hidden = true
  }
  shareBack.addEventListener("click", () => {
    close()
    if (!sharePage.hidden) return
    const target = $<HTMLButtonElement>('[data-workspace-page="overview"]')
    if (target.getClientRects().length) target.focus()
    else $("#mobile-app-more > summary").focus()
  })
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-workspace-page], #mobile-navigation button, #recent-files")) button.addEventListener("click", close)
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.defaultPrevented || sharePage.hidden) return
    if (fileOperationDialog.open && fileOperationDialog.dataset.inline === "true") {
      if (!fileOperationClose.disabled) {
        event.preventDefault()
        void closeDialog(fileOperationDialog)
      }
      return
    }
    if (document.querySelector("dialog[open]")) return
    event.preventDefault()
    shareBack.click()
  })
  mobileExportOpen.addEventListener("click", openSharePage)
  new MutationObserver(() => {
    if (sharePage.hidden) return
    const current = currentExportFormat()
    const platform = appState.archive ? bdaPlatform(appState.archive) : "unknown"
    for (const input of mobileExportFormats) input.checked = input.value === current || input.value === `${current}:${platform}`
    if (!selected()) {
      const first = mobileExportFormats.find(input => !input.disabled)
      if (first) first.checked = true
    }
    const check = resourcePreflight()
    summary.textContent = check.supported ? `资源检查 · ${check.missing.length} 项缺失引用 · ${check.unused} 个未使用样式` : "此格式的资源依赖将在转换时检查"
    details.hidden = !check.missing.length
    details.open = false
    missing.replaceChildren(...check.missing.map(text => Object.assign(element("li", "ui-field-note"), { textContent: text })))
    sharePage.scrollTop = 0
    sync()
    playEnter(shareContent)
    queueMicrotask(() => shareTitle.focus({ preventScroll: true }))
  }).observe(sharePage, { attributes: true, attributeFilter: ["hidden"] })
  const exportSelected = () => {
    const input = selected()
    if (!input || submit.disabled) return
    const format = input.dataset.exportFormat as ExportFormat
    const platform = input.dataset.bdaPlatform as Exclude<BdaPlatform, "unknown"> | undefined
    void runFileOperation("另存为", () => saveArchive(true, format, platform))
  }
  for (const input of mobileExportFormats) {
    input.addEventListener("change", syncSelection)
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter") return
      event.preventDefault()
      exportSelected()
    })
    input.closest("label")!.addEventListener("dblclick", exportSelected)
  }
  new ResizeObserver(() => {
    if (fileOperationDialog.open && fileOperationDialog.dataset.inline === "true" && appState.fileOperationRunning) {
      fileOperationDialog.scrollIntoView({ block: "nearest" })
    }
  }).observe(fileOperationDialog)
  submit.addEventListener("click", exportSelected)
  new MutationObserver(() => { if (canvasWrap.classList.contains("empty")) close() }).observe(canvasWrap, { attributes: true, attributeFilter: ["class"] })
  sync()
}
