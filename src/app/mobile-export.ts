import { bindDialog } from "./ask"
import { exportTargets } from "./canvas-interaction"
import { mobileExportOpen, mobileExportDialog, mobileExportFormats } from "./dom"
import { currentExportFormat, saveArchive } from "./archive-io"
import { runFileOperation } from "./file-operations"
import { type ExportFormat } from "../export.ts"
import { bdaPlatform, type BdaPlatform } from "../bda-platform.ts"
import { appState } from "./state"
import { element } from "../dom-element.ts"
import { openResourceInventory, resourcePreflight } from "./resource-inventory"

export function wireMobileExport(): void {
  bindDialog(mobileExportDialog)
  const report = element("div", "ui-section")
  const summary = element("p", "ui-field-note")
  const details = element("details")
  details.append(Object.assign(element("summary"), { textContent: "查看缺失引用" }))
  const missing = element("ul")
  details.append(missing)
  const inventory = Object.assign(element("button", "ui-button"), { type: "button", textContent: "查看资源清单" })
  inventory.addEventListener("click", openResourceInventory)
  report.append(summary, details, inventory)
  mobileExportDialog.querySelector(".ui-dialog-body")!.append(report)
  const sync = () => {
    mobileExportOpen.disabled = !appState.archive || exportTargets.every(input => input.disabled)
    for (const input of exportTargets) input.closest("label")!.hidden = input.hidden
  }
  const observer = new MutationObserver(sync)
  for (const input of exportTargets) observer.observe(input, { attributes: true, attributeFilter: ["disabled", "hidden"] })
  sync()
  mobileExportOpen.addEventListener("click", () => {
    const current = currentExportFormat()
    const platform = appState.archive ? bdaPlatform(appState.archive) : "unknown"
    for (const input of mobileExportFormats) {
      input.checked = input.value === current || input.value === `${current}:${platform}`
    }
    if (!mobileExportFormats.some(input => input.checked && !input.disabled)) {
      const first = mobileExportFormats.find(input => !input.disabled)
      if (first) first.checked = true
    }
    mobileExportDialog.returnValue = "cancel"
    const check = resourcePreflight()
    summary.textContent = check.supported ? `当前样式表检查：${check.missing.length} 项缺失引用 · ${check.unused} 个未使用样式` : "此格式的资源依赖将在转换时检查；可先查看资源清单"
    details.hidden = !check.missing.length
    details.open = false
    missing.replaceChildren(...check.missing.map(text => Object.assign(element("li", "ui-field-note"), { textContent: text })))
    mobileExportDialog.showModal()
    mobileExportDialog.querySelector<HTMLButtonElement>('button[value="cancel"]')!.focus({ preventScroll: true })
  })
  const form = mobileExportDialog.querySelector("form")!
  const submit = mobileExportDialog.querySelector<HTMLButtonElement>('button[value="export"]')!
  for (const input of mobileExportFormats) {
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter") return
      event.preventDefault()
      form.requestSubmit(submit)
    })
    input.closest("label")!.addEventListener("dblclick", () => {
      if (input.checked && !input.disabled) form.requestSubmit(submit)
    })
  }
  mobileExportDialog.addEventListener("close", () => {
    if (mobileExportDialog.returnValue === "export") {
      const input = mobileExportFormats.find(input => input.checked && !input.disabled)
      if (input) {
        const format = input.dataset.exportFormat as ExportFormat
        const platform = input.dataset.bdaPlatform as Exclude<BdaPlatform, "unknown"> | undefined
        void runFileOperation("导出", () => saveArchive(true, format, platform))
      }
    }
  })
}
