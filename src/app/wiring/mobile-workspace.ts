import { wireMobileInspector } from "./mobile-inspector"
import { files, mobilePaneButtons, mobilePreviewToggle, mobilePreviewResize, mainWorkspace, mobileObjectSelect, mobileCanvasClose, mobileCanvasParent, mobileSaveButton, saveButton, openButton, newButton } from "../dom"
import { mobilePortraitQuery } from "../canvas-interaction"
import { appState } from "../state"
import { setMobilePane, setMobileCanvas, setMobilePreviewHeight, syncMobileInspectorHeader } from "../mobile-layout"
import { updateSourceFindVisibility } from "../source-panel"
import { selectParentObject } from "../key-editing"

export function wireMobileWorkspace(): void {
  wireMobileInspector()
  setMobilePreviewHeight(appState.mobilePreviewRatio)
  setMobilePane("preview")
  syncMobileInspectorHeader()
  for (const button of mobilePaneButtons) {
    button.addEventListener("click", () => setMobilePane(button.dataset.mobilePane === "inspector" ? "inspector" : button.dataset.mobilePane === "layout" ? "layout" : "preview"))
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
      event.preventDefault()
      const next = event.key === "Home" ? mobilePaneButtons[0] : event.key === "End" ? mobilePaneButtons[2]
        : mobilePaneButtons[(mobilePaneButtons.indexOf(button) + (event.key === "ArrowLeft" ? 2 : 1)) % 3]
      next.click()
      next.focus()
    })
  }
  mobilePortraitQuery.addEventListener("change", () => {
    appState.mobilePreviewDrag = undefined
    setMobileCanvas("closed")
    if (mobilePortraitQuery.matches) {
      const activeGroup = files.querySelector<HTMLDetailsElement>(".nav-group.mobile-overview-active")
      if (activeGroup) activeGroup.open = true
    }
    const pane = document.documentElement.dataset.mobilePane
    setMobilePane(pane === "inspector" || pane === "layout" ? pane : "preview")
    syncMobileInspectorHeader()
    updateSourceFindVisibility()
  })
  const syncSave = () => { mobileSaveButton.disabled = saveButton.disabled }
  new MutationObserver(syncSave).observe(saveButton, { attributes: true, attributeFilter: ["disabled"] })
  syncSave()
  mobileSaveButton.addEventListener("click", () => saveButton.click())
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-mobile-action]")) {
    button.addEventListener("click", () => (button.dataset.mobileAction === "open" ? openButton : newButton).click())
  }
  mobileObjectSelect.addEventListener("click", () => {
    setMobileCanvas("select")
    mobileCanvasClose.focus()
  })
  mobilePreviewToggle.addEventListener("click", () => {
    setMobileCanvas(appState.mobileCanvas === "preview" ? "closed" : "preview")
  })
  mobileCanvasClose.addEventListener("click", () => setMobileCanvas("closed"))
  mobileCanvasParent.addEventListener("click", () => {
    selectParentObject()
    setMobileCanvas("closed")
  })
  mobilePreviewResize.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    appState.mobilePreviewDrag = { pointerId: event.pointerId, y: event.clientY, ratio: appState.mobilePreviewRatio }
    mobilePreviewResize.setPointerCapture(event.pointerId)
    event.preventDefault()
  })
  mobilePreviewResize.addEventListener("pointermove", (event) => {
    const drag = appState.mobilePreviewDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    setMobilePreviewHeight(drag.ratio + (event.clientY - drag.y) / mainWorkspace.clientHeight * 100)
  })
  const finishResize = (event: PointerEvent) => {
    const drag = appState.mobilePreviewDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.type === "pointercancel") setMobilePreviewHeight(drag.ratio)
    appState.mobilePreviewDrag = undefined
    localStorage.setItem("mobile-preview-ratio", String(appState.mobilePreviewRatio))
  }
  mobilePreviewResize.addEventListener("pointerup", finishResize)
  mobilePreviewResize.addEventListener("pointercancel", finishResize)
  mobilePreviewResize.addEventListener("lostpointercapture", () => { appState.mobilePreviewDrag = undefined })
  mobilePreviewResize.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    setMobilePreviewHeight(event.key === "Home" ? 28 : event.key === "End" ? 52
      : appState.mobilePreviewRatio + (event.key === "ArrowUp" ? -1 : 1) * (event.shiftKey ? 10 : 2))
    localStorage.setItem("mobile-preview-ratio", String(appState.mobilePreviewRatio))
  })
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || appState.mobileCanvas === "closed") return
    event.preventDefault()
    event.stopImmediatePropagation()
    setMobileCanvas("closed")
  })
}
