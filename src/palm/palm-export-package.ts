// 手心导出的文件清单与打包。同步导出和异步导出必须写出同一份清单，所以都走这里。
import { zipSync } from "fflate"
import type { SkinArchive } from "../skin.ts"
import { encodePalmJSON, type PalmJSONValue } from "./palm-json.ts"
import { NATIVE_LAYOUT_JSON } from "./palm-native-layout.ts"
import { normalizePalmPath, palmBaseName } from "./palm-vfs.ts"

export type ConverterEntry = {
  path: string
  directory: boolean
  bytes?: Uint8Array
}

// `deleteFiles(matchExt:)` from both `PalmSkin.convert` and `PalmSkinConverter`.
const DELETED_EXTENSIONS = new Set(["ini", "pop", "cnd", "css", "txt", "bdi", "til", "plist"])

// `renamePreviewImage` only rewrites `demo.png` directly inside these folders.
const PREVIEW_DIRECTORIES = new Set(["", "dark/", "light/", "dark/skin/", "light/skin/"])

function fileExtension(path: string): string {
  const name = palmBaseName(path)
  const separator = name.lastIndexOf(".")
  return separator <= 0 ? "" : name.slice(separator + 1).toLowerCase()
}

function previewPath(path: string): string | undefined {
  const separator = path.lastIndexOf("/")
  const parent = separator < 0 ? "" : path.slice(0, separator + 1)
  if (path.slice(parent.length) !== "demo.png") return undefined
  return PREVIEW_DIRECTORIES.has(parent) ? `${parent}preview.png` : undefined
}

export function collectConverterEntries(archive: SkinArchive): ConverterEntry[] {
  const raws = archive.names().map((canonical) => {
    const raw = archive.sourcePath(canonical)
    return { canonical, raw, normalized: normalizePalmPath(raw), directory: raw.endsWith("/") }
  })
  const usesSkinRoot = raws.some(({ normalized }) => normalized === "skin" || normalized.startsWith("skin/"))
  const entries: ConverterEntry[] = []
  for (const item of raws) {
    let path = item.normalized
    if (usesSkinRoot) {
      if (!path.startsWith("skin/")) continue
      path = path.slice("skin/".length)
    }
    if (!path) continue
    // Single-theme Baidu packages keep resources at the root; Palm resolves them in the default theme.
    if (/^(?:port|land|res)(?:\/|$)/.test(path)) path = `light/skin/${path}`
    // Palm reads a theme's artwork from `<theme>/skin/`; Baidu Android keeps it at `<theme>/`.
    path = path.replace(/^(dark|light)\/(?!skin\/)/, "$1/skin/")
    entries.push({
      path,
      directory: item.directory,
      bytes: item.directory ? undefined : archive.getBytes(item.canonical),
    })
  }
  return entries
}

// Folders that survive the deletion passes with no file left inside them still need an
// explicit zip entry: the real `.sxi` keeps, for example, `light/skin/land/`.
function emptyDirectories(entries: ConverterEntry[], written: Iterable<string>): string[] {
  const directories = new Set<string>()
  for (const entry of entries) {
    const parts = entry.path.split("/")
    const parentParts = entry.directory ? parts : parts.slice(0, -1)
    let parent = ""
    for (const part of parentParts) {
      parent = parent ? `${parent}/${part}` : part
      directories.add(parent)
    }
  }
  const populated = new Set<string>()
  for (const path of written) {
    const parts = path.split("/")
    let current = ""
    for (const part of parts.slice(0, -1)) {
      current = current ? `${current}/${part}` : part
      populated.add(current)
    }
  }
  return [...directories].filter((directory) => !populated.has(directory)).sort()
}

/**
 * The export's file map: `skin.json`, `info.json`, the surviving resource files, empty folders and
 * the bundled `native.layout`. The sync and async exports share it so both write the same names.
 */
export function assembleSxiFiles(entries: ConverterEntry[], skin: Record<string, PalmJSONValue>): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {
    "skin.json": new TextEncoder().encode(encodePalmJSON(skin)),
    "info.json": new TextEncoder().encode(encodePalmJSON(skin.info)),
  }
  const written = new Set<string>()
  for (const entry of entries) {
    if (entry.directory) continue
    if (DELETED_EXTENSIONS.has(fileExtension(entry.path))) continue
    const preview = previewPath(entry.path)
    const name = preview !== undefined && files[preview] === undefined ? preview : entry.path
    files[name] = entry.bytes ?? new Uint8Array()
    written.add(name)
  }
  for (const directory of emptyDirectories(entries, written)) {
    files[`${directory}/`] = new Uint8Array()
  }

  // `copyLayoutIfNeed` copies the bundled `native_325.json` into the output folder so a
  // standalone skin can resolve its `native` specify-layout. The Swift call is `try?`, so a
  // source file already named `native.layout` survives untouched.
  if (files["native.layout"] === undefined) {
    files["native.layout"] = new TextEncoder().encode(NATIVE_LAYOUT_JSON)
  }
  return files
}

export function packSxiFiles(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 6 })
}
