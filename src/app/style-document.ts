import { IniDocument } from "../ini.ts"
import { appState } from "./state"

/**
 * 检查器每重建一次，就会把同一份配置问几十次（每个文字属性、每个样式层各一次）。20k 行的
 * default.css 解析一次再加建索引约 2ms，重复几十次就是选中按键时那一下卡顿。这里按 路径+文本
 * 缓存一份**只读**文档；要写回的地方仍然自己 `IniDocument.parse`，改不到缓存里的实例。
 */
const documents = new Map<string, { text: string; document: IniDocument }>()

export function cachedIniDocument(path: string): IniDocument | undefined {
  const archive = appState.archive
  if (!archive?.isText(path)) return undefined
  const text = archive.getText(path)
  const cached = documents.get(path)
  if (cached?.text === text) return cached.document
  const document = IniDocument.parse(text)
  documents.set(path, { text, document })
  return document
}
