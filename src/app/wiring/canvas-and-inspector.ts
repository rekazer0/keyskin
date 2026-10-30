import { installClientLogging } from "../../client-log.ts"
import { installSafeAreaLock } from "../../safe-area.ts"
import { isTauri, scrollbarIdleTimers, source, schedulePointerCoordinates, syncMobileShareLabel, mobileCommandButtons, mobileCommandTarget, syncMobileCommands, mobilePortraitQuery, preview, toolbarPreview, keyboardFields } from "../canvas-interaction"
import { installNumberInputWheel } from "../../number-input-wheel.ts"
import { wheelZoomFactor } from "../../wheel-zoom.ts"
import { mixedCoordinateDelta } from "../../mixed-input.ts"
import { keyEventElement, moveSelectedKeys, selectParentObject } from "../key-editing"
import { closeLayoutOverview, fitLayoutOverview, fitLiveKeyboard, openLayoutOverview, panLayoutOverview, stepLayout, zoomLayoutOverview } from "../layout-overview"
import { renderSourceValueThumbnail, updateSourceFindVisibility } from "../source-panel"
import { sidebarProjectName, documentName, aiDesignThinking, aiDesignIntensity, aiDesignScope, aiDesignModel, canvasWrap, deviceShell, toolbarStrip, previewCanvas, toolbarCanvas, editorCrosshair, previewCoordinates, previewCoordinateX, previewCoordinateY, mobileCommandMenu, mobileUndoButton, undoButton, mobileRedoButton, redoButton, desktopUndoButton, desktopRedoButton, quickInspector, mobileInspectorGroups, bdaInspectorStateButtons, bdaConfigFieldsGroup, mobilePaneButtons, files, mainWorkspace, mobileSplitHandle, mobilePreviewPosition, previewZoomOut, previewZoomFit, previewZoomIn, layoutOverview, layoutOverviewToggle, toolbarMenus, previewPanelViewport, candidateArea, candidateInputText, styleDetailImageButtons, workspaceImage, sourceStyleProxy, toolbarFields, keyFields, newStyleDialog, baiduActionCodes, sourceUploadButton, sourceUploadInput, sourceDownloadButton, sourceCopyButton } from "../dom"
import { appState } from "../state"
import { hydrateIcons } from "../../icons"
import { syncSinglePageInspectorGroup, setMobileSplit, setMobilePane, syncMobileInspectorHeader, setMobilePreviewCollapsed } from "../mobile-layout"
import { fitCandidateInputBar } from "../config-context"
import { measureCanvasWrapInnerSize, scheduleFitCanvasPreview, applyPreviewZoom, setPreviewPan, finishPreviewPan, schedulePreviewPan } from "../preview-render"
import { canvasEditable, isEditing } from "../edit-history"
import { chooseStyleImageSlice, clearImagePreviewError, showImagePreviewError } from "../resource-inspector"
import { replacedSourceStyle } from "../../source-value-ranges.ts"
import { decorateStyleReferenceInput } from "../style-references"
import { pickAnimationKeys } from "../animation-resource"
import { knownFunctionCodes, actionDescription } from "../../actions.ts"
import { renameDocumentTitle } from "../key-inspector"
import { runFileOperation } from "../file-operations"
import { sourceTargetFolder, commitSourceUploads, sourceSelection, setSourceTransfer } from "../source-files"
import { writeToChosenFile } from "../archive-io"
import { rememberAiDesignModel, setAiDesignScope } from "../ai-panel"
import { wireWindowControls } from "../window-controls"

/** 启动环境、全局指针、画布预览、检查器与缩放。只在启动时由 main.ts 按顺序调用一次。 */
export function wireCanvasAndInspector(): void {
  installClientLogging(document.querySelector<HTMLElement>("#about-update")?.dataset.currentVersion ?? "unknown")
  installSafeAreaLock()
  document.documentElement.classList.toggle("macos", isTauri() && navigator.userAgent.includes("Macintosh"))
  document.documentElement.classList.toggle("windows", isTauri() && navigator.userAgent.includes("Windows"))
  wireWindowControls()
  preview.onAnimationKeys = pickAnimationKeys
  installNumberInputWheel(document, {
    isMixed: (field) => Boolean(mixedCoordinateDelta(field.dataset.keyField ?? "", field.placeholder, field.disabled, 1)),
    moveMixed: (field, steps) => {
      const delta = mixedCoordinateDelta(field.dataset.keyField ?? "", field.placeholder, field.disabled, steps)
      if (delta) moveSelectedKeys(delta[0] * Math.abs(steps), delta[1] * Math.abs(steps))
    },
  })
  document.addEventListener("scroll", (event) => {
    if (!(event.target instanceof HTMLElement)) return
    const target = event.target
    target.classList.add("scrollbar-active")
    window.clearTimeout(scrollbarIdleTimers.get(target))
    scrollbarIdleTimers.set(target, window.setTimeout(() => {
      target.classList.remove("scrollbar-active")
    }, 1000))
  }, true)
  window.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.pointerType !== "mouse") return
    for (const target of event.composedPath()) {
      if (!(target instanceof HTMLElement)) continue
      // 绝大多数祖先不可滚动，先用廉价判断跳过，避免每次点击对整条路径取计算样式。
      if (target.scrollHeight <= target.clientHeight && target.scrollWidth <= target.clientWidth) continue
      const style = getComputedStyle(target)
      if (style.getPropertyValue("scrollbar-width") === "none") continue
      const size = Number.parseFloat(style.getPropertyValue("--scrollbar-size"))
      const rect = target.getBoundingClientRect()
      const vertical = target.scrollHeight > target.clientHeight
        && /auto|scroll|overlay/.test(style.overflowY)
        && event.clientX >= rect.right - size
        && event.clientY < rect.top + target.clientTop + target.clientHeight
      const horizontal = target.scrollWidth > target.clientWidth
        && /auto|scroll|overlay/.test(style.overflowX)
        && event.clientY >= rect.bottom - size
        && event.clientX < rect.left + target.clientLeft + target.clientWidth
      if (!vertical && !horizontal) continue

      const clientSize = vertical ? target.clientHeight : target.clientWidth
      const scrollSize = vertical ? target.scrollHeight : target.scrollWidth
      const scrollPosition = vertical ? target.scrollTop : target.scrollLeft
      const pointer = vertical ? event.clientY - rect.top - target.clientTop : event.clientX - rect.left - target.clientLeft
      const thumbSize = Math.max(24, clientSize * clientSize / scrollSize)
      const thumbStart = scrollPosition / (scrollSize - clientSize) * (clientSize - thumbSize)
      if (pointer >= thumbStart && pointer <= thumbStart + thumbSize) return

      const position = (pointer - thumbSize / 2) / (clientSize - thumbSize) * (scrollSize - clientSize)
      if (vertical) target.scrollTop = position
      else target.scrollLeft = position
      event.preventDefault()
      event.stopPropagation()
      return
    }
  }, true)
  source.setValuePreviewRenderer(renderSourceValueThumbnail)
  if (sidebarProjectName) {
    const syncSidebarProjectName = () => { sidebarProjectName.textContent = documentName?.textContent?.trim() || "未打开皮肤" }
    syncSidebarProjectName()
    new MutationObserver(syncSidebarProjectName).observe(documentName, { childList: true, characterData: true, subtree: true })
  }
  aiDesignThinking.value = localStorage.getItem("ai-thinking-level") || "off"
  if (!aiDesignThinking.value) aiDesignThinking.value = "off"
  aiDesignThinking.addEventListener("change", () => localStorage.setItem("ai-thinking-level", aiDesignThinking.value))
  aiDesignIntensity.value = localStorage.getItem("ai-design-intensity") || "balanced"
  if (!aiDesignIntensity.value) aiDesignIntensity.value = "balanced"
  aiDesignIntensity.addEventListener("change", () => localStorage.setItem("ai-design-intensity", aiDesignIntensity.value))
  aiDesignScope.addEventListener("click", () => setAiDesignScope(aiDesignScope.getAttribute("aria-pressed") !== "true"))
  aiDesignModel.addEventListener("change", rememberAiDesignModel)
  canvasWrap.addEventListener("pointermove", (event) => {
    if (appState.previewPanStart || deviceShell.hidden) return
    const onToolbar = toolbarStrip.contains(event.target as Node)
    schedulePointerCoordinates(event, onToolbar ? toolbarStrip : previewCanvas, onToolbar ? toolbarCanvas : previewCanvas)
  })
  document.addEventListener("pointermove", (event) => {
    if (appState.previewPanStart) return
    const target = event.target as Node
    if (
      event.pointerType === "mouse" &&
      !canvasWrap.contains(target) &&
      !toolbarStrip.contains(target)
    ) {
      appState.pendingPointerCoordinates = undefined
      if (editorCrosshair.checked) previewCoordinates.hidden = true
      else {
        previewCoordinateX.textContent = "—"
        previewCoordinateY.textContent = "—"
      }
    }
  })
  syncMobileShareLabel()
  hydrateIcons()
  for (const button of mobileCommandButtons) {
    button.addEventListener("click", () => {
      const target = mobileCommandTarget(button)
      if (!target || target.disabled) return
      mobileCommandMenu.open = false
      target.click()
    })
  }
  for (const target of [document.querySelector(".titlebar-actions"), document.querySelector(".app-more"), document.querySelector(".pen-file-menu")]) {
    if (!target) continue
    new MutationObserver(syncMobileCommands).observe(target, {
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "hidden"],
    })
  }
  syncMobileCommands()
  for (const [button, target] of [[mobileUndoButton, undoButton], [mobileRedoButton, redoButton]] as const) {
    button.addEventListener("click", () => {
      if (!target.disabled) target.click()
    })
  }
  for (const [button, target] of [[desktopUndoButton, undoButton], [desktopRedoButton, redoButton]] as const) {
    button.addEventListener("click", () => {
      if (!target.disabled) target.click()
    })
  }
  quickInspector.addEventListener("scroll", syncSinglePageInspectorGroup, { passive: true })
  mobileInspectorGroups.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
    const buttons = Array.from(mobileInspectorGroups.querySelectorAll<HTMLButtonElement>("button"))
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0) return
    event.preventDefault()
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (current + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length
    buttons[next].click()
    buttons[next].focus()
  })
  for (const button of bdaInspectorStateButtons) {
    button.addEventListener("click", () => {
      const state = button.dataset.bdaInspectorState === "pressed" ? "pressed" : "normal"
      bdaConfigFieldsGroup.dataset.previewState = state
      for (const item of bdaInspectorStateButtons) {
        const active = item === button
        item.classList.toggle("active", active)
        item.setAttribute("aria-pressed", String(active))
      }
    })
  }
  setMobileSplit(Number(localStorage.getItem("mobile-workspace-split")) || 50, false)
  setMobilePane("layout")
  syncMobileInspectorHeader()
  for (const button of mobilePaneButtons) {
    button.addEventListener("click", () => setMobilePane(button.dataset.mobilePane === "inspector" ? "inspector" : "layout"))
  }
  mobilePortraitQuery.addEventListener("change", () => {
    if (!mobilePortraitQuery.matches) setMobilePreviewCollapsed(false)
    else {
      const activeGroup = files.querySelector<HTMLDetailsElement>(".nav-group.mobile-overview-active")
      if (activeGroup) activeGroup.open = true
    }
    setMobilePane(document.documentElement.dataset.mobilePane === "inspector" ? "inspector" : "layout")
    syncMobileInspectorHeader()
    updateSourceFindVisibility()
  })
  mainWorkspace.addEventListener("pointerdown", (event) => {
    if (!mobilePortraitQuery.matches || event.pointerType === "mouse" && event.button !== 0 ||
      !(event.target as Element).closest("aside, .source")) return
    appState.mobileSwipeStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  })
  mainWorkspace.addEventListener("pointermove", (event) => {
    if (!appState.mobileSwipeStart || appState.mobileSwipeStart.pointerId !== event.pointerId) return
    const deltaX = event.clientX - appState.mobileSwipeStart.x
    const deltaY = event.clientY - appState.mobileSwipeStart.y
    if (Math.abs(deltaY) > 12 && Math.abs(deltaY) > Math.abs(deltaX)) {
      appState.mobileSwipeStart = undefined
      return
    }
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return
    appState.mobileSwipeStart = undefined
    setMobilePane(deltaX < 0 ? "inspector" : "layout")
  })
  mainWorkspace.addEventListener("pointerup", (event) => {
    if (!appState.mobileSwipeStart || appState.mobileSwipeStart.pointerId !== event.pointerId) return
    const deltaX = event.clientX - appState.mobileSwipeStart.x
    const deltaY = event.clientY - appState.mobileSwipeStart.y
    appState.mobileSwipeStart = undefined
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return
    setMobilePane(deltaX < 0 ? "inspector" : "layout")
  })
  mainWorkspace.addEventListener("pointercancel", (event) => {
    if (appState.mobileSwipeStart?.pointerId === event.pointerId) appState.mobileSwipeStart = undefined
  })
  {
    let dragging = false
    let moved = false
    let pointerId = -1
    let pointerStartY = 0

    mobileSplitHandle.addEventListener("pointerdown", (event) => {
      if (!mobilePortraitQuery.matches) return
      dragging = true
      moved = false
      pointerId = event.pointerId
      pointerStartY = event.clientY
      mobileSplitHandle.classList.add("dragging")
      mobileSplitHandle.setPointerCapture(pointerId)
      event.preventDefault()
    })

    mobileSplitHandle.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerId !== pointerId) return
      moved ||= Math.abs(event.clientY - pointerStartY) > 3
      const rect = mainWorkspace.getBoundingClientRect()
      if (!rect.height) return
      const fromTop = (event.clientY - rect.top) / rect.height * 100
      const split = mobilePreviewPosition.value === "top" ? fromTop : 100 - fromTop
      setMobileSplit(split)
    })

    const finishMobileSplitDrag = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) return
      dragging = false
      pointerId = -1
      mobileSplitHandle.classList.remove("dragging")
      if (mobileSplitHandle.hasPointerCapture(event.pointerId)) mobileSplitHandle.releasePointerCapture(event.pointerId)
    }
    mobileSplitHandle.addEventListener("pointerup", finishMobileSplitDrag)
    mobileSplitHandle.addEventListener("pointercancel", finishMobileSplitDrag)
    mobileSplitHandle.addEventListener("click", () => {
      const wasMoved = moved
      moved = false
      if (!mobilePortraitQuery.matches || wasMoved) return
      setMobilePreviewCollapsed(document.documentElement.dataset.mobilePreviewCollapsed !== "true")
    })
    mobileSplitHandle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
      const current = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--mobile-workspace-split"),
      ) || 50
      setMobileSplit(current + (event.key === "ArrowUp" ? 2 : -2))
      event.preventDefault()
    })
  }
  new ResizeObserver(() => {
    appState.canvasWrapInnerSize = measureCanvasWrapInnerSize()
    scheduleFitCanvasPreview()
  }).observe(canvasWrap)
  // Initial layout and device changes can size the candidate area without changing the empty text.
  const inputBarObserver = new ResizeObserver(() => fitCandidateInputBar())
  inputBarObserver.observe(candidateInputText)
  inputBarObserver.observe(candidateArea)
  previewZoomOut.addEventListener("click", () => {
    if (appState.layoutOverview) zoomLayoutOverview(1 / 1.2)
    else applyPreviewZoom(appState.previewZoom - 0.1)
  })
  previewZoomFit.addEventListener("click", () => {
    if (appState.layoutOverview) return fitLayoutOverview()
    setPreviewPan(0, 0)
    applyPreviewZoom(1)
  })
  previewZoomFit.addEventListener("dblclick", () => {
    if (appState.layoutOverview) return
    appState.previewPanLocked = !appState.previewPanLocked
    previewZoomFit.ariaPressed = String(appState.previewPanLocked)
    previewZoomFit.ariaLabel = appState.previewPanLocked ? "适配窗口，画布已锁定，双击解锁" : "适配窗口，双击锁定画布"
    previewZoomFit.title = appState.previewPanLocked ? "画布已锁定（双击解锁）" : "适配窗口（双击锁定画布）"
    finishPreviewPan()
  })
  previewZoomIn.addEventListener("click", () => {
    if (appState.layoutOverview) zoomLayoutOverview(1.2)
    else applyPreviewZoom(appState.previewZoom + 0.1)
  })
  layoutOverviewToggle.addEventListener("click", () => void (appState.layoutOverview ? closeLayoutOverview() : openLayoutOverview()))
  // 画布放进当前格子后，它的尺寸（布局、面板高度、窗口）一变就重新对齐。
  new ResizeObserver(() => { if (appState.layoutOverview) fitLiveKeyboard() }).observe(deviceShell)
  // 全局预览盖在画布上：滚轮缩放、拖动平移都只作用于网格；当前格子里的画布照常接收点击。
  layoutOverview.addEventListener("wheel", (event) => {
    event.preventDefault()
    event.stopPropagation()
    zoomLayoutOverview(wheelZoomFactor(event), { x: event.clientX, y: event.clientY }, true)
  }, { passive: false })
  layoutOverview.addEventListener("pointerdown", (event) => {
    if (deviceShell.contains(event.target as Node)) return
    event.stopPropagation()
    const state = appState.layoutOverview
    if (!state || event.button !== 0) return
    state.pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: state.x, panY: state.y, moved: false }
  })
  layoutOverview.addEventListener("pointermove", (event) => {
    if (deviceShell.contains(event.target as Node)) return
    event.stopPropagation()
    const pan = appState.layoutOverview?.pan
    if (!pan || pan.pointerId !== event.pointerId) return
    const dx = event.clientX - pan.x
    const dy = event.clientY - pan.y
    if (!pan.moved && Math.hypot(dx, dy) < 3) return
    if (!pan.moved) layoutOverview.setPointerCapture(event.pointerId)
    pan.moved = true
    panLayoutOverview(pan.panX + dx, pan.panY + dy)
  })
  const endOverviewPan = () => {
    // 拖动结束后的 click 先于这里的清理检查 moved，留一帧再清掉。
    const state = appState.layoutOverview
    requestAnimationFrame(() => { if (state) state.pan = undefined })
  }
  layoutOverview.addEventListener("pointerup", endOverviewPan)
  layoutOverview.addEventListener("pointercancel", endOverviewPan)
  layoutOverview.addEventListener("click", (event) => { if (!deviceShell.contains(event.target as Node)) event.stopPropagation() })
  // ⌘/Ctrl + 方向键切换布局；全局预览里方向键切换当前格子，空格进入该布局，进入后 Esc 回到全局预览。
  // 捕获阶段处理，不让按键移动选中的按键。
  window.addEventListener("keydown", (event) => {
    const step = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[event.key]
    if (event.isComposing || document.querySelector("dialog[open]")) return
    const typing = Boolean(keyEventElement(event.target)?.closest("input, textarea, select, [contenteditable], .cm-editor"))
    if (appState.layoutOverview) {
      if (typing) return
      if (event.key === " ") void closeLayoutOverview()
      else if (step) stepLayout(...step)
      else if (event.key !== "Escape") return
    } else if (
      event.key === "Escape" && appState.layoutOverviewReturn && !typing && !appState.selectedKeySections.length &&
      !appState.selectedToolbarSections.length && !toolbarMenus.some((menu) => menu.open) && layoutOverviewToggle.offsetParent !== null
    ) {
      void openLayoutOverview()
    } else if (step && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && appState.archive && !typing) {
      stepLayout(...step)
    } else return
    event.preventDefault()
    event.stopPropagation()
  }, { capture: true })
  canvasWrap.addEventListener("wheel", (event) => {
    // 欢迎页（未打开皮肤）需要正常的纵向滚动，不能被画布缩放拦截
    if (deviceShell.hidden || canvasWrap.classList.contains("empty")) return
    event.preventDefault()
    if (appState.previewPanLocked) return
    applyPreviewZoom(appState.previewZoom * wheelZoomFactor(event), { x: event.clientX, y: event.clientY })
  }, { passive: false })
  // 触摸屏双指缩放：两指间距决定缩放，中点移动带动平移。捕获阶段处理，避免被画布内的按键拖动截走。
  const touches = new Map<number, { x: number; y: number }>()
  let pinch: { distance: number; zoom: number; x: number; y: number } | undefined
  const pinchPoint = () => {
    const [a, b] = [...touches.values()]
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  canvasWrap.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" || appState.previewPanLocked || appState.layoutOverview || deviceShell.hidden || canvasWrap.classList.contains("empty")) return
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (touches.size !== 2) return
    pinch = { ...pinchPoint(), zoom: appState.previewZoom }
    preview.setPointerInteractionLocked(true)
    toolbarPreview.setPointerInteractionLocked(true)
  }, { capture: true })
  canvasWrap.addEventListener("pointermove", (event) => {
    if (!touches.has(event.pointerId)) return
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (!pinch || touches.size !== 2) return
    event.preventDefault()
    const point = pinchPoint()
    setPreviewPan(appState.previewPanX + point.x - pinch.x, appState.previewPanY + point.y - pinch.y)
    Object.assign(pinch, { x: point.x, y: point.y })
    if (pinch.distance > 0) applyPreviewZoom(pinch.zoom * point.distance / pinch.distance, point)
  }, { capture: true })
  const endTouch = (event: PointerEvent) => {
    touches.delete(event.pointerId)
    if (!pinch || touches.size >= 2) return
    pinch = undefined
    preview.setPointerInteractionLocked(false)
    toolbarPreview.setPointerInteractionLocked(false)
  }
  canvasWrap.addEventListener("pointerup", endTouch, { capture: true })
  canvasWrap.addEventListener("pointercancel", endTouch, { capture: true })
  window.addEventListener("blur", () => {
    finishPreviewPan()
    if (editorCrosshair.checked) previewCoordinates.hidden = true
  })
  canvasWrap.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      appState.previewPanLocked ||
      event.pointerType === "touch" ||
      deviceShell.hidden ||
      canvasEditable() && appState.keyMode === "move" && previewPanelViewport.contains(event.target as Node)
    ) return
    appState.previewPanCandidate = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: appState.previewPanX,
      panY: appState.previewPanY,
    }
    canvasWrap.classList.add("preview-pan-ready")
  })
  canvasWrap.addEventListener("pointermove", (event) => {
    if (canvasEditable() && appState.keyMode === "move" && previewPanelViewport.contains(event.target as Node)) return
    if (!appState.previewPanStart && appState.previewPanCandidate?.pointerId === event.pointerId) {
      const dx = event.clientX - appState.previewPanCandidate.x
      const dy = event.clientY - appState.previewPanCandidate.y
      if (Math.hypot(dx, dy) < 3) return
      appState.previewPanStart = appState.previewPanCandidate
      preview.setPointerInteractionLocked(true)
      toolbarPreview.setPointerInteractionLocked(true)
      // Cache layout before the first transform write. Every subsequent frame
      // can derive the transformed canvas bounds from this snapshot and the pan
      // delta, avoiding forced reflow in the crosshair update path.
      appState.previewPanGeometry = {
        target: previewCanvas.getBoundingClientRect(),
        wrap: canvasWrap.getBoundingClientRect(),
        wrapWidth: canvasWrap.clientWidth,
        wrapHeight: canvasWrap.clientHeight,
      }
      if (appState.pointerCoordinatesFrame) cancelAnimationFrame(appState.pointerCoordinatesFrame)
      appState.pointerCoordinatesFrame = 0
      appState.pendingPointerCoordinates = undefined
      canvasWrap.classList.add("preview-panning")
      canvasWrap.setPointerCapture(event.pointerId)
    }
    if (!appState.previewPanStart || appState.previewPanStart.pointerId !== event.pointerId) return
    event.preventDefault()
    schedulePreviewPan(
      appState.previewPanStart.panX + event.clientX - appState.previewPanStart.x,
      appState.previewPanStart.panY + event.clientY - appState.previewPanStart.y,
    )
    const geometry = appState.previewPanGeometry
    if (geometry) {
      const offsetX = event.clientX - appState.previewPanStart.x
      const offsetY = event.clientY - appState.previewPanStart.y
      const target = geometry.target
      schedulePointerCoordinates(event, previewCanvas, previewCanvas, {
        target: new DOMRect(target.left + offsetX, target.top + offsetY, target.width, target.height),
        wrap: geometry.wrap,
        wrapWidth: geometry.wrapWidth,
        wrapHeight: geometry.wrapHeight,
      })
    } else {
      schedulePointerCoordinates(event, previewCanvas, previewCanvas)
    }
  })
  canvasWrap.addEventListener("pointerdown", (event) => { appState.canvasWrapClickStart = { x: event.clientX, y: event.clientY } })
  canvasWrap.addEventListener("click", (event) => {
    const target = event.target as Element
    const start = appState.canvasWrapClickStart
    appState.canvasWrapClickStart = undefined
    if (
      !isEditing() ||
      !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 3 ||
      candidateArea.contains(target) ||
      target.closest("canvas, button, input, select, label, [role=button]")
    ) return
    if (appState.selectedKeySections.length || appState.selectedToolbarSections.length || appState.selectedCandidate) selectParentObject()
  })
  canvasWrap.addEventListener("pointerup", finishPreviewPan)
  canvasWrap.addEventListener("pointercancel", finishPreviewPan)
  // Ignore capture lost by child canvases (it bubbles here when the pan takes capture over).
  canvasWrap.addEventListener("lostpointercapture", (event) => { if (event.target === canvasWrap) finishPreviewPan() })
  for (const button of styleDetailImageButtons) {
    button.addEventListener("click", () => chooseStyleImageSlice(button.dataset.styleImageProperty as "NM_IMG" | "HL_IMG"))
  }
  workspaceImage.addEventListener("load", clearImagePreviewError)
  workspaceImage.addEventListener("error", showImagePreviewError)
  sourceStyleProxy.hidden = true
  document.body.append(sourceStyleProxy)
  sourceStyleProxy.addEventListener("change", () => {
    const target = appState.sourceStyleProxyTarget
    if (!target || source.disabled || source.readOnly) return
    if (source.value.slice(target.from, target.to) !== target.value) return
    const next = replacedSourceStyle(target.value, sourceStyleProxy.value.split(",")[0]?.trim() ?? "")
    if (!next) return
    source.replaceRange(target.from, target.to, next)
    appState.sourceStyleProxyTarget = { ...target, to: target.from + next.length, value: next }
    source.commit()
  })
  for (const input of [...keyboardFields, ...toolbarFields, ...keyFields]) decorateStyleReferenceInput(input)
  newStyleDialog.addEventListener("close", () => { appState.newStyleApplyTarget = undefined })
  baiduActionCodes.replaceChildren(...knownFunctionCodes.map((value) => {
    return new Option(actionDescription(value), value)
  }))
  documentName.parentElement?.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).id === "document-name") renameDocumentTitle()
  })
  documentName.parentElement?.addEventListener("keydown", (event) => {
    if ((event.target as HTMLElement).id !== "document-name") return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      renameDocumentTitle()
    }
  })
  sourceUploadButton.addEventListener("click", () => {
    if (!appState.archive || !isEditing()) return
    sourceUploadInput.value = ""
    sourceUploadInput.click()
  })
  sourceUploadInput.addEventListener("change", () => {
    void runFileOperation("上传文件", async () => {
      if (!appState.archive || !sourceUploadInput.files?.length) return false
      const folder = sourceTargetFolder()
      const uploads = await Promise.all(Array.from(sourceUploadInput.files).map(async (file) => ({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })))
      return commitSourceUploads(uploads, folder)
    })
  })
  sourceDownloadButton.addEventListener("click", () => {
    void runFileOperation("下载文件", async () => {
      const selection = sourceSelection()
      if (!appState.archive || !selection || selection.folder) return false
      const bytes = appState.archive.getBytes(selection.path)
      if (!bytes) return false
      return Boolean(await writeToChosenFile(selection.path.split("/").pop() ?? "download", bytes))
    })
  })
  sourceCopyButton.addEventListener("click", () => {
    setSourceTransfer("copy")
  })
}
