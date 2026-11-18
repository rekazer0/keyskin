// 皮肤会话：给应用层用的打开、保存、转换入口。
//
// 应用只关心「拿到一个皮肤包，得到模型或字节」；格式差异、骨架补齐与损失报告都在这里收敛。
import { zipSync } from "fflate"
import { SkinArchive } from "@/skin.ts"
import type { LossReport } from "@/skin-model/capability.ts"
import { convertModel, describeLoss } from "@/skin-model/convert.ts"
import {
  canExpress,
  detectFormat,
  needsOf,
  openSkin,
  writeSkin,
  type NativeSkin,
  type OpenedSkin,
  type SkinFormatId,
} from "@/skin-model/formats/index.ts"
import type { SkinModel } from "@/skin-model/model.ts"

export type SkinHints = {
  /** 搜狗皮肤要有官方骨架才能读。 */
  skeleton?: SkinArchive
  /** BDA 皮肤要有布局骨架才能读。 */
  base?: SkinArchive
}

export type SessionError = {
  kind: "unrecognized" | "missing-basis" | "read-failed" | "write-failed"
  message: string
}

export type OpenResult =
  | { ok: true; format: SkinFormatId; model: SkinModel; source: NativeSkin }
  | { ok: false; error: SessionError }

/**
 * 打开皮肤包。搜索型失败返回错误对象而不是抛异常：
 * 调用方需要区分「不是皮肤」与「缺少骨架」，两者的提示不同。
 */
export async function openSession(archive: SkinArchive, hints: SkinHints = {}): Promise<OpenResult> {
  const format = detectFormat(archive)
  if (!format) return { ok: false, error: { kind: "unrecognized", message: "无法识别的皮肤格式" } }
  let opened: OpenedSkin | undefined
  try {
    opened = await openSkin(archive, {
      format,
      ...(hints.skeleton ? { skeleton: hints.skeleton } : {}),
      ...(hints.base ? { base: hints.base } : {}),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 缺骨架是「有包但读不了」，与包本身损坏分开报。
    return { ok: false, error: { kind: message.includes("骨架") ? "missing-basis" : "read-failed", message } }
  }
  if (!opened) {
    const need = format === "ssf" ? "搜狗官方骨架" : format === "bda" ? "布局骨架" : "必需文件"
    return { ok: false, error: { kind: "missing-basis", message: `缺少${need}，无法读取该皮肤` } }
  }
  return { ok: true, format: opened.format, model: opened.model, source: opened.source }
}

export type SaveResult =
  | { ok: true; bytes: Uint8Array; loss: LossReport; warnings: string[] }
  | { ok: false; error: SessionError }

/**
 * 把模型存成目标格式的字节。
 * 能力损失不阻止保存：报告随结果返回，由界面决定是否先提示。
 */
export async function saveSession(model: SkinModel, format: SkinFormatId, source?: NativeSkin): Promise<SaveResult> {
  try {
    const written = await writeSkin(model, format, source ? { source } : {})
    const bytes = bytesOf(written.source)
    return { ok: true, bytes, loss: written.loss, warnings: describeLoss(written.loss) }
  } catch (error) {
    return { ok: false, error: { kind: "write-failed", message: error instanceof Error ? error.message : String(error) } }
  }
}

/** 直接换格式：读源包、写目标格式。 */
export async function convertSession(
  archive: SkinArchive,
  target: SkinFormatId,
  hints: SkinHints = {},
): Promise<SaveResult> {
  const opened = await openSession(archive, hints)
  if (!opened.ok) return opened
  if (!canExpress(opened.model, target)) {
    // 表达不全时仍继续，损失写进报告的 warnings。
  }
  const converted = await convertModel(opened.model, target, opened.format)
  return {
    ok: true,
    bytes: bytesOfFromArchive(converted.output, target),
    loss: converted.loss,
    warnings: describeLoss(converted.loss),
  }
}

/** 模型用到了哪些能力，供界面展示皮肤复杂度。 */
export function capabilitiesOf(model: SkinModel): string[] {
  return [...needsOf(model).keys()]
}

function bytesOf(source: NativeSkin): Uint8Array {
  return "archive" in source ? bytesOfArchive(source.archive) : zipFiles(source.files)
}

function bytesOfFromArchive(archive: SkinArchive, format: SkinFormatId): Uint8Array {
  void format
  return bytesOfArchive(archive)
}

/** 按归档里的实际文件打包；手心的包结构与百度不同，不能走百度导出。 */
function bytesOfArchive(archive: SkinArchive): Uint8Array {
  return zipFiles(new Map(archive.names().flatMap((path) => {
    const data = archive.getBytes(path)
    return data ? [[path, data] as const] : []
  })))
}

function zipFiles(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(files), { level: 0 })
}
