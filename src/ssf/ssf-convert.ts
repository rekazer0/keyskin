// 搜狗皮肤文档的入口：打开时把加密容器解成 ZIP，给画布提供官方骨架。
//
// 转换成其它格式已经由中间表示承担（`src/skin-model/formats/ssf/index.ts`），这里只保留
// 打开文档所必需的部分。

import { zipSync } from "fflate"
import { SkinArchive } from "../skin.ts"
import { withDirectoryEntries } from "../skin-zip.ts"
import { isSkinContainer } from "./ssf-container.ts"
import { SsfPackage, unpackSsf } from "./ssf-package.ts"
import { copySsfSkeleton } from "./ssf-skeleton.ts"

/** 画布用的骨架包：搜狗画布与原生 BDA 模板。 */
export type SsfTemplates = { bda: SkinArchive; sogou: SkinArchive }

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
  for (const theme of pkg.themes.keys()) copySsfSkeleton(template, theme, files, Number(pkg.resolution), pkg.skin(theme))
  // Stored the way a two-look BDS package keeps them (`light/port/…`), which reads back as `light/skin/port/…`.
  return SkinArchive.fromSourceFiles([...files].map(([path, data]) => ({ path: path.replace(/^(light|dark)\/skin\//, "$1/"), data })))
}
