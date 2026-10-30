import { checkUpdateButton, updateStatus, downloadUpdate, aboutUpdate, settingsDialog, canvasBackground, canvasWrap, editorCrosshair, deviceShell, previewCoordinates, editorCoordinateSnapSetting, appTheme, sourceFontSize, sourceEditor, windowMaterialOpacity, windowMaterialOpacityValue, windowMaterial, windowMaterialOpacitySetting, sidebarViewVisible, inspectorTabs, inspectorTabsVisible, sourceCompletionEnabled, sourceValueHintsEnabled, sourceLineExplanationEnabled, browserThemeColor } from "./dom"
import { isTauri, settingsPages, settingsNavItems, preview, toolbarPreview, sidebarViewHeading, source } from "./canvas-interaction"
import { invoke } from "@tauri-apps/api/core"
import { checkForUpdate } from "../update.ts"
import { initializeSourceDirectory } from "./source-workspace"
import { type CanvasBackground, canvasBackgroundValues } from "../canvas-background.ts"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { appState } from "./state"
import { retryAsync } from "../retry.ts"
import { showError } from "./file-operations"
import { type WindowMaterialKind } from "./types"
import { updateSourceHighlight } from "./source-panel"
import { initializeSettings } from "../settings"
import { setGuidesVisible } from "./preview-render"
import { modelSettings } from "./ai-panel"

export async function refreshUpdateStatus(): Promise<void> {
  checkUpdateButton.disabled = true
  updateStatus.textContent = "正在检查更新…"
  downloadUpdate.hidden = true
  try {
    const fetcher = isTauri()
      ? async () => new Response(await invoke<string>("fetch_release_page"), { status: 200 })
      : fetch
    const result = await checkForUpdate(aboutUpdate.dataset.currentVersion ?? "0.0.0", fetcher)
    if (result.status === "latest") {
      updateStatus.textContent = `当前已是最新版本（v${result.currentVersion}）`
      return
    }
    updateStatus.textContent = `发现新版本 v${result.latestVersion}`
    downloadUpdate.href = result.url
    downloadUpdate.textContent = `前往下载 v${result.latestVersion}`
    downloadUpdate.hidden = false
  } catch (error) {
    updateStatus.textContent = `检查更新失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    checkUpdateButton.disabled = false
  }
}

export function showSettingsPage(page: string): void {
  const target = settingsPages.find(panel => panel.dataset.settingsPanel === page && !panel.hasAttribute("data-platform-hidden"))
    ?? settingsPages.find(panel => !panel.hasAttribute("data-platform-hidden"))
  if (!target) return
  for (const panel of settingsPages) panel.hidden = panel !== target
  for (const button of settingsNavItems) {
    const selected = button.dataset.settingsPage === target.dataset.settingsPanel
    button.setAttribute("aria-selected", String(selected))
    button.tabIndex = selected ? 0 : -1
  }
  settingsDialog.querySelector<HTMLElement>(".settings-content")?.scrollTo({ top: 0 })
  if (target.dataset.settingsPanel === "about") void refreshUpdateStatus()
}

export const nativeSettings = isTauri() || location.hostname === "127.0.0.1" && ["1420", "4173"].includes(location.port)

export const sourceDirectoryInitialization = initializeSourceDirectory()

export const savedDefaultDevice = localStorage.getItem("default-device")

export function applyCanvasBackground(background: CanvasBackground): void {
  canvasBackground.value = background
  localStorage.setItem("canvas-background", background)
  canvasWrap.dataset.background = background
}

const savedCanvasBackground = localStorage.getItem("canvas-background")

export const initialCanvasBackground = savedCanvasBackground === "default"
  ? "glass"
  : canvasBackgroundValues.includes(savedCanvasBackground as CanvasBackground)
    ? savedCanvasBackground as CanvasBackground
    : "checkerboard"

export function applyEditorCrosshairSetting(): void {
  const state = editorCrosshair.checked ? "on" : "off"
  deviceShell.dataset.crosshair = state
  previewCoordinates.dataset.crosshair = state
  // 全局预览里没有十字线浮层，不能隐藏系统光标。
  preview.setCrosshair(editorCrosshair.checked && !appState.layoutOverview)
  toolbarPreview.setCrosshair(editorCrosshair.checked && !appState.layoutOverview)
  editorCoordinateSnapSetting.hidden = !editorCrosshair.checked
  previewCoordinates.hidden = editorCrosshair.checked
  if (!editorCrosshair.checked) {
    for (const property of ["left", "top", "width", "height"]) previewCoordinates.style.removeProperty(property)
  }
}

export const systemTheme = matchMedia("(prefers-color-scheme: dark)")

export function applyAppTheme(): void {
  const preference = appTheme.value === "light" || appTheme.value === "dark" ? appTheme.value : "system"
  const resolved = preference === "system" ? (systemTheme.matches ? "dark" : "light") : preference
  document.documentElement.dataset.appTheme = resolved
  document.documentElement.style.colorScheme = resolved
  browserThemeColor.content = getComputedStyle(document.documentElement).getPropertyValue("--material-toolbar").trim()
  if (isTauri()) void getCurrentWindow().setTheme(preference === "system" ? null : preference)
}

export function applySourceFontSize(): void {
  const size = Number(sourceFontSize.value)
  if (!Number.isFinite(size) || size < 8 || size > 32) return
  sourceEditor.style.setProperty("--source-font-size", `${size}px`)
}

export const savedSourceFontSize = localStorage.getItem("source-font-size")

export function saveSourceFontSize(): void {
  const size = Number(sourceFontSize.value)
  if (!Number.isInteger(size) || size < 8 || size > 32) {
    sourceFontSize.value = localStorage.getItem("source-font-size") || "11"
    applySourceFontSize()
    return
  }
  sourceFontSize.value = String(size)
  localStorage.setItem("source-font-size", sourceFontSize.value)
  applySourceFontSize()
}

export function currentWindowMaterialOpacity(): number {
  return Math.max(20, Math.min(100, Number(windowMaterialOpacity.value) || 100))
}

export function applyWindowMaterialOpacity(): void {
  const opacity = currentWindowMaterialOpacity()
  windowMaterialOpacity.value = String(opacity)
  windowMaterialOpacityValue.value = `${opacity}%`
  windowMaterialOpacity.disabled = !windowMaterial.checked
  document.documentElement.dataset.windowMaterialKind = appState.windowMaterialKind
  // 滑杆值就是材质填充强度：100% 时每个表面都合成到完全不透明，因此不再像旧版那样乘一个小系数
  // （那样 100% 也只有半透明）。各表面按层角色取系数：单层直接用 f，下沉层用 1-√(1-f) 让两层叠加后
  // 正好等于 f，浮层用 1-(1-f)² 让对话框正文始终落在接近实心的底上。模糊无需再关闭。
  const fill = opacity / 100
  document.documentElement.style.setProperty("--window-material-layer", String(fill))
  document.documentElement.style.setProperty("--window-material-sunken", String(1 - Math.sqrt(1 - fill)))
  document.documentElement.style.setProperty("--window-material-floating", String(1 - (1 - fill) ** 2))
}

async function applyWindowMaterial(): Promise<void> {
  const enabled = windowMaterial.checked
  document.documentElement.dataset.windowMaterial = enabled ? "on" : "off"
  applyWindowMaterialOpacity()
  if (!isTauri()) return
  await invoke("set_window_material", { enabled, opacity: currentWindowMaterialOpacity() })
}

export function applyWindowMaterialWithRetry(): Promise<void> {
  return retryAsync(applyWindowMaterial, { attempts: 4, delayMs: 100 })
}

export function handleWindowMaterialError(error: unknown, action: string): void {
  windowMaterial.checked = false
  document.documentElement.dataset.windowMaterial = "off"
  localStorage.setItem("window-material", "off")
  applyWindowMaterialOpacity()
  showError(error, action)
}

export async function initializeWindowMaterial(): Promise<void> {
  if (isTauri()) {
    appState.windowMaterialKind = await retryAsync(
      () => invoke<WindowMaterialKind>("window_material_kind"),
      { attempts: 4, delayMs: 100 },
    )
  }
  const savedWindowMaterial = localStorage.getItem("window-material")
  windowMaterial.checked = savedWindowMaterial === null
    ? appState.windowMaterialKind !== "acrylic"
    : savedWindowMaterial !== "off"
  windowMaterialOpacitySetting.hidden = appState.windowMaterialKind === "none"
  const storageKey = appState.windowMaterialKind === "acrylic" ? "window-acrylic-opacity" : "window-glass-opacity"
  // 玻璃默认值取 50%：滑杆现在代表填充强度，100% 等同于实心窗口，默认值要留出材质本身。
  windowMaterialOpacity.value = localStorage.getItem(storageKey) ?? "87"
  await applyWindowMaterialWithRetry()
}

export async function restoreWindowMaterialAfterDrag(): Promise<void> {
  appState.windowDragPointerDown = false
  try {
    await appState.windowDragMaterialTransition
  } catch {
    appState.windowDragMaterialDisabled = false
    document.documentElement.dataset.windowMaterial = windowMaterial.checked ? "on" : "off"
    return
  }
  if (!appState.windowDragMaterialDisabled) {
    document.documentElement.dataset.windowMaterial = windowMaterial.checked ? "on" : "off"
    return
  }
  appState.windowDragMaterialDisabled = false
  await new Promise(resolve => setTimeout(resolve, 50))
  try {
    await applyWindowMaterialWithRetry()
  } catch (error) {
    handleWindowMaterialError(error, "恢复窗口材质")
  }
}

export async function startWindowsWindowDrag(): Promise<void> {
  appState.windowDragPointerDown = true
  document.documentElement.dataset.windowMaterial = "off"
  try {
    appState.windowDragMaterialTransition = invoke("set_window_material", { enabled: false, opacity: currentWindowMaterialOpacity() })
    await appState.windowDragMaterialTransition
    appState.windowDragMaterialDisabled = true
    if (!appState.windowDragPointerDown) {
      await restoreWindowMaterialAfterDrag()
      return
    }
    const mouseReleased = invoke("wait_for_left_mouse_release")
    await getCurrentWindow().startDragging()
    await mouseReleased
    await restoreWindowMaterialAfterDrag()
  } catch (error) {
    appState.windowDragMaterialTransition = undefined
    await restoreWindowMaterialAfterDrag()
    showError(error, "拖动窗口")
  } finally {
    appState.windowDragMaterialTransition = undefined
  }
}

export function applySidebarViewVisibility(): void {
  sidebarViewHeading.toggleAttribute("hidden", !sidebarViewVisible.checked)
}

export function applyInspectorTabsVisibility(): void {
  inspectorTabs.toggleAttribute("hidden", !inspectorTabsVisible.checked)
}

export function applySourceEditorFeatures(): void {
  source.setFeatures({
    completion: sourceCompletionEnabled.checked,
    valueHints: sourceValueHintsEnabled.checked,
    explanations: sourceLineExplanationEnabled.checked,
  })
  updateSourceHighlight()
}

export function setCanvasDropState(active: boolean): void {
  canvasWrap.classList.toggle("drop-target", active)
}

export const settingsController = initializeSettings(settingsDialog, setGuidesVisible, modelSettings)
