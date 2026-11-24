import { bindResourceMenu } from "./resource-gallery"
import { clearResourceWindow } from "./resource-grid-window"
import { bindListActionKeys, bindListboxKeys, element, emptyState } from "../dom-element"
import { createIcon } from "../icons"
import { skinFontFiles, themeOfPath } from "../font-files"
import { loadEmbeddedFont } from "../atlas"
import { appState } from "./state"
import { $, resourceGallery, resourceListView, resourceSearch, resourceUsage, resourceDetail, resourceListTitle, resourceCount, resourceUploadButton, resourceUploadInput, resourceDownloadButton, resourceDeleteButton, resourceRenameButton, resourceSelectionActions, resourceName, resourceMeta, resourceCategory, resourceTheme, theme, orientation } from "./dom"
import { addStyle, availableStyleIDs, canAddStyle, styleKind, styleConfigDocument, styleSoundFile } from "./style-picker"
import { styleKindIcon, styleTypeOptions, styleFilterButtons, styleUsageOptions } from "../style-card"
import { styleUsages } from "./style-references"
import { currentSoundEntries, renderResourceInspector, showStyle } from "./resource-inspector"
import { pickableImagePaths } from "./image-pickers"
import { isEditing } from "./edit-history"
import { resourceInventoryItems } from "./resource-inventory"
import { availableSkinThemes, usesSkinThemeDirectories } from "./config-context"
import { selectChoice } from "./mobile-layout"
import { openResources, resourceNavigationPath } from "./resource-navigation"
import { fontSample, lazyFontSample } from "./font-picker"
import { skinFontField } from "./skin-fonts"
import { mobilePortraitQuery, releaseKeySound } from "./canvas-interaction"
import { field, section } from "./property-rows"
import { releaseOnRemove } from "../dom-lifecycle"

export function resourceStyleMatchesUsage(id: string): boolean {
  if (!appState.resourceConfigActive || appState.resourceUsageFilter === "all" || !["bdi", "bds", "sxi"].includes(appState.archive?.format ?? "")) return true
  const used = styleUsages(id).length > 0
  return appState.resourceUsageFilter === "used" ? used : !used
}

const resourceNames = new Intl.Collator(undefined, { numeric: true })

export function sortResources<T>(items: T[], name: (item: T) => string = item => String(item)): T[] {
  const direction = $<HTMLSelectElement>("#resource-sort").value === "descending" ? -1 : 1
  return items.sort((a, b) => direction * resourceNames.compare(name(a), name(b)))
}

function setText(selector: string, value: string): void {
  const target = $(selector)
  if (target.textContent !== value) target.textContent = value
}

export function renderStyleFilters(bdaGroup?: string): void {
  let bar = resourceListView.querySelector<HTMLElement>(".ui-style-filter-bar")
  if (!bar) {
    bar = document.createElement("span")
    bar.className = "ui-style-filter-bar"
    resourceUsage.parentElement!.before(bar)
  }
  const filterKind = bdaGroup ? "bda" : "legacy"
  if (bar.dataset.kind === filterKind) {
    bar.hidden = false
    bar.querySelector("select")!.value = appState.styleUsageFilter
    for (const button of bar.querySelectorAll<HTMLButtonElement>("[data-style-kind]")) {
      const selected = button.dataset.styleKind === (bdaGroup ?? resourceCategory.value)
      if (button.getAttribute("aria-pressed") !== String(selected)) button.setAttribute("aria-pressed", String(selected))
    }
    return
  }
  if (!bdaGroup && resourceCategory.dataset.styleCategories !== "bdi") {
    resourceCategory.replaceChildren(...styleTypeOptions.map(([value, label]) => new Option(label, value)))
    resourceCategory.dataset.styleCategories = "bdi"
  }
  const select = (label: string, options: readonly (readonly [string, string])[], value: string, change: (value: string) => void) => {
    const wrap = document.createElement("span")
    wrap.className = "ui-input ui-select"
    const control = document.createElement("select")
    control.setAttribute("aria-label", label)
    control.replaceChildren(...options.map(([value, label]) => new Option(label, value)))
    control.value = value
    control.addEventListener("change", () => change(control.value))
    wrap.append(control)
    return wrap
  }
  bar.hidden = false
  bar.dataset.kind = filterKind
  bar.replaceChildren(
    select("样式用途", styleUsageOptions.map(([value, label]) => [value, value === "all" ? "用途" : label] as const), appState.styleUsageFilter, value => { appState.styleUsageFilter = value; renderResourceInspector() }),
    styleFilterButtons(bdaGroup ? styleTypeOptions.filter(([kind]) => ["image", "color", "text"].includes(kind)) : styleTypeOptions, "styleKind", bdaGroup ?? resourceCategory.value, value => {
      resourceCategory.value = bdaGroup ? value === "image" ? "imageStyles" : value === "text" ? "textStyles" : "colorStyles" : value
      if (bdaGroup) resourceCategory.dispatchEvent(new Event("change"))
      else renderResourceInspector()
    }),
  )
}

function resourceFonts(): string[] {
  return skinFontFiles(appState.archive?.names() ?? []).filter(path => {
    const scope = themeOfPath(path)
    return !["light", "dark"].includes(scope) || scope === theme.value
  })
}

/** 分类数量来自当前资源范围，引用统计复用删除保护的跨布局索引。 */
export function updateResourcePage(title: string, count: number): void {
  appState.resourceCatalog = ""
  resourceListView.querySelector(".resource-actions")!.prepend(resourceUploadButton)
  $(document.body.classList.contains("resource-workspace") || mobilePortraitQuery.matches ? "#resource-page-heading" : ".resource-actions").append(resourceDownloadButton)
  $("#resource-catalog").hidden = true
  resourceGallery.hidden = false
  const archive = appState.archive
  resourceTheme.hidden = !usesSkinThemeDirectories() && availableSkinThemes().length < 2
  for (const button of resourceTheme.querySelectorAll<HTMLButtonElement>("[data-resource-theme]")) {
    const pressed = String(button.dataset.resourceTheme === theme.value)
    if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed)
  }
  const ids = archive?.format === "ssf" ? [] : availableStyleIDs()
  const supported = Boolean(archive && ["bdi", "bds", "sxi"].includes(archive.format))
  const key = `${archive?.revision}|${theme.value}|${orientation.value}|${appState.selectedPath}`
  if (archive && (appState.resourcePageStatistics?.archive !== archive || appState.resourcePageStatistics.key !== key)) {
    const types: Record<string, number> = Object.fromEntries(styleTypeOptions.map(([type]) => [type, 0]))
    const styles = styleConfigDocument()
    for (const id of ids) {
      const kind = styleKind(id, styles)
      types[kind]++
      if (kind !== "sound" && styleSoundFile(id, styles)) types.sound++
    }
    appState.resourcePageStatistics = { archive, key, types, unused: supported ? ids.filter(id => !styleUsages(id).length).length : 0 }
  }
  const counts = { style: ids.length, image: pickableImagePaths().length, sound: currentSoundEntries().length, font: resourceFonts().length, all: 0 }
  counts.all = counts.image + counts.sound + counts.font
  setText("#mobile-resource-summary", `共 ${(counts.style + counts.all).toLocaleString()} 个资源 · ${archive?.format.toUpperCase() ?? ""}`)
  for (const [kind, value] of Object.entries(counts)) setText(`[data-resource-count="${kind}"]`, value.toLocaleString())
  setText("#resource-total", `${(counts.style + counts.all).toLocaleString()} 项`)
  setText("#resource-unused-summary", supported ? `${appState.resourcePageStatistics?.unused.toLocaleString()} 个样式未被引用` : "当前格式不提供样式引用统计")
  $<HTMLButtonElement>("#resource-show-unused").disabled = !supported
  resourceUsage.parentElement!.hidden = !supported || appState.resourceInspectorMode !== "style"
  resourceUsage.value = appState.resourceUsageFilter
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-resource-page], [data-resource-catalog], [data-resource-style-type]")) {
    const type = button.dataset.resourceStyleType
    const selected = type ? appState.resourceInspectorMode === "style" && type === appState.resourceStyleType
      : button.dataset.resourcePage === appState.resourceInspectorMode && (appState.resourceInspectorMode !== "style" || appState.resourceStyleType === "all")
    button.setAttribute("aria-pressed", String(selected))
    if (type) {
      button.disabled = !archive || archive.format === "ssf" || archive.format === "bda" && !["image", "color", "text"].includes(type)
      setText(`[data-resource-style-count="${type}"]`, (appState.resourcePageStatistics?.types[type] ?? 0).toLocaleString())
    }
  }
  syncMobileResourceCategory()
  const kind = appState.resourceInspectorMode
  const total = counts[kind]
  setText("#resource-page-description", `${total.toLocaleString()} 个${title}${kind === "style" ? ` · ${counts.all.toLocaleString()} 个资源` : ""}${count !== total ? ` · 筛出 ${count.toLocaleString()} 项` : ""}`)
  const create = $<HTMLButtonElement>("#resource-create-style")
  create.hidden = false
  create.lastChild!.textContent = kind === "style" ? (mobilePortraitQuery.matches ? "新建样式" : "新建资源") : kind === "image" ? "上传" : "添加"
  create.disabled = !isEditing() || kind === "style" && !canAddStyle()
}

function renderCatalog(): void {
  const archive = appState.archive
  if (!archive || !appState.resourceCatalog) return
  clearResourceWindow()
  const catalog = appState.resourceCatalog
  updateResourcePage(catalog === "font" ? "字体" : "全部资源", 0)
  appState.resourceCatalog = catalog
  resourceListView.hidden = false
  const styleFilters = resourceListView.querySelector<HTMLElement>(".ui-style-filter-bar")
  if (styleFilters) styleFilters.hidden = true
  releaseKeySound()
  resourceGallery.hidden = true
  resourceDetail.hidden = true
  const host = $("#resource-catalog")
  host.hidden = false
  host.setAttribute("role", "listbox")
  host.setAttribute("aria-label", appState.resourceCatalog === "font" ? "字体" : "全部资源")
  host.replaceChildren()
  resourceListTitle.textContent = appState.resourceCatalog === "font" ? "字体" : "全部资源"
  const query = resourceSearch.value.trim().toLowerCase()
  const canEditFonts = catalog === "font" && ["bdi", "bds"].includes(archive.format) && isEditing()
  const fonts = resourceFonts()
  const scope = new Set([...pickableImagePaths(), ...currentSoundEntries().map(entry => entry.path)])
  const items = appState.resourceCatalog === "font" ? [] : resourceInventoryItems().filter(item => scope.has(item.id))
  const entries = [...items.map(item => ({ ...item, font: false })), ...fonts.map(path => ({
    id: path, title: path.split("/").pop()!, detail: path, icon: "type", font: true, open: undefined as (() => void) | undefined,
  }))]
  const visible = sortResources(entries, item => item.title)
    .filter(item => `${item.title} ${item.detail}`.toLowerCase().includes(query))
  resourceCount.textContent = String(visible.length)
  setText("#resource-page-description", `${entries.length.toLocaleString()} 项${query ? ` · 筛出 ${visible.length.toLocaleString()} 项` : ""}`)
  $<HTMLButtonElement>("#resource-create-style").hidden = true
  resourceListView.querySelector(".resource-filters")!.append(resourceUploadButton, resourceDownloadButton)
  resourceSelectionActions.querySelector<HTMLElement>(".ui-list-toolbar")!.hidden = true
  resourceUploadButton.hidden = catalog !== "font"
  resourceUploadButton.disabled = !canEditFonts
  resourceUploadButton.setAttribute("aria-label", `上传字体至${theme.value === "dark" ? "深色" : "浅色"}皮肤`)
  resourceUploadButton.querySelector("span:last-child")!.textContent = "上传"
  resourceUploadInput.accept = ".ttf,.otf,.ttc"
  resourceRenameButton.hidden = true
  resourceDownloadButton.hidden = catalog !== "font"
  resourceDownloadButton.disabled = true
  resourceDownloadButton.title = "下载选中字体"
  resourceDownloadButton.setAttribute("aria-label", resourceDownloadButton.title)
  resourceDeleteButton.hidden = catalog !== "font"
  resourceDeleteButton.disabled = true
  resourceDeleteButton.title = "删除选中字体"
  resourceDeleteButton.setAttribute("aria-label", resourceDeleteButton.title)
  resourceSearch.setAttribute("aria-label", catalog === "font" ? "搜索字体" : "搜索资源")
  if (!visible.some(item => item.id === appState.selectedResourceCatalogItem)) appState.selectedResourceCatalogItem = ""
  resourceUsage.parentElement!.hidden = true
  resourceListView.querySelector<HTMLElement>(".ui-style-filter-bar")?.setAttribute("hidden", "")
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-resource-page], [data-resource-catalog], [data-resource-style-type]")) button.setAttribute("aria-pressed", String(button.dataset.resourceCatalog === appState.resourceCatalog))
  syncMobileResourceCategory()
  const choose = (row: HTMLElement, focus = true) => {
    appState.selectedResourceCatalogItem = row.dataset.catalogId!
    if (focus) row.focus({ preventScroll: true })
    for (const option of host.querySelectorAll<HTMLElement>('[role="option"]')) {
      option.setAttribute("aria-selected", String(option === row))
      option.tabIndex = option === row ? 0 : -1
    }
    resourceDetail.hidden = true
    if (row.dataset.font === "true") {
      const field = skinFontField(appState.selectedResourceCatalogItem.split("/")[0])
      const detail = $("#style-detail-fields")
      const path = appState.selectedResourceCatalogItem
      const sample = fontSample({ value: path, label: row.querySelector("strong")!.textContent!, load: () => loadEmbeddedFont(archive, path) })
      sample.dataset.size = "lg"
      detail.replaceChildren(section("字体预览", [sample]), ...field ? [field] : [])
    } else {
      const item = entries.find(item => item.id === appState.selectedResourceCatalogItem)
      if (!item) return
      const detail = $("#style-detail-fields")
      detail.replaceChildren(section("资源信息", [field({ key: "resource-info", label: "详情", spec: { kind: "readonly", value: item.detail } })]))
      if (archive.isImage(item.id)) {
        const frame = element("div", "ui-preview-frame")
        const url = URL.createObjectURL(new Blob([archive.getBytes(item.id)!.slice()], { type: "image/png" }))
        frame.append(Object.assign(element("img"), { src: url, alt: item.title }))
        releaseOnRemove(frame, () => URL.revokeObjectURL(url))
        detail.prepend(frame)
      }
      if (item.open) {
        const open = Object.assign(element("button", "ui-button"), { type: "button", textContent: "打开资源" })
        open.append(createIcon("arrow-up-right"))
        open.addEventListener("click", item.open)
        detail.append(open)
      }
    }
    $("#resource-name").textContent = row.querySelector("strong")!.textContent
    $("#resource-meta").textContent = appState.selectedResourceCatalogItem
    $("#image-resource-detail").hidden = true
    $("#sound-resource-detail").hidden = true
    $("#style-resource-detail").hidden = false
    $("#style-detail-previews").hidden = true
    resourceName.textContent = row.querySelector("strong")!.textContent
    resourceMeta.textContent = row.dataset.catalogId!
    resourceDetail.hidden = false
    resourceDownloadButton.disabled = row.dataset.font !== "true"
    resourceDeleteButton.disabled = !canEditFonts || row.dataset.font !== "true"
  }
  for (const item of visible) {
    const row = element("div", "ui-list-item ui-resource-catalog-item")
    row.setAttribute("role", "option")
    row.setAttribute("aria-selected", String(item.id === appState.selectedResourceCatalogItem))
    row.tabIndex = item.id === appState.selectedResourceCatalogItem || !appState.selectedResourceCatalogItem && host.childElementCount === 0 ? 0 : -1
    row.dataset.catalogId = item.id
    row.dataset.font = String(item.font)
    row.title = item.detail
    const text = element("span", "ui-list-item-text")
    const mode = item.id.startsWith("dark/") ? "深色" : item.id.startsWith("light/") ? "浅色" : ""
    text.append(Object.assign(element("strong"), { textContent: item.title }), Object.assign(element("small"), { textContent: item.font && mode ? `${mode} · ${item.detail}` : item.detail }))
    if (item.font) row.append(lazyFontSample({ value: item.id, label: item.title, load: preview => loadEmbeddedFont(archive, item.id, preview) }, true))
    else row.append(createIcon(item.icon, 20))
    row.append(text)
    row.addEventListener("click", () => choose(row))
    const open = () => { choose(row); item.open?.() }
    row.addEventListener("dblclick", open)
    row.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); open() }
      if (event.key === " ") { event.preventDefault(); choose(row) }
    })
    host.append(row)
  }
  if (!visible.length) host.append(emptyState(query ? "search-x" : appState.resourceCatalog === "font" ? "type" : "layers"))
  const selected = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(row => row.dataset.catalogId === appState.selectedResourceCatalogItem)
  if (selected) choose(selected, false)
}

export function renderResourceCatalogSearch(): boolean {
  if (!appState.resourceConfigActive || !appState.resourceCatalog) return false
  renderCatalog()
  return true
}

function syncMobileResourceCategory(): void {
  const select = $<HTMLSelectElement>("#mobile-resource-category")
  for (const button of $("#resource-page-tabs").querySelectorAll<HTMLButtonElement>("[data-resource-choice]")) {
    const value = button.dataset.resourceChoice!
    const option = select.querySelector<HTMLOptionElement>(`[value="${value}"]`)!
    const label = button.querySelector(":scope > span:not([aria-hidden])")?.textContent ?? ""
    const count = button.querySelector("small")?.textContent
    const text = count ? `${label} (${count})` : label
    if (option.text !== text) option.text = text
    const pressed = button.getAttribute("aria-pressed") === "true"
    const kind = button.dataset.resourcePage as "style" | "image" | "sound" | undefined
    option.disabled = kind ? !resourceNavigationPath(kind) : button.disabled
    if (pressed && select.value !== value) select.value = value
  }
}

export function wireResourcePage(): void {
  const types = $("#resource-style-types")
  for (const type of ["anim", "text", "image", "color", "sound", "empty"]) {
    const label = styleTypeOptions.find(([value]) => value === type)![1]
    const button = Object.assign(element("button"), { type: "button" })
    button.dataset.resourceStyleType = type
    button.setAttribute("aria-pressed", "false")
    const icon = styleKindIcon(type).querySelector(".ui-icon")!
    const count = element("small")
    count.dataset.resourceStyleCount = type
    button.append(icon, Object.assign(element("span"), { textContent: `${label}样式` }), count)
    button.addEventListener("click", () => {
      appState.resourceStyleType = type
      appState.resourceCatalog = ""
      if (appState.resourceInspectorMode !== "style") openResources("style")
      else renderResourceInspector()
    })
    types.append(button)
  }
  const category = $<HTMLSelectElement>("#mobile-resource-category")
  const styleChoices = element("optgroup")
  const fileChoices = element("optgroup")
  styleChoices.label = "样式"
  fileChoices.label = "资源"
  category.append(styleChoices, fileChoices)
  for (const button of $("#resource-page-tabs").querySelectorAll<HTMLButtonElement>("button")) {
    const { resourceStyleType, resourcePage, resourceCatalog } = button.dataset
    const value = resourceStyleType ? `style:${resourceStyleType}` : resourcePage ?? `catalog:${resourceCatalog}`
    button.dataset.resourceChoice = value
    const group = resourceStyleType || resourcePage === "style" ? styleChoices : fileChoices
    group.append(new Option("", value))
  }
  category.addEventListener("change", () => $("#resource-page-tabs").querySelector<HTMLButtonElement>(`[data-resource-choice="${category.value}"]`)?.click())
  const filterToggle = $("#mobile-resource-filters-toggle")
  const filterOptions = $("#resource-filter-options")
  filterToggle.addEventListener("click", () => {
    const expanded = filterOptions.hasAttribute("data-collapsed")
    filterOptions.toggleAttribute("data-collapsed", !expanded)
    filterToggle.setAttribute("aria-expanded", String(expanded))
  })
  const redraw = () => { if (appState.resourceCatalog) renderCatalog(); else renderResourceInspector() }
  $("#resource-create-style").addEventListener("click", () => {
    if (appState.resourceInspectorMode !== "style") { resourceUploadButton.click(); return }
    const id = addStyle()
    if (id) showStyle(id)
  })
  $("#resource-sort").addEventListener("change", redraw)
  for (const button of resourceTheme.querySelectorAll<HTMLButtonElement>("[data-resource-theme]")) button.addEventListener("click", async () => {
    if (resourceTheme.hidden || theme.value === button.dataset.resourceTheme) return
    const { resourceCatalog, resourceInspectorMode } = appState
    const search = resourceSearch.value
    const focused = document.activeElement === button
    await selectChoice(theme, button.dataset.resourceTheme!)
    if (theme.value !== button.dataset.resourceTheme) return
    openResources(resourceInspectorMode)
    appState.resourceCatalog = resourceCatalog
    resourceSearch.value = search
    if (resourceCatalog || search) redraw()
    if (focused) button.focus({ preventScroll: true })
  })

  resourceUsage.addEventListener("change", () => {
    appState.resourceUsageFilter = resourceUsage.value
    redraw()
  })
  $("#resource-show-unused").addEventListener("click", () => {
    appState.resourceUsageFilter = "unused"
    appState.resourceStyleType = "all"
    resourceCategory.value = "all"
    appState.styleUsageFilter = "all"
    openResources("style")
  })
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-resource-catalog]")) button.addEventListener("click", () => {
    appState.resourceCatalog = button.dataset.resourceCatalog!
    resourceSearch.value = ""
    renderCatalog()
  })
  bindListboxKeys($("#resource-catalog"), row => row.click())
  bindListActionKeys($("#resource-catalog"), resourceSelectionActions)
  bindResourceMenu($("#resource-catalog"), '[role="option"]', row => row.click())
  $("#resource-page-tabs").addEventListener("click", event => {
    if ((event.target as Element).closest("[data-resource-page]")) appState.resourceCatalog = ""
  }, { capture: true })
}
