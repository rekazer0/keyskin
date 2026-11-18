// 导出计划：哪些文件重建、哪些原样保留、哪些明确丢弃。
//
// IR 只建模了皮肤的一部分（布局、样式、动效、图片）。导出时如果只写建模部分，
// 音效、字体、原生配置这些没有建模的文件就会丢。所以每次导出都先算一份计划：
// 重建的文件覆盖同名路径，其余原样带上，只有确实冲突的才丢弃并报告。
import type { SkinArchive } from "@/skin.ts"

export type ExportFile = { path: string; data: Uint8Array }

export type ExportPlan = {
  /** 重建出来的文件，路径到内容。 */
  rebuilt: ReadonlyMap<string, Uint8Array>
  /** 从原包原样带上的文件。 */
  kept: readonly string[]
  /** 被重建覆盖、因而没有沿用原内容的文件。 */
  replaced: readonly string[]
  /** 明确不带的文件及原因。 */
  dropped: ReadonlyArray<{ path: string; reason: string }>
  /** 最终要写进包里的文件，按路径排序。 */
  files: readonly ExportFile[]
}

export type PlanOptions = {
  /** 这些前缀下的未建模文件一律保留，通常是资源目录。 */
  keepPrefixes?: readonly string[]
  /** 明确要丢掉的路径或前缀，例如已被图集取代的散图。 */
  dropPrefixes?: readonly string[]
  /** 按路径判断是否丢弃，优先于前缀规则。 */
  dropPath?: (path: string) => boolean
  /** 额外需要保留的路径判断。 */
  keepPath?: (path: string) => boolean
}

/** 资源目录：音效、字体、贴图都属于这类，未建模时应当保留。 */
const RESOURCE_PATTERN = /(?:^|\/)(?:res|sound|sounds|font|fonts|images?)\//i

function isResource(path: string): boolean {
  return RESOURCE_PATTERN.test(path)
}

/**
 * 生成导出计划。
 * `source` 为空表示从零重建（跨格式转换），此时没有可保留的文件。
 */
export function planExport(
  source: SkinArchive | undefined,
  rebuilt: ReadonlyMap<string, Uint8Array>,
  options: PlanOptions = {},
): ExportPlan {
  const kept: string[] = []
  const replaced: string[] = []
  const dropped: Array<{ path: string; reason: string }> = []
  const files = new Map<string, Uint8Array>([...rebuilt])

  const dropPrefixes = options.dropPrefixes ?? []
  const keepPrefixes = options.keepPrefixes ?? []

  for (const path of source?.names() ?? []) {
    if (rebuilt.has(path)) {
      replaced.push(path)
      continue
    }
    if (options.dropPath?.(path) === true) {
      dropped.push({ path, reason: "已被重建内容取代" })
      continue
    }
    if (dropPrefixes.some((prefix) => path.startsWith(prefix))) {
      dropped.push({ path, reason: "路径按规则丢弃" })
      continue
    }
    const keep = keepPrefixes.some((prefix) => path.startsWith(prefix))
      || isResource(path)
      || options.keepPath?.(path) === true
    if (!keep) {
      dropped.push({ path, reason: "未建模且不属于资源目录" })
      continue
    }
    const data = source?.getBytes(path)
    if (!data) {
      dropped.push({ path, reason: "读不出内容" })
      continue
    }
    files.set(path, data)
    kept.push(path)
  }

  return {
    rebuilt,
    kept,
    replaced,
    dropped,
    files: [...files].sort((left, right) => left[0].localeCompare(right[0])).map(([path, data]) => ({ path, data })),
  }
}

/** 计划的一句话摘要，供导出前展示。 */
export function describePlan(plan: ExportPlan): string {
  const parts = [`重建 ${plan.rebuilt.size} 个文件`]
  if (plan.kept.length) parts.push(`保留 ${plan.kept.length} 个原文件`)
  if (plan.replaced.length) parts.push(`覆盖 ${plan.replaced.length} 个`)
  if (plan.dropped.length) parts.push(`丢弃 ${plan.dropped.length} 个`)
  return parts.join("，")
}
