import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import type { ExportFormat } from "./export.ts"
import { IniDocument } from "./ini.ts"
import { adaptPackageSounds } from "./sounds.ts"
import { adaptIosToolbar } from "./ios-toolbar.ts"
import { adaptIosPanelBackground } from "./ios-panel-background.ts"
import { SXI_INFO_PATH, SXI_SKIN_PATH, encodeSkinJson, parseSkinJson } from "./palm/sxi-json.ts"
import { parseZip, validateArchiveLimits, normalizeEntryCounts, MAX_FILES, safePath, MAX_UNPACKED_BYTES, unpackArchive, view, changedLocal, writeUint32, writeUint16, addZipEntry } from "./skin-zip.ts"

const TEXT_EXTENSIONS = new Set(["ini", "css", "til", "cnd", "pop", "txt", "plist"])

type PackageLayout =
  | "bdi-dual"
  | "bdi-single"
  | "bds-dual"
  | "bds-single"
  | "bda-dual"
  | "bda-single"
  | "ssf"
  | "sxi"
  | "legacy-ios"

type BdaTheme = "light" | "dark"
type PackageInfo = { layout: PackageLayout; bdaRoots?: Map<BdaTheme, string>; sxiNested?: boolean }

function bdaThemeRoots(files: Map<string, Uint8Array>): Map<BdaTheme, string> | undefined {
  const names = [...files.keys()]
  const roots = [...new Set(names.flatMap((name) => {
    const match = name.match(/^(?:(.*)\/)?(?:land|port)\/\d*appearanceConfig$/)
    return match ? [match[1] ?? ""] : []
  }))]
  if (!roots.length) return

  // A complete skin copied below another skin is a resource, not another editable theme.
  const candidates = roots.filter((root) => !roots.some((parent) => parent !== root && (!parent || root.startsWith(`${parent}/`))))
  const result = new Map<BdaTheme, string>()
  for (const theme of ["light", "dark"] as const) {
    if (candidates.includes(theme)) result.set(theme, theme)
  }

  const infoPaths = ["Info.txt", ...candidates.filter(Boolean).map((root) => `${root}/Info.txt`)]
  const declared = infoPaths.flatMap((path) => {
    const bytes = files.get(path)
    const value = bytes && strFromU8(bytes).match(/^AtomSkinName=(.*)$/mi)?.[1]
    return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : []
  })
  const declaredRoots = [...new Set(declared.flatMap((value) => {
    const root = candidates.find((candidate) => candidate === value || candidate.split("/").pop() === value)
    return root === undefined ? [] : [root]
  }))]
  for (const [index, theme] of (["light", "dark"] as const).entries()) {
    if (!result.has(theme) && declaredRoots[index] !== undefined) result.set(theme, declaredRoots[index])
  }

  const used = new Set(result.values())
  // undeclared theme semantics use stable path order; add a theme picker if such packages appear.
  const remaining = candidates.filter((root) => !used.has(root)).sort()
  for (const theme of ["light", "dark"] as const) {
    if (!result.has(theme) && remaining.length) result.set(theme, remaining.shift()!)
  }
  return result
}

function packageInfo(files: Map<string, Uint8Array>, formatHint?: ExportFormat): PackageInfo {
  const names = [...files.keys()]
  const bdaRoots = bdaThemeRoots(files)
  if (formatHint === "bda" && !bdaRoots) throw new Error("BDA 皮肤缺少 port/land appearanceConfig")
  if (bdaRoots) return { layout: bdaRoots.size > 1 ? "bda-dual" : "bda-single", bdaRoots }
  // A Sogou phone skin keeps its own folder layout, so its paths are used as they are. Without a
  // file name (Android content:// URIs) its phoneTheme.ini identifies it.
  if (formatHint === "ssf" || !formatHint && names.includes("phoneTheme.ini")) return { layout: "ssf" }
  // Palm `.sxi` keeps its own tree. Palm's exporter nests it under `light/skin/`, while this
  // editor's converter writes the flat `light/` form, so both spellings have to be read.
  if (files.has(SXI_SKIN_PATH) || formatHint === "sxi") {
    return { layout: "sxi", sxiNested: names.some((name) => /^(?:dark|light)\/skin\//.test(name)) }
  }
  if (names.some((name) => /^skin\/(?:dark|light)\/skin\//.test(name))) return { layout: "bdi-dual" }
  if (names.some((name) => /^skin\/(?:land|port|res)\//.test(name))) return { layout: "bdi-single" }
  if (names.some((name) => /^(?:dark|light)\/(?:land|port|res)\//.test(name))) return { layout: "bds-dual" }
  if (names.some((name) => /^(?:land|port|res)\//.test(name))) return { layout: "bds-single" }
  return { layout: "legacy-ios" }
}

function canonicalPath(path: string, layout: PackageLayout, bdaRoots?: Map<BdaTheme, string>): string {
  if (layout === "ssf") return path
  // Hand-made packages ship info.txt / INFO.TXT; the IME only reads Info.txt, so conversions must rename it.
  path = path.replace(/(^|\/)info\.txt$/i, "$1Info.txt")
  if (layout === "bdi-dual") {
    if (path === "skin/") return ""
    if (path === "skin/Info.txt") return "Info.txt"
    if (path === "skin/demo.png") return "demo.png"
    const themed = path.match(/^skin\/(dark|light)\/skin(?:\/(.*))?$/)
    if (themed) return `${themed[1]}/skin/${themed[2] ?? ""}`
    const themeDirectory = path.match(/^skin\/(dark|light)\/$/)
    if (themeDirectory) return `${themeDirectory[1]}/skin/`
    return path.replace(/^skin\//, "")
  }
  if (layout === "bdi-single") {
    if (path === "skin/") return "light/skin/"
    if (path === "skin/Info.txt") return "Info.txt"
    if (path === "skin/demo.png") return "demo.png"
    return path.startsWith("skin/") ? `light/skin/${path.slice(5)}` : path
  }
  if (layout === "bda-dual" || layout === "bda-single") {
    for (const [theme, root] of bdaRoots ?? []) {
      if (root && path === `${root}/`) return `${theme}/skin/`
      if (root && path.startsWith(`${root}/`)) return `${theme}/skin/${path.slice(root.length + 1)}`
      if (!root && path !== "Info.txt" && path !== "demo.png") return `${theme}/skin/${path}`
    }
    return path
  }
  if (layout === "bds-dual" || layout === "sxi") {
    const themed = path.match(/^(dark|light)(?:\/(.*))?$/)
    if (themed) {
      // Palm's own `.sxi` trees already carry `light/skin/`; adding a second `skin/` there
      // leaves every resource unreachable, which blanks the whole preview.
      if (layout === "sxi" && (themed[2] === "skin" || themed[2]?.startsWith("skin/"))) return path
      return `${themed[1]}/skin/${themed[2] ?? ""}`
    }
  }
  if (layout === "bds-single") {
    if (path === "Info.txt" || path === "demo.png") return path
    return `light/skin/${path}`
  }
  return path
}

function rawPath(path: string, layout: PackageLayout, bdaRoots?: Map<BdaTheme, string>, sxiNested?: boolean): string {
  if (layout === "bdi-dual") {
    if (path === "Info.txt" || path === "demo.png") return `skin/${path}`
    return path.replace(/^(dark|light)\/skin\//, "skin/$1/skin/")
  }
  if (layout === "bdi-single") {
    if (path === "Info.txt" || path === "demo.png") return `skin/${path}`
    return path.replace(/^light\/skin\//, "skin/")
  }
  if (layout === "bda-dual" || layout === "bda-single") {
    const themed = path.match(/^(light|dark)\/skin\/(.*)$/)
    if (!themed) return path
    const root = bdaRoots?.get(themed[1] as BdaTheme) ?? ""
    return root ? `${root}/${themed[2]}` : themed[2]
  }
  if (layout === "bds-dual" || layout === "sxi") {
    if (layout === "sxi" && sxiNested) return path
    return path.replace(/^(dark|light)\/skin\//, "$1/")
  }
  if (layout === "bds-single") {
    return path.replace(/^light\/skin\//, "")
  }
  return path
}

function setInfoField(bytes: Uint8Array, key: string, value: string): Uint8Array {
  let text = strFromU8(bytes)
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const field = new RegExp(`^${key}=.*$`, "mi")
  if (field.test(text)) text = text.replace(field, `${key}=${value}`)
  else text = `${text}${text && !text.endsWith("\n") && !text.endsWith("\r") ? eol : ""}${key}=${value}${eol}`
  return strToU8(text)
}

function removeInfoField(bytes: Uint8Array, key: string): Uint8Array {
  const text = strFromU8(bytes).replace(new RegExp(`^${key}=.*(?:\\r?\\n|$)`, "mi"), "")
  return strToU8(text)
}

function targetPath(path: string, format: ExportFormat, single: boolean): string | undefined {
  if (format === "bdi") {
    if (path === "Info.txt" || path === "demo.png") return `skin/${path}`
    const themed = path.match(/^(dark|light)\/skin\/(.*)$/)
    if (single && themed?.[1] === "light") return `skin/${themed[2]}`
    return themed ? `skin/${themed[1]}/skin/${themed[2]}` : `skin/${path}`
  }
  if (/^(?:dark|light)\/skin\/(?:Info\.txt|demo\.png)$/.test(path)) return
  const themed = path.match(/^(dark|light)\/skin\/(.*)$/)
  if (single && themed?.[1] === "light") return themed[2]
  return themed ? `${themed[1]}/${themed[2]}` : path
}

/** BDA and SSF each have their own configuration format; only BDI and BDS repackage into each other. */
function assertRepackable(from: ExportFormat, to: ExportFormat | undefined): void {
  if (!to || to === from) return
  if (from === "bda" || to === "bda") throw new Error("BDA 与 BDI/BDS 使用不同配置格式，不能转换")
  if (from === "ssf" || to === "ssf") throw new Error("搜狗皮肤与百度皮肤使用不同配置格式，需要经过转换")
  if (from === "sxi" || to === "sxi") throw new Error("手心皮肤（.sxi）需要转换后导出，不能直接改包")
}

export class SkinArchive {
  private files: Map<string, Uint8Array>
  private originals: Map<string, Uint8Array>
  private sourceBytes: Uint8Array
  private sourceZip?: ReturnType<typeof parseZip>
  private layout: PackageLayout
  private bdaRoots?: Map<BdaTheme, string>
  private sxiNested: boolean
  private canonicalToRaw = new Map<string, string>()
  private cachedNames?: string[]
  private changedRaw = new Set<string>()
  readonly changed = new Set<string>()
  /** Bumped whenever file contents or paths change, so callers can skip redundant redraws. */
  revision = 0

  private constructor(files: Map<string, Uint8Array>, sourceBytes: Uint8Array, formatHint?: ExportFormat) {
    this.files = files
    this.originals = new Map(files)
    this.sourceBytes = sourceBytes.slice()
    const info = packageInfo(files, formatHint)
    this.layout = info.layout
    this.bdaRoots = info.bdaRoots
    this.sxiNested = info.sxiNested ?? false
    this.rebuildPathMap()
    try {
      this.sourceZip = parseZip(this.sourceBytes)
    } catch {
      this.sourceZip = undefined
    }
  }

  private rebuildPathMap(): void {
    this.canonicalToRaw.clear()
    for (const raw of this.files.keys()) {
      const canonical = canonicalPath(raw, this.layout, this.bdaRoots)
      if (canonical && !this.canonicalToRaw.has(canonical)) this.canonicalToRaw.set(canonical, raw)
    }
  }

  get format(): ExportFormat {
    if (this.layout === "ssf") return "ssf"
    if (this.layout === "sxi") return "sxi"
    if (this.layout.startsWith("bda")) return "bda"
    return this.layout.startsWith("bds") ? "bds" : "bdi"
  }

  static open(bytes: Uint8Array, formatHint?: ExportFormat): SkinArchive {
    const sourceBytes = normalizeEntryCounts(bytes)
    validateArchiveLimits(sourceBytes)
    const unpacked = unzipSync(sourceBytes)
    const names = Object.keys(unpacked)
    if (names.length > MAX_FILES) throw new Error(`皮肤包含过多文件（${names.length}）`)

    let total = 0
    const files = new Map<string, Uint8Array>()
    for (const name of names) {
      if (!safePath(name)) throw new Error(`皮肤包含不安全路径：${name}`)
      total += unpacked[name].byteLength
      if (total > MAX_UNPACKED_BYTES) throw new Error("皮肤解压后超过 256 MB")
      files.set(name, unpacked[name])
    }
    return new SkinArchive(files, sourceBytes, formatHint)
  }

  static async openAsync(
    bytes: Uint8Array,
    formatHint?: ExportFormat,
    onProgress?: (value: number) => void,
  ): Promise<SkinArchive> {
    const sourceBytes = normalizeEntryCounts(bytes)
    validateArchiveLimits(sourceBytes)
    const unpacked = await unpackArchive(sourceBytes, onProgress)
    const names = Object.keys(unpacked)
    if (names.length > MAX_FILES) throw new Error(`皮肤包含过多文件（${names.length}）`)

    let total = 0
    const files = new Map<string, Uint8Array>()
    for (const [index, name] of names.entries()) {
      if (!safePath(name)) throw new Error(`皮肤包含不安全路径：${name}`)
      total += unpacked[name].byteLength
      if (total > MAX_UNPACKED_BYTES) throw new Error("皮肤解压后超过 256 MB")
      files.set(name, unpacked[name])
      if (onProgress && ((index + 1) % 50 === 0 || index + 1 === names.length)) {
        onProgress(0.85 + (index + 1) / names.length * 0.1)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
    const archive = new SkinArchive(files, sourceBytes, formatHint)
    onProgress?.(1)
    return archive
  }

  static fromSourceFiles(files: Array<{ path: string; data: Uint8Array }>): SkinArchive {
    return SkinArchive.open(zipSync(Object.fromEntries(files.map((file) => [file.path, file.data])), { level: 0 }))
  }

  names(): string[] {
    this.cachedNames ??= [...this.canonicalToRaw.keys()].sort()
    return this.cachedNames.slice()
  }

  sourceFiles(): Array<{ path: string; data: Uint8Array }> {
    return [...this.files.entries()]
      .filter(([path]) => !path.endsWith("/"))
      .map(([path, data]) => ({ path, data: data.slice() }))
  }

  zipEncryptedPaths(): string[] {
    return this.sourceZip?.entries.filter((entry) => view(entry.central).getUint16(8, true) & 1).map((entry) => entry.name) ?? []
  }

  normalizedBytes(): Uint8Array {
    return zipSync(Object.fromEntries(this.files), { level: 6 })
  }

  sourcePath(path: string): string {
    return this.canonicalToRaw.get(path) ?? rawPath(path, this.layout, this.bdaRoots, this.sxiNested)
  }

  getSourceBytes(path: string): Uint8Array | undefined {
    return this.files.get(path)
  }

  canonicalSourcePath(path: string): string {
    return canonicalPath(path, this.layout, this.bdaRoots)
  }

  isText(path: string): boolean {
    const extension = path.split(".").pop()?.toLowerCase() ?? ""
    return this.getBytes(path) !== undefined && (TEXT_EXTENSIONS.has(extension) || this.layout === "sxi" && extension === "json")
  }

  isImage(path: string): boolean {
    return this.getBytes(path) !== undefined && path.toLowerCase().endsWith(".png")
  }

  isBdaConfig(path: string): boolean {
    return this.format === "bda" && /\/\d*(?:appearance|animation|lightAnimation|sound|switch|sticker|scene)Config$/.test(path)
  }

  getBytes(path: string): Uint8Array | undefined {
    return this.files.get(this.canonicalToRaw.get(path) ?? path)
  }

  /** The name the skin declares for itself: Info.txt `Name`, or phoneTheme.ini `skin_name` for Sogou. */
  skinName(): string | undefined {
    const [paths, section, key] = this.format === "ssf"
      ? [["phoneTheme.ini"], "General", "skin_name"]
      : [["Info.txt", "light/skin/Info.txt", "dark/skin/Info.txt"], "", "Name"]
    for (const path of paths) {
      const bytes = this.getBytes(path)
      const name = bytes && IniDocument.parse(strFromU8(bytes)).get(section, key)?.trim()
      if (name) return name
    }
  }

  getText(path: string): string {
    const bytes = this.getBytes(path)
    if (!bytes) throw new Error(`文件不存在：${path}`)
    return strFromU8(bytes)
  }

  setText(path: string, text: string): void {
    this.setBytes(path, strToU8(text))
  }

  setBytes(path: string, bytes: Uint8Array): void {
    const raw = this.canonicalToRaw.get(path) ?? rawPath(path, this.layout, this.bdaRoots, this.sxiNested)
    const current = this.files.get(raw)
    if (current && current.length === bytes.length && current.every((byte, index) => byte === bytes[index])) {
      return
    }
    const isNewPath = !this.canonicalToRaw.has(path)
    this.files.set(raw, bytes)
    this.revision++
    this.canonicalToRaw.set(path, raw)
    if (isNewPath) this.cachedNames = undefined
    if (this.layout === "sxi" && path === SXI_SKIN_PATH) this.syncSxiInfo(bytes)
    const original = this.originals.get(raw)
    if (original && original.length === bytes.length && original.every((byte, index) => byte === bytes[index])) {
      this.changed.delete(path)
      this.changedRaw.delete(raw)
    } else {
      this.changed.add(path)
      this.changedRaw.add(raw)
    }
  }

  // `info.json` mirrors `skin.json`'s `info`, as the Palm converter writes it.
  private syncSxiInfo(bytes: Uint8Array): void {
    if (!this.canonicalToRaw.has(SXI_INFO_PATH)) return
    try {
      const info = parseSkinJson(strFromU8(bytes)).info
      if (info !== undefined) this.setBytes(SXI_INFO_PATH, strToU8(encodeSkinJson(info)))
    } catch {
      // Callers validate skin.json before committing it; keep the stale mirror otherwise.
    }
  }

  delete(path: string): void {
    const raw = this.canonicalToRaw.get(path)
    if (!raw) return
    this.files.delete(raw)
    this.revision++
    this.canonicalToRaw.delete(path)
    this.cachedNames = undefined
    if (this.originals.has(raw)) {
      this.changed.add(path)
    } else {
      this.changed.delete(path)
    }
    this.changedRaw.delete(raw)
  }

  markSaved(bytes?: Uint8Array, format = this.format): void {
    if (bytes) {
      if (format !== this.format || this.layout === "legacy-ios") {
        const reopened = SkinArchive.open(bytes, format)
        this.files = reopened.files
        this.originals = reopened.originals
        this.sourceBytes = reopened.sourceBytes
        this.sourceZip = reopened.sourceZip
        this.layout = reopened.layout
        this.bdaRoots = reopened.bdaRoots
        this.sxiNested = reopened.sxiNested
        this.canonicalToRaw = reopened.canonicalToRaw
        this.cachedNames = undefined
        this.revision++
      } else {
        // The decoded files and paths do not change when saving in place.
        this.originals = new Map(this.files)
        this.sourceBytes = bytes.slice()
        this.sourceZip = parseZip(bytes)
      }
      this.changedRaw.clear()
      this.changed.clear()
      return
    }
    this.originals = new Map(this.files)
    this.changedRaw.clear()
    this.changed.clear()
  }

  private packagedFiles(format: ExportFormat): Record<string, Uint8Array> {
    const output = new Map<string, Uint8Array>()
    const single = this.layout.endsWith("single")
    const add = (name: string, data: Uint8Array) => addZipEntry(output, name, data)

    for (const path of this.names()) {
      if (path.endsWith("/")) continue
      const destination = targetPath(path, format, single)
      const source = this.getBytes(path)
      if (!destination || !source) continue
      let data = source
      if (path === "Info.txt" || /\/(?:Info\.txt)$/.test(path)) {
        data = setInfoField(data, "SupportPlatform", format === "bdi" ? "I" : "A")
        if (format === "bds" && path === "Info.txt") data = setInfoField(data, "Style", "default")
        if (format === "bdi") data = removeInfoField(data, "Style")
      }
      add(destination, data)
    }

    // iOS packages repeat Info.txt inside each theme folder; BDS sources only have the root copy.
    const rootInfo = format === "bdi" ? output.get("skin/Info.txt") : undefined
    if (rootInfo && !single) {
      for (const theme of ["light", "dark"]) {
        if (output.has(`skin/${theme}/skin/`) && !output.has(`skin/${theme}/skin/Info.txt`)) {
          output.set(`skin/${theme}/skin/Info.txt`, rootInfo)
        }
      }
    }

    return Object.fromEntries(output)
  }

  private packagedBytes(format: ExportFormat): Uint8Array {
    return zipSync(this.packagedFiles(format), { level: 6 })
  }

  /** `warnings` collects key sounds the target cannot play; `notes` (by default the same list) what packaging for iOS adjusted. */
  async toBytesAsync(format?: ExportFormat, warnings?: string[], notes = warnings): Promise<Uint8Array> {
    assertRepackable(this.format, format)
    if (this.changed.size === 0 && (!format || (format === this.format && this.layout !== "legacy-ios"))) {
      return this.sourceBytes.slice()
    }
    // Avoid fflate's one-worker-per-large-file async ZIP path, which can exhaust WebView workers.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    if ((format === "bdi" || format === "bds") && (format !== this.format || this.layout === "legacy-ios")) {
      return this.platformBytesAsync(format, warnings, format === "bdi" && this.layout.startsWith("bds"), notes)
    }
    return this.toBytes(format)
  }

  /** Packages for a BDI/BDS platform, pointing key sounds at a format that platform plays (AIFF / OGG). */
  async platformBytesAsync(format: "bdi" | "bds", warnings?: string[], fromAndroid = false, notes = warnings): Promise<Uint8Array> {
    assertRepackable(this.format, format)
    const files = new Map(Object.entries(this.packagedFiles(format)))
    // An Android BDS on iOS: without LOGO entry points iOS draws faint default toolbar icons, and it stretches panel
    // backgrounds behind the toolbar. The toolbar samples the bar's background before it is cleared.
    if (fromAndroid) {
      adaptIosToolbar(files, notes)
      adaptIosPanelBackground(files, notes)
    }
    const adapted = await adaptPackageSounds(files, format)
    warnings?.push(...adapted.warnings)
    return zipSync(Object.fromEntries(files), { level: 6 })
  }

  toBytes(format?: ExportFormat): Uint8Array {
    assertRepackable(this.format, format)
    if (format && (format !== this.format || this.layout === "legacy-ios")) {
      return this.packagedBytes(format)
    }
    if (this.changed.size === 0) return this.sourceBytes.slice()
    if (!this.sourceZip) {
      return zipSync(Object.fromEntries(this.files), { level: 6 })
    }

    const locals: Uint8Array[] = []
    const centrals: Uint8Array[] = []
    let localOffset = 0
    const sourceNames = new Set(this.sourceZip.entries.map((entry) => entry.name))
    const added = [...this.files.entries()]
      .filter(([name]) => !sourceNames.has(name))
      .map(([name, data]) => parseZip(zipSync({
        [name]: [data, { level: 6, mtime: new Date(1980, 0, 1) }],
      })).entries[0])
    const entries = [
      ...this.sourceZip.entries.filter((entry) => this.files.has(entry.name)),
      ...added,
    ]
    for (const entry of entries) {
      let local = entry.local
      let crc: number | undefined
      let compressedSize: number | undefined
      if (sourceNames.has(entry.name) && this.changedRaw.has(entry.name)) {
        const changed = changedLocal(entry, this.files.get(entry.name)!)
        local = changed.local
        crc = changed.crc
        compressedSize = changed.compressedSize
      }
      const central = entry.central.slice()
      writeUint32(central, 42, localOffset)
      if (crc !== undefined && compressedSize !== undefined) {
        writeUint32(central, 16, crc)
        writeUint32(central, 20, compressedSize)
        writeUint32(central, 24, this.files.get(entry.name)!.length)
      }
      locals.push(local)
      centrals.push(central)
      localOffset += local.length
    }
    const centralSize = centrals.reduce((total, bytes) => total + bytes.length, 0)
    const end = this.sourceZip.end.slice()
    writeUint16(end, 8, entries.length)
    writeUint16(end, 10, entries.length)
    writeUint32(end, 12, centralSize)
    writeUint32(end, 16, localOffset)
    const total = localOffset + centralSize + end.length
    const output = new Uint8Array(total)
    let offset = 0
    for (const part of [...locals, ...centrals, end]) {
      output.set(part, offset)
      offset += part.length
    }
    return output
  }
}
