/** Why an operation failed, in the user's words; the failure dialog's title already names the action. */
export function operationErrorDetail(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string" && error.trim()
      ? error
      : "未知错误"
}

export function operationError(action: string, error: unknown): string {
  return `${action}失败：${operationErrorDetail(error)}`
}

type ProjectTemplateFetcher = (
  path: string,
) => Promise<{ readonly ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>

function fetchPublicAsset(path: string): ReturnType<typeof fetch> {
  return fetch(new URL(path.replace(/^\//, ""), document.baseURI))
}

const builtInProjectTemplatePaths: Record<string, string> = {
  "default-android": "/default-template.bda",
  "official-android-bds": "/default-template.bds",
  "official-sogou": "/sogou-template.bds",
  "oppo-swipe-down": "/templates/oppo-swipe-down.bds",
  "oppo-dual-color": "/templates/oppo-dual-color.bds",
  "iqoo-rounded-black": "/templates/iqoo-rounded-black.bds",
  "xiaomi-unified-rounded-blur": "/templates/xiaomi-unified-rounded-blur.bds",
  "huawei-swipe-symbols-1080": "/templates/huawei-swipe-symbols-1080.bds",
  "palm-harmony": "/templates/palm-harmony.sxi",
}

/**
 * 包内没有 demo 图的内置模板，用随应用发布的静态预览图兜底。图片是用同一套预览
 * 逻辑离线导出的，运行时只当普通图片加载，不再实时渲染。
 */
const builtInProjectTemplatePreviewPaths: Record<string, string> = {
  "default-android": "/templates/default-android.png",
  "official-android-bds": "/templates/official-android-bds.png",
}

export function builtInProjectTemplatePreviewURL(id: string): string | undefined {
  const path = builtInProjectTemplatePreviewPaths[id]
  return path ? new URL(path.replace(/^\//, ""), document.baseURI).href : undefined
}

/** 内置模板的文件扩展名（含点），新建时用作默认文件名后缀。 */
export function builtInProjectTemplateExtension(id: string): string {
  return builtInProjectTemplatePaths[id]?.match(/\.\w+$/)?.[0] ?? ".bds"
}

export async function loadBuiltInProjectTemplate(
  id: string,
  fetcher: ProjectTemplateFetcher = fetchPublicAsset,
): Promise<Uint8Array> {
  const path = builtInProjectTemplatePaths[id]
  if (!path) throw new Error(`未知的内置项目模板：${id}`)
  const response = await fetcher(path)
  if (!response.ok) throw new Error("无法加载内置默认皮肤模板")
  return new Uint8Array(await response.arrayBuffer())
}

/** The official BDA skin's INI layout skeleton (1080 × 641 portrait), the base BDI/BDS conversion lays on. */
export async function loadBdaBase(fetcher: ProjectTemplateFetcher = fetchPublicAsset): Promise<Uint8Array> {
  const response = await fetcher("/bda-base.bds")
  if (!response.ok) throw new Error("无法加载 BDA 官方基础布局")
  return new Uint8Array(await response.arrayBuffer())
}
