import { type RecentFile, type RecentThumb } from "./types"
import { appState } from "./state"
import { runFileOperation } from "./file-operations"
import { prepareDocumentReplacement } from "./edit-history"
import { loadNativePath, loadSourceWorkspace } from "./archive-io"
import { symbolSpan } from "../icons"
import { isTauri, sourceDirectoryEnabledBySettings } from "./canvas-interaction"
import { invoke } from "@tauri-apps/api/core"
import { canvasWrap, welcomeScroller, $ } from "./dom"
import { renderBlobPreview, archiveDemoImage, MissingPreviewImageError, releaseArchivePreview } from "../template-preview"

export const recentFilesKey = "recent-files"

export const recentFilesLimit = 9

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
    ).slice(0, recentFilesLimit)
  } catch {
    return []
  }
}

export function recordRecentFile(path: string, name: string, source = ""): void {
  if (!path || path.startsWith("content://")) return
  const next = [{ path, name, at: Date.now(), source: source || undefined }, ...readRecentFiles().filter((item) => item.path !== path)]
    .slice(0, recentFilesLimit)
  localStorage.setItem(recentFilesKey, JSON.stringify(next))
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
  // 从菜单回到启动页后再点当前皮肤，直接回到编辑，不重新读盘、不丢未保存修改。
  if (appState.archive && !appState.unsavedNew && item.path === appState.currentPath) {
    canvasWrap.classList.remove("empty")
    return
  }
  void runFileOperation("打开", async () => {
    if (!(await prepareDocumentReplacement())) return false
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
  card.className = "template-card recent-card"
  card.dataset.recent = item.path
  card.title = `打开 ${item.name}\n${item.path}`
  const preview = document.createElement("span")
  preview.className = "template-preview"
  preview.ariaHidden = "true"
  preview.textContent = "正在加载预览…"
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
  format.textContent = recentFormatLabel(item.path)
  const time = document.createElement("span")
  time.textContent = formatRecentTime(item.at)
  meta.append(format, time)
  const folder = recentFolderLabel(item.path)
  if (folder) {
    const place = document.createElement("span")
    place.className = "recent-card-folder"
    place.textContent = `· ${folder}`
    meta.append(place)
  }
  foot.append(nameRow, meta)
  card.append(preview, foot)
  card.addEventListener("click", () => openRecentFile(item))
  return card
}

export const recentPreviewCache = new Map<string, HTMLImageElement>()

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

// 最近皮肤最多 9 张，逐个串行取图，避免同时读多份皮肤阻塞 UI。
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

async function renderRecentPreview(path: string, host: HTMLElement): Promise<HTMLImageElement> {
  const stamp = (await invoke<number[]>("skin_file_stamp", { path })).join(":")
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
      if (!path || !host || host.classList.contains("is-rendered") || host.dataset.preview === "failed") continue
      const cached = recentPreviewCache.get(path)
      if (cached) {
        host.replaceChildren(cached)
        host.classList.add("is-rendered")
        continue
      }
      try {
        const image = await renderRecentPreview(path, host)
        if (readRecentFiles().some((item) => item.path === path)) recentPreviewCache.set(path, image)
      } catch {
        host.dataset.preview = "failed"
        host.classList.remove("is-rendered")
        host.textContent = "暂无预览图"
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
    return Boolean(host) && !host!.classList.contains("is-rendered") && host!.dataset.preview !== "failed"
  })
  for (const card of pending) {
    if (recentPreviewObserver) recentPreviewObserver.observe(card)
    else queueRecentPreview(card)
  }
}

export function renderRecentFiles(): void {
  const clear = $("#recent-clear")
  recentPreviewObserver?.disconnect()
  recentPreviewQueue.length = 0
  recentPreviewQueued.clear()
  const items = readRecentFiles()
  clear?.toggleAttribute("hidden", items.length === 0)
  const grid = $("#welcome-recent-grid")
  const gridEmpty = $("#welcome-recent-empty")
  const hint = $("#welcome-recent-hint")
  grid?.replaceChildren(...items.map(recentCard))
  grid?.toggleAttribute("hidden", items.length === 0)
  if (gridEmpty) gridEmpty.hidden = items.length > 0
  if (hint) hint.textContent = items.length ? `${items.length} 个文件` : "还没有记录"
  // 预览图按路径缓存，这里裁掉已不在列表里的条目并释放它们占用的 blob URL
  const listed = new Set(items.map((item) => item.path))
  for (const [path, image] of [...recentPreviewCache]) {
    if (listed.has(path)) continue
    releaseArchivePreview(image)
    recentPreviewCache.delete(path)
  }
  void recentThumbRequest("readonly", (store) => store.getAllKeys())
    .then((keys) => Promise.all(keys.filter((key) => !listed.has(String(key)))
      .map((key) => recentThumbRequest("readwrite", (store) => store.delete(key)))))
    .catch(() => undefined)
  if (items.length) observeRecentPreviews()
}
