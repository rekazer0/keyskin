// 跨格式转换：读一个格式，写出另一个格式，并报告目标格式表达不了的部分。
//
// 转换只经过 IR：不直接搬运两个格式的原生字段，避免格式间互相依赖。
import { zipSync } from "fflate"
import type { ExportFormat } from "@/export.ts"
import { SkinArchive } from "@/skin.ts"
import type { LossReport } from "@/skin-model/capability.ts"
import { openSkin, writeSkin, type NativeSkin, type OpenSkinOptions, type SkinFormatId } from "@/skin-model/formats/index.ts"
import type { DeriveOverrides } from "@/skin-model/derive/options.ts"
import type { SkinModel } from "@/skin-model/model.ts"

/** 格式到归档格式名的映射；手心没有独立的归档容器，按百度归档承载。 */
const ARCHIVE_OF: Record<SkinFormatId, ExportFormat> = {
  bds: "bds",
  bda: "bda",
  ssf: "ssf",
  sxi: "bds",
}

export type ConversionRequest = {
  archive: SkinArchive
  /** 目标格式。 */
  target: SkinFormatId
  /** 搜狗读取需要的官方骨架。 */
  skeleton?: SkinArchive
  /** BDA 读取需要的布局骨架。 */
  base?: SkinArchive
  /** 推导参数覆盖。 */
  derive?: DeriveOverrides
}

export type ConversionResult = {
  from: SkinFormatId
  to: SkinFormatId
  model: SkinModel
  output: SkinArchive
  /** 目标格式相对模型需求的损失。 */
  loss: LossReport
}

function bytesOf(source: NativeSkin): Uint8Array {
  if ("archive" in source) return source.archive.toBytes(ARCHIVE_OF.bds)
  return zipSync(Object.fromEntries(source.files), { level: 0 })
}

/**
 * 把一个皮肤包转成目标格式。
 * 源格式无法识别时抛出错误；能力缺失只进损失报告，不中断转换。
 */
export async function convertSkin(request: ConversionRequest): Promise<ConversionResult> {
  const options: OpenSkinOptions = {
    ...(request.skeleton ? { skeleton: request.skeleton } : {}),
    ...(request.base ? { base: request.base } : {}),
    ...(request.derive ? { derive: request.derive } : {}),
  }
  const opened = await openSkin(request.archive, options)
  if (!opened) throw new Error("无法识别源皮肤格式")
  return convertModel(opened.model, request.target, opened.format)
}

/** 已经拿到模型时的转换：只做写出与损失统计。 */
export async function convertModel(model: SkinModel, target: SkinFormatId, from: SkinFormatId): Promise<ConversionResult> {
  const written = await writeSkin(model, target)
  const bytes = bytesOf(written.source)
  return {
    from,
    to: target,
    model,
    output: SkinArchive.open(bytes, ARCHIVE_OF[target]),
    loss: written.loss,
  }
}

/** 不实际写出，只问目标格式会丢什么，供导出前提示。 */
export async function previewConversion(model: SkinModel, target: SkinFormatId): Promise<LossReport> {
  return (await writeSkin(model, target)).loss
}

/** 损失报告的简短描述，一行一条。 */
export function describeLoss(loss: LossReport): string[] {
  return loss.items.map((item) => item.detail ?? `${item.capability}：${item.reason}`)
}
