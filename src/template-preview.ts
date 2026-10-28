import { builtInProjectTemplatePreviewURL, loadBuiltInProjectTemplate } from "./operations.ts"
import { SkinArchive } from "./skin.ts"
import { readArchiveEntry } from "./skin-zip.ts"

const SXI_PREVIEW_PATH = "preview.png"

/**
 * 皮肤包里的效果预览图。各平台位置不同（`demo.png` / `skin/demo.png` /
 * `dark/skin/demo.png`），所以只按文件名匹配，跳过 macOS 资源分叉。
 */
function isDemoImagePath(name: string): boolean {
  const segments = name.split("/")
  if (segments.some((segment) => segment === "__MACOSX" || segment.startsWith("._"))) return false
  // Sogou skins keep their preview as square_preview.png next to phoneTheme.ini.
  return segments[segments.length - 1]?.toLowerCase() === "demo.png" || name.toLowerCase() === "square_preview.png"
}

function demoImageType(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg"
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif"
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp"
  return "image/png"
}

function yieldPreviewTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function previewCards(root: ParentNode): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>(".template-card[data-template]")]
}

/**
 * 只抽 demo 图：先按本地文件头就地取（不解整包），大小写在数据描述符里的包
 * 才退回整包解压。
 */
async function demoImageBytes(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  // 手心 .sxi 的总预览图是包根的 preview.png，优先于各外观下的 demo 图。
  const entry = readArchiveEntry(bytes, (name) => name === SXI_PREVIEW_PATH) ?? readArchiveEntry(bytes, isDemoImagePath)
  if (entry) return entry.data
  const archive = await SkinArchive.openAsync(bytes)
  const path = archive.names()
    .filter(isDemoImagePath)
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0]
  return archive.getBytes(SXI_PREVIEW_PATH) ?? (path ? archive.getBytes(path) : undefined)
}

/** 包内没有 demo 预览图。这是稳定结果，调用方不必重试。 */
export class MissingPreviewImageError extends Error {
  override name = "MissingPreviewImageError"
}

function previewImageElement(src: string, objectUrl?: string): HTMLImageElement {
  const image = document.createElement("img")
  image.alt = ""
  image.decoding = "async"
  if (objectUrl) image.dataset.objectUrl = objectUrl
  image.src = src
  return image
}

async function showPreviewImage(host: HTMLElement, image: HTMLImageElement): Promise<HTMLImageElement> {
  try {
    await image.decode()
  } catch (error) {
    releaseArchivePreview(image)
    throw error
  }
  host.replaceChildren(image)
  host.classList.add("is-rendered")
  return image
}

export async function archiveDemoImage(bytes: Uint8Array): Promise<Blob> {
  const demo = await demoImageBytes(bytes)
  if (!demo) throw new MissingPreviewImageError("皮肤包内没有 demo 预览图")
  return new Blob([demo.slice() as BlobPart], { type: demoImageType(demo) })
}

async function renderArchivePreview(bytes: Uint8Array, host: HTMLElement): Promise<HTMLImageElement> {
  return renderBlobPreview(await archiveDemoImage(bytes), host)
}

export function renderBlobPreview(blob: Blob, host: HTMLElement): Promise<HTMLImageElement> {
  const objectURL = URL.createObjectURL(blob)
  return showPreviewImage(host, previewImageElement(objectURL, objectURL))
}

/** 释放预览图的 blob URL：预览元素被替换或缓存淘汰时必须调用。 */
export function releaseArchivePreview(image: HTMLImageElement): void {
  const url = image.dataset.objectUrl
  if (!url) return
  URL.revokeObjectURL(url)
  delete image.dataset.objectUrl
}

/** 内置模板包内没有 demo 图时的兜底：随应用发布的静态预览图。 */
async function renderStaticTemplatePreview(id: string, host: HTMLElement): Promise<void> {
  const url = builtInProjectTemplatePreviewURL(id)
  if (!url) throw new MissingPreviewImageError("该模板没有静态预览图")
  await showPreviewImage(host, previewImageElement(url))
}

async function renderTemplatePreview(id: string, host: HTMLElement): Promise<void> {
  // Static previews are already shipped with the app; do not unzip the matching template first.
  const staticURL = builtInProjectTemplatePreviewURL(id)
  if (staticURL) {
    await showPreviewImage(host, previewImageElement(staticURL))
    return
  }
  try {
    await renderArchivePreview(await loadBuiltInProjectTemplate(id), host)
  } catch {
    await renderStaticTemplatePreview(id, host)
  }
}

export async function hydrateTemplateCardPreviews(
  root: ParentNode = document,
  options: { lazy?: boolean } = {},
): Promise<void> {
  const cards = previewCards(root)
  if (options.lazy && cards.length && "IntersectionObserver" in window) {
    const scrollRoot = root instanceof Element ? root.closest<HTMLElement>(".welcome-main") : null
    const pending = new Set(cards)
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const card = entry.target as HTMLButtonElement
        if (!pending.delete(card)) continue
        observer.unobserve(card)
        void hydrateTemplateCard(card)
      }
    }, { root: scrollRoot, rootMargin: "240px 0px" })
    for (const card of cards) observer.observe(card)
    return
  }
  for (const card of cards) {
    await hydrateTemplateCard(card)
  }
}

async function hydrateTemplateCard(card: HTMLButtonElement): Promise<void> {
  const id = card.dataset.template
  const host = card.querySelector<HTMLElement>(".template-preview")
  if (!id || !host || host.classList.contains("is-rendered")) return
  await yieldPreviewTask()
  try {
    await renderTemplatePreview(id, host)
  } catch (error) {
    if (error instanceof MissingPreviewImageError) {
      host.textContent = "暂无预览图"
      return
    }
    await yieldPreviewTask()
    try {
      await renderTemplatePreview(id, host)
    } catch {
      host.textContent = "暂无预览图"
    }
  }
}
