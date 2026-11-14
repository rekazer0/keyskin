import { bindDialog } from "./ask"
import { exportButtons } from "./canvas-interaction"
import { mobileExportOpen, mobileExportDialog, mobileExportFormats } from "./dom"
import { currentExportFormat } from "./archive-io"
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
  const target = (value: string) => {
    const [format, platform] = value.split(":")
    return exportButtons.find(button => button.dataset.exportFormat === format && button.dataset.bdaPlatform === platform)
  }
  const sync = () => { mobileExportOpen.disabled = !appState.archive || exportButtons.every(button => button.disabled) }
  const observer = new MutationObserver(sync)
  for (const button of exportButtons) observer.observe(button, { attributes: true, attributeFilter: ["disabled"] })
  sync()
  mobileExportOpen.addEventListener("click", () => {
    const current = currentExportFormat()
    for (const input of mobileExportFormats) {
      input.disabled = target(input.value)?.disabled ?? true
      input.checked = input.value === current
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
  })
  mobileExportDialog.addEventListener("close", () => {
    if (mobileExportDialog.returnValue === "export") {
      const input = mobileExportFormats.find(input => input.checked && !input.disabled)
      if (input) target(input.value)?.click()
    }
  })
}
