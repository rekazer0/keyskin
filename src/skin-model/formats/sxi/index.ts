// 手心输入法皮肤（SXI）转换器。
//
// 手心皮肤是一个 zip 包：`skin.json` 是外观主体（`default`/`night` 两套主题，各带横竖两个
// 方向的完整键盘几何），`info.json` 是元信息，根目录的 `.layout` 是规则层，图片与音效散在
// 主题目录下。几何是文档自带的，所以不需要外部骨架。
import type { Json, JsonObject } from "@/palm/sxi-ini.ts"
import { parseSkinJson, SXI_INFO_PATH, SXI_SKIN_PATH } from "@/palm/sxi-json.ts"
import { decodePng, encodePng } from "@/raster.ts"
import type { SkinArchive } from "@/skin.ts"
import type { Atlas } from "@/skin-model/atlas.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import type { SkinFormat } from "@/skin-model/format.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import { emptyModel, type SkinModel } from "@/skin-model/model.ts"
import type { FileRole, SkinDocuments, SkinStructure } from "@/skin-model/pipeline.ts"
import { filesOf } from "@/skin-model/pipeline.ts"
import type { SoundBinding } from "@/skin-model/sound.ts"
import type { SkinStyle } from "@/skin-model/style.ts"
import type { AppearanceSet } from "@/skin-model/activation.ts"
import type { Orientation } from "@/skin-model/types.ts"
import { atlasesOfTheme } from "./atlas.ts"
import { boardsOfTheme } from "./board.ts"
import { arrayOf, objectOf, textOf } from "./json.ts"
import { motionsOfTheme } from "./motion.ts"
import { identifySxi, parseSxi, SXI_THEME_KEYS, themeOfKey, jsonOf } from "./pipeline.ts"
import {
  atlasRefOf,
  binaryFilesOf,
  infoJsonOf,
  jsonFilesOf,
  layoutsOf,
  menuBoardOf,
  removedKeysOf,
  skinJsonOf,
  SXI_OPAQUE,
} from "./skin.ts"
import { stylesOfTheme, type SxiAudioLookup } from "./style.ts"

export type SxiSource = {
  /** 皮肤包内的全部文件。 */
  files: Map<string, Uint8Array>
}

/** 手心包的特征是 `skin.json`；主题里必须有横竖布局之一，空壳不算手心皮肤。 */
export function sxiSource(files: Map<string, Uint8Array>): SxiSource | undefined {
  const bytes = files.get(SXI_SKIN_PATH)
  if (!bytes) return
  try {
    const skin = parseSkinJson(new TextDecoder().decode(bytes))
    const themes = [skin.default, skin.night].flatMap((theme) => theme && typeof theme === "object" && !Array.isArray(theme) ? [theme] : [])
    if (!themes.some((theme) => theme.port_layout !== undefined || theme.land_layout !== undefined)) return
  } catch {
    return
  }
  return { files }
}

function capabilities(): ReadonlyMap<Capability, CapabilityLevel> {
  return new Map<Capability, CapabilityLevel>([
    ["board.geometry", "full"],
    ["board.keys", "full"],
    ["board.add-remove", "full"],
    ["key.actions", "full"],
    ["key.states", "none"],
    ["key.touch", "full"],
    ["style.image", "full"],
    ["style.color", "full"],
    ["style.text", "full"],
    ["style.nine-slice", "none"],
    ["panel.backdrop", "partial"],
    ["panel.candidate", "partial"],
    ["panel.hint", "partial"],
    ["panel.list", "partial"],
    ["panel.toolbar", "partial"],
    ["motion.track", "full"],
    ["motion.sequence", "full"],
    ["motion.binding", "none"],
    ["sound", "full"],
  ])
}

/** 音效文件：`s_4` 的 `path_N` 写文件名，另一扩展名的同名文件是同一音效的另一版。 */
function audioLookup(files: ReadonlyMap<string, Uint8Array>, theme: string): SxiAudioLookup {
  return (file) => {
    const leaf = file.split("/").pop() ?? file
    const stem = leaf.replace(/\.[^.]+$/, "")
    const candidates = [...files.keys()].filter((path) => path.startsWith(`${theme}/`)
      && (path.split("/").pop() ?? "").replace(/\.[^.]+$/, "") === stem
      && /\.(?:aiff|ogg|mp3|wav|m4a)$/i.test(path))
    const chosen = candidates.find((path) => path.endsWith(`/${leaf}`))
      ?? candidates.find((path) => /\.aiff$/i.test(path))
      ?? candidates[0]
    if (!chosen) return
    return {
      path: chosen,
      variants: candidates.filter((path) => path !== chosen).map((path) => ({
        format: (path.split(".").pop() ?? "").toLowerCase(),
        path,
      })),
    }
  }
}

/** 样式表里的音效图层 → 音效绑定表。 */
function soundsOf(styles: ReadonlyMap<string, SkinStyle>): SoundBinding[] {
  const sounds: SoundBinding[] = []
  for (const style of styles.values()) {
    for (const layer of style.normal) if (layer.kind === "sound") sounds.push(layer.binding)
  }
  return sounds
}

function imagesOf(documents: SkinDocuments): Map<string, SkinImage> {
  const images = new Map<string, SkinImage>()
  for (const [path, data] of documents.binaries) {
    if (!/\.(?:png|webp|jpe?g)$/i.test(path)) continue
    try {
      images.set(path, decodePng(data))
    } catch {
      // 解不出来的不是图片。
    }
  }
  return images
}

/**
 * 解析产物 → 模型。
 * 两个主题各读一次；样式、动效、图集的名字带主题，板按「主题 + 方向 + 键盘名」分开。
 */
export async function sxiToModel(documents: SkinDocuments): Promise<SkinModel> {
  const skin = jsonOf(documents, SXI_SKIN_PATH)
  if (!skin) throw new Error("手心皮肤缺少 skin.json")
  const info = jsonOf(documents, SXI_INFO_PATH) ?? objectOf(skin.info) ?? {}
  const model = emptyModel({
    ...(textOf(info.name) !== undefined ? { name: textOf(info.name)! } : {}),
    ...(textOf(info.author) !== undefined ? { author: textOf(info.author)! } : {}),
    ...(textOf(info.description) !== undefined ? { description: textOf(info.description)! } : {}),
    ...(textOf(info.platform) !== undefined ? { platform: textOf(info.platform)! } : {}),
    theme: "light",
    orientation: "port",
  }, "sxi")
  const opaque = new Map<string, unknown>()
  opaque.set(SXI_OPAQUE.info, info)
  opaque.set(SXI_OPAQUE.skinInfo, objectOf(skin.info) ?? {})
  opaque.set(SXI_OPAQUE.skinRoot, skin.root ?? "")
  // `.layout` 的规则层未建模（五种 operation 原样保留），只有 `deleteKey` 同时落到板的键清单。
  const layouts = new Map<string, unknown>()
  for (const [path, value] of documents.structs) {
    if (path.toLowerCase().endsWith(".layout")) layouts.set(path, value)
  }
  for (const [path, value] of layouts) opaque.set(SXI_OPAQUE.layout(path), value)
  for (const [path, value] of documents.structs) {
    if (path === SXI_SKIN_PATH || path === SXI_INFO_PATH || layouts.has(path)) continue
    opaque.set(SXI_OPAQUE.json(path), value)
  }
  for (const [path, data] of documents.binaries) {
    if (/\.(?:png|webp|jpe?g|aiff|ogg|mp3|wav|m4a|ttf|otf|ttc)$/i.test(path)) continue
    opaque.set(SXI_OPAQUE.file(path), data)
  }
  const removed = removedKeysOf(layouts)
  const images = imagesOf(documents)
  const atlases: Atlas[] = []
  const styles = new Map(model.styles)
  const motions = new Map(model.motions)
  const appearances: AppearanceSet[] = []
  for (const themeKey of SXI_THEME_KEYS) {
    const struct = objectOf(skin[themeKey])
    if (!struct) continue
    const theme = themeOfKey(themeKey)
    const sInfo = objectOf(struct.s_info) ?? {}
    const ss1 = objectOf(sInfo.ss_1) ?? {}
    const themeRest: JsonObject = { ...struct }
    for (const field of ["s_info", "land_layout", "port_layout", "menu", "a_i"]) delete themeRest[field]
    opaque.set(SXI_OPAQUE.theme(themeKey), themeRest)
    opaque.set(SXI_OPAQUE.sInfo(themeKey), sInfo)
    const extras: JsonObject = {}
    for (const orientation of ["port", "land"] as const) {
      // 只有原包存在的方向才记下来：写回时不能凭空补一个空布局。
      const layout = objectOf(struct[`${orientation}_layout`])
      if (!layout) continue
      const rest: JsonObject = {}
      for (const [field, value] of Object.entries(layout)) if (field !== "b") rest[field] = value
      extras[orientation] = rest
    }
    opaque.set(SXI_OPAQUE.layoutExtras(themeKey), extras)
    const atlasRead = atlasesOfTheme(objectOf(sInfo.info) ?? {}, arrayOf(struct.a_i), theme, documents.binaries)
    for (const atlas of atlasRead.atlases) atlases.push({ ...atlas, name: atlasRefOf(themeKey, atlas.name) })
    for (const [id, image] of atlasRead.images) if (!images.has(id)) images.set(id, image)
    const themeStyles = stylesOfTheme(ss1, theme, atlasRead.lookup, audioLookup(documents.binaries, theme))
    for (const [id, style] of themeStyles) styles.set(id, style)
    for (const [id, motion] of motionsOfTheme(objectOf(sInfo.ss_2) ?? {}, theme)) motions.set(id, motion)
    const themeBoards = boardsOfTheme(struct, themeKey, theme, ss1, removed)
    const menu = menuBoardOf(struct.menu as Json, themeKey, theme)
    model.boards.push(...themeBoards, ...(menu ? [menu] : []))
    for (const orientation of ["port", "land"] as const) {
      const boardIds = themeBoards.filter((board) => board.orientation === orientation).map((board) => board.id)
      if (orientation === "port" && menu) boardIds.push(menu.id)
      if (!boardIds.length) continue
      appearances.push({ theme, orientation, activation: { kind: "theme", theme }, boards: boardIds })
    }
  }
  model.images = images
  model.atlases = atlases
  model.styles = styles
  model.motions = motions
  model.sounds = soundsOf(styles)
  model.appearances = appearances
  model.opaque = opaque
  // 资源：音效与字体是包里的文件，字节随模型走。
  const resources = new Map(model.resources)
  for (const [path, data] of documents.binaries) {
    if (/\.(?:aiff|ogg|mp3|wav|m4a)$/i.test(path)) resources.set(path, { kind: "audio", path, data })
    else if (/\.(?:ttf|otf|ttc)$/i.test(path)) resources.set(path, { kind: "font", path, data })
  }
  model.resources = resources
  // 手心不声明画布；板尺寸由键的并集推出，主板的宽度就是设计宽。
  const main = model.boards.find((board) => board.kind === "main" && board.orientation === "port")
  if (main) {
    model.meta.designWidth = main.container.width
    model.meta.resolution = { width: main.container.width, height: main.container.height }
  }
  return model
}

/** 样式表里所有主题的音效图层（跨主题收集）。 *//* —— 写回 —— */

/** 图片写回统一成 PNG；切片是派生资源，不单独成文件。 */
function pngPathOf(id: string): string {
  const hash = id.lastIndexOf("#")
  const path = hash < 0 ? id : id.slice(0, hash)
  return path.replace(/\.[^.\/]+$/, "") + ".png"
}

/** 模型 → 文档。手心包是两份 JSON、若干 `.layout` 与图片音效。 */
async function sxiFromModel(model: SkinModel): Promise<SkinDocuments> {
  const structs = new Map<string, unknown>()
  const binaries = new Map<string, Uint8Array>()
  const roles = new Map<string, FileRole>()
  const renamed = new Map<string, string>()
  for (const [id, image] of model.images) {
    if (id.includes("#")) continue
    const path = pngPathOf(id)
    if (path !== id) renamed.set(id, path)
    binaries.set(path, encodePng(image))
    roles.set(path, { kind: "image" })
  }
  for (const resource of model.resources.values()) {
    if (!resource.data) continue
    binaries.set(resource.path, resource.data)
    roles.set(resource.path, { kind: resource.kind === "font" ? "font" : "audio" })
  }
  structs.set(SXI_SKIN_PATH, await skinJsonOf(model, renamed))
  roles.set(SXI_SKIN_PATH, { kind: "panel-config" })
  structs.set(SXI_INFO_PATH, infoJsonOf(model))
  roles.set(SXI_INFO_PATH, { kind: "info" })
  // `.layout` 规则层、`switchConfig.json` 与没有角色的文件原样写回。
  for (const [path, value] of layoutsOf(model.opaque)) {
    structs.set(path, value)
    roles.set(path, { kind: "layout", board: "other", theme: "light", orientation: "port" })
  }
  for (const [path, value] of jsonFilesOf(model.opaque)) {
    structs.set(path, value)
    roles.set(path, { kind: "panel-config" })
  }
  for (const [path, data] of binaryFilesOf(model.opaque)) {
    binaries.set(path, data)
    roles.set(path, { kind: "unknown", reason: `手心包里没有这种文件的位置：${path}` })
  }
  return { roles, texts: new Map(), structs, binaries }
}

/** 手心包的主题与方向由 JSON 结构决定，与目录路径无关。 */
function sxiStructureOf(documents: SkinDocuments): SkinStructure {
  const themes = new Set<"light" | "dark">()
  const orientations = new Set<Orientation>()
  for (const path of documents.roles.keys()) {
    if (path === SXI_SKIN_PATH) {
      const skin = objectOf(documents.structs.get(path) as Json | undefined)
      if (skin?.default !== undefined) themes.add("light")
      if (skin?.night !== undefined) themes.add("dark")
    }
    const role = documents.roles.get(path)
    if (role?.kind === "layout") orientations.add(role.orientation)
  }
  return { roles: documents.roles, themes: [...themes], orientations: [...orientations] }
}

/** 文档 → 包。 */
function sxiPack(documents: SkinDocuments, _structure: SkinStructure): SxiSource {
  const encoder = new TextEncoder()
  const files = new Map<string, Uint8Array>()
  for (const [path, document] of documents.texts) files.set(path, encoder.encode(document.toString()))
  for (const [path, value] of documents.structs) files.set(path, encoder.encode(JSON.stringify(value)))
  for (const [path, data] of documents.binaries) files.set(path, data)
  return { files }
}

export const sxiFormat: SkinFormat<SxiSource> = {
  name: "sxi",
  capabilities: capabilities(),
  derive: { tolerance: 1 },
  open(archive: SkinArchive) {
    return sxiSource(filesOf(archive))
  },
  importer() {
    return {
      identify: identifySxi,
      parse: parseSxi,
      toModel: (documents: SkinDocuments, _hints?: unknown) => sxiToModel(documents),
    }
  },
  exporter: {
    fromModel: sxiFromModel,
    structure: sxiStructureOf,
    pack: sxiPack,
  },
}
