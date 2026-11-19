import { exportTargets, isAndroidTauri } from "./canvas-interaction"
import { $, mobileExportOpen, mobileShareButton, shareDialog, mobileExportFormats, documentName, dirty, adbShareButton, saveButton, fileOperationDialog, fileOperationClose, shareTitle, shareDocumentName, shareDocumentStatus, shareDocumentFormat, shareAdbAction, shareExport, shareExportName, shareResourceCheck } from "./dom"
import { currentExportFormat, saveArchive } from "./archive-io"
import { runFileOperation } from "./file-operations"
import { type ExportFormat, exportName } from "../export.ts"
import { skinPlatform, type BdaPlatform } from "../bda-platform.ts"
import { appState } from "./state"
import { element } from "../dom-element.ts"
import { createIcon } from "../icons.ts"
import { closeDialog } from "../motion"
import { bindDialog } from "./ask"
import { openResourceInventory, resourcePreflight } from "./resource-inventory"
import { inspectSkin } from "../skin-preflight.ts"
import { flushNumberInputWheel } from "../number-input-wheel.ts"
import { commitTextChanges } from "./edit-history"

export function openShareDialog(focusExport = false): void {
  if (shareDialog.open || !appState.archive) return
  shareDialog.showModal()
  shareDialog.dataset.focusExport = String(focusExport)
  shareTitle.focus({ preventScroll: true })
}

function setupFormatCheck() {
  const title = Object.assign(element("h3"), { textContent: "格式检查", id: "share-format-check-title" })
  const status = Object.assign(element("p", "ui-field-note"), { tabIndex: -1 })
  status.setAttribute("role", "status")
  const resources = element("p", "ui-field-note")
  const details = element("details", "ui-disclosure")
  const disclosure = element("summary", "ui-button")
  disclosure.dataset.variant = "quiet"
  const disclosureLabel = element("span")
  const total = element("span", "ui-badge")
  total.dataset.variant = "pill"
  disclosure.append(createIcon("chevron-right", 14), disclosureLabel, total)
  const list = element("ul")
  list.setAttribute("role", "list")
  details.append(disclosure, list)
  const repair = Object.assign(element("button", "ui-button"), { type: "button", textContent: "一键修复", hidden: true })
  const inventory = Object.assign(element("button", "ui-button"), { type: "button", textContent: "查看资源清单" })
  inventory.addEventListener("click", openResourceInventory)
  const header = element("div")
  header.append(title, status, resources)
  shareResourceCheck.append(header, repair, inventory, details)

  const inspect = (archive: NonNullable<typeof appState.archive>) => {
    const { issues, changes } = inspectSkin(archive)
    try {
      const check = resourcePreflight()
      resources.textContent = check.supported
        ? `当前样式表的资源检查 · ${check.missing.length} 项缺失引用 · ${check.unused} 个未使用样式`
        : "资源检查范围：不含此格式的资源引用"
      for (const text of check.missing) issues.push({ location: "资源引用", message: text, fixable: false })
    } catch {
      resources.textContent = ""
      issues.push({ location: "资源引用", message: "资源检查未完成，需手动核对", fixable: false })
    }
    return { issues, changes }
  }
  const feedback = (message: string, state: "ok" | "warn" | "error") => {
    status.replaceChildren(createIcon(state === "ok" ? "circle-check" : "circle-alert"), document.createTextNode(message))
    status.dataset.state = state
  }
  type Issue = ReturnType<typeof inspect>["issues"][number]
  let rows: { issue: Issue; state: string }[] = []
  const renderDetails = () => {
    const panel = document.createDocumentFragment()
    if (details.open) for (const { issue, state } of rows) {
      const item = element("li")
      const label = Object.assign(element("span", "ui-badge"), { textContent: state })
      label.dataset.variant = "pill"
      item.append(Object.assign(element("span"), { textContent: issue.message }), label,
        Object.assign(element("small", "ui-field-note"), { textContent: issue.location }))
      panel.append(item)
    }
    list.replaceChildren(panel)
  }
  details.addEventListener("toggle", renderDetails)
  const render = ({ issues, changes }: ReturnType<typeof inspect>, fixed: Issue[] = []) => {
    const count = issues.filter(issue => issue.fixable).length
    feedback(issues.length ? `当前项目发现 ${issues.length} 项问题 · ${count} 项可自动修复` : "当前项目检查通过 · 未发现问题", issues.length ? "warn" : "ok")
    repair.hidden = !changes.length
    rows = [...issues.map(issue => ({ issue, state: issue.fixable ? "可自动修复" : "需手动处理" })),
      ...fixed.map(issue => ({ issue, state: "已修复" }))]
    details.hidden = !rows.length
    disclosureLabel.textContent = fixed.length ? "查看修复详情" : "查看问题详情"
    total.textContent = String(rows.length)
    renderDetails()
  }
  const check = () => {
    details.open = false
    repair.hidden = details.hidden = true
    resources.textContent = ""
    try {
      flushNumberInputWheel()
      if (appState.archive) render(inspect(appState.archive))
    } catch {
      feedback("格式检查失败，无法确认当前文件状态", "error")
    }
  }
  repair.addEventListener("click", () => {
    const archive = appState.archive
    if (!archive || appState.fileOperationRunning) return
    if (appState.aiDraftPreview) {
      feedback("未执行修复：请先应用或取消 AI 草稿预览", "warn")
      return
    }
    try {
      const before = inspect(archive)
      if (!before.changes.length) {
        render(before)
        feedback(before.issues.length ? `没有可自动修复的问题 · 剩余 ${before.issues.length} 项需手动处理` : "重新检查通过 · 无需修复", before.issues.length ? "warn" : "ok")
        return
      }
      commitTextChanges(before.changes)
      const after = inspect(archive)
      const remaining = new Set(after.issues.map(issue => `${issue.location}\0${issue.message}`))
      const fixed = before.issues.filter(issue => issue.fixable && !remaining.has(`${issue.location}\0${issue.message}`))
      render(after, fixed)
      if (!fixed.length || before.changes.some(change => archive.getText(change.path) !== change.after)) {
        feedback(`修复失败 · 复查剩余 ${after.issues.length} 项问题`, "error")
      } else if (after.issues.length) {
        feedback(`部分修复 · 已修复 ${fixed.length} 项 · 复查剩余 ${after.issues.length} 项`, "warn")
      } else {
        feedback(`修复成功 · 已修复 ${fixed.length} 项 · 复查通过`, "ok")
      }
    } catch {
      feedback("修复失败 · 无法确认复查结果，请重新打开弹窗检查", "error")
    } finally {
      status.focus({ preventScroll: true })
    }
  })
  return { check, sync: () => { repair.disabled = inventory.disabled = appState.fileOperationRunning } }
}

export function wireMobileExport(): void {
  const shareHint = mobileShareButton.closest(".ui-share-action")!.querySelector("small")!
  const supportedHint = shareHint.textContent
  const formatCheck = setupFormatCheck()
  const submit = shareExport
  const exportDetails = $("#share-export-details")
  let bdaChoice = ""
  const currentChoice = () => currentExportFormat() === "bda" ? bdaChoice : currentExportFormat()
  const selected = () => mobileExportFormats.find(input => input.checked)
  const syncSelection = () => {
    const input = selected()
    const exporting = shareDialog.open && !!input && input.value !== currentChoice()
    saveButton.hidden = exporting
    exportDetails.hidden = !exporting
    submit.hidden = !shareDialog.open
    submit.disabled = saveButton.disabled || !!input?.disabled
    if (exporting) submit.dataset.variant = "primary"
    else delete submit.dataset.variant
    shareExportName.textContent = exporting ? exportName(documentName.textContent ?? "皮肤", input.dataset.exportFormat as ExportFormat) : ""
  }
  const sync = () => {
    for (const button of shareDialog.querySelectorAll<HTMLButtonElement>(".ui-share-content > .ui-dialog-header button")) button.disabled = appState.fileOperationRunning
    formatCheck.sync()
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
    formatCheck.check()
    shareDialog.querySelector(".ui-dialog-body")!.scrollTop = 0
    sync()
    if (!appState.fileOperationRunning) {
      const focus = shareDialog.dataset.focusExport === "true" ? selected() : saveButton
      focus?.focus({ preventScroll: true })
    }
  }).observe(shareDialog, { attributes: true, attributeFilter: ["open"] })
  submit.addEventListener("click", () => {
    if (submit.disabled) return
    const input = selected()
    const format = (input?.dataset.exportFormat as ExportFormat | undefined) ?? currentExportFormat()
    const platform = input?.dataset.bdaPlatform as Exclude<BdaPlatform, "unknown"> | undefined
    const targetPlatform = input?.value === currentChoice() ? undefined : platform
    void runFileOperation("另存为", () => saveArchive(true, format, targetPlatform))
  })
  const activateFormat = () => (selected()?.value === currentChoice() ? saveButton : submit).click()
  for (const input of mobileExportFormats) {
    input.addEventListener("change", syncSelection)
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter") return
      event.preventDefault()
      activateFormat()
    })
    input.closest("label")!.addEventListener("dblclick", activateFormat)
  }
  new ResizeObserver(() => {
    if (fileOperationDialog.open && fileOperationDialog.dataset.inline === "true" && appState.fileOperationRunning) {
      fileOperationDialog.scrollIntoView({ block: "nearest" })
    }
  }).observe(fileOperationDialog)
  sync()
}
