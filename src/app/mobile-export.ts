import { exportTargets, isAndroidTauri } from "./canvas-interaction"
import { $, mobileExportOpen, mobileShareButton, shareDialog, mobileExportFormats, documentName, dirty, adbShareButton, saveButton, fileOperationDialog, fileOperationClose, shareTitle, shareDocumentName, shareDocumentStatus, shareDocumentFormat, shareAdbAction, shareExport, shareExportName, shareResourceCheck } from "./dom"
import { currentExportFormat, saveArchive } from "./archive-io"
import { runFileOperation } from "./file-operations"
import { type ExportFormat, exportName } from "../export.ts"
import { skinPlatform, type BdaPlatform } from "../bda-platform.ts"
import { appState } from "./state"
import { element } from "../dom-element.ts"
import { closeDialog } from "../motion"
import { bindDialog } from "./ask"
import { openResourceInventory, resourcePreflight } from "./resource-inventory"

export function openShareDialog(focusExport = false): void {
  if (shareDialog.open || !appState.archive) return
  shareDialog.showModal()
  shareDialog.dataset.focusExport = String(focusExport)
  shareTitle.focus({ preventScroll: true })
}

export function wireMobileExport(): void {
  const shareHint = mobileShareButton.closest(".ui-share-action")!.querySelector("small")!
  const supportedHint = shareHint.textContent
  const summary = element("p", "ui-field-note")
  const details = element("details")
  details.append(Object.assign(element("summary"), { textContent: "查看缺失引用" }))
  const missing = element("ul")
  details.append(missing)
  const inventory = Object.assign(element("button", "ui-button"), { type: "button", textContent: "查看资源清单" })
  inventory.addEventListener("click", openResourceInventory)
  shareResourceCheck.append(summary, details, inventory)
  const submit = shareExport
  const exportDetails = $("#share-export-details")
  let bdaChoice = ""
  const currentChoice = () => currentExportFormat() === "bda" ? bdaChoice : currentExportFormat()
  const selected = () => mobileExportFormats.find(input => input.checked)
  const syncSelection = () => {
    const input = selected()
    const exporting = shareDialog.open && !!input && input.value !== currentChoice()
    saveButton.hidden = exporting
    submit.hidden = exportDetails.hidden = !exporting
    submit.disabled = !exporting || input.disabled
    shareExportName.textContent = exporting ? exportName(documentName.textContent ?? "皮肤", input.dataset.exportFormat as ExportFormat) : ""
  }
  const sync = () => {
    for (const button of shareDialog.querySelectorAll<HTMLButtonElement>(".ui-share-content > .ui-dialog-header button")) button.disabled = appState.fileOperationRunning
    inventory.disabled = appState.fileOperationRunning
    mobileExportOpen.disabled = !appState.archive || exportTargets.every(input => input.disabled)
    for (const input of exportTargets) input.closest("label")!.setAttribute("aria-disabled", String(input.disabled))
    shareAdbAction.hidden = adbShareButton.hidden
    shareDocumentName.textContent = documentName.textContent
    shareDocumentStatus.textContent = dirty.hidden ? "所有修改已保存" : "有未保存的修改"
    shareDocumentFormat.textContent = appState.archive?.format.toUpperCase() ?? ""
    syncSelection()
  }
  const observer = new MutationObserver(sync)
  for (const input of [...exportTargets, adbShareButton, dirty]) observer.observe(input, { attributes: true, attributeFilter: ["disabled", "hidden"] })
  observer.observe(documentName, { childList: true, characterData: true, subtree: true })
  const operationOpen = () => shareDialog.contains(fileOperationDialog) && fileOperationDialog.open
  const close = () => {
    if (operationOpen()) {
      if (!fileOperationClose.disabled) void closeDialog(fileOperationDialog).then(() => shareTitle.focus({ preventScroll: true }))
    } else if (!appState.fileOperationRunning) void closeDialog(shareDialog)
  }
  bindDialog(shareDialog, close)
  shareDialog.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.defaultPrevented || !operationOpen()) return
    event.preventDefault()
    close()
  })
  mobileExportOpen.addEventListener("click", () => openShareDialog(true))
  $("#workspace-export").addEventListener("click", () => openShareDialog())
  new MutationObserver(() => {
    if (!shareDialog.open) { syncSelection(); return }
    mobileShareButton.hidden = !isAndroidTauri() && typeof navigator.share !== "function"
    shareHint.textContent = mobileShareButton.hidden ? "当前环境不支持系统分享，可使用保存或另存为。" : supportedHint
    bdaChoice = appState.archive?.format === "bda" ? `bda:${skinPlatform(appState.archive)}` : ""
    const current = currentChoice()
    for (const input of mobileExportFormats) input.checked = input.value === current
    const check = resourcePreflight()
    summary.textContent = check.supported ? `资源检查 · ${check.missing.length} 项缺失引用 · ${check.unused} 个未使用样式` : "此格式的资源依赖将在转换时检查"
    details.hidden = !check.missing.length
    details.open = false
    missing.replaceChildren(...check.missing.map(text => Object.assign(element("li", "ui-field-note"), { textContent: text })))
    shareDialog.querySelector(".ui-dialog-body")!.scrollTop = 0
    sync()
    if (!appState.fileOperationRunning) {
      const focus = shareDialog.dataset.focusExport === "true" ? selected() : saveButton
      focus?.focus({ preventScroll: true })
    }
  }).observe(shareDialog, { attributes: true, attributeFilter: ["open"] })
  const exportSelected = () => {
    const input = selected()
    if (!input || input.disabled) return
    if (input.value === currentChoice()) { saveButton.click(); return }
    if (submit.disabled) return
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
  sync()
}
