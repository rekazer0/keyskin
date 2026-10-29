import { appState } from "./state"
import { rebuildSsfPreview } from "./ssf-preview"
import { type TextVisual, canvasFontFamily } from "../atlas.ts"
import { setSimulatedComposition, toolbarPreview, currentDeviceValue, deviceGeometryProperties, preview, resizeKeyboardPreviews, schedulePreviewInteractionFrame, paintPreviewInteraction, applySkinState, REFERENCE_PHONE_WIDTH_SCALE, deviceFrameProperties } from "./canvas-interaction"
import { simulatedOutput, skinState, candidateComposition, candidateInput, candidateInputText, candidateWords, candidateArea, toolbarStrip, deviceShell, orientation, theme, layout, hintPreviewEnabled, canvasWrap, toolbarCanvas, candidateBackgroundCanvas, previewCanvas, panelStatus, previewZoomOut, previewZoomIn, $, skinStateValue, skinStateControl, toggleGuides, mobileToggleGuides } from "./dom"
import { candidatePreview } from "../simulation.ts"
import { isConfiguredSymbolLayout, knownSkinStates, skinStateLabel } from "../actions.ts"
import { textDocument, visualResolver, currentBdaAppearance, bdaBasePath, bdaAvailableLayoutPaths } from "./bda-documents"
import { genConfigPath, keyboardContext, refreshToolbarPreview, legacyAnimationConfigPath, styleConfigPath, toolbarConfigPath, isToolbarPath, layoutSource } from "./config-context"
import { deviceSpec, keyboardPreviewGeometry, showsKeyboardAccessories } from "../devices.ts"
import { skinPlatform } from "../bda-platform.ts"
import { bdaConfigPath, bdaLayoutDocument, bdaStyleID } from "../bda.ts"
import { decodeBdaAnimation } from "../bda-decode.ts"
import { parseLegacyAnimation } from "../preview-animation.ts"
import { parseLegacyHint } from "../preview-hints.ts"
import { previewItems, previewSurfaceHeight, previewContentVerticalBounds, type PreviewItem } from "../preview-items.ts"
import { IniDocument } from "../ini.ts"
import { resolvePanelConfig, DEFAULT_BDA_PANEL_WIDTH, DEFAULT_BDA_PANEL_HEIGHT } from "../keyboard.ts"
import { resolveCandidateInputTextVisual, resolveCandidateTextVisuals } from "../candidate-style.ts"
import { availableSkinStates, canvasFitWidth, previewScalePercent } from "../panel-tools.ts"
import { populateKeyInspector } from "./key-inspector"
import { setDrawingTile, drawAtlas } from "./tile-editing"
import { nativeCandidateText, refreshNativeScenes, refreshPalmPreview } from "./native-preview"

export function simulationLanguage(): "zh" | "en" {
  return /^en_/i.test(appState.layoutPath.split("/").pop() ?? "") ? "en" : "zh"
}

export function applyCandidateTextVisual(
  element: HTMLElement,
  visual: TextVisual | undefined,
  canvasWidth: number,
): void {
  element.style.color = visual?.color ?? ""
  element.style.fontFamily = canvasFontFamily(visual?.fontName)
  element.style.fontWeight = visual?.bold ? "bold" : ""
  element.style.fontSize = visual?.fontSize
    ? `${(visual.fontSize / canvasWidth) * 100}cqw`
    : ""
}

function renderCandidateState(): boolean {
  const language = simulationLanguage()
  if (appState.lastSimulationLanguage !== undefined && appState.lastSimulationLanguage !== language) {
    setSimulatedComposition("")
  }
  appState.lastSimulationLanguage = language
  const candidateSource = language === "en" ? simulatedOutput.value : appState.simulatedComposition
  const candidateCaret = language === "en"
    ? simulatedOutput.selectionStart ?? simulatedOutput.value.length
    : appState.simulatedComposition.length
  const state = candidatePreview(
    candidateSource,
    candidateCaret,
    language,
    skinState.value ? Number(skinState.value) : undefined,
  )
  candidateComposition.hidden = !state.composing
  candidateInput.hidden = !state.input && !inputBarInKeyboard()
  candidateInputText.textContent = state.input
  candidateWords.replaceChildren(...state.candidates.map((value) => {
    const item = document.createElement("span")
    item.textContent = value
    return item
  }))
  const firstCandidate = candidateWords.firstElementChild as HTMLElement | null
  if (firstCandidate) {
    applyCandidateTextVisual(firstCandidate, appState.firstCandidateTextVisual, appState.candidateTextWidth)
  }
  return state.composing
}

export function refreshSimulationState(): boolean {
  const composing = renderCandidateState()
  const symbolPanel = isConfiguredSymbolLayout(appState.layoutPath, textDocument(genConfigPath()))
  candidateArea.hidden = symbolPanel
  toolbarStrip.hidden = symbolPanel || !toolbarStrip.dataset.path
  toolbarPreview.setPersistentOnly(composing)
  return composing
}

/**
 * Baidu iOS shows the input code in a row at the keyboard's top, Android in a popup above it. The
 * phone decides, not the skin (iOS installs Android BDS too); the bare canvas follows the skin.
 */
export function inputBarInKeyboard(): boolean {
  const spec = deviceSpec(currentDeviceValue())
  if (spec) return spec.family === "iphone"
  return Boolean(appState.archive && skinPlatform(appState.archive) === "ios")
}

export function applyDeviceKeyboardGeometry(
  panelWidth: number,
  panelHeight: number,
  candidateHeight: number,
  candidateInputHeight: number,
): void {
  deviceShell.dataset.inputBar = inputBarInKeyboard() ? "keyboard" : "popup"
  const spec = deviceSpec(currentDeviceValue())
  if (!spec) {
    for (const property of deviceGeometryProperties) deviceShell.style.removeProperty(property)
    fitCanvasPreview()
    return
  }
  const geometry = keyboardPreviewGeometry(
    spec,
    orientation.value,
    panelWidth,
    panelHeight,
    candidateHeight,
    candidateInputHeight,
    deviceShell.dataset.inputBar === "keyboard",
  )
  const screenHeight = orientation.value === "port" ? spec.height : spec.width
  deviceShell.style.setProperty(
    `--keyboard-height-${orientation.value}`,
    `${(geometry.totalHeight / screenHeight) * 100}%`,
  )
  deviceShell.style.setProperty("--candidate-row", `${geometry.candidateHeight}fr`)
  deviceShell.style.setProperty("--candidate-top-inset-row", `${geometry.topInsetHeight}fr`)
  deviceShell.style.setProperty("--candidate-inset-row", `${geometry.candidateInsetHeight}fr`)
  deviceShell.style.setProperty("--candidate-content-row", `${geometry.candidateContentHeight}fr`)
  // The keyboard spans the screen width, so a share of it in cqw follows the device frame's scale.
  const screenWidth = orientation.value === "port" ? spec.width : spec.height
  deviceShell.style.setProperty("--candidate-input-height", `${(geometry.inputBarHeight / screenWidth) * 100}cqw`)
  deviceShell.style.setProperty("--panel-row", `${geometry.panelHeight}fr`)
  deviceShell.style.setProperty("--safe-row", `${geometry.safeBottomHeight}fr`)
}

export function devicePreviewTransparent(): boolean {
  return true
}

/** A built-in text look with the skin's own fields laid over it. */
function merged(base: TextVisual | undefined, own: TextVisual | undefined): TextVisual | undefined {
  return base || own ? { ...base, ...own } : undefined
}

export function refreshPreview(): void {
  if (!appState.archive) return
  rebuildSsfPreview()
  const currentArchive = appState.archive
  const composing = refreshSimulationState()
  if (refreshPalmPreview()) return
  const resolver = visualResolver()
  const context = keyboardContext()
  const toolbarSize = resolver ? refreshToolbarPreview(composing, resolver) : undefined
  preview.setResolver(resolver)
  const animationPath = appState.archive.format === "bda"
    ? bdaConfigPath(appState.archive, theme.value, orientation.value, "animation")
    : undefined
  const animationBytes = animationPath && appState.archive.getBytes(animationPath)
  preview.setAnimation(animationBytes ? decodeBdaAnimation(animationBytes) : undefined)
  const layouts = layoutSource()
  const legacyAnimationPath = legacyAnimationConfigPath()
  const legacyAnimation =
    appState.archive.format !== "bda" && layouts?.isText(styleConfigPath()) && legacyAnimationPath
      ? parseLegacyAnimation(
          IniDocument.parse(layouts.getText(styleConfigPath())),
          IniDocument.parse(layouts.getText(legacyAnimationPath)),
        )
      : undefined
  preview.setLegacyAnimation(legacyAnimation)
  toolbarPreview.setLegacyAnimation(legacyAnimation)
  const hintBase = `${theme.value}/skin/${orientation.value}/`
  const hintPath = (name: string) => `${hintBase}${name}`
  const bdaInfo = currentBdaAppearance()
  const bdaHintPanel = bdaInfo?.appearance.panels.get(layout.value.replace(/\.ini$/i, ""))
  const hasBdaHints = Boolean(bdaHintPanel?.hints.size)
  const hintSource = currentArchive.format === "bda" ? appState.bdaBase : layouts
  const hintDocument = (name: string) => {
    if (currentArchive.format === "bda" && !hasBdaHints) return
    const path = currentArchive.format === "bda" ? bdaBasePath(hintPath(name)) : hintPath(name)
    if (!hintSource?.isText(path)) return
    const document = IniDocument.parse(hintSource.getText(path))
    return bdaInfo ? bdaLayoutDocument(document, bdaInfo.appearance, layout.value) : document
  }
  // 每个面板用 [HINT] LAYOUT_NAME 指定一个 pop（未写时取 gen.ini），pop 内同时含普通气泡与长按 [BAR]。
  const hintName = (appState.layoutDocument?.get("HINT", "LAYOUT_NAME") ?? context?.gen?.get("HINT", "LAYOUT_NAME"))?.trim()
  const namedHint = hintName ? hintDocument(`${hintName.replace(/\.pop$/i, "")}.pop`) : undefined
  const shortHint = namedHint ?? hintDocument("hint1.pop") ?? hintDocument("hint.pop")
  const longHint = namedHint ?? hintDocument("hint2.pop") ?? shortHint
  preview.setLegacyHints(
    hintPreviewEnabled.checked ? parseLegacyHint(shortHint) : undefined,
    hintPreviewEnabled.checked ? parseLegacyHint(longHint) : undefined,
    hintPreviewEnabled.checked && currentArchive.format === "bda" && hasBdaHints,
  )
  const bdaGenPath = bdaBasePath(genConfigPath())
  const bdaGen = appState.archive.format === "bda" && appState.bdaBase?.isText(bdaGenPath)
    ? IniDocument.parse(appState.bdaBase.getText(bdaGenPath))
    : undefined
  preview.setOffsets(context?.gen ?? bdaGen)
  preview.setDefaults(context?.gen ?? bdaGen)
  preview.setTheme(theme.value === "dark" ? "dark" : "light")
  preview.setTransparent(devicePreviewTransparent())
  if (context && appState.layoutDocument && resolver) {
    const symbolPanel = candidateArea.hidden
    const candidatePath = toolbarConfigPath()
    const candidateLayout = candidatePath && layouts?.isText(candidatePath)
      ? IniDocument.parse(layouts.getText(candidatePath))
      : undefined
    const config = resolvePanelConfig(
      appState.layoutDocument,
      context.gen,
      context.styles,
    )
    const skinFont = appState.archive.format === "ssf"
    const native = nativeCandidateText(config.width)
    const builtIn = resolveCandidateTextVisuals(candidateLayout, context.gen, resolver, skinFont)
    const inputVisual = merged(resolveCandidateInputTextVisual(context.gen, resolver, candidateLayout, inputBarInKeyboard(), skinFont), native?.input)
    const candidateVisual = merged(builtIn.normal, native?.words)
    const firstCandidateVisual = native?.first ? merged(builtIn.first ?? builtIn.normal, native.first) : builtIn.first
    appState.firstCandidateTextVisual = firstCandidateVisual
    appState.candidateTextWidth = config.width
    applyCandidateTextVisual(candidateInput, inputVisual, appState.candidateTextWidth)
    applyCandidateTextVisual(
      candidateWords,
      candidateVisual ?? { color: "#ffffff" },
      appState.candidateTextWidth,
    )
    const firstCandidate = candidateWords.firstElementChild as HTMLElement | null
    if (firstCandidate) {
      applyCandidateTextVisual(firstCandidate, appState.firstCandidateTextVisual, appState.candidateTextWidth)
    }
    preview.setPanel(
      config.styleID,
      config.width,
      config.height,
      appState.layoutDocument.get("PANEL", "ANIM_STYLE") ?? "",
    )
    const candidateHeight = symbolPanel ? 0 : (toolbarSize?.height ?? 0)
    const candidateInputHeight = symbolPanel ? 0 : (toolbarSize?.inputHeight ?? 0)
    const surfaceHeight = updatePanelTools(config.width, config.height, candidateHeight)
    appState.activeKeyboardGeometry = {
      panelWidth: config.width,
      panelHeight: surfaceHeight,
      candidateHeight,
      candidateInputHeight,
    }
    applyDeviceKeyboardGeometry(
      config.width,
      surfaceHeight,
      candidateHeight,
      candidateInputHeight,
    )
  } else if (bdaGen && appState.layoutDocument) {
    const generalSize = bdaGen.get("PANEL", "SIZE")?.split(",").map(Number)
    const layoutSize = appState.layoutDocument.get("PANEL", "SIZE")?.split(",").map(Number)
    const generalPanelWidth = generalSize?.[0] || DEFAULT_BDA_PANEL_WIDTH
    const panelWidth = layoutSize?.[0] || generalPanelWidth
    const panelHeight = layoutSize?.[1] || generalSize?.[1] || DEFAULT_BDA_PANEL_HEIGHT
    const candidateDocument = toolbarConfigPath() ? textDocument(toolbarConfigPath()!) : undefined
    const panel = currentBdaAppearance()?.appearance.panels.get(layout.value.replace(/\.ini$/i, ""))
    const inputVisual = panel?.input?.textStyle
      ? resolver?.resolveText(bdaStyleID(panel.input.textStyle), false)
      : resolver && resolveCandidateInputTextVisual(bdaGen, resolver, candidateDocument, inputBarInKeyboard())
    const { normal: candidateVisual, first: firstVisual } = resolver
      ? resolveCandidateTextVisuals(candidateDocument, bdaGen, resolver)
      : { normal: undefined, first: undefined }
    appState.candidateTextWidth = panelWidth
    appState.firstCandidateTextVisual = firstVisual
    applyCandidateTextVisual(candidateInput, inputVisual, appState.candidateTextWidth)
    applyCandidateTextVisual(
      candidateWords,
      candidateVisual ?? { color: "#ffffff" },
      appState.candidateTextWidth,
    )
    const firstCandidate = candidateWords.firstElementChild as HTMLElement | null
    if (firstCandidate) applyCandidateTextVisual(firstCandidate, firstVisual, appState.candidateTextWidth)
    preview.setPanel(
      bdaStyleID(panel?.wholeBackStyle ?? panel?.backStyle),
      panelWidth,
      panelHeight,
    )
    const bdaSymbolPanel = candidateArea.hidden
    const candidateHeight = bdaSymbolPanel ? 0 : (toolbarSize?.height ?? 0)
    const candidateInputHeight = bdaSymbolPanel ? 0 : (toolbarSize?.inputHeight ?? 0)
    const surfaceHeight = updatePanelTools(panelWidth, panelHeight, candidateHeight)
    appState.activeKeyboardGeometry = {
      panelWidth,
      panelHeight: surfaceHeight,
      candidateHeight,
      candidateInputHeight,
    }
    applyDeviceKeyboardGeometry(
      panelWidth,
      surfaceHeight,
      candidateHeight,
      candidateInputHeight,
    )
  } else {
    appState.activeKeyboardGeometry = undefined
    for (const property of deviceGeometryProperties) deviceShell.style.removeProperty(property)
  }
  preview.setDocument(appState.layoutDocument)
  refreshNativeScenes()
}

export function refreshSimulationPreview(): void {
  const composing = refreshSimulationState()
  if (!appState.archive || !appState.activeKeyboardGeometry) return
  applyDeviceKeyboardGeometry(
    appState.activeKeyboardGeometry.panelWidth,
    appState.activeKeyboardGeometry.panelHeight,
    appState.activeKeyboardGeometry.candidateHeight,
    appState.activeKeyboardGeometry.candidateInputHeight,
  )
  updateCanvasCandidateGeometry(appState.activeKeyboardGeometry.candidateHeight)
  // A Palm bar keeps its size while composing; its icons follow the composition by themselves.
  const resolver = appState.archive.format === "sxi" ? undefined : visualResolver()
  if (!resolver) return
  const toolbarSize = refreshToolbarPreview(composing, resolver)
  const symbolPanel = candidateArea.hidden
  const candidateHeight = symbolPanel ? 0 : (toolbarSize?.height ?? appState.activeKeyboardGeometry.candidateHeight)
  const candidateInputHeight = symbolPanel
    ? 0
    : (toolbarSize?.inputHeight ?? appState.activeKeyboardGeometry.candidateInputHeight)
  if (
    candidateHeight !== appState.activeKeyboardGeometry.candidateHeight ||
    candidateInputHeight !== appState.activeKeyboardGeometry.candidateInputHeight
  ) {
    appState.activeKeyboardGeometry.candidateHeight = candidateHeight
    appState.activeKeyboardGeometry.candidateInputHeight = candidateInputHeight
    applyDeviceKeyboardGeometry(
      appState.activeKeyboardGeometry.panelWidth,
      appState.activeKeyboardGeometry.panelHeight,
      candidateHeight,
      candidateInputHeight,
    )
    updateCanvasCandidateGeometry(candidateHeight)
  }
}

// 每次切换布局都会把全部布局文件重新解析（BDA 还要按当前布局逐个合成）来统计皮肤状态；内容不变时复用结果。
function currentSkinStates(): number[] {
  const key = [appState.archive, appState.archive?.revision, appState.bdaBase, appState.bdaBase?.revision, theme.value, orientation.value]
  if (!appState.cachedSkinStates?.key.every((value, index) => value === key[index])) appState.cachedSkinStates = { key, byLayout: new Map() }
  let states = appState.cachedSkinStates.byLayout.get(layout.value)
  if (!states) appState.cachedSkinStates.byLayout.set(layout.value, states = availableSkinStates(...skinStateDocuments()))
  return [...states]
}

function skinStateDocuments(): IniDocument[] {
  const layouts = layoutSource()
  if (!appState.archive || !layouts) return []
  const prefix = `${theme.value}/skin/${orientation.value}/`
  const paths = appState.archive.format === "bda"
    ? bdaAvailableLayoutPaths()
    : layouts.names().filter((path) => path.startsWith(prefix) && path.endsWith(".ini") && layouts.isText(path))
  return paths.flatMap((path) => {
    const document = textDocument(path)
    return document ? [document] : []
  })
}

export function measureCanvasWrapInnerSize(): { width: number; height: number } {
  const canvasStyle = getComputedStyle(canvasWrap)
  // offsetWidth/Height ignore scrollbars: a panned shell that overflows briefly
  // shows scrollbars, and fitting to clientWidth would shrink then regrow the keyboard.
  return {
    width: canvasWrap.offsetWidth - parseFloat(canvasStyle.borderLeftWidth) - parseFloat(canvasStyle.borderRightWidth) -
      parseFloat(canvasStyle.paddingLeft) - parseFloat(canvasStyle.paddingRight),
    height: canvasWrap.offsetHeight - parseFloat(canvasStyle.borderTopWidth) - parseFloat(canvasStyle.borderBottomWidth) -
      parseFloat(canvasStyle.paddingTop) - parseFloat(canvasStyle.paddingBottom),
  }
}

export function fitCanvasPreview(): void {
  if (!appState.canvasLogicalSize) return
  const { width: availableWidth, height: availableHeight } = appState.canvasWrapInnerSize ?? measureCanvasWrapInnerSize()
  if (availableWidth <= 0 || availableHeight <= 0) return
  const width = canvasFitWidth(
    availableWidth,
    availableHeight,
    appState.canvasLogicalSize.width,
    appState.canvasLogicalSize.height,
  )
  const renderedWidth = width * appState.previewZoom
  const scale = renderedWidth / appState.canvasLogicalSize.width
  const panelViewportHeight = Math.round(appState.canvasLogicalSize.panelHeight * scale)
  deviceShell.style.setProperty("--canvas-fit-width", `${renderedWidth}px`)
  deviceShell.style.setProperty("--panel-viewport-height", `${panelViewportHeight}px`)
  const toolbarHeight = Number(toolbarCanvas.style.getPropertyValue("--toolbar-height") || "0")
  const toolbarWidth = Number(toolbarCanvas.style.getPropertyValue("--toolbar-width") || "0")
  if (toolbarWidth > 0 && toolbarHeight > 0) {
    deviceShell.style.setProperty("--toolbar-viewport-height", `${Math.round(toolbarHeight * scale)}px`)
    // A device frame sizes the input code bar in applyDeviceKeyboardGeometry.
    if (currentDeviceValue() === "canvas") {
      const inputHeight = Number(toolbarCanvas.style.getPropertyValue("--candidate-input-height") || "0")
      deviceShell.style.setProperty("--candidate-input-height", `${Math.round(inputHeight * scale)}px`)
    }
    deviceShell.style.setProperty(
      "--candidate-viewport-height",
      `${Math.round(toolbarHeight * scale)}px`,
    )
  }
  if (currentDeviceValue() === "canvas") updateCanvasPanelStatus(renderedWidth)
  requestAnimationFrame(resizeKeyboardPreviews)
}

function updateCanvasPanelStatus(renderedWidth: number): void {
  if (!appState.canvasLogicalSize) return
  panelStatus.textContent = `面板：${Math.round(appState.canvasLogicalSize.width)} × ${Math.round(appState.canvasLogicalSize.layoutPanelHeight)} · 预览缩放：${Math.round(renderedWidth / appState.canvasLogicalSize.width * 100)}%`
}

export function setPreviewPan(x: number, y: number): void {
  appState.previewPanX = x
  appState.previewPanY = y
  deviceShell.style.transform = `translate(${x}px, ${y}px) scale(${currentDeviceValue() === "canvas" ? 1 : appState.previewZoom})`
}

export function schedulePreviewPan(x: number, y: number): void {
  appState.pendingPreviewPan = { x, y }
  schedulePreviewInteractionFrame()
}

export function flushPreviewPan(): void {
  paintPreviewInteraction()
}

export function applyPreviewZoom(value: number, anchor?: { x: number; y: number }): void {
  const before = anchor ? deviceShell.getBoundingClientRect() : undefined
  const anchorX = before && anchor ? (anchor.x - before.left) / before.width : 0.5
  const anchorY = before && anchor ? (anchor.y - before.top) / before.height : 0.5
  appState.previewZoom = Math.min(3, Math.max(0.4, Math.round(value * 1000) / 1000))
  previewZoomOut.disabled = appState.previewZoom <= 0.4
  previewZoomIn.disabled = appState.previewZoom >= 3
  if (currentDeviceValue() === "canvas") fitCanvasPreview()
  else setPreviewPan(appState.previewPanX, appState.previewPanY)
  if (anchor && before) {
    const after = deviceShell.getBoundingClientRect()
    setPreviewPan(
      appState.previewPanX + anchor.x - (after.left + anchorX * after.width),
      appState.previewPanY + anchor.y - (after.top + anchorY * after.height),
    )
  }
  if (currentDeviceValue() !== "canvas" && appState.canvasLogicalSize) {
    requestAnimationFrame(() => {
      const bounds = ($("#preview") as HTMLCanvasElement).getBoundingClientRect()
      panelStatus.textContent = `面板：${Math.round(appState.canvasLogicalSize!.width)} × ${Math.round(appState.canvasLogicalSize!.layoutPanelHeight)} · 预览缩放：${previewScalePercent(bounds.width, bounds.height, appState.canvasLogicalSize!.width, appState.canvasLogicalSize!.panelHeight)}%`
    })
  }
  requestAnimationFrame(resizeKeyboardPreviews)
}

export function scheduleFitCanvasPreview(): void {
  if (appState.canvasFitFrozen) return
  clearTimeout(appState.fitCanvasDebounce)
  appState.fitCanvasDebounce = setTimeout(() => {
    if (currentDeviceValue() === "canvas") fitCanvasPreview()
  }, 50)
}

export function finishPreviewPan(): void {
  const pointerId = appState.previewPanStart?.pointerId
  flushPreviewPan()
  appState.previewPanCandidate = undefined
  appState.previewPanStart = undefined
  appState.previewPanGeometry = undefined
  preview.setPointerInteractionLocked(false)
  toolbarPreview.setPointerInteractionLocked(false)
  canvasWrap.classList.remove("preview-pan-ready", "preview-panning")
  if (pointerId !== undefined && canvasWrap.hasPointerCapture(pointerId)) canvasWrap.releasePointerCapture(pointerId)
}

function updateCanvasCandidateGeometry(candidateHeight: number): void {
  if (!appState.canvasLogicalSize) return
  appState.canvasLogicalSize.height = appState.canvasLogicalSize.panelHeight + candidateHeight
  fitCanvasPreview()
}

/** `native` is a Palm board's own key list and the keyboard states its keys swap for. */
export function updatePanelTools(
  width: number,
  height: number,
  candidateHeight = 0,
  native?: { items: PreviewItem[]; states: number[] },
): number {
  const items = native?.items ?? (appState.layoutDocument ? previewItems(appState.layoutDocument, width, height) : [])
  const surfaceHeight = previewSurfaceHeight(items, height)
  const content = previewContentVerticalBounds(items, width, surfaceHeight)
  deviceShell.style.setProperty("--canvas-width", `${width}px`)
  deviceShell.style.setProperty("--canvas-ratio-width", String(width))
  deviceShell.style.setProperty("--panel-visible-height", String(content.height))
  deviceShell.style.removeProperty("--panel-crop-offset")
  appState.canvasLogicalSize = {
    width,
    height: surfaceHeight + candidateHeight,
    panelHeight: surfaceHeight,
    layoutPanelHeight: height,
    panelVisibleHeight: content.height,
  }
  fitCanvasPreview()
  const states = native ? [...new Set([...knownSkinStates, ...native.states])].sort((a, b) => a - b) : currentSkinStates()
  const selected = skinState.value
  const selectedState = selected ? Number(selected) : undefined
  if (selectedState !== undefined && selectedState <= 122 && !states.includes(selectedState)) {
    states.push(selectedState)
    states.sort((a, b) => a - b)
  }
  skinState.replaceChildren(
    new Option("默认", ""),
    ...states.map((state) => new Option(skinStateLabel(state), String(state))),
  )
  skinState.value = selectedState !== undefined && states.includes(selectedState) ? selected : ""
  skinStateValue.textContent = skinState.value ? `S${Number(skinState.value)}` : "默认"
  skinStateControl.hidden = states.length === 0
  applySkinState(skinState.value ? Number(skinState.value) : undefined)
  requestAnimationFrame(() => {
    if (currentDeviceValue() === "canvas") return
    const bounds = ($("#preview") as HTMLCanvasElement).getBoundingClientRect()
    panelStatus.textContent = `面板：${Math.round(width)} × ${Math.round(height)} · 预览缩放：${previewScalePercent(bounds.width, bounds.height, width, surfaceHeight)}%`
  })
  return surfaceHeight
}

export function updateDevicePreview(): void {
  setPreviewPan(0, 0)
  const deviceValue = currentDeviceValue()
  deviceShell.dataset.device = deviceValue
  deviceShell.dataset.orientation = orientation.value
  deviceShell.dataset.theme = theme.value
  deviceShell.classList.toggle("canvas-only", deviceValue === "canvas")
  const spec = deviceSpec(deviceValue)
  const referenceFrame = spec?.family === "iphone" && orientation.value === "port"
  deviceShell.dataset.referenceFrame = String(referenceFrame)
  deviceShell.dataset.accessories = showsKeyboardAccessories(spec, orientation.value)
    ? "visible"
    : "hidden"
  if (spec) {
    deviceShell.dataset.family = spec.family
    const portrait = orientation.value === "port"
    const frame = spec.frame
    deviceShell.style.aspectRatio = portrait
      ? `${referenceFrame ? spec.width * REFERENCE_PHONE_WIDTH_SCALE : frame?.width ?? spec.width} / ${referenceFrame ? spec.height : frame?.height ?? spec.height}`
      : `${frame?.height ?? spec.height} / ${frame?.width ?? spec.width}`
    for (const property of deviceFrameProperties) deviceShell.style.removeProperty(property)
    if (frame) {
      const insetX = (frame.width - frame.screenWidth) / 2
      const insetY = (frame.height - frame.screenHeight) / 2
      const screenRadius = frame.width * 0.26 - insetX
      deviceShell.style.setProperty("--device-screen-inset-x", `${(portrait ? insetX / frame.width : insetY / frame.height) * 100}%`)
      deviceShell.style.setProperty("--device-screen-inset-y", `${(portrait ? insetY / frame.height : insetX / frame.width) * 100}%`)
      deviceShell.style.setProperty("--device-screen-radius", portrait
        ? `${screenRadius / frame.screenWidth * 100}% / ${screenRadius / frame.screenHeight * 100}%`
        : `${screenRadius / frame.screenHeight * 100}% / ${screenRadius / frame.screenWidth * 100}%`)
      const bodyRadius = frame.width * 0.26
      deviceShell.style.setProperty("--device-body-radius", portrait
        ? `${bodyRadius / frame.width * 100}% / ${bodyRadius / frame.height * 100}%`
        : `${bodyRadius / frame.height * 100}% / ${bodyRadius / frame.width * 100}%`)
      deviceShell.style.setProperty("--device-island-width", `${(portrait ? 126 / frame.viewportWidth : 37 / frame.viewportHeight) * 100}%`)
      deviceShell.style.setProperty("--device-island-height", `${(portrait ? 37 / frame.viewportHeight : 126 / frame.viewportWidth) * 100}%`)
      deviceShell.style.setProperty("--device-island-offset", `${11 / frame.viewportHeight * 100}%`)
    }
  } else {
    delete deviceShell.dataset.family
    deviceShell.style.removeProperty("aspect-ratio")
    for (const property of deviceGeometryProperties) deviceShell.style.removeProperty(property)
    for (const property of deviceFrameProperties) deviceShell.style.removeProperty(property)
  }
  preview.setTransparent(devicePreviewTransparent())
  applyPreviewZoom(appState.previewZoom)
  // Device switches change whether the canvas is the panel surface, which
  // decides if the gesture hot zones can line up.
  populateKeyInspector()
}

export function setGuidesVisible(enabled: boolean): void {
  appState.guidesVisible = enabled
  ;($("#settings-layout-guides") as HTMLInputElement).checked = enabled
  for (const button of [toggleGuides, mobileToggleGuides]) {
    button.classList.toggle("active", appState.guidesVisible)
    button.setAttribute("aria-pressed", String(appState.guidesVisible))
  }
  preview.setGuides(appState.guidesVisible)
  toolbarPreview.setGuides(appState.guidesVisible)
  if (!enabled) setDrawingTile(false)
  drawAtlas()
}

export function syncCandidateSelection(): void {
  const selected = appState.selectedCandidate && appState.archive?.format === "bda" && appState.selectedPath === appState.layoutPath
    || appState.archive?.format !== "bda" && isToolbarPath(appState.selectedPath) && !appState.selectedToolbarSections.length
  candidateArea.classList.toggle("candidate-selected", selected)
  candidateArea.setAttribute("aria-selected", String(selected))
}

/** The keyboard as drawn on the canvas at canvas resolution: the candidate bar layers (which overlap) over the panel; transparent unless a background is given. */
export function keyboardSnapshot(background?: string): HTMLCanvasElement | undefined {
  if (!previewCanvas.width || !previewCanvas.height) return
  const bars = [
    !candidateBackgroundCanvas.hidden ? candidateBackgroundCanvas : undefined,
    !toolbarCanvas.hidden && !toolbarStrip.hidden ? toolbarCanvas : undefined,
  ].filter((canvas): canvas is HTMLCanvasElement => Boolean(!candidateArea.hidden && canvas?.width && canvas.height))
  const barHeight = Math.max(0, ...bars.map((canvas) => canvas.height))
  const snapshot = document.createElement("canvas")
  snapshot.width = Math.max(previewCanvas.width, ...bars.map((canvas) => canvas.width))
  snapshot.height = barHeight + previewCanvas.height
  const context = snapshot.getContext("2d")
  if (!context) return
  if (background) {
    context.fillStyle = background
    context.fillRect(0, 0, snapshot.width, snapshot.height)
  }
  for (const canvas of bars) context.drawImage(canvas, 0, 0)
  context.drawImage(previewCanvas, 0, barHeight)
  return snapshot
}
