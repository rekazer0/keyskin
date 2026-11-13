import { element, searchField } from "../dom-element"
import { createIcon } from "../icons"
import { mobilePortraitQuery } from "./canvas-interaction"
import { appState } from "./state"
import { mobileInspectorResize, mobilePropertyTabs, mobileFileSearch, quickInspector, inspectorPane, files } from "./dom"

/** 手机分类复用原属性行和提交逻辑；布局等低频参数收起后仍可展开。 */
export function syncMobilePropertyGroups(groups: HTMLElement[]): void {
  const selected = appState.selectedKeySections.length > 0
  inspectorPane.dataset.mobileKey = String(selected)
  mobilePropertyTabs.hidden = !selected
  const context = JSON.stringify([appState.selectedPath, appState.selectedKeySections])
  if (context !== appState.mobileInspectorContext) {
    appState.mobileInspectorContext = context
    appState.mobileInspectorCategory = "appearance"
    appState.mobileInspectorExpanded.clear()
  }
  for (const group of groups) {
    const label = group.dataset.inspectorGroupLabel ?? group.querySelector("h3")?.textContent ?? ""
    group.dataset.inspectorGroupLabel = label
    group.dataset.mobileCategory = /文字|字体/.test(label) ? "text" : /手势|动作|音效|动画/.test(label) ? "actions" : "appearance"
    const secondary = /^(布局|排列)$/.test(label)
    group.dataset.mobileCollapsed = String(secondary && !appState.mobileInspectorExpanded.has(label))
    const heading = group.querySelector("h3")
    if (secondary && heading && !heading.querySelector(".mobile-group-disclosure")) {
      const button = element("button", "ui-button mobile-group-disclosure")
      button.type = "button"
      button.append(label, createIcon("chevron-down"))
      button.addEventListener("click", () => {
        const open = group.dataset.mobileCollapsed === "true"
        if (open) appState.mobileInspectorExpanded.add(label)
        else appState.mobileInspectorExpanded.delete(label)
        group.dataset.mobileCollapsed = String(!open)
        button.setAttribute("aria-expanded", String(open))
      })
      heading.append(button)
      heading.setAttribute("aria-label", label)
    }
    heading?.querySelector(".mobile-group-disclosure")?.setAttribute("aria-expanded", String(group.dataset.mobileCollapsed !== "true"))
  }
  syncCategory()
}

function syncCategory(): void {
  quickInspector.dataset.mobileCategory = appState.mobileInspectorCategory
  for (const button of mobilePropertyTabs.querySelectorAll<HTMLButtonElement>("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.mobileCategory === appState.mobileInspectorCategory))
  }
}

export function wireMobileInspector(): void {
  for (const button of mobilePropertyTabs.querySelectorAll<HTMLButtonElement>("button")) button.addEventListener("click", () => {
    appState.mobileInspectorCategory = button.dataset.mobileCategory!
    syncCategory()
    quickInspector.scrollTop = 0
  })
  const resize = (value: number) => {
    const split = Math.max(24, Math.min(62, value))
    document.documentElement.style.setProperty("--mobile-inspector-split", `${split}%`)
    mobileInspectorResize.setAttribute("aria-valuenow", String(Math.round(split)))
    mobileInspectorResize.setAttribute("aria-valuetext", `画布占 ${Math.round(split)}%`)
  }
  mobileInspectorResize.addEventListener("pointerdown", event => {
    mobileInspectorResize.setPointerCapture(event.pointerId)
    event.preventDefault()
  })
  mobileInspectorResize.addEventListener("pointermove", event => {
    if (!mobileInspectorResize.hasPointerCapture(event.pointerId) || !mobilePortraitQuery.matches) return
    const main = mobileInspectorResize.parentElement!.getBoundingClientRect()
    resize((event.clientY - main.top) / main.height * 100)
  })
  mobileInspectorResize.addEventListener("keydown", event => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    resize(event.key === "Home" ? 24 : event.key === "End" ? 62
      : Number(mobileInspectorResize.getAttribute("aria-valuenow")) + (event.key === "ArrowUp" ? -2 : 2))
  })
  mobileInspectorResize.addEventListener("dblclick", () => resize(38))
  const expandedFolders = new Set<string>()
  let searching = false
  const filterFiles = () => {
    const query = mobileFileSearch.value.trim().toLocaleLowerCase()
    const folders = [...files.querySelectorAll<HTMLDetailsElement>(".raw-folder")]
    if (query && !searching) {
      expandedFolders.clear()
      for (const folder of folders) if (folder.open) expandedFolders.add(folder.dataset.folderPath ?? "")
    }
    for (const row of files.querySelectorAll<HTMLElement>(".nav-item, .source-file-row")) {
      row.hidden = Boolean(query) && !`${row.textContent} ${row.dataset.path ?? ""}`.toLocaleLowerCase().includes(query)
    }
    for (const folder of folders) {
      const matches = Boolean(folder.querySelector(".source-file-row:not([hidden])"))
      folder.hidden = Boolean(query) && !matches
      if (query) folder.open = matches
      else if (searching) folder.open = expandedFolders.has(folder.dataset.folderPath ?? "")
    }
    searching = Boolean(query)
  }
  searchField({ input: mobileFileSearch, label: "搜索文件与布局", onInput: filterFiles })
  new MutationObserver(filterFiles).observe(files, { childList: true, subtree: true })
}
