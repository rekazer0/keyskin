import { SkinArchive } from "../skin.ts"
import { convertSsfDocument, type SsfTemplates } from "../ssf/ssf-convert.ts"
import { convertBaiduToSsf } from "../ssf/baidu-to-ssf.ts"
import { buildSxiZip } from "./palm-export.ts"
import { sxiToBaiduArchive } from "./sxi-to-baidu.ts"

/** Both native formats use their own configuration; the shared INI model carries resources between them. */
export async function convertSsfSxi(source: SkinArchive, templates?: SsfTemplates): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  if (source.format === "sxi") return convertBaiduToSsf(sxiToBaiduArchive(source))
  if (source.format !== "ssf" || !templates) throw new Error("搜狗转手心需要搜狗基础布局")
  const baidu = await convertSsfDocument(source, "bds", templates)
  const palm = buildSxiZip(SkinArchive.open(baidu.bytes, "bds"))
  return { bytes: palm.bytes, warnings: [...new Set([...baidu.warnings, ...palm.warnings])] }
}
