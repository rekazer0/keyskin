import { type RecentFile, type RecentThumb } from "./types"
import { appState } from "./state"
import { runFileOperation } from "./file-operations"
import { prepareDocumentReplacement } from "./edit-history"
import { loadNativePath, loadSourceWorkspace } from "./archive-io"
import { newDocument } from "./new-document"
import { builtInProjectTemplateExtension } from "../operations"
import { symbolSpan, createIcon } from "../icons"
import { isTauri, sourceDirectoryEnabledBySettings, mobilePortraitQuery } from "./canvas-interaction"
import { invoke } from "@tauri-apps/api/core"
import { canvasWrap, mode, welcomeScroller, $ } from "./dom"
import { selectChoice } from "./mobile-layout"
import { selectFile } from "./navigation"
import { bindListboxKeys } from "../dom-element"
import { playPageSlide } from "../motion"
import { renderBlobPreview, archiveDemoImage, MissingPreviewImageError, renderBuiltInTemplatePreview, releaseArchivePreview, showMissingPreview } from "../template-preview"

export const recentFilesKey = "recent-files"

const templatePrefix = "template:"

function recentTemplateId(path: string): string | undefined {
  return path.startsWith(templatePrefix) ? path.slice(templatePrefix.length) : undefined
}

const mobileRecentPageSize = 9
const desktopRecentRows = 3
const defaultRecentHistoryLimit = 27
const recentHistoryLimitKey = "recent-history-limit"

function recentHistoryLimit(): number {
  const value = Number(localStorage.getItem(recentHistoryLimitKey) ?? defaultRecentHistoryLimit)
  return Number.isInteger(value) && value >= 0 ? value : defaultRecentHistoryLimit
}

export function saveRecentHistoryLimit(limit: number): void {
  if (limit === recentHistoryLimit()) return
  localStorage.setItem(recentHistoryLimitKey, String(limit))
  if (limit && readRecentFiles().length > limit) renderRecentFiles()
}

function readRecentFiles(): RecentFile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentFilesKey) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is RecentFile =>
        Boolean(item)
        && typeof item.path === "string"
        && typeof item.name === "string"
        && typeof item.at === "number"
        && (item.source === undefined || typeof item.source === "string"),
    )
  } catch {
    return []
  }
}

export function recordRecentTemplate(id: string, name: string): void {
  recordRecentFile(templatePrefix + id, name)
}

export function recordRecentFile(path: string, name: string, source = "", replacedTemplateId = ""): void {
  if (!path || path.startsWith("content://")) return
  const next = [{ path, name, at: Date.now(), source: source || undefined }, ...readRecentFiles().filter(
    (item) => item.path !== path && item.path !== templatePrefix + replacedTemplateId,
  )]
  const limit = recentHistoryLimit()
  localStorage.setItem(recentFilesKey, JSON.stringify(limit ? next.slice(0, limit) : next))
  appState.recentPage = 0
  renderRecentFiles()
}

function formatRecentTime(at: number): string {
  const minute = 60_000
  const diff = Date.now() - at
  if (diff < minute) return "刚刚"
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`
  const days = Math.floor(diff / (24 * 60 * minute))
  if (days === 1) return "昨天"
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${Math.floor(days / 7)} 周前`
  return new Date(at).toLocaleDateString("zh-CN")
}

function openRecentFile(item: RecentFile): void {
  if (appState.fileOperationRunning) return
  const template = recentTemplateId(item.path)
  // 当前皮肤直接重用内存中的文档，不重新加载、不丢未保存修改。
  if (appState.archive && (template !== undefined
    ? template === appState.currentTemplateId
    : !appState.unsavedNew && item.path === appState.currentPath)) {
    canvasWrap.classList.remove("empty")
    if (mobilePortraitQuery.matches) {
      if (appState.layoutPath && (appState.selectedPath !== appState.layoutPath || appState.resourceConfigActive)) selectFile(appState.layoutPath)
      selectChoice(mode, "preview")
    }
    return
  }
  void runFileOperation("打开", async () => {
    if (template !== undefined) return newDocument(template)
    if (!(await prepareDocumentReplacement("open"))) return false
    if (!item.source || !sourceDirectoryEnabledBySettings()) return loadNativePath(item.path)
    try {
      return await loadSourceWorkspace(item.source, item.path)
    } catch {
      // 源码目录被删或被清理时退回原皮肤包，并重新生成源码目录。
      return loadNativePath(item.path)
    }
  })
}

function recentFolderLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length < 2) return ""
  const folder = parts.slice(0, -1)
  return folder.length > 2 ? `…/${folder.slice(-2).join("/")}` : folder.join("/")
}

function recentFormatLabel(path: string): string {
  return path.match(/\.(bdi|bds|bda|m?ssf|sxi)$/i)?.[0]?.toLowerCase() ?? "皮肤"
}

function recentCard(item: RecentFile): HTMLButtonElement {
  const card = document.createElement("button")
  card.type = "button"
  card.className = "ui-project-card template-card recent-card ui-skin-entry"
  card.dataset.variant = "recent"
  card.dataset.recent = item.path
  const template = recentTemplateId(item.path)
  if (template === undefined) card.title = `打开 ${item.name}\n${item.path}`
  const preview = document.createElement("span")
  preview.className = "template-preview"
  preview.ariaHidden = "true"
  const foot = document.createElement("span")
  foot.className = "template-foot"
  const nameRow = document.createElement("span")
  nameRow.className = "template-name-row"
  const name = document.createElement("span")
  name.className = "template-name"
  name.textContent = item.name
  const go = symbolSpan("arrow.right")
  go.classList.add("icon", "template-go")
  nameRow.append(name, go)
  const meta = document.createElement("span")
  meta.className = "template-meta"
  const format = document.createElement("em")
  format.textContent = template === undefined ? recentFormatLabel(item.path) : builtInProjectTemplateExtension(template)
  const time = document.createElement("span")
  time.textContent = formatRecentTime(item.at)
  meta.append(time)
  const folder = template === undefined ? recentFolderLabel(item.path) : "内置模板"
  if (folder) {
    const place = document.createElement("span")
    place.className = "recent-card-folder"
    place.textContent = `· ${folder}`
    meta.append(place)
  }
  meta.append(format)
  foot.append(nameRow, meta)
  const mobileMeta = document.createElement("span")
  mobileMeta.className = "ui-skin-entry-meta"
  const extension = format.textContent.replace(/^\./, "").toUpperCase()
  mobileMeta.textContent = `${formatRecentTime(item.at)} · ${extension}${template === undefined ? "" : " · 内置模板"}`
  foot.append(mobileMeta)
  card.append(preview, foot)
  const chevron = createIcon("chevron-right", 20)
  chevron.classList.add("ui-skin-entry-chevron")
  card.append(chevron)
  card.addEventListener("click", () => openRecentFile(item))
  return card
}

export const recentPreviewCache = new Map<string, { stamp: string; image: HTMLImageElement }>()

// 预览只取包里的 demo 图，不需要解整包；上限与后端可读的整包上限保持一致。
const recentPreviewMaxBytes = 64 * 1024 * 1024

async function readRecentPreviewBytes(path: string): Promise<Uint8Array> {
  if (!isTauri()) throw new Error("仅在桌面应用中生成本地预览")
  if (await invoke<number>("skin_file_size", { path }) > recentPreviewMaxBytes) {
    throw new Error("皮肤文件过大，暂不生成预览")
  }
  return new Uint8Array(await invoke<ArrayBuffer>("read_file", { path }))
}

function welcomeVisible(): boolean {
  return canvasWrap.classList.contains("empty")
}

export function waitForPreviewFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

// 逐个串行取图，避免同时读多份皮肤阻塞 UI。
const recentPreviewQueue: HTMLButtonElement[] = []

const recentPreviewQueued = new Set<HTMLButtonElement>()

export function recentThumbRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  appState.recentThumbDb ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("recent-previews", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("previews")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return appState.recentThumbDb.then((db) => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction("previews", mode).objectStore("previews"))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

async function renderRecentPreview(path: string, stamp: string, host: HTMLElement): Promise<HTMLImageElement> {
  const stored = await recentThumbRequest<RecentThumb | undefined>("readonly", (store) => store.get(path))
    .catch(() => undefined)
  if (stored?.stamp === stamp && stored.bytes) {
    try {
      return await renderBlobPreview(new Blob([stored.bytes], { type: stored.type }), host)
    } catch {
      // 缓存的图解码失败就当没缓存，重新从皮肤包取。
    }
  }
  const blob = await readDemoImageWithRetry(path)
  const image = await renderBlobPreview(blob, host)
  void blob.arrayBuffer()
    .then((bytes) => recentThumbRequest("readwrite", (store) => store.put({ stamp, bytes, type: blob.type } satisfies RecentThumb, path)))
    .catch(() => undefined)
  return image
}

async function readDemoImageWithRetry(path: string): Promise<Blob> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await archiveDemoImage(await readRecentPreviewBytes(path))
    } catch (error) {
      lastError = error
      // 没有 demo 图是稳定结果，重试只会把整包再读一遍。
      if (attempt || error instanceof MissingPreviewImageError) break
      await new Promise((resolve) => window.setTimeout(resolve, 120))
    }
  }
  throw lastError
}

async function drainRecentPreviews(): Promise<void> {
  if (appState.recentPreviewRunning) return
  appState.recentPreviewRunning = true
  try {
    for (;;) {
      // Let the welcome page paint between archive reads so the first interaction is immediate.
      await waitForPreviewFrame()
      const card = recentPreviewQueue.shift()
      if (!card) return
      recentPreviewQueued.delete(card)
      if (!welcomeVisible()) {
        recentPreviewQueue.length = 0
        recentPreviewQueued.clear()
        return
      }
      if (!card.isConnected) continue
      const path = card.dataset.recent
      const host = card.querySelector<HTMLElement>(".template-preview")
      // data-preview：rendered 已画好，failed 已放弃，两种都不再重画。
      if (!path || !host || host.dataset.preview) continue
      const template = recentTemplateId(path)
      try {
        let stamp = ""
        if (template === undefined) {
          const fileStamp = await invoke<number[]>("skin_file_stamp", { path })
          stamp = fileStamp.join(":")
          const meta = card.querySelector<HTMLElement>(".ui-skin-entry-meta")
          if (meta) meta.textContent += ` · ${(fileStamp[0] / 1024 / 1024).toFixed(1)} MB`
        }
        const cached = recentPreviewCache.get(path)
        if (cached?.stamp === stamp) {
          host.replaceChildren(cached.image.cloneNode(true))
          host.dataset.preview = "rendered"
          continue
        }
        if (cached) releaseArchivePreview(cached.image)
        const image = template === undefined
          ? await renderRecentPreview(path, stamp, host)
          : await renderBuiltInTemplatePreview(template, host)
        if (!image) continue
        if (readRecentFiles().some((item) => item.path === path)) recentPreviewCache.set(path, { stamp, image })
        else releaseArchivePreview(image)
      } catch {
        showMissingPreview(host)
      }
    }
  } finally {
    appState.recentPreviewRunning = false
    if (recentPreviewQueue.length && welcomeVisible()) void drainRecentPreviews()
  }
}

function queueRecentPreview(card: HTMLButtonElement): void {
  if (recentPreviewQueued.has(card)) return
  recentPreviewQueued.add(card)
  recentPreviewQueue.push(card)
  void drainRecentPreviews()
}

const recentPreviewObserver = welcomeScroller && "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      recentPreviewObserver?.unobserve(entry.target)
      queueRecentPreview(entry.target as HTMLButtonElement)
    }
  }, { root: welcomeScroller, rootMargin: "240px 0px" })
  : undefined

function observeRecentPreviews(): void {
  if (!welcomeVisible()) return
  recentPreviewObserver?.disconnect()
  const pending = [...document.querySelectorAll<HTMLButtonElement>(".recent-card[data-recent]")].filter((card) => {
    const host = card.querySelector<HTMLElement>(".template-preview")
    return Boolean(host) && !host!.dataset.preview
  })
  for (const card of pending) {
    if (recentPreviewObserver) recentPreviewObserver.observe(card)
    else queueRecentPreview(card)
  }
}

function renderRecentPage(items: RecentFile[]): void {
  recentPreviewObserver?.disconnect()
  recentPreviewQueue.length = 0
  recentPreviewQueued.clear()
  const { recentPageSize } = appState
  const pageCount = Math.ceil(items.length / recentPageSize)
  appState.recentPage = Math.min(appState.recentPage, Math.max(0, pageCount - 1))
  const index = appState.recentPage
  const start = index * recentPageSize
  const cards = items.slice(start, start + recentPageSize).map((item, position) => {
    const card = recentCard(item)
    card.role = "option"
    card.ariaSelected = "false"
    card.tabIndex = position === 0 ? 0 : -1
    return card
  })
  $("#welcome-recent-grid").replaceChildren(...cards)
  $("#recent-viewport").hidden = !items.length
  $("#welcome-recent-empty").hidden = Boolean(items.length)
  $("#recent-clear").hidden = !items.length
  $("#welcome-recent-hint").textContent = items.length ? `${items.length} 条` : ""
  $("#recent-pagination").hidden = pageCount <= 1
  $("#recent-page-number").textContent = pageCount > 1 ? `${index + 1} / ${pageCount}` : ""
  $("#recent-prev").toggleAttribute("disabled", index === 0)
  $("#recent-next").toggleAttribute("disabled", index + 1 >= pageCount)
}

export function wireRecentPage(): void {
  $<HTMLInputElement>("#recent-history-limit").value = String(recentHistoryLimit())
  const grid = $("#welcome-recent-grid")
  bindListboxKeys(grid, (option) => {
    for (const card of grid.querySelectorAll<HTMLElement>('[role="option"]')) {
      card.ariaSelected = String(card === option)
      card.tabIndex = card === option ? 0 : -1
    }
    option.focus()
  })
  const previous = $<HTMLButtonElement>("#recent-prev")
  const next = $<HTMLButtonElement>("#recent-next")
  const turnPage = (direction: -1 | 1, button: HTMLButtonElement, fallback: HTMLButtonElement) => {
    appState.recentPage += direction
    const focused = document.activeElement === button
    renderRecentPage(readRecentFiles())
    if (focused && button.disabled) fallback.focus({ preventScroll: true })
    playPageSlide(grid, direction)
    observeRecentPreviews()
  }
  previous.addEventListener("click", () => turnPage(-1, previous, next))
  next.addEventListener("click", () => turnPage(1, next, previous))
  new ResizeObserver(([entry]) => {
    if (!entry?.contentRect.width) return
    const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length
    const size = mobilePortraitQuery.matches ? mobileRecentPageSize : columns * desktopRecentRows
    if (size === appState.recentPageSize) return
    const focused = document.activeElement
    const cards = [...grid.querySelectorAll<HTMLButtonElement>(".recent-card")]
    const focusedIndex = cards.findIndex((card) => card === focused)
    const offset = appState.recentPage * appState.recentPageSize + Math.max(0, focusedIndex)
    const items = readRecentFiles()
    appState.recentPageSize = size
    appState.recentPage = Math.floor(offset / size)
    renderRecentPage(items)
    const current = grid.querySelectorAll<HTMLButtonElement>(".recent-card")
    const focusedButton = [previous, next].find((button) => button === focused)
    if (focusedIndex >= 0) {
      const card = current[offset % size]
      if (card) {
        current[0]!.tabIndex = -1
        card.tabIndex = 0
        card.ariaSelected = cards[focusedIndex]!.ariaSelected
        card.focus({ preventScroll: true })
      }
    } else if (focusedButton?.disabled) {
      const alternate = focusedButton === previous ? next : previous
      const fallback = alternate.disabled ? current[0] : alternate
      fallback?.focus({ preventScroll: true })
    }
    observeRecentPreviews()
  }).observe(grid)
}

export function renderRecentFiles(): void {
  const limit = recentHistoryLimit()
  const saved = readRecentFiles()
  const items = limit && saved.length > limit ? saved.slice(0, limit) : saved
  if (items !== saved) localStorage.setItem(recentFilesKey, JSON.stringify(items))
  renderRecentPage(items)
  // 预览图按路径缓存，这里裁掉已不在列表里的条目并释放它们占用的 blob URL
  const listed = new Set(items.map((item) => item.path))
  for (const [path, cached] of [...recentPreviewCache]) {
    if (listed.has(path)) continue
    releaseArchivePreview(cached.image)
    recentPreviewCache.delete(path)
  }
  void recentThumbRequest("readonly", (store) => store.getAllKeys())
    .then((keys) => Promise.all(keys.filter((key) => !listed.has(String(key)))
      .map((key) => recentThumbRequest("readwrite", (store) => store.delete(key)))))
    .catch(() => undefined)
  if (items.length) observeRecentPreviews()
}
