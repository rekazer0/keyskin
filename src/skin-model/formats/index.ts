// 格式注册表：按内容识别皮肤格式，并用驱动器统一完成导入与导出。
//
// 这里只做三件事：探测格式、把归档交给对应格式的 open、把结果交给驱动器。
// 格式自己不再有 read/write——读写都是驱动器的动作。
import { SkinArchive } from "@/skin.ts"
import { lossOf, requiredCapabilities, type Capability, type CapabilityLevel, type LossReport } from "@/skin-model/capability.ts"
import { bdaFormat, type BdaSource } from "@/skin-model/formats/bda.ts"
import { bdsFormat, type BdsSource } from "@/skin-model/formats/bds.ts"
import { ssfFormat, type SsfSource } from "@/skin-model/formats/ssf.ts"
import { sxiFormat, type SxiSource } from "@/skin-model/formats/sxi.ts"
import type { ImportOptions, OpenContext, SkinFormat } from "@/skin-model/format.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import { exportSkin, importArchive } from "@/skin-model/pipeline.ts"

export type { OpenContext } from "@/skin-model/format.ts"

export type SkinFormatId = "bds" | "bda" | "ssf" | "sxi"

/** 各格式的原生数据；只在格式实现与这里之间流动。 */
export type NativeSkin = BdsSource | BdaSource | SsfSource | SxiSource

/**
 * 四个格式收在同一种形态里。
 * 断言成立：每个格式的 T 都是 NativeSkin 的分支，open 只会返回自己那支。
 */
const FORMATS: Record<SkinFormatId, SkinFormat<NativeSkin>> = {
  bds: bdsFormat as SkinFormat<NativeSkin>,
  bda: bdaFormat as SkinFormat<NativeSkin>,
  ssf: ssfFormat as SkinFormat<NativeSkin>,
  sxi: sxiFormat as SkinFormat<NativeSkin>,
}

/**
 * 原生数据里的包。
 * 三个格式自己带着归档；搜狗与手心只有文件表，现场装一个。
 * 这是格式与驱动器之间唯一的形状知识，集中在这里。
 */
function archiveOfNative(source: NativeSkin): SkinArchive {
  if ("archive" in source && source.archive) return source.archive
  if ("files" in source) {
    return SkinArchive.fromSourceFiles([...source.files].map(([path, data]) => ({ path, data })))
  }
  throw new Error("原生数据里没有包，无法拆包")
}

export const SKIN_FORMATS: ReadonlyArray<SkinFormatId> = ["bds", "bda", "ssf", "sxi"]

/** 按归档内容判断格式：手心看 `skin.json`，BDA 看外观配置，搜狗看主题 INI，其余按百度归档处理。 */
export function detectFormat(archive: SkinArchive): SkinFormatId | undefined {
  const names = archive.names()
  if (names.includes("skin.json")) return "sxi"
  if (names.some((name) => /phoneTheme\.ini$/i.test(name))) return "ssf"
  if (names.some((name) => /appearanceConfig$/.test(name))) return "bda"
  if (names.some((name) => /\/(?:port|land)\/[^/]+\.ini$/i.test(name))) return "bds"
  return
}

export type OpenSkinOptions = ImportOptions & OpenContext & {
  /** 指定格式时跳过探测，用于内容特征不明显的包。 */
  format?: SkinFormatId
}

export type OpenedSkin = {
  format: SkinFormatId
  model: SkinModel
  source: NativeSkin
}

/**
 * 打开一个皮肤包：探测格式、取原生数据、交给驱动器读成 IR。
 * 探测不到或缺少必需输入时返回 undefined，由调用方决定提示方式。
 */
export async function openSkin(archive: SkinArchive, options: OpenSkinOptions = {}): Promise<OpenedSkin | undefined> {
  const format = options.format ?? detectFormat(archive)
  if (!format) return
  const entry = FORMATS[format]
  const source = entry.open(archive, {
    ...(options.skeleton ? { skeleton: options.skeleton } : {}),
    ...(options.base ? { base: options.base } : {}),
  })
  if (!source) return
  const model = await importArchive(archiveOfNative(source), format, entry.importer(source, options))
  return { format, model, source }
}

export type WrittenSkin = {
  format: SkinFormatId
  source: NativeSkin
  /** 目标格式的能力相对模型需求的损失；空数组表示无损。 */
  loss: LossReport
}

/**
 * 把 IR 写成目标格式。
 * 损失报告只说明目标格式缺少哪些能力，不改变写出的内容。
 */
export async function writeSkin(model: SkinModel, format: SkinFormatId): Promise<WrittenSkin> {
  const entry = FORMATS[format]
  const source = await exportSkin(model, entry.exporter)
  return { format, source, loss: lossOf(model, entry.capabilities) }
}

/** 目标格式能不能完整表达这个模型，用于导出前的提示。 */
export function canExpress(model: SkinModel, format: SkinFormatId): boolean {
  return lossOf(model, FORMATS[format].capabilities).items.length === 0
}

/** 模型自身需要的能力集合，供界面展示「这个皮肤用到了什么」。 */
export function needsOf(model: SkinModel): ReadonlyMap<Capability, CapabilityLevel> {
  return requiredCapabilities(model)
}
