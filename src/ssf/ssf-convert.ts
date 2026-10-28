// Entry points for Sogou skin documents and conversion, kept apart from the editor so they can be tested directly.

import { zipSync } from "fflate"
import { convertBdaArchive } from "../bda-convert.ts"
import { SkinArchive } from "../skin.ts"
import { withDirectoryEntries } from "../skin-zip.ts"
import { convertBaiduToSsf } from "./baidu-to-ssf.ts"
import { isSkinContainer } from "./ssf-container.ts"
import { SsfPackage, unpackSsf } from "./ssf-package.ts"
import { syncKeyStateTips } from "./ssf-state-tips.ts"
import { copySsfSkeleton } from "./ssf-skeleton.ts"
import { convertSsfToBaidu } from "./ssf-to-baidu.ts"
import { convertSsfToBda } from "./ssf-to-bda.ts"
import { adaptSsfNativeToolbar } from "./ssf-native-toolbar.ts"

/** The Sogou canvas/BDI/BDS skeleton and the native BDA template. */
export type SsfTemplates = { bda: SkinArchive; sogou: SkinArchive }
type Converted = { bytes: Uint8Array; warnings: string[] }

/** The document's own files, not copies: derived images are cached by the arrays they come from. */
export function documentPackage(archive: SkinArchive): SsfPackage {
  return SsfPackage.fromFiles(new Map(archive.names().flatMap((path) => {
    const bytes = path.endsWith("/") ? undefined : archive.getBytes(path)
    return bytes ? [[path, bytes] as const] : []
  })))
}

/**
 * Bytes the editor opens as an SSF document. A ZIP is kept as it is, so saving rewrites only edited
 * entries; an encrypted container is repacked as a ZIP, which Sogou reads too. PC skins are rejected.
 */
export async function ssfDocumentBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const files = await unpackSsf(bytes)
  SsfPackage.fromFiles(files)
  return isSkinContainer(bytes) ? zipSync(Object.fromEntries(withDirectoryEntries(files)), { level: 6 }) : bytes
}

/**
 * Sogou's official skeleton for each look of the skin, a read-only package of its own (a Sogou skin has
 * no layouts): the canvas takes its boards (key sections, geometry, built-in labels) from here and paints
 * the skin's own files onto them. It is never part of the document.
 */
export function ssfSkeleton(pkg: SsfPackage, template: SkinArchive): SkinArchive {
  const files = new Map<string, Uint8Array>()
  for (const theme of pkg.themes.keys()) copySsfSkeleton(template, theme, files, Number(pkg.resolution))
  // Stored the way a two-look BDS package keeps them (`light/port/…`), which reads back as `light/skin/port/…`.
  return SkinArchive.fromSourceFiles([...files].map(([path, data]) => ({ path: path.replace(/^(light|dark)\/skin\//, "$1/"), data })))
}

/** Converts an SSF document into a Baidu package of `format`. */
export async function convertSsfDocument(archive: SkinArchive, format: "bdi" | "bds" | "bda", templates: SsfTemplates): Promise<Converted> {
  const pkg = documentPackage(archive)
  if (format === "bda") {
    const { archive: converted, warnings } = convertSsfToBda(pkg, templates.bda)
    return { bytes: converted.toBytes(), warnings }
  }
  // Keep the SSF canvas geometry and artwork; the toolbar moves into Baidu's native F14 container and logo icons.
  const { archive: converted, warnings } = convertSsfToBaidu(pkg, templates.sogou, Number(pkg.resolution))
  syncKeyStateTips(converted)
  adaptSsfNativeToolbar(converted, pkg, format, warnings)
  // Platform packaging also re-encodes the Sogou WAV key sounds into what the target IME plays.
  return { bytes: await converted.platformBytesAsync(format, warnings), warnings }
}

/** Converts any editable Baidu skin to `.ssf`; BDA goes through the official BDS base layout first. */
export async function exportSsf(archive: SkinArchive, bdaBase: SkinArchive | undefined): Promise<Converted> {
  if (archive.format !== "bda") return convertBaiduToSsf(archive)
  if (!bdaBase) throw new Error("无法加载 BDA 官方基础布局")
  const converted = convertBdaArchive(archive, bdaBase)
  const result = await convertBaiduToSsf(converted.archive)
  // BDA-only panels (split / one-handed landscape boards) have no Sogou counterpart either.
  const warnings = converted.warnings.filter((warning) => !warning.includes("没有 BDS/BDI 基础布局"))
  return { bytes: result.bytes, warnings: [...warnings, ...result.warnings] }
}
