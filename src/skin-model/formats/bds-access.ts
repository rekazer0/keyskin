// 转换阶段能访问的东西。
//
// 它不是归档的替身：只有已经解析出来的文档与已识别角色的字节，
// 没有「再回包里找找」的能力。函数按这个接口取数据，就自然拿不到原始包。
import type { IniDocument } from "@/ini.ts"
import type { SkinDocuments } from "@/skin-model/pipeline.ts"

export type DocumentAccess = {
  /** 包里有哪些路径；顺序与包内顺序一致。 */
  paths(): string[]
  /** 按路径取 INI 文档；不是 INI 或没解析出来时返回 undefined。 */
  text(path: string): IniDocument | undefined
  /** 按路径取原始字节。 */
  bytes(path: string): Uint8Array | undefined
  /** 按路径取非 INI 的文本（样式表）。 */
  css(path: string): string | undefined
}

/** 由解析产物构造访问器。 */
export function accessOf(documents: SkinDocuments): DocumentAccess {
  return {
    paths: () => [...documents.roles.keys()],
    text: (path) => documents.texts.get(path),
    bytes: (path) => documents.binaries.get(path),
    css: (path) => {
      const value = documents.structs.get(path)
      return typeof value === "string" ? value : undefined
    },
  }
}

/** 按路径取文本内容；用于必须拿到原文本的场合（如判断有没有按键段）。 */
export function textContent(access: DocumentAccess, path: string): string | undefined {
  const document = access.text(path)
  if (document) return document.toString()
  return access.css(path)
}
