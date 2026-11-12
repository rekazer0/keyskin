import { SkinArchive } from "../skin.ts"
import { buildSxiZipAsync, type SxiExportReport } from "./palm-export.ts"
import { convertSsfDocument, type SsfTemplates } from "../ssf/ssf-convert.ts"
import { convertBaiduToSsf } from "../ssf/baidu-to-ssf.ts"
import { sxiToBaiduArchive } from "./sxi-to-baidu.ts"

/** Both native formats use their own configuration; the shared INI model carries resources between them. */
export async function convertSsfSxi(
  source: SkinArchive,
  templates?: SsfTemplates,
  report?: SxiExportReport,
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  // 手心 → 搜狗只做转换，不走手心打包；进度由转换流程自己报告。
  if (source.format === "sxi") return convertBaiduToSsf(sxiToBaiduArchive(source))
  if (source.format !== "ssf" || !templates) throw new Error("搜狗转手心需要搜狗基础布局")
  const baidu = await convertSsfDocument(source, "bdi", templates, report ? (fraction, detail) => report(fraction * 0.8, detail) : undefined)
  const palm = await buildSxiZipAsync(SkinArchive.open(baidu.bytes, "bdi"), report ? (fraction, detail) => report(0.8 + fraction * 0.2, detail) : undefined)
  return { bytes: palm.bytes, warnings: [...new Set([...baidu.warnings, ...palm.warnings])] }
}
