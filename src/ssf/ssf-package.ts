// Reader for Sogou phone skins (`.ssf`). A phone skin is a plain ZIP (iOS and Android share it), or the
// same files in Sogou's encrypted container (ssf-container.ts):
//
//   phoneTheme.ini                     skin name / author / version
//   time.ini                           which `statusN` folder is shown at which hours (day / night)
//   <res>/[statusN/]phoneSkin.ini      key classes, image styles, text colours
//   <res>/[statusN/]keys.ini           per-key foreground images and their placement (FG_RECT)
//   <res>/[statusN/]*.png              images, looked up next to the INI first
//   default/                           sounds (sound_android.ini + wav), fonts, shared webp animations
//
// `<res>` is a screen-width folder (1080, 720, 480); the selected folder follows time.ini's supported
// screens, falling back to the widest available folder. Key geometry is not part of the package:
// it is built into the Sogou app, so converters lay the skin onto a Baidu base layout instead.

import { unzipSync } from "fflate"
import { IniDocument } from "../ini.ts"
import { MAX_FILES, MAX_UNPACKED_BYTES, normalizeEntryCounts, parseZip, safePath, validateArchiveLimits } from "../skin-zip.ts"
import { isSkinContainer, unpackSkinContainer } from "./ssf-container.ts"

export type SsfTheme = "light" | "dark"
/** Stretchable band of a Sogou image: pixel ranges `left..right` and `top..bottom`. */
export type SsfStretch = [left: number, right: number, top: number, bottom: number]
export type SsfImageRef = { file: string; stretch?: SsfStretch }
type SsfInfo = { name: string; author: string; version: string }

const PC_SKIN_ERROR = "这是电脑版搜狗皮肤（候选窗皮肤），没有手机键盘，不能转换"

function decodeSsfText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2))
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    // Hand-edited skins saved from Chinese Windows tools are GBK.
    return new TextDecoder("gbk").decode(bytes)
  }
}

/** `img.png,1,97,1,141` → image plus its stretch band; anything malformed stretches the whole image. */
export function parseSsfImage(value: string | undefined): SsfImageRef | undefined {
  const [file, ...rest] = value?.split(",").map((part) => part.trim()) ?? []
  if (!file || !/\.(png|webp|jpg|jpeg)$/i.test(file)) return
  const numbers = rest.slice(0, 4).map(Number)
  const valid = numbers.length === 4 && numbers.every(Number.isInteger) && numbers[0] < numbers[1] && numbers[2] < numbers[3]
  return valid ? { file, stretch: numbers as SsfStretch } : { file }
}

export function ssfColor(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^(?:0x|#)?([0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (!match) return
  return (match[1].length === 6 ? `FF${match[1]}` : match[1]).toUpperCase()
}

function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const normalized = normalizeEntryCounts(bytes)
  validateArchiveLimits(normalized)
  const unpacked = unzipSync(normalized)
  const names = Object.keys(unpacked)
  if (names.length > MAX_FILES) throw new Error(`皮肤包含过多文件（${names.length}）`)
  const files = new Map<string, Uint8Array>()
  let total = 0
  for (const name of names) {
    if (!safePath(name)) throw new Error(`皮肤包含不安全路径：${name}`)
    total += unpacked[name].byteLength
    if (total > MAX_UNPACKED_BYTES) throw new Error("皮肤解压后超过 256 MB")
    if (!name.endsWith("/")) files.set(name.replace(/\\/g, "/"), unpacked[name])
  }
  return files
}

/** The files of a ZIP or encrypted `.ssf`, before deciding what kind of skin they are. */
export async function unpackSsf(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  return isSkinContainer(bytes) ? unpackSkinContainer(bytes) : zipEntries(bytes)
}

export function isSsfPath(path: string): boolean {
  return /\.m?ssf$/i.test(path)
}

/** For paths without an extension (Android `content://`): an encrypted container or a ZIP with phoneTheme.ini. */
export function looksLikeSsf(bytes: Uint8Array): boolean {
  if (isSkinContainer(bytes)) return true
  try {
    return parseZip(bytes).entries.some((entry) => entry.name === "phoneTheme.ini")
  } catch {
    return false
  }
}

export class SsfPackage {
  readonly files: Map<string, Uint8Array>
  readonly resolution: string
  /** Theme → folder holding that theme's phoneSkin.ini (with trailing slash). */
  readonly themes: Map<SsfTheme, string>
  readonly info: SsfInfo
  readonly warnings: string[] = []
  private documents = new Map<string, IniDocument>()

  private constructor(files: Map<string, Uint8Array>) {
    this.files = files
    if (!files.has("phoneTheme.ini")) {
      throw new Error([...files.keys()].some((name) => /(^|\/)skin\.ini$/i.test(name)) ? PC_SKIN_ERROR : "不是搜狗手机皮肤：缺少 phoneTheme.ini")
    }
    const resolutions = [...new Set([...files.keys()].flatMap((name) => {
      const match = name.match(/^(\d+)\/(?:[^/]+\/)?phoneSkin\.ini$/)
      return match ? [match[1]] : []
    }))].sort((a, b) => Number(b) - Number(a))
    if (!resolutions.length) throw new Error("搜狗皮肤缺少 phoneSkin.ini")
    const time = files.has("time.ini") ? this.ini("time.ini") : undefined
    const supported = time?.get("General", "SUPPORT_SCREEN")
      ?.split(/[,;\s]+/)
      .map((value) => value.trim())
      .filter((value) => resolutions.includes(value))
    this.resolution = [...new Set(supported?.length ? supported : resolutions)].sort((a, b) => Number(b) - Number(a))[0]
    this.themes = this.readThemes()
    const theme = this.ini("phoneTheme.ini")
    this.info = {
      name: theme.get("General", "skin_name")?.trim() || "搜狗皮肤",
      author: theme.get("General", "skin_author")?.trim() ?? "",
      version: theme.get("General", "skin_version")?.trim() ?? "",
    }
  }

  /** Reads a ZIP or encrypted package; what kind of skin it is comes from the files inside. */
  static async open(bytes: Uint8Array): Promise<SsfPackage> {
    return new SsfPackage(await unpackSsf(bytes))
  }

  /** The skin an editor document currently holds. */
  static fromFiles(files: Map<string, Uint8Array>): SsfPackage {
    return new SsfPackage(files)
  }

  private readThemes(): Map<SsfTheme, string> {
    const root = `${this.resolution}/`
    const folders = [...new Set([...this.files.keys()].flatMap((name) => {
      const match = name.match(new RegExp(`^${root}([^/]+)/phoneSkin\\.ini$`))
      return match ? [match[1]] : []
    }))]
    const themes = new Map<SsfTheme, string>()
    if (!folders.length) {
      themes.set("light", root)
      return themes
    }
    const time = this.files.has("time.ini") ? this.ini("time.ini") : undefined
    const listed = time?.get(this.resolution, "STATUS_LIST")?.split(",").map((value) => value.trim()).filter((value) => folders.includes(value))
    const ordered = listed?.length ? listed : folders.sort()
    // The status shown at noon is the day (light) look; another one is the night (dark) look.
    const coversNoon = (status: string) => {
      const starts = time?.get(status, "START")?.split(",").map(Number) ?? []
      const ends = time?.get(status, "END")?.split(",").map(Number) ?? []
      return starts.some((start, index) => start <= 12 && 12 <= (ends[index] ?? -1))
    }
    const light = ordered.find(coversNoon) ?? ordered[0]
    themes.set("light", `${root}${light}/`)
    const dark = ordered.find((status) => status !== light)
    if (dark) themes.set("dark", `${root}${dark}/`)
    const ignored = ordered.filter((status) => status !== light && status !== dark)
    if (ignored.length) this.warnings.push(`只转换白天和夜间两套外观，已忽略 ${ignored.join("、")}`)
    return themes
  }

  ini(path: string): IniDocument {
    let document = this.documents.get(path)
    if (!document) {
      const bytes = this.files.get(path)
      document = IniDocument.parse(bytes ? decodeSsfText(bytes) : "")
      this.documents.set(path, document)
    }
    return document
  }

  skin(theme: SsfTheme): IniDocument {
    return this.ini(`${this.folder(theme)}phoneSkin.ini`)
  }

  keys(theme: SsfTheme): IniDocument {
    return this.ini(`${this.folder(theme)}keys.ini`)
  }

  folder(theme: SsfTheme): string {
    return this.themes.get(theme) ?? this.themes.get("light")!
  }

  /** Files are looked up next to the theme's INI first, then in the shared folders. */
  path(theme: SsfTheme, name: string): string | undefined {
    const folder = this.folder(theme)
    return [`${folder}${name}`, `${this.resolution}/${name}`, `default/${name}`, `default/res/${name}`, name].find((candidate) => this.files.has(candidate))
  }

  file(theme: SsfTheme, name: string): Uint8Array | undefined {
    const path = this.path(theme, name)
    return path === undefined ? undefined : this.files.get(path)
  }

  /** The file a `sound=` value (written without extension) names, shared by preview, inspector and writers. */
  soundPath(theme: SsfTheme, sound: string): string | undefined {
    return [...SOUND_EXTENSIONS.map((extension) => `${sound}.${extension}`), sound]
      .map((name) => this.path(theme, name)).find(Boolean)
  }
}

/** Sogou's `sound=` value has no extension; skins ship any of these next to the INI. */
const SOUND_EXTENSIONS = ["wav", "ogg", "mp3", "aiff", "aif", "caf"]
