import { bindDialog } from "./ask"
import { exportButtons } from "./canvas-interaction"
import { mobileExportOpen, mobileExportDialog, mobileExportFormats } from "./dom"
import { currentExportFormat } from "./archive-io"
import { appState } from "./state"

export function wireMobileExport(): void {
  bindDialog(mobileExportDialog)
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
    mobileExportDialog.showModal()
  })
  mobileExportDialog.addEventListener("close", () => {
    if (mobileExportDialog.returnValue === "export") {
      const input = mobileExportFormats.find(input => input.checked && !input.disabled)
      if (input) target(input.value)?.click()
    }
  })
}
