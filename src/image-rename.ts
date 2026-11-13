import type { SkinArchive } from "./skin.ts"
import type { Change } from "./history.ts"
import { IniDocument } from "./ini.ts"
import { applyDecodedBdaSource, decodedBdaEditorSource } from "./bda-source.ts"
import { encodeSkinJson, parseSkinJson, sxiFragment, SXI_SKIN_PATH } from "./palm/sxi-json.ts"
import { palmTilePointer } from "./palm/palm-style-edit.ts"
import { asObject, type Json } from "./palm/sxi-ini.ts"

/** 先完整校验并生成改动，再由调用方一次提交，避免引用改到一半才发现冲突。 */
export function imageRenameChanges(archive: SkinArchive, path: string, name: string): Change[] {
  const oldFile = path.split("/").pop()!
  const extension = oldFile.slice(oldFile.lastIndexOf("."))
  if (!name || /[\\/:*?"<>|,\x00-\x1f]/.test(name) || name.startsWith(".") || name.endsWith(".")
    || name.slice(-extension.length) !== extension || name.length <= extension.length
    || name.slice(0, -extension.length).trim() !== name.slice(0, -extension.length)) {
    throw new Error(`请输入有效的 ${extension.slice(1).toUpperCase()} 文件名，并保留扩展名`)
  }
  if (!archive.getBytes(path)) throw new Error("原图片已不存在")
  const target = path.slice(0, -oldFile.length) + name
  if (target === path) return []
  // 源码目录可能不区分大小写，写新文件后删除旧路径会误删同一文件。
  if (target.toLowerCase() === path.toLowerCase()) throw new Error("新名称不能只改变字母大小写")
  if (/\/res\/logo\//i.test(path)) throw new Error("工具栏图片使用固定文件名，无法重命名")
  const oldBase = oldFile.slice(0, -extension.length), nextBase = name.slice(0, -extension.length)
  const moves = [{ from: path, to: target }]
  const til = path.replace(/\.[^.]+$/, ".til")
  if (archive.getBytes(til)) moves.push({ from: til, to: target.replace(/\.[^.]+$/, ".til") })
  const occupied = (target: string, source: string) => archive.names().some(existing => existing !== source
    && (existing.toLowerCase() === target.toLowerCase() || existing.toLowerCase().startsWith(`${target.toLowerCase()}/`)))
  if (moves.some(move => occupied(move.to, move.from))) throw new Error("已存在同名文件、切片或文件夹")
  if (occupied(target.replace(/\.[^.]+$/, ".til"), til)) throw new Error("已存在同名切片或文件夹")
  const changes: Change[] = []
  const resolve = (roots: string[], file: string) => roots.map(root => root + file).find(candidate => archive.getBytes(candidate))
  const rootsFor = (config: string): string[][] => {
    if (archive.format === "ssf") {
      const folder = config.slice(0, config.lastIndexOf("/") + 1)
      const resolution = config.match(/^\d+\//)?.[0] ?? ""
      return [[folder, resolution, "default/", "default/res/", ""]]
    }
    const match = /^(light|dark)\/skin\/(?:(port|land)\/)?/.exec(config)
    if (!match) return []
    return (match[2] ? [match[2]] : ["port", "land"]).map(orientation => [
      `${match[1]}/skin/${orientation}/res/`, `${match[1]}/skin/res/`,
      ...archive.format === "bda" ? ["light/skin/res/"] : [],
    ])
  }
  const reference = (value: string, contexts: string[][], withExtension = false): string => {
    const token = value.split(",")[0].trim()
    if (token !== (withExtension ? oldFile : oldBase)) return value
    const affected = contexts.map(roots => resolve(roots, oldFile) === path)
    if (!affected.some(Boolean)) return value
    // 一个共享配置同时命中不同图片时，直接替换名称会误改另一个方向。
    if (!affected.every(Boolean)) throw new Error("横竖屏存在同名图片，无法安全更新共享引用")
    if (contexts.some(roots => {
      const existing = resolve(roots, name)
      return existing && existing !== path
    })) throw new Error("新名称与其他资源目录中的图片冲突")
    const start = value.indexOf(token)
    return value.slice(0, start) + (withExtension ? name : nextBase) + value.slice(start + token.length)
  }
  for (const config of archive.names()) {
    const contexts = rootsFor(config)
    if (archive.format === "bda" && /(?:appearance|animation)Config$/i.test(config)) {
      const before = archive.getBytes(config)!
      const text = decodedBdaEditorSource(config, before)
      const after = JSON.stringify(JSON.parse(text), (key, value) => key === "resourceID" && typeof value === "string"
        ? reference(value, contexts, value.endsWith(extension)) : value)
      if (JSON.stringify(JSON.parse(text)) !== after) changes.push({ kind: "bytes", path: config, before,
        after: applyDecodedBdaSource(config, before, after) })
    } else if (archive.isText(config) && /\.(ini|css|cnd|pop)$/i.test(config)) {
      const before = archive.getText(config)
      const document = IniDocument.parse(before)
      for (const section of document.sections()) for (const { key, value } of document.entries(section)) {
        if (archive.format !== "ssf" && !/^(NM_IMG|HL_IMG)$/i.test(key)) continue
        const next = reference(value, contexts, archive.format === "ssf")
        if (next !== value) document.set(section, key, next)
      }
      const after = document.toString()
      if (after !== before) changes.push({ kind: "text", path: config, before, after })
    }
  }
  if (archive.format === "sxi") {
    const before = archive.getText(SXI_SKIN_PATH)
    const skin = parseSkinJson(before)
    const pointer = palmTilePointer(path)
    if (!pointer || pointer.at(-2) !== "info") throw new Error("该图片使用固定名称，无法重命名")
    const tiles = asObject(sxiFragment(skin, pointer.slice(0, -1)))
    if (tiles && Object.hasOwn(tiles, nextBase) && nextBase !== oldBase) throw new Error("已存在同名切片")
    const walk = (value: Json, context: string, key = ""): Json => {
      if (typeof value === "string") {
        if (value === archive.sourcePath(path)) return archive.sourcePath(target)
        if (value === path) return target
        return /^(normal|hl)$/.test(key) ? reference(value, rootsFor(context)) : value
      }
      if (Array.isArray(value)) return value.map(item => walk(item, context, key))
      const object = asObject(value)
      if (object) for (const [property, item] of Object.entries(object)) {
        const next = property === "default" ? "light/skin/" : property === "night" ? "dark/skin/"
          : /^s_(port|land)$/.test(property) ? context.replace(/(?:port|land)\/$/, "") + property.slice(2) + "/" : context
        object[property] = walk(item, next, property)
      }
      return value
    }
    walk(skin, "")
    if (tiles && nextBase !== oldBase && Object.hasOwn(tiles, oldBase)) {
      Object.defineProperty(tiles, nextBase, { value: tiles[oldBase], enumerable: true, writable: true, configurable: true })
      delete tiles[oldBase]
    }
    const after = encodeSkinJson(skin)
    if (after !== before) changes.push({ kind: "text", path: SXI_SKIN_PATH, before, after })
  }
  return [...changes, ...moves.filter(move => move.from !== move.to).flatMap(({ from, to }): Change[] => [
    { kind: "bytes", path: to, after: archive.getBytes(from)!.slice() },
    { kind: "bytes", path: from, before: archive.getBytes(from)!.slice() },
  ])]
}
