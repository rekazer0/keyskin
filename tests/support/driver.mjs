// 测试用的驱动器入口。
//
// 格式不再有 read/write：读走 importArchive，写走 exportSkin。
// 这里只负责把测试手工构造的原生数据装成归档。
import { SkinArchive } from "../../src/skin.ts"
import { exportSkin, importArchive } from "../../src/skin-model/pipeline.ts"

/** 原生数据里取出包：自带归档的用它，只有文件表的现场装一个。 */
export function archiveOfSource(source) {
  if (source.archive) return source.archive
  if (source.files) return SkinArchive.fromSourceFiles([...source.files].map(([path, data]) => ({ path, data })))
  throw new Error("测试数据里没有包")
}

export async function readWith(format, source, options) {
  return await importArchive(archiveOfSource(source), format.name, format.importer(source, options))
}

export async function writeWith(format, model) {
  return await exportSkin(model, format.exporter)
}
