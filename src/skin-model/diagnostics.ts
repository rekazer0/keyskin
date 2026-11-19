// 包的诊断：这个包里有哪些文件、各自被认成了什么、哪些认不出来。
//
// 识别结果以前只活在 read 的调用栈里，读完就没了；这里让它变成可以展示的数据。
// 它不改写包、不构造模型，只回答「这个包我读懂了多少」。
import type { SkinArchive } from "@/skin.ts"
import { identifyBda } from "@/skin-model/formats/bda/pipeline.ts"
import { identifyBds } from "@/skin-model/formats/bds/identify.ts"
import { identifySsf } from "@/skin-model/formats/ssf/pipeline.ts"
import { identifySxi } from "@/skin-model/formats/sxi/pipeline.ts"
import type { SkinFormatId } from "@/skin-model/formats/index.ts"
import { packageOf, roleCounts, unknownFiles, type FileRole, type SkinStructure } from "@/skin-model/pipeline.ts"
import type { Theme, Orientation } from "@/skin-model/types.ts"

export type SkinDiagnostics = {
  format: SkinFormatId
  /** 包里的文件总数。 */
  files: number
  /** 各类角色的文件数，按数量降序。 */
  roles: Array<{ kind: FileRole["kind"]; count: number }>
  /** 认不出来的文件；空数组表示整包都认得出。 */
  unknown: Array<{ path: string; reason: string }>
  themes: Theme[]
  orientations: Orientation[]
}

/** 按格式取识别产物。调用方只需要格式 id，不必知道各格式的识别器。 */
export function structureOf(archive: SkinArchive, format: SkinFormatId): SkinStructure {
  const pkg = packageOf(archive, format)
  if (format === "bds") return identifyBds(pkg)
  if (format === "bda") return identifyBda(pkg)
  if (format === "ssf") return identifySsf(pkg)
  return identifySxi(pkg)
}

/** 诊断一个包：识别一遍，把角色分布与认不出来的文件整理成可展示的形状。 */
export function diagnose(archive: SkinArchive, format: SkinFormatId): SkinDiagnostics {
  const structure = structureOf(archive, format)
  return {
    format,
    files: structure.roles.size,
    roles: [...roleCounts(structure)]
      .map(([kind, count]) => ({ kind, count }))
      .sort((left, right) => right.count - left.count),
    unknown: unknownFiles(structure),
    themes: [...structure.themes],
    orientations: [...structure.orientations],
  }
}

/** 一行摘要，给状态栏或日志用。 */
export function describeDiagnostics(diagnostics: SkinDiagnostics): string {
  const parts = [`${diagnostics.format.toUpperCase()} ${diagnostics.files} 个文件`]
  const covered = diagnostics.files - diagnostics.unknown.length
  parts.push(`已识别 ${covered}`)
  if (diagnostics.unknown.length) parts.push(`未识别 ${diagnostics.unknown.length}`)
  return parts.join(" · ")
}
