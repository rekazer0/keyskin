// 测试用的驱动器入口。
//
// 格式不再有 read/write：读走 importArchive，写走 exportSkin。
// 这里只负责把测试手工构造的原生数据装成归档。
import { SkinArchive } from "../../src/skin.ts"
import { layoutOf } from "../../src/skin-model/layout-cache.ts"
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

/** 按键矩形只有布局树这一个来源；测试按同一路径取。 */
export async function rectOfKey(model, boardId, keyId) {
  const board = model.boards.find((item) => item.id === boardId) ?? model.boards[0]
  if (!board) throw new Error("模型里没有板")
  const rects = await layoutOf(board)
  const rect = rects.get(keyId)
  if (!rect) throw new Error(`布局树里没有这个键：${keyId}`)
  return rect
}

/** 预热所有板的布局；编辑与检查器都要求模型建好后缓存已热。 */
export async function warm(model) {
  await Promise.all(model.boards.map((board) => layoutOf(board)))
  return model
}
