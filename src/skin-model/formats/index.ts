// 格式注册表：按内容识别皮肤格式，统一提供导入与导出入口。
//
// 各格式的转换器只认自己的原生数据；调用方不该知道这些类型，只在这里进出。
import type { SkinArchive } from "@/skin.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import { lossOf, requiredCapabilities, type LossReport } from "@/skin-model/capability.ts"
import { bdsFormat, bdsSource, type BdsSource } from "@/skin-model/formats/bds.ts"
import { bdaFormat, bdaSource, type BdaSource } from "@/skin-model/formats/bda.ts"
import { ssfFormat, ssfSource, type SsfSource } from "@/skin-model/formats/ssf.ts"
import { sxiFormat, sxiSource, type SxiSource } from "@/skin-model/formats/sxi.ts"
import type { ImportOptions } from "@/skin-model/format.ts"
import type { SkinModel } from "@/skin-model/model.ts"

export type SkinFormatId = "bds" | "bda" | "ssf" | "sxi"

/** 各格式的原生数据；只在格式实现与这里之间流动。 */
export type NativeSkin = BdsSource | BdaSource | SsfSource | SxiSource

export type OpenContext = {
  /** 搜狗皮肤自身没有几何，读取时必须有官方骨架。 */
  skeleton?: SkinArchive
  /** BDA 包只描述外观，几何来自布局骨架。 */
  base?: SkinArchive
}

export type SkinFormatEntry = {
  id: SkinFormatId
  /** 从归档里取出该格式的原生数据；不是这个格式或缺少必需输入时返回 undefined。 */
  open: (archive: SkinArchive, context: OpenContext) => NativeSkin | undefined
  read: (source: NativeSkin, options?: ImportOptions) => SkinModel | Promise<SkinModel>
  write: (model: SkinModel, source?: NativeSkin) => NativeSkin | Promise<NativeSkin>
  capabilities: ReadonlyMap<Capability, CapabilityLevel>
  derive?: ImportOptions["derive"]
}

function entryOf(id: SkinFormatId): SkinFormatEntry {
  if (id === "bds") {
    return {
      id,
      open: (archive) => bdsSource(archive),
      read: (source, options) => bdsFormat.read(source as BdsSource, options),
      write: (model) => bdsFormat.write(model),
      capabilities: bdsFormat.capabilities,
      ...(bdsFormat.derive ? { derive: bdsFormat.derive } : {}),
    }
  }
  if (id === "ssf") {
    return {
      id,
      open: (archive, context) => context.skeleton ? ssfSource(filesOf(archive), context.skeleton) : undefined,
      read: (source, options) => ssfFormat.read(source as SsfSource, options),
      write: (model) => ssfFormat.write(model),
      capabilities: ssfFormat.capabilities,
      ...(ssfFormat.derive ? { derive: ssfFormat.derive } : {}),
    }
  }
  if (id === "bda") {
    return {
      id,
      open: (archive, context) => bdaSource(archive, context.base),
      read: (source, options) => bdaFormat.read(source as BdaSource, options),
      write: (model) => bdaFormat.write(model),
      capabilities: bdaFormat.capabilities,
    }
  }
  return {
    id,
    open: (archive) => sxiSource(filesOf(archive)),
    read: (source) => sxiFormat.read(source as SxiSource),
    write: (model) => sxiFormat.write(model),
    capabilities: sxiFormat.capabilities,
    ...(sxiFormat.derive ? { derive: sxiFormat.derive } : {}),
  }
}

/** 归档的文件表；格式自己的构造函数要的正是这张表。 */
function filesOf(archive: SkinArchive): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  for (const name of archive.names()) {
    const bytes = archive.getBytes(name)
    if (bytes) files.set(name, bytes)
  }
  return files
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
 * 打开一个皮肤包：探测格式、取原生数据、读成 IR。
 * 探测不到或缺少必需输入时返回 undefined，由调用方决定提示方式。
 */
export async function openSkin(archive: SkinArchive, options: OpenSkinOptions = {}): Promise<OpenedSkin | undefined> {
  const format = options.format ?? detectFormat(archive)
  if (!format) return
  const entry = entryOf(format)
  const source = entry.open(archive, {
    ...(options.skeleton ? { skeleton: options.skeleton } : {}),
    ...(options.base ? { base: options.base } : {}),
  })
  if (!source) return
  const model = await entry.read(source, options)
  return { format, model, source }
}

export type WriteSkinOptions = {
  /** 在原数据上写回时传入；不给就按模型重建。 */
  source?: NativeSkin
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
export async function writeSkin(model: SkinModel, format: SkinFormatId, options: WriteSkinOptions = {}): Promise<WrittenSkin> {
  const entry = entryOf(format)
  const source = await entry.write(model, options.source)
  return { format, source, loss: lossOf(model, entry.capabilities) }
}

/** 目标格式能不能完整表达这个模型，用于导出前的提示。 */
export function canExpress(model: SkinModel, format: SkinFormatId): boolean {
  return lossOf(model, entryOf(format).capabilities).items.length === 0
}

/** 模型自身需要的能力集合，供界面展示「这个皮肤用到了什么」。 */
export function needsOf(model: SkinModel): ReadonlyMap<Capability, CapabilityLevel> {
  return requiredCapabilities(model)
}
