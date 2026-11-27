/** Keep diagnostic context without exposing credentials or private system locations. */
export function operationLogText(text: string): string {
  return text
    .replace(/(\b(?:authorization|(?:set[-_]?)?cookie)["']?[ \t]*:[ \t]*)[^\r\n]+/gi, "$1[credential]")
    .replace(/\bBearer[ \t]+[\w.=/+~-]+/gi, "[credential]")
    .replace(/(\b(?:password|passphrase|(?:access[-_]?|refresh[-_]?)?token|secret|(?:api|private)[-_ ]?key|pair[-_ ]?code|(?:system|developer)[-_ ]?prompt)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi, "$1[credential]")
    .replace(/\b(?:file|content):\/\/[^\s"'<>]+/gi, "[private URI]")
    .replace(/\bhttps?:\/\/[^/\s)'"<>]+/gi, "[origin]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[address]")
    .replace(/(^|[\s("'=])(?:[A-Z]:[\\/]|\/(?:Users|home|private|var|tmp|mnt|data|storage|sdcard)\/)[^\r\n"'<>]+/gi, "$1[private path]")
}

/** Why an operation failed, in the user's words; the failure dialog's title already names the action. */
export function operationErrorDetail(error: unknown): string {
  if (error instanceof Error || error instanceof DOMException) return operationLogText(error.message)
  if (typeof error === "string" && error.trim()) return operationLogText(error)
  return "未知错误"
}

/** Preserve the exception as received, for the local operation log rather than its summary. */
export function operationErrorLog(error: unknown): string {
  const seen = new Set<Error | DOMException>()
  const format = (value: unknown): string => {
    if (value instanceof Error || value instanceof DOMException) {
      const header = value.toString()
      if (seen.has(value)) return `${header}（已记录）`
      seen.add(value)
      const stack = value.stack
      const trace = stack?.startsWith(header) ? stack : [header, stack].filter(Boolean).join("\n")
      const errors = value instanceof AggregateError ? value.errors.map(format) : []
      return [trace, ...errors, ...("cause" in value ? [`Caused by: ${format(value.cause)}`] : [])].join("\n")
    }
    if (typeof value === "function") return "[函数异常值]"
    if (value === null || typeof value !== "object") return String(value)
    // Structured rejections may also include request/configuration payloads; only show error fields.
    const fields = Object.entries(Object.getOwnPropertyDescriptors(value))
      .filter(([key, field]) => ["name", "code", "message", "stack"].includes(key) && ["string", "number"].includes(typeof field.value))
      .map(([key, field]) => `${key}: ${field.value}`)
    return fields.join("\n") || "[未提供错误字段的异常对象]"
  }
  try { return operationLogText(format(error)) }
  catch { return "[无法读取原始异常]" }
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
