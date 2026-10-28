import { modeChoiceButtons, mode, themeChoiceButtons, theme, orientationChoiceButtons, orientation, mobileChoiceButtons, mobileInspectorSelection, selectedKeyName, sourceHeading, quickInspector, resourceInspector, mobileInspectorGroups, keyTypographyFieldsGroup, bdaConfigFieldsGroup, documentFieldsGroup, documentFields, bdaConfigFields, bdaSelectedStyleHeading, mobilePaneButtons, sidebarPane, inspectorPane, mobileSplitHandle, panelScaleButton, replaceLayoutImageButton, adaptIos26Button, editorCrosshair, previewCoordinates, deviceShell, replaceAssetButton, editModeDialog, keyFields, styleFields, toolbarFields, skinFields, gapFields } from "./dom"
import { appState } from "./state"
import { redrawStyleStateCanvases } from "./style-references"
import { createIcon, groupIcon } from "../icons"
import { bdaConfigPath } from "../bda.ts"
import { selectFile } from "./navigation"
import { mobilePortraitQuery, preview, toolbarPreview, source, keyboardFields, layoutActionButtons } from "./canvas-interaction"
import { selectParentObject } from "./key-editing"
import { isEditing } from "./edit-history"
import { updateSourceFileActions } from "./source-files"
import { updateSourceSearchStatus } from "./source-panel"
import { syncAiDesignContext } from "./ai-panel"

export function syncSegmentedControls(): void {
  for (const button of modeChoiceButtons) {
    button.classList.toggle("active", button.dataset.modeChoice === mode.value)
  }
  for (const button of themeChoiceButtons) {
    button.classList.toggle("active", button.dataset.themeChoice === theme.value)
  }
  for (const button of orientationChoiceButtons) {
    button.classList.toggle("active", button.dataset.orientationChoice === orientation.value)
  }
  const values: Record<string, string> = { mode: mode.value, theme: theme.value, orientation: orientation.value }
  const labels: Record<string, string> = {
    preview: "交互预览",
    edit: "编辑模式",
    light: "浅色",
    dark: "深色",
    port: "竖屏",
    land: "横屏",
  }
  for (const button of mobileChoiceButtons) {
    const value = values[button.dataset.mobileChoice ?? ""] ?? ""
    const label = labels[value] ?? value
    const labelNode = button.querySelector<HTMLElement>(".mobile-choice-label")
    if (labelNode) labelNode.textContent = label
    const currentIcon = button.querySelector<HTMLElement>("[data-mobile-current-icon]")
    if (currentIcon) {
      const icons: Record<string, string> = { port: "rectangle-vertical", land: "rectangle-horizontal", light: "sun", dark: "moon" }
      currentIcon.replaceChildren(createIcon(icons[value]))
    }
    for (const icon of Array.from(button.querySelectorAll<HTMLElement>("[data-mobile-choice-value]"))) {
      icon.classList.toggle("active", icon.dataset.mobileChoiceValue === value)
    }
    button.setAttribute("aria-label", `切换${label || "选项"}（当前${label}）`)
  }
}

export function syncMobileInspectorHeader(): void {
  mobileInspectorSelection.textContent = selectedKeyName.textContent
  sourceHeading.dataset.mobileKeyTools = appState.selectedKeySections.length ? "on" : "off"
}

function mobileInspectorGroupLabel(group: HTMLElement): string {
  // 导航标签不带计数之类的括注（「已选按键（3）」→「已选按键」）。
  const explicitLabel = group.dataset.inspectorGroupLabel?.trim().replace(/\s*[（(][^）)]*[）)]\s*$/, "")
  if (explicitLabel) return explicitLabel
  if (group.classList.contains("document-property-section")) {
    const label = group.querySelector(":scope > h3")?.textContent?.trim() ?? "配置"
    return label.replace(/\s*[（(][^）)]*[）)]\s*$/, "")
  }
  if (group.classList.contains("primary-key-fields")) return "常用"
  if (group.classList.contains("skin-fields")) return "皮肤"
  if (group.classList.contains("toolbar-fields")) return "候选栏"
  if (group.classList.contains("document-fields")) return "文档"
  if (group.classList.contains("bda-config-fields")) return "BDA"
  const label = group.querySelector(":scope > h3")?.textContent?.trim() ?? "属性"
  if (label.includes("样式")) return "样式"
  if (label.includes("滑动")) return "手势"
  return label.split(/[、与（(]/)[0]
}

export function mobileInspectorGroupKey(group: HTMLElement): string {
  return group.querySelector(":scope > h3 .document-section-code")?.textContent?.trim()
    || mobileInspectorGroupLabel(group)
}

export function setMobileInspectorGroup(id: string, scroll = true): void {
  quickInspector.dataset.mobileInspectorGroup = id
  for (const button of Array.from(mobileInspectorGroups.querySelectorAll<HTMLButtonElement>("button"))) {
    const active = button.dataset.mobileInspectorGroup === id
    button.classList.toggle("active", active)
    button.setAttribute("aria-pressed", String(active))
  }
  const current = Array.from(quickInspector.querySelectorAll<HTMLElement>(".mobile-inspector-managed"))
    .find((group) => group.dataset.mobileInspectorGroup === id)
  appState.inspectorGroupKey = current ? mobileInspectorGroupKey(current) : ""
  // Each group owns its scrolling area. Scrolling the outer grid here moves the
  // summary card and category rail together, so switching tabs appears to make
  // the controls jump away from the pointer.
  revealActiveRailButton()
  if (scroll) {
    quickInspector.scrollTop = 0
    // 样式引用缩略图只在可见时才量得到卡片尺寸，切到该分组时补绘一次。
    redrawStyleStateCanvases()
    scrollToSinglePageInspectorGroup()
  }
}

/** 分类栏放不下时自己滚动：只滚分类栏让当前项露出来，不带动属性列表。 */
function revealActiveRailButton(): void {
  const rail = mobileInspectorGroups.parentElement
  const button = mobileInspectorGroups.querySelector<HTMLElement>("button.active")
  if (!rail || !button) return
  const view = rail.getBoundingClientRect()
  const box = button.getBoundingClientRect()
  // 第一项连同上面的筛选按钮一起露出来
  if (!button.previousElementSibling) rail.scrollTop = 0
  else if (box.top < view.top) rail.scrollTop -= view.top - box.top
  else if (box.bottom > view.bottom) rail.scrollTop += box.bottom - view.bottom
}

/** 一页显示时把当前分区滚到检查器顶部；第一个分区保留顶部留白。 */
function scrollToSinglePageInspectorGroup(): void {
  const groups = Array.from(quickInspector.querySelectorAll<HTMLElement>(".mobile-inspector-managed"))
    .filter((group) => group.getClientRects().length > 0)
  const current = groups.find((group) => group.dataset.mobileInspectorGroup === quickInspector.dataset.mobileInspectorGroup)
  quickInspector.scrollTop = 0
  if (current && current !== groups[0]) quickInspector.scrollTop = current.getBoundingClientRect().top - quickInspector.getBoundingClientRect().top
}

/** 换了选中对象时停在记住的分区（与分组模式一致）；同一对象重绘时只按滚动位置刷新分类轨。 */
export function revealSinglePageInspectorGroup(context: string): void {
  if (context === appState.singlePageInspectorContext) {
    syncSinglePageInspectorGroup()
    return
  }
  appState.singlePageInspectorContext = context
  scrollToSinglePageInspectorGroup()
}

/** 一页显示时按滚动位置点亮分类轨：最后一个顶边越过检查器顶部的分区即为当前分区。 */
export function syncSinglePageInspectorGroup(): void {
  const groups = Array.from(quickInspector.querySelectorAll<HTMLElement>(".mobile-inspector-managed"))
    .filter((group) => group.getClientRects().length > 0)
  if (!groups.length) return
  const view = quickInspector.getBoundingClientRect()
  const current = groups.find((group) => group.dataset.mobileInspectorGroup === quickInspector.dataset.mobileInspectorGroup)
  const atEnd = quickInspector.scrollTop + quickInspector.clientHeight >= quickInspector.scrollHeight - 2
  // 滚到底时末尾几个短分区到不了顶部：保留刚点选且仍可见的分区，否则点亮最后一个。
  const currentTop = current?.getBoundingClientRect().top ?? -Infinity
  if (atEnd && currentTop >= view.top - 8 && currentTop < view.bottom) return
  const next = atEnd ? groups[groups.length - 1] : groups.filter((group) => group.getBoundingClientRect().top - view.top <= 8).pop() ?? groups[0]
  if (next !== current) setMobileInspectorGroup(next.dataset.mobileInspectorGroup ?? "", false)
}

export function syncMobileInspectorGroups(): void {
  const combinedBda = appState.archive?.format === "bda" && appState.selectedKeySections.length > 0 && !appState.selectedCandidate
  if (combinedBda && keyTypographyFieldsGroup.parentElement !== bdaConfigFieldsGroup) bdaConfigFieldsGroup.append(keyTypographyFieldsGroup)
  else if (!combinedBda && keyTypographyFieldsGroup.parentElement !== quickInspector) quickInspector.insertBefore(keyTypographyFieldsGroup, quickInspector.querySelector(".key-gesture-fields"))
  let groups = Array.from(quickInspector.querySelectorAll<HTMLElement>(":scope > .inspector-group"))
    .filter((group) => !group.hidden)
    .flatMap((group) => {
      if (group === documentFieldsGroup) {
        return Array.from(documentFields.querySelectorAll<HTMLElement>(":scope > .document-property-section"))
      }
      if (group === bdaConfigFieldsGroup) {
        return Array.from(bdaConfigFields.querySelectorAll<HTMLElement>(":scope > .bda-inspector-section"))
      }
      return [group]
    })
  const managed = Array.from(quickInspector.querySelectorAll<HTMLElement>(".mobile-inspector-managed"))
  if (appState.archive?.format !== "bda" && groups.length === managed.length && groups.every((group, index) =>
    group === managed[index] && mobileInspectorGroupLabel(group) === mobileInspectorGroups.children[index]?.querySelector(".inspector-group-label")?.textContent,
  )) return
  for (const group of Array.from(quickInspector.querySelectorAll<HTMLElement>(".mobile-inspector-managed"))) {
    group.classList.remove("mobile-inspector-managed", "mobile-inspector-active")
    delete group.dataset.mobileInspectorGroup
  }
  const selectedBdaKey = appState.archive?.format === "bda" && appState.selectedKeySections.length > 0 && !appState.selectedCandidate
  bdaSelectedStyleHeading.hidden = !selectedBdaKey
  if (selectedBdaKey) {
    bdaConfigFieldsGroup.dataset.inspectorGroupLabel = "样式"
    // 导航列出样式里的每个分区（已选按键、文字……），没有分区时退回整组。
    const sections = bdaConfigFieldsGroup.hidden ? [] : Array.from(bdaConfigFieldsGroup.querySelectorAll<HTMLElement>(":scope > #bda-config-fields > .bda-inspector-section, :scope > .key-typography-fields"))
      .filter((section) => !section.hidden)
    groups = sections.length ? sections : [bdaConfigFieldsGroup].filter((group) => !group.hidden)
  } else {
    delete bdaConfigFieldsGroup.dataset.inspectorGroupLabel
  }
  for (const [index, group] of groups.entries()) {
    group.dataset.mobileInspectorGroup = `${index}`
    group.classList.add("mobile-inspector-managed")
  }
  // 两个分组可能落在同一个短标签上（例如静态候选栏组与 [CAND] 分区）：
  // 先算出一组唯一名称并写回分组，再按名称找回当前分组，避免选中同名的另一个。
  // 重名时加序号（「候选栏 2」），分区代码放进提示，窄分类轨上不会被截断。
  const railLabels = new Map<HTMLElement, string>()
  const railCodes = new Map<HTMLElement, string>()
  const usedRailLabels = new Map<string, number>()
  for (const group of groups) {
    let label = mobileInspectorGroupLabel(group)
    const code = group.querySelector(":scope > h3 .document-section-code")?.textContent?.trim() ?? ""
    const seen = usedRailLabels.get(label) ?? 0
    usedRailLabels.set(label, seen + 1)
    if (seen) {
      label = `${label} ${seen + 1}`
      group.dataset.inspectorGroupLabel = label
    }
    railLabels.set(group, label)
    if (code) railCodes.set(group, code)
  }
  const chosen = appState.inspectorGroupKey
  const remembered = groups.find((group) => mobileInspectorGroupKey(group) === chosen)
  const active = remembered ?? groups[0]
  // 分类轨只在检查器没有任何分组时隐藏。单分区文档（例如只有 [PANEL] 的 help.ini）
  // 此前也会被当成「没有可切换的分组」而整条收起，属性检查器于是少了一侧导航。
  mobileInspectorGroups.hidden = groups.length === 0
  // Keep the horizontal inspector navigation evenly distributed when the
  // available groups change (for example: 面板 / 提示栏 / 扩展区域).
  mobileInspectorGroups.style.setProperty("--inspector-group-count", String(Math.max(groups.length, 1)))
  mobileInspectorGroups.replaceChildren(...groups.map((group) => {
    const button = document.createElement("button")
    button.type = "button"
    const label = railLabels.get(group) ?? mobileInspectorGroupLabel(group)
    const text = document.createElement("span")
    text.className = "inspector-group-label"
    text.textContent = label
    button.append(groupIcon(label), text)
    button.title = railCodes.has(group) ? `${label}（${railCodes.get(group)}）` : label
    button.dataset.mobileInspectorGroup = group.dataset.mobileInspectorGroup
    button.addEventListener("click", () => setMobileInspectorGroup(group.dataset.mobileInspectorGroup ?? "0"))
    return button
  }))
  setMobileInspectorGroup(active?.dataset.mobileInspectorGroup ?? "", false)
  // 落到第一个分区只是默认值：保留用户选过的分区，换到有这个分区的对象时再回到它。
  if (!remembered) appState.inspectorGroupKey = chosen
  if (appState.archive && appState.selectedKeySections.length) {
    const addDestination = (label: string, action: () => void) => {
      const button = document.createElement("button")
      button.type = "button"
      button.title = label
      button.append(groupIcon(label), Object.assign(document.createElement("span"), { className: "inspector-group-label", textContent: label }))
      button.addEventListener("click", action)
      mobileInspectorGroups.append(button)
    }
    if (appState.archive.format === "bda") {
      addDestination("面板", selectParentObject)
      for (const [kind, label] of [["animation", "动画"], ["sound", "声音"]] as const) {
        const path = bdaConfigPath(appState.archive, theme.value, orientation.value, kind)
        if (path) addDestination(label, () => selectFile(path, "overview"))
      }
      mobileInspectorGroups.hidden = false
    }
  }
}

export function setMobilePane(pane: "layout" | "inspector"): void {
  document.documentElement.dataset.mobilePane = pane
  for (const button of mobilePaneButtons) {
    const active = button.dataset.mobilePane === pane
    button.classList.toggle("active", active)
    button.setAttribute("aria-pressed", String(active))
  }
  const mobile = mobilePortraitQuery.matches
  sidebarPane.inert = mobile && pane !== "layout"
  inspectorPane.inert = mobile && pane !== "inspector"
}

export function setMobileSplit(value: number, persist = true): void {
  const clamped = Math.max(28, Math.min(72, value))
  document.documentElement.style.setProperty("--mobile-workspace-split", `${clamped}%`)
  mobileSplitHandle.setAttribute("aria-valuenow", String(Math.round(clamped)))
  mobileSplitHandle.setAttribute("aria-valuetext", `画布占 ${Math.round(clamped)}%`)
  if (persist) localStorage.setItem("mobile-workspace-split", String(clamped))
}

export function setMobilePreviewCollapsed(collapsed: boolean): void {
  if (collapsed) {
    appState.mobileSplitBeforeCollapse = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--mobile-workspace-split"),
    ) || appState.mobileSplitBeforeCollapse
  }
  document.documentElement.dataset.mobilePreviewCollapsed = String(collapsed)
  mobileSplitHandle.setAttribute("aria-expanded", String(!collapsed))
  mobileSplitHandle.title = collapsed ? "点击展开预览" : "拖动调整画布与配置区域比例；点击收起或展开预览"
  mobileSplitHandle.setAttribute("aria-label", mobileSplitHandle.title)
  if (!collapsed) setMobileSplit(appState.mobileSplitBeforeCollapse)
}

export function updatePanelToolButtons(): void {
  // The tools restyle and copy files, so they work on Sogou skins too, whose key geometry is fixed.
  const editing = isEditing()
  panelScaleButton.disabled = !editing || appState.fileOperationRunning || !appState.archive
  replaceLayoutImageButton.disabled = !editing || appState.fileOperationRunning || !appState.archive || appState.archive.format === "bda"
  adaptIos26Button.disabled = !editing || appState.fileOperationRunning || !appState.archive || appState.archive.format === "bda"
}

export function applyModeState(): void {
  const editing = isEditing()
  if (!editing && editorCrosshair.checked) previewCoordinates.hidden = true
  const canvasMode = editing ? "edit" : "preview"
  deviceShell.dataset.mode = canvasMode
  preview.setMode(canvasMode)
  toolbarPreview.setMode(canvasMode)
  preview.setEditTool(appState.keyMode)
  source.readOnly = !editing
  replaceAssetButton.disabled = !editing
  for (const view of [quickInspector, resourceInspector]) view.dataset.readonly = editing ? "false" : "true"
  if (!editing) {
    for (const field of [...keyFields, ...styleFields, ...keyboardFields, ...toolbarFields, ...skinFields, ...gapFields]) {
      field.disabled = true
    }
    for (const button of layoutActionButtons) button.disabled = true
  }
  updatePanelToolButtons()
  updateSourceFileActions()
  updateSourceSearchStatus()
  syncSegmentedControls()
}

/** 交互预览里点到只读控件时的唯一提示（DESIGN.md §7），确认后切换至编辑模式。 */
export function requestEditMode(): void {
  if (editModeDialog.open) return
  editModeDialog.returnValue = ""
  editModeDialog.showModal()
  editModeDialog.addEventListener("close", () => {
    if (editModeDialog.returnValue === "edit") selectChoice(mode, "edit")
  }, { once: true })
}

export function selectChoice(select: HTMLSelectElement, value: string): void {
  if (select.value === value) return
  select.value = value
  syncAiDesignContext()
  select.dispatchEvent(new Event("change"))
}

// 左栏与检查器共用的拖动调宽：direction 为 1 时向右拖变宽，-1 时向左拖变宽。
export function bindPaneResize(handle: HTMLElement, cssVar: string, storageKey: string, minW: number, maxW: number, defaultW: number, direction: 1 | -1): void {
  const stored = Number(localStorage.getItem(storageKey) || defaultW)
  const initialW = Math.max(minW, Math.min(maxW, stored))
  document.documentElement.style.setProperty(cssVar, `${initialW}px`)
  const currentW = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar) || String(defaultW), 10)

  let dragging = false
  let startX = 0
  let startW = initialW

  handle.addEventListener("pointerdown", (e) => {
    dragging = true
    startX = e.clientX
    startW = currentW()
    handle.classList.add("dragging")
    handle.setPointerCapture(e.pointerId)
    e.preventDefault()
  })

  // pointermove 可能比刷新率更频繁，每帧只改一次宽度，避免重复整页重排。
  let pendingW: number | undefined
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return
    if (pendingW === undefined) requestAnimationFrame(() => {
      document.documentElement.style.setProperty(cssVar, `${pendingW}px`)
      pendingW = undefined
    })
    pendingW = Math.max(minW, Math.min(maxW, startW + (e.clientX - startX) * direction))
  })

  handle.addEventListener("pointerup", () => {
    if (!dragging) return
    dragging = false
    handle.classList.remove("dragging")
    localStorage.setItem(storageKey, String(pendingW ?? currentW()))
  })
}
