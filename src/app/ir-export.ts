// 应用侧的 IR 导出：把一个皮肤包经中间表示写成另一种格式。
//
// 这里只负责「拿到当前文档 + 目标格式 → 字节」，格式细节在 `src/skin-model` 里。
// 旧的分支树按「源格式 × 目标格式」逐对写转换，接了 IR 之后只剩这一条路径。
import type { ExportFormat } from "@/export.ts"
import { SkinArchive } from "@/skin.ts"
import { convertBdaPlatform, type BdaPlatform } from "@/bda-platform.ts"
import { completeBdsPackage } from "@/bds-package.ts"
import { bakeExportedFonts } from "@/app/font-bake-export.ts"
import { composeAtlasPng } from "@/app/file-operations.ts"
import type { LossReport } from "@/skin-model/capability.ts"
import { describeLoss, formatIdOf } from "@/skin-model/convert.ts"
import { openSession, saveSession, type SkinHints } from "@/skin-model/session.ts"
import { isExportable, summarize, validateModel } from "@/skin-model/validate.ts"

export type PackagedBytes = { bytes: Uint8Array; converted: boolean; warnings: string[] }

export type IrExportOptions = {
  hints: SkinHints
  /** 源文档的格式；与原包一致时不算转换。 */
  sourceFormat: ExportFormat
  /** BDA 的目标平台：iOS 与 Android 的美术尺寸不同，打包后要再转一次。 */
  bdaPlatform?: Exclude<BdaPlatform, "unknown">
  /** 进度回调，取值 0–1。 */
  onProgress?: (fraction: number, detail?: string) => void | Promise<void>
}

export type IrExportResult = PackagedBytes & {
  /** 目标格式表达不了的能力；非空时由调用方决定是否提示。 */
  loss: LossReport
}

/**
 * 用 IR 导出。失败时抛出错误，由调用方决定提示方式。
 * 自检不通过直接拦下：带悬空引用导出会在输入法里变成空白块。
 */
export async function exportViaIr(archive: SkinArchive, format: ExportFormat, options: IrExportOptions): Promise<IrExportResult> {
  await options.onProgress?.(0.05, "正在读取皮肤…")
  const opened = await openSession(archive, options.hints)
  if (!opened.ok) throw new Error(opened.error.message)

  const report = validateModel(opened.model)
  if (!isExportable(report)) throw new Error(`${summarize(report)}；请先修复后再导出`)

  const target = formatIdOf(format)
  await options.onProgress?.(0.35, `正在写出 ${format.toUpperCase()}…`)
  const saved = await saveSession(opened.model, target, opened.source)
  if (!saved.ok) throw new Error(saved.error.message)

  let bytes = saved.bytes
  if (format === "bds") {
    await options.onProgress?.(0.7, "正在适配 BDS 图片…")
    bytes = await finishBds(bytes)
  }
  if (format === "bda" && options.bdaPlatform) {
    await options.onProgress?.(0.85, "正在生成目标平台的 BDA…")
    bytes = await convertBdaPlatform(SkinArchive.open(bytes, "bda"), options.bdaPlatform).toBytesAsync()
  }
  await options.onProgress?.(1, "完成")
  return {
    bytes,
    converted: options.sourceFormat !== format,
    warnings: describeLoss(saved.loss),
    loss: saved.loss,
  }
}

/** BDS 的多分辨率图集与字体烘焙，沿用既有实现，不在这里重写。 */
async function finishBds(bytes: Uint8Array): Promise<Uint8Array> {
  const archive = SkinArchive.open(bytes, "bds")
  await bakeExportedFonts(archive)
  await completeBdsPackage(archive, composeAtlasPng)
  return archive.toBytesAsync("bds")
}

/** 这次导出会不会降级内容；空数组表示无损。 */
export function downgradeWarnings(result: IrExportResult): string[] {
  return result.warnings
}

/**
 * 是否需要走 IR：源格式与目标格式不同就算跨格式。
 * BDI 与 BDS 是同一套容器，不算跨格式。
 */
export function isCrossFormatExport(source: ExportFormat, target: ExportFormat): boolean {
  if (source === target) return false
  if (source === "bdi" && target === "bds" || source === "bds" && target === "bdi") return false
  return true
}
