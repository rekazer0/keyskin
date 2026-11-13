import { modeChoiceButtons, mode, theme, orientation, mobileChoiceButtons, mobileInspectorSelection, selectedKeyName, sourceHeading, quickInspector, resourceInspector, mobileInspectorGroups, keyTypographyFieldsGroup, bdaConfigFieldsGroup, documentFieldsGroup, documentFields, bdaConfigFields, bdaSelectedStyleHeading, mobilePaneButtons, sidebarPane, inspectorPane, panelScaleButton, replaceLayoutImageButton, adaptIos26Button, editorCrosshair, previewCoordinates, deviceShell, replaceAssetButton, keyFields, styleFields, toolbarFields, skinFields, gapFields } from "./dom"
import { ask } from "./ask.ts"
import { element } from "../dom-element.ts"
import { appState } from "./state"
import { createIcon, groupIcon } from "../icons"
import { bdaConfigPath } from "../bda.ts"
import { selectFile } from "./navigation"
import { mobilePortraitQuery, preview, toolbarPreview, source, keyboardFields, layoutActionButtons } from "./canvas-interaction"
import { selectParentObject } from "./key-editing"
import { isEditing } from "./edit-history"
import { updateSourceFileActions } from "./source-files"
import { updateSourceSearchStatus } from "./source-panel"
import { syncAiDesignContext } from "./ai-panel"
import { syncMobileKeyPreview } from "./mobile-key-preview"
import { workspacePane } from "./dom"
import { syncMobilePropertyGroups } from "./mobile-inspector"
import { playEnter, playRotation } from "../motion"

export function syncSegmentedControls(): void {
  for (const button of modeChoiceButtons) {
    const on = button.dataset.modeChoice === mode.value
    button.setAttribute("aria-pressed", String(on))
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
      const icon = icons[value]
      if (currentIcon.dataset.icon !== icon) {
        currentIcon.replaceChildren(createIcon(icon))
        currentIcon.dataset.icon = icon
        if (button.dataset.mobileChoice === "orientation") playRotation(currentIcon, value === "land" ? -90 : 90)
        else playEnter(currentIcon)
      }
    }
    if (button.dataset.mobileChoice === "mode") button.setAttribute("aria-pressed", String(value === "edit"))
    const name = button.dataset.mobileChoice === "orientation" ? "方向" : button.dataset.mobileChoice === "theme" ? "外观" : "工作模式"
    const description = `切换${name}（当前${label}）`
    button.setAttribute("aria-label", description)
    button.title = description
  }
}

export function syncMobileInspectorHeader(): void {
  mobileInspectorSelection.textContent = selectedKeyName.textContent
  sourceHeading.dataset.mobileKeyTools = appState.selectedKeySections.length ? "on" : "off"
  syncMobileKeyPreview()
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

// 点选分类栏后记下落点：末尾的短分区滚不到顶部，按滚动位置反推会指回上一个分区。
let pinnedScrollTop: number | null = null

export function setMobileInspectorGroup(id: string, scroll = true): void {
  quickInspector.dataset.mobileInspectorGroup = id
  for (const button of Array.from(mobileInspectorGroups.querySelectorAll<HTMLButtonElement>("button"))) {
    const active = button.dataset.mobileInspectorGroup === id
    button.setAttribute("aria-pressed", String(active))
  }
  const current = Array.from(quickInspector.querySelectorAll<HTMLElement>(".mobile-inspector-managed"))
    .find((group) => group.dataset.mobileInspectorGroup === id)
  appState.inspectorGroupKey = current ? mobileInspectorGroupKey(current) : ""
  // 分类栏只定位同一列内的分组，不切换或隐藏属性。
  revealActiveRailButton()
  if (scroll) {
    quickInspector.scrollTop = 0
    scrollToSinglePageInspectorGroup()
    // 程序滚动的落点：随后的 scroll 事件按位置反推分组时不改掉这次点选。
    pinnedScrollTop = quickInspector.scrollTop
    current?.getAnimations().forEach((animation) => animation.cancel())
    current?.animate(
      [{ opacity: 0.5, transform: "translateY(var(--space-xs))" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: Number.parseFloat(getComputedStyle(quickInspector).getPropertyValue("--duration-base")), easing: getComputedStyle(quickInspector).getPropertyValue("--ease-standard").trim() },
    )
  }
}

/** 选中画布上的区域后，把分类栏定位到该区域对应的分组（例如输入码区域 → 输入区）。 */
export function revealInspectorGroup(key: string): void {
  const group = Array.from(quickInspector.querySelectorAll<HTMLElement>(".mobile-inspector-managed"))
    .find((el) => mobileInspectorGroupKey(el) === key)
  if (group) setMobileInspectorGroup(group.dataset.mobileInspectorGroup ?? "", true)
}

/** 分类栏放不下时自己滚动：只滚分类栏让当前项露出来，不带动属性列表。 */
function revealActiveRailButton(): void {
  const rail = mobileInspectorGroups.parentElement
  const button = mobileInspectorGroups.querySelector<HTMLElement>('button[aria-pressed="true"]')
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
  // 刚点选分类栏：落点没变就保留点选的分区，用户自己滚动后才重新按位置点亮。
  if (pinnedScrollTop !== null) {
    if (Math.abs(quickInspector.scrollTop - pinnedScrollTop) <= 1) return
    pinnedScrollTop = null
  }
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
  let groups = Array.from(quickInspector.querySelectorAll<HTMLElement>(":scope > :is(.ui-section, .document-fields, .bda-config-fields)"))
    .filter((group) => !group.hidden)
    .flatMap((group) => {
      if (group === documentFieldsGroup) {
        return Array.from(documentFields.querySelectorAll<HTMLElement>(":scope > .ui-section"))
      }
      if (group === bdaConfigFieldsGroup) {
        return Array.from(bdaConfigFields.querySelectorAll<HTMLElement>(":scope > .bda-inspector-section"))
      }
      return [group]
    })
  syncMobilePropertyGroups(groups)
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
    const button = railButton()
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
      const button = railButton()
      button.title = label
      button.append(groupIcon(label), Object.assign(document.createElement("span"), { className: "inspector-group-label", textContent: label }))
      button.addEventListener("click", action)
      mobileInspectorGroups.append(button)
    }
    if (appState.archive.format === "bda") {
      addDestination("面板", selectParentObject)
      for (const [kind, label] of [["animation", "动画"], ["sound", "音效"]] as const) {
        const path = bdaConfigPath(appState.archive, theme.value, orientation.value, kind)
        if (path) addDestination(label, () => selectFile(path, "overview"))
      }
      mobileInspectorGroups.hidden = false
    }
  }
}

function railButton(): HTMLButtonElement {
  const button = element("button", "ui-list-item")
  button.type = "button"
  button.dataset.layout = "tile"
  return button
}

export function setMobilePane(pane: "canvas" | "layout" | "inspector"): void {
  source.commit()
  document.documentElement.dataset.mobilePane = pane
  for (const button of mobilePaneButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.mobilePane === pane))
  }
  const mobile = mobilePortraitQuery.matches
  sidebarPane.inert = mobile && pane !== "layout"
  inspectorPane.inert = mobile && pane !== "inspector"
  workspacePane.inert = mobile && pane === "layout" && Boolean(appState.archive)
  if (mobile && pane === "inspector") syncMobileInspectorHeader()
}

export function updatePanelToolButtons(): void {
  // The tools restyle and copy files, so they work on Sogou skins too, whose key geometry is fixed.
  const editing = isEditing()
  panelScaleButton.disabled = !editing || appState.fileOperationRunning || !appState.archive
  replaceLayoutImageButton.disabled = !editing || appState.fileOperationRunning || !appState.archive
  adaptIos26Button.disabled = !editing || appState.fileOperationRunning || !appState.archive
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
let editModeAsked = false
export function requestEditMode(): void {
  if (editModeAsked) return
  editModeAsked = true
  void ask({
    title: "交互预览中无法编辑",
    detail: "切换至编辑模式后即可修改",
    actions: [{ value: "cancel", label: "取消" }, { value: "edit", label: "切换至编辑模式", variant: "primary" }],
  }).then((choice) => {
    editModeAsked = false
    if (choice === "edit") selectChoice(mode, "edit")
  })
}

export function selectChoice(select: HTMLSelectElement, value: string): void {
  if (select.value === value) return
  select.value = value
  syncAiDesignContext()
  select.dispatchEvent(new Event("change"))
}

// 左栏与检查器共用的拖动调宽：direction 为 1 时向右拖变宽，-1 时向左拖变宽。
export function bindPaneResize(handle: HTMLElement, cssVar: string, storageKey: string, minW: number, defaultW: number, direction: 1 | -1): void {
  const clampWidth = (width: number) => Math.min(window.innerWidth * 0.7, Math.max(minW, width))
  const stored = Number(localStorage.getItem(storageKey) || defaultW)
  const initialW = clampWidth(Number.isFinite(stored) ? stored : defaultW)
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
      document.documentElement.style.setProperty(cssVar, `${clampWidth(pendingW!)}px`)
      pendingW = undefined
    })
    pendingW = clampWidth(startW + (e.clientX - startX) * direction)
  })

  handle.addEventListener("pointerup", () => {
    if (!dragging) return
    dragging = false
    handle.classList.remove("dragging")
    localStorage.setItem(storageKey, String(pendingW ?? currentW()))
  })

  window.addEventListener("resize", () => {
    if (pendingW !== undefined) pendingW = clampWidth(pendingW)
    document.documentElement.style.setProperty(cssVar, `${clampWidth(currentW())}px`)
  })
}
