import { mobileCommandMenu, settingsDialog, $, sidebarViewControl, device, resourceSearch, editorCrosshair, previewCoordinates, canvasWrap, previewCanvas, toolbarCanvas, editorCoordinateSnap, previewCoordinateX, previewCoordinateY, toolbarStrip, candidateBackgroundCanvas, skinState, skinStateValue, eventLog, theme, orientation, simulatedOutput, deviceControlIcon, mobileShareButton, mobileUndoButton, undoButton, mobileRedoButton, redoButton, desktopUndoButton, desktopRedoButton } from "./dom"
import { LazySourceCodeEditor } from "../lazy-source-editor.ts"
import { effectiveDeviceValue } from "../canvas-background.ts"
import { type SourceWriteSnapshot } from "../source-tree.ts"
import { createGestureHistory } from "../gesture-history"
import { Preview, type PreviewEvent } from "../preview.ts"
import { previewStateImpact } from "../preview-items.ts"
import { appState } from "./state"
import { syncCandidateSelection, setPreviewPan, refreshSimulationPreview, simulationLanguage } from "./preview-render"
import { selectFile } from "./navigation"
import { setMobilePane } from "./mobile-layout"
import { moveSelectedKeys } from "./key-editing"
import { isEditing } from "./edit-history"
import { populateKeyInspector } from "./key-inspector"
import { updateSourceHighlight } from "./source-panel"
import { scrollSelectedSource, styleConfigPath, genConfigPath, currentConfigPath, layoutSource } from "./config-context"
import { compositionSkinState, deleteBackward, deleteForward, moveCaretVertical, moveCaret, insertText } from "../simulation.ts"
import { decodeAiffPcm, soundMimeType, soundPathForFilename, soundFilenameForKey } from "../sounds.ts"
import { bdaConfigPath, bdaPanelKeyName } from "../bda.ts"
import { decodeBdaSoundConfig } from "../bda-decode.ts"
import { bdaPlatform } from "../bda-platform.ts"
import { IniDocument } from "../ini.ts"
import { previewStateFromAction, previewToggleStateFromAction, previewStateTransitionFromAction, previewPageTransition } from "../actions.ts"
import { bdaAvailableLayoutPaths, isBdaLayoutPath } from "./bda-documents"
import { palmKeySound } from "./sxi-styles"
import { isSxiBoardAddress, palmBoardTypes, sxiBoardAddress, sxiPointer } from "./sxi-documents"
import { boardFileName } from "../palm/sxi-layout.ts"
import { boardTypeFromIniFileName } from "../palm/palm-board-types.ts"
import { createIcon } from "../icons"

export const scrollbarIdleTimers = new WeakMap<HTMLElement, number>()

export const mobileCommandButtons = Array.from(
  mobileCommandMenu.querySelectorAll<HTMLButtonElement>("[data-mobile-command], [data-mobile-export-format]"),
)

export const mobileShareMenuLabel = mobileCommandMenu.querySelector<HTMLElement>(
  '[data-mobile-command="mobile-share"] span:last-child',
)!

export const settingsNavItems = Array.from(settingsDialog.querySelectorAll<HTMLButtonElement>("[data-settings-page]"))

export const settingsPages = Array.from(settingsDialog.querySelectorAll<HTMLElement>("[data-settings-panel]"))

export const mobilePortraitQuery = matchMedia("(max-width: 760px) and (orientation: portrait)")

export const exportButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-export-format]"),
)

export const source = new LazySourceCodeEditor($("#source"))

export const sidebarViewHeading = sidebarViewControl.closest<HTMLElement>(".pane-heading")!

export const LARGE_SKIN_BYTES = 5 * 1024 * 1024

export const keyboardFields = Array.from(
  document.querySelectorAll<HTMLInputElement>("[data-keyboard-field]"),
)

export const bdaKeyFieldLabels: Record<string, string> = {
  BACK_STYLE: "背景样式（backStyle）",
  FORE_STYLE: "前景样式（foreStyles）",
  FORE_OFFSET: "前景样式偏移（foreStyleOffsets）",
  FONT_NAME: "字体名称（fontName）",
  FONT_SIZE: "字体大小（fontSize）",
  NM_COLOR: "正常文字颜色（normalColor）",
  HL_COLOR: "高亮文字颜色（highlightColor）",
}

export const layoutActionButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-layout-action]"),
)

export const actionMeaningNodes = Array.from(
  document.querySelectorAll<HTMLElement>("[data-action-meaning]"),
)

export const actionFieldNames = new Set(actionMeaningNodes.map((node) => node.dataset.actionMeaning ?? ""))

export const inspectorTabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]"),
)

export function currentDeviceValue(): string {
  return effectiveDeviceValue(device.value)
}

export const resourceSearchControl = resourceSearch.closest("label")!

export const LAST_SOURCE_WORKSPACE_KEY = "last-source-workspace"

export function sourceDirectoryEnabledBySettings(): boolean {
  const stored = localStorage.getItem("source-directory-enabled")
  return isAndroidTauri() ? stored === "true" : stored !== "false"
}

export const pendingSourcePaths = new Set<string>()

export const sourceWriteSnapshots = new Map<string, SourceWriteSnapshot[]>()

export const pendingSourceWatchPaths = new Set<string>()

export const recordChange = createGestureHistory()

export const deviceGeometryProperties = [
  "--keyboard-height-port",
  "--keyboard-height-land",
  "--candidate-row",
  "--candidate-top-inset-row",
  "--candidate-inset-row",
  "--candidate-content-row",
  "--candidate-input-height",
  "--panel-row",
  "--safe-row",
] as const

export const deviceFrameProperties = [
  "--device-screen-inset-x",
  "--device-screen-inset-y",
  "--device-screen-radius",
  "--device-body-radius",
  "--device-island-width",
  "--device-island-height",
  "--device-island-offset",
] as const

export const REFERENCE_PHONE_WIDTH_SCALE = 1

export const preview = new Preview(
  $("#preview") as HTMLCanvasElement,
  (event) => {
    handlePreviewEvent(event)
  },
  (sections) => {
    appState.selectedCandidate = false
    syncCandidateSelection()
    if (appState.selectedPath !== appState.layoutPath) selectFile(appState.layoutPath, "overview")
    appState.selectedKeySections = sections
    if (!sections.length) source.collapseSelection()
    if (sections.length && mobilePortraitQuery.matches) setMobilePane("inspector")
    scheduleSelectionInspectorSync(preview)
  },
  false,
  (sections, deltaX, deltaY) => moveSelectedKeys(deltaX, deltaY, sections),
  $("#hint-preview") as HTMLCanvasElement,
)

export function updatePointerCoordinates(
  event: Pick<PointerEvent, "clientX" | "clientY" | "pointerType">,
  target: HTMLElement,
  canvas: HTMLCanvasElement,
  geometry?: { target: DOMRect; wrap: DOMRect; wrapWidth: number; wrapHeight: number },
): void {
  if (event.pointerType !== "mouse" || editorCrosshair.checked && !isEditing()) {
    if (editorCrosshair.checked) previewCoordinates.hidden = true
    return
  }
  // During canvas panning the shell is transformed every frame. Reading its
  // bounds immediately after that write forces a synchronous layout. The pan
  // handler supplies the already-known geometry instead, keeping this path
  // compositor-only while preserving exact coordinates.
  const bounds = geometry?.target ?? target.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  const wrapBounds = geometry?.wrap ?? canvasWrap.getBoundingClientRect()
  const wrapWidth = geometry?.wrapWidth ?? canvasWrap.clientWidth
  const wrapHeight = geometry?.wrapHeight ?? canvasWrap.clientHeight
  const overlayGeometry = { left: canvasWrap.scrollLeft, top: canvasWrap.scrollTop, width: wrapWidth, height: wrapHeight }
  const x = Math.min(bounds.width - 1, Math.max(0, event.clientX - bounds.left))
  const y = Math.min(bounds.height - 1, Math.max(0, event.clientY - bounds.top))
  const snapPreview = canvas === previewCanvas ? preview : canvas === toolbarCanvas ? toolbarPreview : undefined
  const logicalSize = snapPreview?.logicalSize() ?? { width: canvas.width, height: canvas.height }
  const raw = { x: x / bounds.width * logicalSize.width, y: y / bounds.height * logicalSize.height }
  const point = !appState.previewPanStart && editorCrosshair.checked && editorCoordinateSnap.checked && snapPreview
    ? snapPreview.snapPoint(raw, bounds)
    : raw
  const snappedX = Math.min(logicalSize.width - 1, Math.max(0, point.x))
  const snappedY = Math.min(logicalSize.height - 1, Math.max(0, point.y))
  const logicalX = Math.floor(snappedX)
  const logicalY = Math.floor(snappedY)
  if (previewCoordinateX.textContent !== String(logicalX)) previewCoordinateX.textContent = String(logicalX)
  if (previewCoordinateY.textContent !== String(logicalY)) previewCoordinateY.textContent = String(logicalY)
  if (!editorCrosshair.checked) {
    previewCoordinates.hidden = false
    return
  }
  // The lines always follow the pointer exactly, like the system cursor. Snapping
  // only changes the readout; a dashed guide marks the edge it snapped to.
  const crosshairX = event.clientX - wrapBounds.left
  const crosshairY = event.clientY - wrapBounds.top
  const outsideCanvas = event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom
  const snapX = String(!outsideCanvas && point.x !== raw.x)
  const snapY = String(!outsideCanvas && point.y !== raw.y)
  if (previewCoordinates.dataset.snapX !== snapX) previewCoordinates.dataset.snapX = snapX
  if (previewCoordinates.dataset.snapY !== snapY) previewCoordinates.dataset.snapY = snapY
  if (snapX === "true") previewCoordinates.style.setProperty("--snap-x", `${bounds.left - wrapBounds.left + snappedX / logicalSize.width * bounds.width}px`)
  if (snapY === "true") previewCoordinates.style.setProperty("--snap-y", `${bounds.top - wrapBounds.top + snappedY / logicalSize.height * bounds.height}px`)
  if (
    !appState.pointerOverlayGeometry ||
    appState.pointerOverlayGeometry.left !== overlayGeometry.left ||
    appState.pointerOverlayGeometry.top !== overlayGeometry.top ||
    appState.pointerOverlayGeometry.width !== overlayGeometry.width ||
    appState.pointerOverlayGeometry.height !== overlayGeometry.height
  ) {
    appState.pointerOverlayGeometry = overlayGeometry
    previewCoordinates.style.left = `${appState.pointerOverlayGeometry.left}px`
    previewCoordinates.style.top = `${appState.pointerOverlayGeometry.top}px`
    previewCoordinates.style.width = `${appState.pointerOverlayGeometry.width}px`
    previewCoordinates.style.height = `${appState.pointerOverlayGeometry.height}px`
  }
  previewCoordinates.style.setProperty("--crosshair-x", `${crosshairX}px`)
  previewCoordinates.style.setProperty("--crosshair-y", `${crosshairY}px`)
  const labelWidth = 130
  previewCoordinates.style.setProperty(
    "--coordinate-label-x",
    `${crosshairX + labelWidth + 8 <= wrapWidth ? crosshairX + 8 : Math.max(0, crosshairX - labelWidth - 8)}px`,
  )
  previewCoordinates.style.setProperty(
    "--coordinate-label-y",
    `${Math.min(wrapHeight - 14, Math.max(14, crosshairY))}px`,
  )
  previewCoordinates.hidden = false
}

export function schedulePointerCoordinates(
  event: PointerEvent,
  target: HTMLElement,
  canvas: HTMLCanvasElement,
  geometry?: { target: DOMRect; wrap: DOMRect; wrapWidth: number; wrapHeight: number },
): void {
  appState.pendingPointerCoordinates = {
    event: { clientX: event.clientX, clientY: event.clientY, pointerType: event.pointerType },
    target,
    canvas,
    geometry,
  }
  schedulePreviewInteractionFrame()
}

export function paintPreviewInteraction(): void {
  if (appState.pointerCoordinatesFrame) cancelAnimationFrame(appState.pointerCoordinatesFrame)
  appState.pointerCoordinatesFrame = 0
  const coordinates = appState.pendingPointerCoordinates
  const pan = appState.pendingPreviewPan
  appState.pendingPointerCoordinates = undefined
  appState.pendingPreviewPan = undefined
  // All geometry reads occur before changing the shell transform. The overlay and
  // artwork are painted from the same latest pointer snapshot, in a single frame.
  if (coordinates) updatePointerCoordinates(coordinates.event, coordinates.target, coordinates.canvas, coordinates.geometry)
  if (pan) setPreviewPan(pan.x, pan.y)
}

export function schedulePreviewInteractionFrame(): void {
  if (!appState.pointerCoordinatesFrame) appState.pointerCoordinatesFrame = requestAnimationFrame(paintPreviewInteraction)
}

// Runs callback in its own task right after the next frame is painted.
export function afterNextPaint(callback: () => void): void {
  requestAnimationFrame(() => window.setTimeout(callback))
}

export function scheduleSelectionInspectorSync(canvasPreview: Preview): void {
  if (appState.selectionInspectorSyncPending) return
  appState.selectionInspectorSyncPending = true
  afterNextPaint(() => void canvasPreview.rendered().then(() => {
    appState.selectionInspectorSyncPending = false
    populateKeyInspector()
    updateSourceHighlight()
    scrollSelectedSource()
  }))
}

export const toolbarPreview = new Preview(toolbarCanvas, handlePreviewEvent, (sections) => {
  const path = toolbarStrip.dataset.path
  if (!path) return
  if (appState.selectedPath !== path) selectFile(path, "overview")
  appState.selectedToolbarSections = sections
  toolbarPreview.setSelected(sections)
  syncCandidateSelection()
  scheduleSelectionInspectorSync(toolbarPreview)
}, true)

export const candidateBackgroundPreview = new Preview(candidateBackgroundCanvas, () => {}, () => {})

export function resizeKeyboardPreviews(): void {
  preview.resize()
  toolbarPreview.resize()
  candidateBackgroundPreview.resize()
}

export function applySkinState(state?: number, message?: string): void {
  skinState.value = state === undefined ? "" : String(state)
  skinStateValue.textContent = state === undefined ? "默认" : `S${state}`
  preview.setSkinState(state)
  toolbarPreview.setSkinState(state)
  if (message) eventLog.textContent = message
}

export function setSimulatedComposition(value: string): void {
  appState.simulatedComposition = value
  const current = skinState.value ? Number(skinState.value) : undefined
  const next = compositionSkinState(value, current)
  if (next !== current) applySkinState(next)
}

export function skinStatePreviewMessage(state: number): string {
  const impact = previewStateImpact(appState.layoutDocument, state)
  if (impact.resolved) return `皮肤状态：S${state}`
  if (impact.mapped) return `皮肤状态：S${state} · 当前布局的状态定义缺少 TIP 内容`
  if (state === 4) return `皮肤状态：S4 · 已进入输入编码预览，当前布局未配置按键换层`
  return `皮肤状态：S${state} · 当前布局未配置按键换层`
}

export function activateSkinState(state?: number, message?: string): void {
  applySkinState(state, message ?? (state ? skinStatePreviewMessage(state) : "皮肤状态：默认"))
  refreshSimulationPreview()
  populateKeyInspector()
  updateSourceHighlight()
  scrollSelectedSource()
}

export const keySoundBuffers = new Map<string, AudioBuffer>()

export function releaseKeySound(): void {
  appState.keySoundAudio?.pause()
  appState.keySoundAudio = undefined
  try {
    appState.keySoundSource?.stop()
  } catch {}
  appState.keySoundSource = undefined
  appState.keySoundPath = ""
  if (appState.keySoundURL) URL.revokeObjectURL(appState.keySoundURL)
  appState.keySoundURL = ""
}

export async function playDecodedSound(path: string, bytes: Uint8Array): Promise<void> {
  appState.keySoundContext ??= new AudioContext()
  if (appState.keySoundContext.state === "suspended") await appState.keySoundContext.resume()
  let buffer = keySoundBuffers.get(path)
  if (!buffer) {
    try {
      buffer = await appState.keySoundContext.decodeAudioData(new Uint8Array(bytes).buffer)
    } catch (error) {
      if (/^FORM$/.test(new TextDecoder("ascii").decode(bytes.subarray(0, 4)))) {
        const decoded = decodeAiffPcm(bytes)
        buffer = appState.keySoundContext.createBuffer(decoded.channelData.length, decoded.samplesDecoded, decoded.sampleRate)
        decoded.channelData.forEach((channel, index) => buffer!.copyToChannel(new Float32Array(channel), index))
      } else {
        const ogg = /^OggS$/.test(new TextDecoder("ascii").decode(bytes.subarray(0, 4))) || /\.ogg$/i.test(path)
        if (!ogg) throw error
        const { OggVorbisDecoder } = await import("@wasm-audio-decoders/ogg-vorbis")
        const decoder = new OggVorbisDecoder()
        await decoder.ready
        const decoded = await decoder.decodeFile(bytes)
        decoder.free()
        if (!decoded.samplesDecoded || !decoded.channelData.length) throw new Error("OGG 文件没有可播放的音频")
        buffer = appState.keySoundContext.createBuffer(decoded.channelData.length, decoded.samplesDecoded, decoded.sampleRate)
        decoded.channelData.forEach((channel, index) => buffer!.copyToChannel(new Float32Array(channel), index))
      }
      if (!buffer) {
        throw error
      }
    }
    keySoundBuffers.set(path, buffer)
  }
  appState.keySoundSource = appState.keySoundContext.createBufferSource()
  appState.keySoundSource.buffer = buffer
  appState.keySoundSource.connect(appState.keySoundContext.destination)
  appState.keySoundSource.start()
}

export function playSoundPath(path: string): void {
  const bytes = appState.archive?.getBytes(path)
  if (!bytes) return
  if (path !== appState.keySoundPath) {
    releaseKeySound()
    const copy = bytes.slice()
    appState.keySoundURL = URL.createObjectURL(new Blob([copy.buffer], { type: soundMimeType(path) }))
    appState.keySoundPath = path
    appState.keySoundAudio = new Audio(appState.keySoundURL)
    appState.keySoundAudio.preload = "auto"
  }
  if (!appState.keySoundAudio) return
  appState.keySoundAudio.currentTime = 0
  void appState.keySoundAudio.play().catch(async (error: unknown) => {
    if (error instanceof DOMException && error.name === "NotSupportedError") {
      try {
        await playDecodedSound(path, bytes)
        return
      } catch (fallbackError) {
        error = fallbackError
      }
    }
    const reason = error instanceof Error ? `（${error.name}：${error.message}）` : ""
    eventLog.textContent = `无法播放按键音效：${path.split("/").pop() ?? path}${reason}`
  })
}

export function keySoundForEvent(event: PreviewEvent): string | undefined {
  if (appState.archive?.format === "sxi") {
    const filename = palmKeySound(event.section)
    return filename ? soundPathForFilename(appState.archive.names(), theme.value, orientation.value, filename) : undefined
  }
  if (!appState.archive || !appState.layoutDocument) return
  const names = appState.archive.names()
  if (appState.archive.format === "bda") {
    const path = bdaConfigPath(appState.archive, theme.value, orientation.value, "sound")
    const bytes = path ? appState.archive.getBytes(path) : undefined
    if (!bytes) return
    const sound = decodeBdaSoundConfig(bytes)
    const sounds = bdaPlatform(appState.archive) === "ios" ? sound.iosKeySounds : sound.keySounds
    const resource = sounds.get(bdaPanelKeyName(event.code))
      ?? sounds.get(event.section)
      ?? [...sounds.values()][0]
    return resource?.resourceID
      ? soundPathForFilename(names, theme.value, orientation.value, resource.resourceID)
      : undefined
  }
  const layouts = layoutSource()
  const stylesPath = styleConfigPath()
  if (!layouts?.isText(stylesPath)) return
  const generalPath = genConfigPath()
  const general = layouts.isText(generalPath) ? IniDocument.parse(layouts.getText(generalPath)) : undefined
  const filename = soundFilenameForKey(
    appState.layoutDocument,
    event.section,
    IniDocument.parse(layouts.getText(stylesPath)),
    general,
  )
  return filename ? soundPathForFilename(names, theme.value, orientation.value, filename) : undefined
}

export function handlePreviewEvent(event: PreviewEvent): void {
  const soundPath = keySoundForEvent(event)
  if (soundPath) playSoundPath(soundPath)
  eventLog.textContent =
    `${event.section} · ${event.direction.toUpperCase()} · ${event.code || "未配置"}`
  if (event.direction === "hold" && event.holdSymbols) {
    eventLog.textContent = `${event.section} · HOLD · 长按符号候选：${event.holdSymbols}`
    return
  }
  const code = event.code.trim()
  const state = previewStateFromAction(code)
  if (state !== undefined) {
    activateSkinState(
      state || undefined,
      `${eventLog.textContent} → ${state ? skinStatePreviewMessage(state) : "皮肤状态：默认"}`,
    )
    return
  }
  const toggleState = previewToggleStateFromAction(code)
  if (toggleState !== undefined) {
    const currentState = skinState.value ? Number(skinState.value) : undefined
    const nextState = currentState === toggleState ? undefined : toggleState
    activateSkinState(
      nextState,
      `${eventLog.textContent} → ${nextState ? skinStatePreviewMessage(nextState) : "皮肤状态：默认"}`,
    )
    return
  }
  const currentState = skinState.value ? Number(skinState.value) : undefined
  const transitionedState = previewStateTransitionFromAction(code, currentState)
  if (transitionedState !== undefined) {
    activateSkinState(
      transitionedState === null ? undefined : transitionedState,
      `${eventLog.textContent} → ${transitionedState === null ? "皮肤状态：默认" : skinStatePreviewMessage(transitionedState)}`,
    )
    return
  }
  // A Palm board is named by its type; page switching speaks the layout names Palm's types stand for.
  const palmBoard = sxiPointer(appState.layoutPath)
  const currentName = palmBoard ? boardFileName(palmBoard[3]) : appState.layoutPath.split("/").pop() ?? ""
  const currentDirectory = appState.layoutPath.slice(0, appState.layoutPath.lastIndexOf("/") + 1)
  const layouts = layoutSource()
  const availableNames = appState.archive && layouts
    ? appState.archive.format === "bda"
      ? bdaAvailableLayoutPaths().map((path) => path.slice(path.lastIndexOf("/") + 1))
      : palmBoard ? palmBoardTypes().map(boardFileName)
      : layouts.names()
        .filter((path) => path.startsWith(currentDirectory) && path.slice(currentDirectory.length).includes("/") === false)
        .map((path) => path.slice(currentDirectory.length))
    : undefined
  const general = layouts?.isText(genConfigPath())
    ? IniDocument.parse(layouts.getText(genConfigPath()))
    : undefined
  const symbolLayout = general?.get("MORE", "SYM_LAYOUT")?.trim()?.replace(/\.ini$/i, "") || "symbol"
  const transition = previewPageTransition(code, currentName, appState.previewReturnName, availableNames, symbolLayout)
  const target = transition.target
  if (target) {
    const path = palmBoard ? sxiBoardAddress(boardTypeFromIniFileName(target) ?? target.replace(/\.ini$/i, "")) : currentConfigPath(target)
    if (layouts?.isText(path) || isBdaLayoutPath(path) || isSxiBoardAddress(path)) {
      appState.previewReturnName = transition.returnName
      if (code === "F15" || code === "F16") setSimulatedComposition("")
      if (skinState.value === "38") activateSkinState(undefined)
      selectFile(path, "overview")
      eventLog.textContent += ` → 已切换预览到 ${target}`
      return
    }
  }
  if (code === "F36") {
    if (appState.simulatedComposition) {
      setSimulatedComposition(Array.from(appState.simulatedComposition).slice(0, -1).join(""))
      refreshSimulationPreview()
      return
    }
    const result = deleteBackward(
      simulatedOutput.value,
      simulatedOutput.selectionStart ?? simulatedOutput.value.length,
      simulatedOutput.selectionEnd ?? simulatedOutput.value.length,
    )
    simulatedOutput.value = result.value
    simulatedOutput.focus()
    simulatedOutput.setSelectionRange(result.caret, result.caret)
    refreshSimulationPreview()
    return
  }
  if (code === "F37") {
    const result = deleteForward(
      simulatedOutput.value,
      simulatedOutput.selectionStart ?? simulatedOutput.value.length,
      simulatedOutput.selectionEnd ?? simulatedOutput.value.length,
    )
    simulatedOutput.value = result.value
    simulatedOutput.focus()
    simulatedOutput.setSelectionRange(result.caret, result.caret)
    refreshSimulationPreview()
    return
  }
  if (code === "F38") {
    if (appState.simulatedComposition) {
      setSimulatedComposition("")
      refreshSimulationPreview()
      return
    }
    insertSimulatedText(" ")
    return
  }
  if (code === "F39") {
    setSimulatedComposition("")
    insertSimulatedText("\n")
    return
  }
  if (code === "F40") {
    setSimulatedComposition("")
    refreshSimulationPreview()
    return
  }
  if (code === "F47") {
    simulatedOutput.focus()
    simulatedOutput.setSelectionRange(0, simulatedOutput.value.length)
    refreshSimulationPreview()
    return
  }
  if (code === "F49" || code === "F50" || code === "F51" || code === "F52") {
    const direction = code === "F49" || code === "F51" ? -1 : 1
    const result = code === "F49" || code === "F50"
      ? moveCaretVertical(
        simulatedOutput.value,
        simulatedOutput.selectionStart ?? simulatedOutput.value.length,
        simulatedOutput.selectionEnd ?? simulatedOutput.value.length,
        direction,
      )
      : moveCaret(
      simulatedOutput.value,
      simulatedOutput.selectionStart ?? simulatedOutput.value.length,
      simulatedOutput.selectionEnd ?? simulatedOutput.value.length,
      direction,
      )
    simulatedOutput.focus()
    simulatedOutput.setSelectionRange(result.start, result.end)
    refreshSimulationPreview()
    return
  }
  if (code === "F48") {
    clearSimulatedOutput()
    return
  }
  if (!code || /^(F\d+|S\d+|Z\+)/.test(code)) return
  if (simulationLanguage() === "zh" && /^[A-Za-z']$/.test(code)) {
    setSimulatedComposition(appState.simulatedComposition + code.toLowerCase())
    refreshSimulationPreview()
    return
  }
  setSimulatedComposition("")
  insertSimulatedText(code)
}

export function clearSimulatedOutput(): void {
  setSimulatedComposition("")
  simulatedOutput.value = ""
  simulatedOutput.setSelectionRange(0, 0)
  refreshSimulationPreview()
}

export function insertSimulatedText(text: string): void {
  const result = insertText(
    simulatedOutput.value,
    simulatedOutput.selectionStart ?? simulatedOutput.value.length,
    simulatedOutput.selectionEnd ?? simulatedOutput.value.length,
    text,
  )
  simulatedOutput.value = result.value
  simulatedOutput.focus()
  simulatedOutput.setSelectionRange(result.caret, result.caret)
  refreshSimulationPreview()
}

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window
}

export function isAndroidTauri(): boolean {
  return isTauri() && /Android/i.test(navigator.userAgent)
}

export function isAndroidWeb(): boolean {
  return !isTauri() && /Android/i.test(navigator.userAgent)
}

export function isIOSWeb(): boolean {
  return !isTauri() && (/iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

export function mobileShareLabel(): string {
  const format = appState.archive?.format
  return format === "ssf" ? "分享到搜狗输入法"
    : format === "sxi" ? "分享到手心输入法"
      : "分享到百度输入法"
}

export function syncMobileShareLabel(): void {
  const label = mobileShareLabel()
  mobileShareButton.querySelector("span:last-child")!.textContent = label
  mobileShareButton.title = label
  mobileShareButton.setAttribute("aria-label", label)
  mobileShareMenuLabel.textContent = label
}
// 源文件树缩略图按 PNG 字节缓存：文件被改写时换成新的字节对象，旧缓存随之回收。
// 只保留 16px（按像素比放大）的小图，大图解码后立即释放。
export const sourceThumbnails = new WeakMap<Uint8Array, Promise<string | undefined>>()

export function sourceThumbnail(bytes: Uint8Array): Promise<string | undefined> {
  let thumbnail = sourceThumbnails.get(bytes)
  if (!thumbnail) {
    thumbnail = createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" })).then((bitmap) => {
      const scale = Math.min(1, 16 * (window.devicePixelRatio || 1) / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext("2d")
      if (context) context.imageSmoothingQuality = "high"
      context?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      return canvas.toDataURL()
    }).catch(() => undefined) // 损坏的 PNG 保留图片图标
    sourceThumbnails.set(bytes, thumbnail)
  }
  return thumbnail
}

export function syncDeviceControlIcon(): void {
  const name = currentDeviceValue() === "canvas" ? "square-dashed" : "smartphone"
  if (deviceControlIcon.dataset.icon === name && deviceControlIcon.childElementCount) return
  deviceControlIcon.dataset.icon = name
  deviceControlIcon.replaceChildren(createIcon(name, 16))
}

export function mobileCommandTarget(button: HTMLButtonElement): HTMLButtonElement | undefined {
  const command = button.dataset.mobileCommand
  if (command) return document.getElementById(command) as HTMLButtonElement | null ?? undefined
  const format = button.dataset.mobileExportFormat
  const platform = button.dataset.bdaPlatform
  return format
    ? document.querySelector<HTMLButtonElement>(
      `[data-export-format="${format}"]${platform ? `[data-bda-platform="${platform}"]` : ""}`,
    ) ?? undefined
    : undefined
}

export function syncMobileCommands(): void {
  for (const button of mobileCommandButtons) {
    const target = mobileCommandTarget(button)
    button.disabled = target?.disabled ?? true
    button.hidden = target?.hidden ?? false
  }
  mobileUndoButton.disabled = undoButton.disabled
  mobileRedoButton.disabled = redoButton.disabled
  desktopUndoButton.disabled = undoButton.disabled
  desktopRedoButton.disabled = redoButton.disabled
}
