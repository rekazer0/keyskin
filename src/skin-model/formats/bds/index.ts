// BDS/BDI 转换器：覆盖布局、按键、动作、样式图层、动效与音效。
//
// 格式原生数据是归档加路径；read 解析成 IR，write 从 IR 重新生成全部文件（含重新打包的图集）。
import { appearanceOf, bdsBoardName, bdsDirectory, isBdsLayoutPath, orientationOf } from "@/skin-model/board-paths.ts"
import { IniDocument, numbersOf } from "@/ini.ts"
import { accessOf, textContent, type DocumentAccess } from "@/skin-model/formats/public/access.ts"
import { identifyBds } from "@/skin-model/formats/bds/identify.ts"
import { parseBds } from "@/skin-model/formats/public/parse.ts"
import type { FileRole, SkinDocuments, SkinStructure } from "@/skin-model/pipeline.ts"
import { parseLegacyAnimationFile, type LegacyAnimationEntry } from "@/legacy-animation.ts"
import { decodePng, encodePng, type RgbaImage } from "@/raster.ts"
import { SkinArchive } from "@/skin.ts"
import { tileSlices } from "@/tiles.ts"
import type { Size } from "taffy-layout"
import type { Theme, BoardKind, KeyEvent, Orientation, KeyAction } from "@/skin-model/types.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import { absoluteBoard, computeLayout, type LayoutBox } from "@/skin-model/layout.ts"
import type { Key } from "@/skin-model/key.ts"
import type { SkinLayer, SkinStyle, SkinStyles, Stretch } from "@/skin-model/style.ts"
import type { Board } from "@/skin-model/board.ts"
import { containerOf, knownContainer } from "@/skin-model/board.ts"
import type { AppearanceSet } from "@/skin-model/activation.ts"
import type { Atlas, AtlasSlice } from "@/skin-model/atlas.ts"
import type { FormatProfile } from "@/skin-model/profile.ts"
import type { BoardPanels, HintBubble, ListPanel, MoreMenu } from "@/skin-model/panel.ts"
import { boardPanels } from "@/skin-model/panel.ts"
import type { MotionEmitter, MotionNode, MotionRange, MotionTimeline, MotionTrack, SkinMotions } from "@/skin-model/motion.ts"
import { keyframesOf, motionPropertyOf } from "@/skin-model/motion.ts"
import { emptyModel, type SkinModel } from "@/skin-model/model.ts"
import { cutTiles, packAtlasPages, type SkinImage } from "@/skin-model/image.ts"
import { panelFiles, panelsOf, type PanelPaths } from "@/skin-model/formats/bds/panels.ts"
import { tipLines, tipPoolOf, tipsOf } from "@/skin-model/formats/bds/tips.ts"
import type { KeyRender } from "@/skin-model/build.ts"
import type { ImportOptions, SkinFormat } from "@/skin-model/format.ts"

export type BdsSource = {
  archive: SkinArchive
  layout: string
  /** 样式文件；官方基础布局没有样式，此时为空。 */
  styles?: string
  animation?: string
  theme: Theme
  orientation: Orientation
  kind: BoardKind
}

/** 在归档里按主题/方向/布局名找路径。 */
export function bdsSource(
  archive: SkinArchive,
  options: Partial<Pick<BdsSource, "layout" | "theme" | "orientation" | "kind">> = {},
): BdsSource | undefined {
  const theme = options.theme ?? "light"
  const orientation = options.orientation ?? "port"
  const kind = options.kind ?? "main"
  const prefix = bdsDirectory(theme, orientation)
  const candidates = archive.names().filter((name) => name.startsWith(prefix) && name.endsWith(".ini") && !/gen\.ini$/i.test(name))
  // 只有带按键段的布局才是键盘；菜单、候选栏这类板没有 `[KEY`，
  // 只按文件名排序会把它们当成主布局，读回时连容器尺寸都定不出来。
  const withKeys = candidates.filter((name) => {
    try {
      return archive.getText(name).includes("[KEY")
    } catch {
      return false
    }
  })
  const layout = options.layout
    ?? withKeys.find((name) => /\/py_26\.ini$/.test(name))
    ?? withKeys.find((name) => /_26\.ini$/.test(name))
    ?? withKeys[0]
    ?? candidates[0]
  if (!layout) return
  // 基础布局只提供几何，没有样式表；样式可以缺失，读取时按空样式处理。
  const styles = archive.names().find((name) => name.startsWith(`${theme}/`) && name.endsWith("/res/default.css"))
  const animation = archive.names().find((name) => name.startsWith(`${theme}/`) && name.endsWith("/res/anim.ini"))
  return {
    archive,
    layout,
    ...(styles ? { styles } : {}),
    theme,
    orientation,
    kind,
    ...(animation ? { animation } : {}),
  }
}

/* —— 动作 —— */

export function actionOf(value: string | undefined): KeyAction | undefined {
  const text = value?.trim()
  if (!text) return
  if (text === "F36") return { kind: "delete" }
  if (text === "F37") return { kind: "delete", forward: true }
  if (text === "F38") return { kind: "text", value: " " }
  if (text === "F39") return { kind: "enter" }
  if (text === "F22") return { kind: "candidate-page", direction: "up" }
  if (text === "F23") return { kind: "candidate-page", direction: "down" }
  if (text === "F10") return { kind: "case", mode: "title" }
  if (text === "F11") return { kind: "case", mode: "lock" }
  if (text === "F1") return { kind: "switch", board: "symbol" }
  if (text === "F6") return { kind: "switch", board: "number" }
  if (/^F\d+$/i.test(text)) return { kind: "system", code: text }
  return { kind: "text", value: text }
}

export function actionValue(action: KeyAction | undefined): string | undefined {
  if (!action) return
  switch (action.kind) {
    case "text":
      return action.value === " " ? "F38" : action.value
    case "delete":
      return action.forward ? "F37" : "F36"
    case "enter":
      return "F39"
    case "candidate-page":
      return action.direction === "up" ? "F22" : "F23"
    case "case":
      return action.mode === "title" ? "F10" : "F11"
    case "switch":
      return action.board === "symbol" ? "F1" : action.board === "number" ? "F6" : undefined
    case "open-app":
      return undefined
    case "system":
      return action.code
  }
}

const EVENT_FIELDS: ReadonlyArray<{ event: KeyEvent; field: string }> = [
  { event: "press", field: "CENTER" },
  { event: "long-press", field: "HOLD" },
  { event: "swipe-up", field: "UP" },
  { event: "swipe-down", field: "DOWN" },
  { event: "swipe-left", field: "LEFT" },
  { event: "swipe-right", field: "RIGHT" },
]

/* —— 样式 —— */

function imageRef(value: string | undefined): { file: string; slice?: number } | undefined {
  const parts = value?.split(",").map((part) => part.trim())
  const file = parts?.[0]
  if (!file) return
  const slice = parts[1] === undefined ? undefined : Number(parts[1])
  return slice !== undefined && Number.isFinite(slice) ? { file, slice } : { file }
}

function tilePath(access: DocumentAccess, theme: Theme, orientation: Orientation, file: string): string | undefined {
  return [
    `${theme}/skin/${orientation}/res/${file}.til`,
    `${theme}/skin/res/${file}.til`,
    `${theme}/res/${file}.til`,
  ].find((candidate) => access.text(candidate) !== undefined)
}

/** 图集文件与它的 PNG；切图需要像素，所以两者都要在。 */
function atlasBytes(access: DocumentAccess, path: string): Uint8Array | undefined {
  return access.bytes(path.replace(/\.til$/i, ".png"))
}

/** 把一张图集切进图片资源表，返回 `<图集>#<序号>` 键。 */
function cutAtlas(images: Map<string, SkinImage>, access: DocumentAccess, path: string): void {
  if ([...images.keys()].some((key) => key.startsWith(`${path}#`))) return
  const bytes = atlasBytes(access, path)
  if (!bytes) return
  let atlas: RgbaImage
  try {
    atlas = decodePng(bytes)
  } catch {
    return
  }
  const document = access.text(path)
  if (!document) return
  const slices = tileSlices(document)
  for (const [id, image] of cutTiles(atlas, slices.map((slice) => ({ index: slice.index, source: slice.source })), path)) {
    images.set(id, image)
  }
}

/**
 * 切片的 `INNER_RECT` → 拉伸区域。内区就是允许拉伸的那块，与 `nine-slice` 的四边方向相反；
 * 内区等于整片时没有拉伸可表达，返回 undefined。
 */
function stretchOf(tile: { source: readonly [number, number, number, number]; inner?: readonly [number, number, number, number] }): Stretch | undefined {
  if (!tile.inner) return
  const [sourceX, sourceY, width, height] = tile.source
  const [innerX, innerY, innerWidth, innerHeight] = tile.inner
  const inner = { x: innerX - sourceX, y: innerY - sourceY, width: innerWidth, height: innerHeight }
  const fits = inner.x <= 0 && inner.y <= 0 && inner.width >= width && inner.height >= height
  return fits ? undefined : { kind: "region", inner }
}

function imageLayer(
  access: DocumentAccess,
  images: Map<string, SkinImage>,
  theme: Theme,
  orientation: Orientation,
  document: IniDocument,
  section: string,
  field: string,
): SkinLayer | undefined {
  const ref = imageRef(document.get(section, field))
  if (!ref) return
  const path = tilePath(access, theme, orientation, ref.file)
  if (!path) return
  cutAtlas(images, access, path)
  const tileDocument = access.text(path)
  if (!tileDocument) return
  const slices = tileSlices(tileDocument)
  const tile = ref.slice === undefined ? slices[0] : slices.find((candidate) => candidate.index === ref.slice)
  if (!tile) return
  const stretch = stretchOf(tile)
  return {
    kind: "image",
    image: `${path}#${tile.index}`,
    ...(stretch ? { stretch } : {}),
  }
}

function styleLayers(
  access: DocumentAccess,
  images: Map<string, SkinImage>,
  theme: Theme,
  orientation: Orientation,
  document: IniDocument,
  section: string,
  pressed: boolean,
): SkinLayer[] {
  const layers: SkinLayer[] = []
  const suffix = pressed ? "HL" : "NM"
  const image = imageLayer(access, images, theme, orientation, document, section, `${suffix}_IMG`)
  if (image) layers.push(image)
  const color = document.get(section, `${suffix}_COLOR`)
  if (color) {
    const text = document.get(section, "SHOW")
    const fontSize = Number(document.get(section, "FONT_SIZE"))
    if (!pressed && (text || Number.isFinite(fontSize))) {
      layers.push({ kind: "text", ...(text ? { text } : {}), style: { ...(Number.isFinite(fontSize) ? { fontSize } : {}), color } })
    } else layers.push({ kind: "color", value: color })
  }
  if (!pressed) {
    const sound = document.get(section, "PRESS_SOUND_PATH")
    if (sound) layers.push({ kind: "sound", binding: { subject: section, sound } })
  }
  return layers
}

function stylesOf(
  access: DocumentAccess,
  theme: Theme,
  orientation: Orientation,
  document: IniDocument,
): { styles: SkinStyles; images: Map<string, SkinImage>; fields: Map<string, readonly string[]>; global: ReadonlyMap<string, string> } {
  const styles = new Map<string, SkinStyle>()
  const images = new Map<string, SkinImage>()
  const fields = new Map<string, readonly string[]>()
  const global = new Map<string, string>()
  for (const entry of document.entries("GLOBAL")) global.set(entry.key, entry.value)
  for (const section of document.sections()) {
    const match = /^STYLE(\d+)$/i.exec(section)
    if (!match) continue
    const normal = styleLayers(access, images, theme, orientation, document, section, false)
    const pressed = styleLayers(access, images, theme, orientation, document, section, true)
    // 空样式段也是文件里的事实：段头存在、只是没有可识别的字段。
    styles.set(match[1], { normal, ...(pressed.length ? { pressed } : {}) })
    // 未建模字段、以及同一段里重复出现的同名字段，都保留原始行。
    const seen = new Set<string>()
    const extra: string[] = []
    for (const entry of document.entries(section)) {
      const name = entry.key.toUpperCase()
      const duplicated = seen.has(name)
      seen.add(name)
      if (!duplicated && STYLE_MODELED.has(name)) continue
      extra.push(`${entry.key}=${entry.value}`)
    }
    if (extra.length) fields.set(match[1], extra)
  }
  return { styles, images, fields, global }
}

/** `[STYLEn]` 里按结构化字段读出的字段名；其余字段原样保留。 */
const STYLE_MODELED = new Set([
  "NM_IMG", "HL_IMG", "NM_COLOR", "HL_COLOR", "SHOW", "FONT_SIZE", "PRESS_SOUND_PATH", "FONT_FILE", "FONT_NAME",
])

/* —— 图集 —— */

/** `.til` 的 `[IMGn]` 里按结构化字段读出的字段名；其余字段原样保留。 */
const TILE_MODELED = new Set(["SOURCE_RECT", "INNER_RECT", "SCALE"])

/** `.til` 里除切片之外的原值：`[GLOBAL]` 段还没有 IR 语义，按段原样带回。 */
type AtlasGlobal = Record<string, string>

/** 图集段号 → `SCALE` 原值；未定字段，进切片的 `extra`。 */
function scaleOf(document: IniDocument): Map<number, string> {
  const scales = new Map<number, string>()
  for (const section of document.sections()) {
    const match = /^IMG(\d+)$/i.exec(section)
    const value = document.get(section, "SCALE")?.trim()
    if (match && value) scales.set(Number(match[1]), value)
  }
  return scales
}

/**
 * 每个 `.til` 一个图集：切片矩形进 `Atlas.slices`，`INNER_RECT`/`SCALE` 进切片 `extra`，
 * `[GLOBAL]` 原样带回。切片的像素同时进图片表，写回时按原像素重建同名 png。
 */
function atlasesOf(
  access: DocumentAccess,
  images: Map<string, SkinImage>,
): { atlases: Atlas[]; globals: Map<string, AtlasGlobal> } {
  const atlases: Atlas[] = []
  const globals = new Map<string, AtlasGlobal>()
  for (const path of access.paths()) {
    if (!path.toLowerCase().endsWith(".til")) continue
    const document = access.text(path)
    if (!document) continue
    const global: AtlasGlobal = {}
    for (const entry of document.entries("GLOBAL")) global[entry.key] = entry.value
    if (Object.keys(global).length) globals.set(path, global)
    const scales = scaleOf(document)
    const slices = tileSlices(document).map((tile): AtlasSlice => {
      const extra = new Map<string, unknown>()
      if (tile.inner) extra.set("innerRect", tile.inner)
      const scale = scales.get(tile.index)
      if (scale) extra.set("scale", scale)
      // 切片段里还有 `INFO` 这类没建模的字段：原样保留，写回时逐行还原。
      for (const entry of document.entries(`IMG${tile.index}`)) {
        if (TILE_MODELED.has(entry.key.toUpperCase())) continue
        extra.set(entry.key, entry.value)
      }
      // `[IMG<n>]` 编号是 BDS 的打包细节：记下来，写回时才能原样还原。
      extra.set("tilIndex", tile.index)
      return {
        id: `${path}#${tile.index}`,
        rect: { x: tile.source[0], y: tile.source[1], width: tile.source[2], height: tile.source[3] },
        extra,
      }
    })
    if (!slices.length) continue
    const source = path.replace(/\.til$/i, ".png")
    const bytes = access.bytes(source)
    if (bytes && !images.has(source)) {
      try {
        images.set(source, decodePng(bytes))
      } catch {
        // 源图不是能解码的 PNG；切片已经切出来了，整图外的东西不凭空造。
      }
    }
    atlases.push({ name: path, source, slices })
  }
  return { atlases, globals }
}

/* —— 外观与能力声明 —— */

/** 每套主题方向一个外观；BDS 用目录区分主题，没有时段声明。 */
function appearancesOf(boards: readonly Board[]): AppearanceSet[] {
  const groups = new Map<string, AppearanceSet>()
  for (const board of boards) {
    const key = `${board.theme}/${board.orientation}`
    const existing = groups.get(key)
    if (existing) {
      existing.boards.push(board.id)
      continue
    }
    groups.set(key, {
      theme: board.theme,
      orientation: board.orientation,
      activation: { kind: "theme", theme: board.theme },
      boards: [board.id],
    })
  }
  return [...groups.values()]
}

/**
 * 格式能力与自带声明。`gen.ini` 就是这个包自己的配置声明：每个段声明了哪些字段，
 * 原样记进 `declared`；能力表用格式级的那张，不拿声明反推。
 */
function profileOf(access: DocumentAccess): FormatProfile {
  const declared = new Map<string, string>()
  for (const path of access.paths()) {
    if (!/gen\.ini$/i.test(path)) continue
    const document = access.text(path)
    if (!document) continue
    for (const section of document.sections()) {
      const fields = document.entries(section).map((entry) => entry.key)
      if (fields.length) declared.set(section, fields.join(","))
    }
  }
  return {
    format: "bds",
    capabilities: bdsFormat.capabilities,
    ...(declared.size ? { declared } : {}),
  }
}

/** 样式表文本；图片引用交给调用方换算成「图集名,切片号」。 */
/**
 * 百度皮肤的段名映射。
 * 百度样式段只用数字编号（`[STYLE12]`），其它格式转来的样式名（如 `bda:image:10039`）不能直接当段名，
 * 否则写出的段读不回来。这里给每个样式分配一个合法段名，按键引用与样式表用同一张表。
 */
function styleNames(styles: SkinStyles): Map<string, string> {
  const names = new Map<string, string>()
  const used = new Set<string>()
  let next = 1
  for (const id of styles.keys()) {
    // 已经是纯数字的沿用原编号，避免改变原生皮肤的样式名。
    if (/^\d+$/.test(id) && !used.has(id)) {
      names.set(id, id)
      used.add(id)
      continue
    }
    while (used.has(String(next))) next += 1
    names.set(id, String(next))
    used.add(String(next))
    next += 1
  }
  return names
}

function stylesText(
  styles: SkinStyles,
  imageRef: (id: string) => string | undefined,
  names: ReadonlyMap<string, string>,
  extraOf: (id: string) => readonly string[] | undefined,
  global: ReadonlyMap<string, string> | undefined,
): string {
  const lines: string[] = []
  // 样式表的 `[GLOBAL]` 段是原文件声明的计数等字段，原样写回；没有它就不写。
  if (global?.size) {
    lines.push("[GLOBAL]", ...[...global].map(([key, value]) => `${key}=${value}`), "")
  }
  for (const [id, style] of styles) {
    const name = names.get(id)
    if (!name) continue
    const image = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const pressedImage = (style.pressed ?? []).find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const text = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "text" }> => layer.kind === "text")
    const color = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
    const pressedColor = (style.pressed ?? []).find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
    const sound = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "sound" }> => layer.kind === "sound")
    const normalRef = image && imageRef(image.image)
    const pressedRef = pressedImage && imageRef(pressedImage.image)
    const textColor = text?.style.color ?? color?.value
    const highlightColor = pressedColor?.value
    // 只有文字没有颜色的样式也要写，否则按键引用会指向不存在的段。
    const hasText = text?.text !== undefined || text?.style.fontSize !== undefined
    const extra = extraOf(id)
    if (!normalRef && !pressedRef && !textColor && !highlightColor && !sound && !hasText && !extra) {
      // 空样式段也是原文件的一部分：段头保留，字段本来就是空的。
      lines.push(`[STYLE${name}]`, "")
      continue
    }
    lines.push(`[STYLE${name}]`)
    if (normalRef) lines.push(`NM_IMG=${normalRef}`)
    if (pressedRef) lines.push(`HL_IMG=${pressedRef}`)
    if (textColor) lines.push(`NM_COLOR=${textColor}`)
    if (highlightColor) lines.push(`HL_COLOR=${highlightColor}`)
    if (text?.text !== undefined) lines.push(`SHOW=${text.text}`)
    if (text?.style.fontSize !== undefined) lines.push(`FONT_SIZE=${text.style.fontSize}`)
    if (sound) lines.push(`PRESS_SOUND_PATH=${sound.binding.sound}`)
    // 未建模字段原样写回；语义还不知道，但它们是原文件的一部分。
    for (const line of extra ?? []) lines.push(line)
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

/**
 * `Info.txt` 文本。这个文件里除名字/作者/版本之外还有平台、能力声明等字段，IR 不解释它们，
 * 但它们是原包的事实：读时整表留在 `opaque`，写时原样带回；元信息有值时覆盖同名行。
 */
function infoText(model: SkinModel): string {
  const fields = textFieldsOf(model.opaque.get("info"))
  if (model.meta.name) fields.set("Name", model.meta.name)
  if (model.meta.author) fields.set("Author", model.meta.author)
  if (model.meta.version) fields.set("Version", model.meta.version)
  return `${[...fields].map(([key, value]) => `${key}=${value}`).join("\n")}\n`
}

/** 非按键窗口：候选栏、提示气泡、手写区；原样保留在 opaque 里，导出时按路径写回。 */
type WindowDocument = {
  kind: "candidate" | "hint" | "handwriting"
  theme: Theme
  orientation: Orientation
  sections: ReadonlyMap<string, ReadonlyMap<string, string>>
}

/** 把窗口的分段结构拼回 INI 文本；段与字段顺序按模型里的顺序。 */
function windowText(window: WindowDocument): string {
  const document = IniDocument.parse("")
  for (const [section, fields] of window.sections) {
    document.appendSection(section, [...fields].map(([key, value]) => ({ key, value })))
  }
  return document.toString()
}

export function layoutText(board: Board, renders: ReadonlyArray<Pick<KeyRender, "key" | "rect">>, names?: ReadonlyMap<string, string>): string {
  const lines: string[] = []
  const panels = boardPanels(board) ?? {}
  // 未建模字段按段名原样带回；它们是原文件的一部分，丢掉等于改写源文件。
  const extraOf = (section: string): string[] => [...(panels.extraFields?.get(section) ?? [])]
  // 已经按结构化字段写出的段，不需要再补一次。
  const writtenSections = new Set<string>()
  // 布局文件只写它自己出现过的段；其余面板字段属于 `gen.ini`，写到这里就是凭空多出来的段。
  const layoutSections = new Set(panels.layoutSections ?? [])
  const says = (section: string): boolean => layoutSections.has(section)
  // 空段按原顺序声明；它们的配置在 gen.ini 与面板文件里，段本身只表明存在这个面板。
  for (const section of panels.emptySections ?? []) {
    writtenSections.add(section)
    lines.push(`[${section}]`, "")
  }
  writtenSections.add("PANEL")
  lines.push("[PANEL]")
  if (panels.layoutNoBlur !== undefined) lines.push(`NO_BLUR=${panels.layoutNoBlur ? 1 : 0}`)
  if (panels.handwritingStyle) lines.push(`HW_FORE_STYLE=${panels.handwritingStyle}`)
  if (board.backdrop) lines.push(`BACK_STYLE=${board.backdrop}`)
  // 源文件没声明 SIZE 时容器尺寸是从按键外框算出来的，写回它会把推导值冒充成声明值。
  // 容器未知时也写不出来：宁可省略，不写一个编出来的 0。
  const layoutContainer = containerOf(board)
  if (layoutContainer && panels.containerDeclared !== false) lines.push(`SIZE=${layoutContainer.width},${layoutContainer.height}`)
  lines.push(`KEY_NUM=${panels.keyCount ?? board.keys.length}`)
  // TIP_NUM 是原文件声明的槽位数，可能与实际定义数不同；没有声明时按写出的 TIP 段计。
  const tipCount = panels.tipCount ?? panels.tips?.size ?? 0
  if (tipCount) lines.push(`TIP_NUM=${tipCount}`)
  lines.push(...extraOf("PANEL"), "")
  // 列表段：尺寸、条目、位置与取值都按布局文件自己的声明写回。
  if (panels.layoutList && says("LIST") && Object.keys(panels.layoutList).length) {
    const list = panels.layoutList
    writtenSections.add("LIST")
    lines.push("[LIST]")
    if (list.style) lines.push(`BACK_STYLE=${list.style}`)
    if (list.foreStyle) lines.push(`FORE_STYLE=${list.foreStyle}`)
    if (list.cellStyle) lines.push(`CELL_STYLE=${list.cellStyle}`)
    if (list.cellSize) lines.push(`CELL_SIZE=${list.cellSize.width},${list.cellSize.height}`)
    if (list.count !== undefined) lines.push(`LIST_NUM=${list.count}`)
    if (list.order) lines.push(`LIST_ORDER=${list.order}`)
    if (list.names?.length) lines.push(`NAMES=${list.names.join(" ")}`)
    if (list.offset) lines.push(`POS=${list.offset.x},${list.offset.y}`)
    if (list.padding) lines.push(`PADDING=${list.padding.left},${list.padding.top},${list.padding.right},${list.padding.bottom}`)
    if (list.type !== undefined) lines.push(`TYPE=${list.type}`)
    if (list.values?.length) lines.push(`VALUES=${list.values.join(" ")}`)
    lines.push(...extraOf("LIST"), "")
  }
  if (says("HINT") && (panels.layoutHint?.layoutName || panels.layoutHint?.type !== undefined)) {
    writtenSections.add("HINT")
    lines.push("[HINT]")
    if (panels.layoutHint.layoutName) lines.push(`LAYOUT_NAME=${panels.layoutHint.layoutName}`)
    if (panels.layoutHint.type !== undefined) lines.push(`TYPE=${panels.layoutHint.type}`)
    lines.push(...extraOf("HINT"), "")
  }
  // 符号键盘菜单：类别引用原样写回，顺序按布局名排，稳定可复现。
  if (says("MORE") && panels.layoutMore && (panels.layoutMore.layouts.size || panels.layoutMore.cellStyle || panels.layoutMore.foreStyle || panels.layoutMore.grid || panels.layoutMore.layoutName)) {
    const menu = panels.layoutMore
    writtenSections.add("MORE")
    lines.push("[MORE]")
    if (menu.cellStyle) lines.push(`CELL_STYLE=${menu.cellStyle}`)
    if (menu.foreStyle) lines.push(`FORE_STYLE=${menu.foreStyle}`)
    if (menu.grid) lines.push(`GRID=${menu.grid.width},${menu.grid.height}`)
    if (menu.layoutName) lines.push(`LAYOUT_NAME=${menu.layoutName}`)
    for (const [key, value] of [...menu.layouts].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`${key}=${value}`)
    }
    lines.push(...extraOf("MORE"), "")
  }
  const tipBlocks: string[] = []
  // 板上的状态段全写：有引用的和没引用的都写，孤儿段同样是文件的一部分。
  for (const [section, override] of panels.tips ?? []) {
    writtenSections.add(`TIP${section}`)
    tipBlocks.push(...tipLines(override, section, actionValue), ...extraOf(`TIP${section}`))
  }
  // 没有几何的键排在后面：原文件里它们也是附在末尾的模板段，写回顺序保持不变。
  const orderedKeys = [
    ...board.keys.filter((key) => key.layoutId !== undefined),
    ...board.keys.filter((key) => key.layoutId === undefined),
  ]
  // BDS 的按键段名是 `[KEYn]`；别的格式的键 id 是任意标识符，写进 `.til` 前要改成段名，
  // 否则读回时认不出这些段。原生键 id 已经是 `KEYn`，原样沿用。
  const sectionNames = new Map<string, string>()
  const sectionOf = (key: Key): string => {
    if (/^KEY\d+$/i.test(key.id)) return key.id
    const existing = sectionNames.get(key.id)
    if (existing !== undefined) return existing
    let next = 1
    const used = new Set(sectionNames.values())
    while (used.has(`KEY${next}`)) next += 1
    const name = `KEY${next}`
    sectionNames.set(key.id, name)
    return name
  }
  for (const key of orderedKeys) {
    // 几何只有布局树这一个来源：taffy 算出矩形，写回的就是它。
    const rect = renders.find((render) => render.key.id === key.id)?.rect
    // 有 layoutId 却没有矩形说明布局树对不上；没有 layoutId 的键本来就没有几何，段照写。
    if (!rect && key.layoutId !== undefined) continue
    lines.push(`[${sectionOf(key)}]`)
    if (rect) {
      lines.push(`VIEW_RECT=${rect.x},${rect.y},${rect.width},${rect.height}`)
    }
    if (key.hitArea?.kind === "none") {
      lines.push("TOUCH_RECT=0,0,0,0")
    } else if (key.hitArea?.kind === "same" && rect) {
      // 源文件写了 TOUCH_RECT 且与显示区重合：读成 `same`，写回仍要显式声明这一行。
      lines.push(`TOUCH_RECT=${rect.x},${rect.y},${rect.width},${rect.height}`)
    } else if (key.hitArea?.kind === "inset" && rect) {
      const edges = key.hitArea.edges
      lines.push(`TOUCH_RECT=${Math.round(rect.x + edges.left)},${Math.round(rect.y + edges.top)},${Math.round(rect.width - edges.left - edges.right)},${Math.round(rect.height - edges.top - edges.bottom)}`)
    }
    if (key.padding) lines.push(`PADDING=${key.padding.left},${key.padding.top},${key.padding.right},${key.padding.bottom}`)
    if (key.foreground && rect) {
      const area = key.foreground
      lines.push(`FOREGROUND_RECT=${Math.round(rect.x + area.left * rect.width)},${Math.round(rect.y + area.top * rect.height)},${Math.round((1 - area.left - area.right) * rect.width)},${Math.round((1 - area.top - area.bottom) * rect.height)}`)
    }
    if (key.labelPosition) lines.push(`POS_TYPE=${key.labelPosition.join(",")}`)
    if (key.label) lines.push(`SHOW=${key.label}`)
    if (key.holdSymbol) lines.push(`HOLDSYM=${key.holdSymbol}`)
    if (key.info) lines.push(`INFO=${key.info}`)
    // 状态覆盖写成 `[TIPn]` 段，按键只留状态名与段号；段内容从板上的池里取。
    const refs = key.stateRefs ?? []
    if (refs.length) lines.push(`STAT_STYLE=${refs.map((ref) => `${ref.state}_${ref.section}`).join("|")}`)
    for (const { event, field: name } of EVENT_FIELDS) {
      const value = actionValue(key.actions[event])
      if (value !== undefined) lines.push(`${name}=${value}`)
    }
    // 样式引用要经过同一张名表，否则键会指向不存在的段。
    const styleName = (id: string): string => names?.get(id) ?? id
    const container = key.container
    if (container.back?.style) lines.push(`BACK_STYLE=${styleName(container.back.style)}`)
    if (container.back?.pressed) lines.push(`HL_BACK_STYLE=${styleName(container.back.pressed)}`)
    if (container.fore.length) lines.push(`FORE_STYLE=${container.fore.map((layer) => (layer.style ? styleName(layer.style) : "")).join(",")}`)
    if (container.back?.anim) lines.push(`BACK_ANIM_STYLE=${styleName(container.back.anim)}`)
    // 前景动画与偏移按层写，空位保留：层数由逗号分隔的空位决定。
    if (container.fore.some((layer) => layer.anim)) {
      lines.push(`FORE_ANIM_STYLE=${container.fore.map((layer) => (layer.anim ? styleName(layer.anim) : "")).join(",")}`)
    }
    if (container.fore.some((layer) => layer.offset)) {
      lines.push(`FORE_OFFSET=${container.fore.map((layer) => (layer.offset ? `${layer.offset.x},${layer.offset.y}` : "")).join(";")}`)
    }
    if (container.press) lines.push(`PRESS_STYLE=${styleName(container.press)}`)
    if (container.pressAnim) lines.push(`ANIM_STYLE=${styleName(container.pressAnim)}`)
    if (key.sound) lines.push(`SOUND_STYLE=${key.sound}`)
    // 按键自身的动效引用：一张表里按键 id → 动效 id。
    const motions = Object.entries(key.motions ?? {}).flatMap(([slot, id]) => (id ? [`${slot.toUpperCase()}_ANIM=${id}`] : []))
    lines.push(...motions)
    writtenSections.add(sectionOf(key))
    lines.push(...extraOf(sectionOf(key)), "")
  }
  // 只有未建模字段、没有结构化字段的段：原样写回，不猜它的含义。
  for (const section of panels.extraFields?.keys() ?? []) {
    if (writtenSections.has(section)) continue
    lines.push(`[${section}]`, ...extraOf(section), "")
  }
  return `${[...lines, ...tipBlocks].join("\n")}\n`
}

/* —— 动效 —— */

function field(entry: LegacyAnimationEntry, key: string): string | undefined {
  return entry.fields.find(([name]) => name === key)?.[1]?.trim()
}

function numberField(entry: LegacyAnimationEntry, key: string): number | undefined {
  const value = Number(field(entry, key))
  return Number.isFinite(value) ? value : undefined
}

function range(value: string | undefined): MotionRange | undefined {
  if (!value) return
  const random = value.match(/rand\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i)
  if (random) return [Number(random[1]), Number(random[2])]
  const number = Number(value)
  return Number.isFinite(number) ? [number, number] : undefined
}

function pair(value: string | undefined): [MotionRange, MotionRange] | undefined {
  const parts = value?.split(",").map((part) => part.trim())
  if (!parts || parts.length !== 2) return
  const x = range(parts[0])
  const y = range(parts[1])
  return x && y ? [x, y] : undefined
}

function singleRange(value: string | undefined): [MotionRange, MotionRange] | undefined {
  const parsed = range(value)
  return parsed ? [parsed, parsed] : undefined
}

function trackOf(entry: LegacyAnimationEntry): MotionTrack | undefined {
  const type = entry.type
  if (type === undefined) return
  const property: MotionTrack["property"] = type === 0 ? "alpha" : type === 1 ? "rotate" : type === 2 ? "translate" : type === 3 || type === 4 ? "scale" : "rotate3d"
  const from = type === 2 ? pair(field(entry, "FROM_PX")) : singleRange(field(entry, "FROM"))
  const to = type === 2 ? pair(field(entry, "TO_PX")) : singleRange(field(entry, "TO"))
  if (!from || !to) return
  const pivot = pair(field(entry, "PIVOT_PX")) ?? pair(field(entry, "PIVOT"))
  return {
    property,
    from,
    to,
    relative: false,
    easing: { kind: "linear" },
    ...(pivot ? { pivot: { x: pivot[0][0], y: pivot[1][0] } } : {}),
  }
}

function regionOf(entry: LegacyAnimationEntry): LayoutBox {
  const parts = field(entry, "EMIT_REGION")?.split(",").map((part) => Number(part.trim()))
  return parts && parts.length === 4 && parts.every(Number.isFinite)
    ? { position: { x: parts[0], y: parts[1] }, size: { width: parts[2], height: parts[3] } }
    : { position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }
}

function emitterOf(entry: LegacyAnimationEntry): MotionEmitter {
  const empty: MotionRange = [0, 0]
  return {
    images: field(entry, "PARTICLE_IMAGE")?.split("|").map((part) => part.trim()).filter(Boolean) ?? [],
    type: field(entry, "TYPE") === "1" ? "complex" : "simple",
    life: range(field(entry, "LIFE")) ?? empty,
    count: numberField(entry, "TOTAL_NUMBER") ?? 0,
    birthRate: numberField(entry, "BIRTH_RATE") ?? 0,
    region: regionOf(entry),
    velocity: range(field(entry, "VELOCITY")) ?? empty,
    velocityDirection: range(field(entry, "VELOCITY_DIRECTION")) ?? empty,
    acceleration: range(field(entry, "ACCELERATION")) ?? empty,
    accelerationDirection: range(field(entry, "ACCELERATION_DIRECTION")) ?? empty,
    scale: range(field(entry, "INIT_SCALE")) ?? empty,
    scaleSpeed: range(field(entry, "SCALE_SPEED")) ?? empty,
    rotation: range(field(entry, "INIT_ROTATE")) ?? empty,
    rotationSpeed: range(field(entry, "ROTATE_SPEED")) ?? empty,
    alpha: range(field(entry, "INIT_ALPHA")) ?? empty,
    alphaSpeed: range(field(entry, "ALPHA_SPEED")) ?? empty,
    finish: field(entry, "FINISH_AFTER_PRACTICES") === "1" ? "emitted" : "gone",
    removeWithParticles: field(entry, "REMOVE_INCLUDE_PRACTICES") === "1",
    mirror: numberField(entry, "MIRROR_UP") ?? 0,
  }
}

const DEFAULT_TIMELINE: MotionTimeline = { delay: 0, duration: 0, repeat: 1, reverse: false, clear: false }

/** 一个动画段的时长与循环信息；设计稿的节点没有这两项，写回按它还原。 */
function timelineOf(entry: LegacyAnimationEntry): MotionTimeline {
  return {
    delay: numberField(entry, "DELAY") ?? 0,
    duration: numberField(entry, "DURATION") ?? 0,
    repeat: field(entry, "REPEAT_CNT")?.toLowerCase() === "inf" ? -1 : numberField(entry, "REPEAT_CNT") ?? 1,
    reverse: field(entry, "REPEAT_MODE") === "1",
    clear: field(entry, "REMOVE") === "1",
  }
}

function nodeOf(entries: Map<string, LegacyAnimationEntry>, entry: LegacyAnimationEntry, seen: Set<string>): MotionNode {
  const timeline = timelineOf(entry)
  if (entry.kind === "basic") {
    const track = trackOf(entry)
    // 读不出起点终点的基本动画没有可归一的内容，按不透明节点原样保留。
    if (!track) return { kind: "opaque", format: "bds.basic", blob: entry, timeline }
    return {
      kind: "track",
      target: { subject: "unknown", property: motionPropertyOf(track.property) },
      keyframes: keyframesOf(track, timeline.duration),
      easing: track.easing,
      ...(track.pivot ? { pivot: track.pivot } : {}),
      timeline,
    }
  }
  if (entry.kind === "combination") {
    const ids = field(entry, "BUILD_LIST")?.split(",").map((part) => part.trim()).filter(Boolean) ?? []
    const children = ids.flatMap((id) => {
      const section = /^\d+$/.test(id) ? `ANIM${id}` : id
      const child = entries.get(section)
      return child && !seen.has(section) ? [nodeOf(entries, child, new Set([...seen, section]))] : []
    })
    const method = field(entry, "BUILD_METHOD") === "2" ? "random" : field(entry, "BUILD_METHOD") === "1" ? "sequential" : "simultaneous"
    return { kind: "group", children, method, timeline }
  }
  if (entry.kind === "frame") {
    const file = field(entry, "ANIM_PATH")
    return { kind: "frames", frames: file ? [{ image: file }] : [], timeline }
  }
  return { kind: "opaque", format: "bds.particles", blob: emitterOf(entry), timeline }
}

function motionsOf(text: string): SkinMotions {
  const document = parseLegacyAnimationFile(text)
  const entries = new Map(document.entries.map((entry) => [entry.section, entry]))
  const motions = new Map<string, MotionNode>()
  for (const entry of document.entries) {
    motions.set(entry.section, nodeOf(entries, entry, new Set([entry.section])))
  }
  return motions
}

function rangeText(value: MotionRange): string {
  return value[0] === value[1] ? String(value[0]) : `rand(${value[0]},${value[1]})`
}

function animationIndex(id: string): string {
  return id.match(/\d+/)?.[0] ?? id
}

export function writeMotions(motions: SkinMotions): string {
  const lines: string[] = []
  let counter = Math.max(0, ...[...motions.keys()].map((id) => Number(id.match(/^ANIM(\d+)$/)?.[1] ?? 0))) + 1
  const write = (node: MotionNode, id: string): void => {
    // 只能写回 BDS 自己的不透明节点；别的格式的没有对应段，跳过而不是写出空段。
    if (node.kind === "opaque" && node.format !== "bds.particles" && !Array.isArray((node.blob as LegacyAnimationEntry).fields)) return
    const timeline = node.timeline ?? DEFAULT_TIMELINE
    lines.push(`[${id}]`)
    if (node.kind === "track") {
      const property = node.target.property
      const type = property === "alpha" ? 0 : property === "rotation" ? 1 : property === "x" || property === "y" ? 2 : property === "scale" ? 3 : 5
      lines.push("CATEGORY=0", `TYPE=${type}`, `DELAY=${Math.round(timeline.delay)}`, `DURATION=${Math.round(timeline.duration)}`)
      const from = node.keyframes[0]?.value ?? 0
      const to = node.keyframes[node.keyframes.length - 1]?.value ?? 0
      if (type === 2) lines.push(`FROM_PX=${from},${from}`, `TO_PX=${to},${to}`)
      else lines.push(`FROM=${from}`, `TO=${to}`)
      if (node.pivot) lines.push(`PIVOT=${node.pivot.x},${node.pivot.y}`)
    } else if (node.kind === "group") {
      const childIds = node.children.map(() => `ANIM${counter++}`)
      const method = node.method === "random" ? 2 : node.method === "sequential" ? 1 : 0
      lines.push("CATEGORY=1", `BUILD_LIST=${childIds.map(animationIndex).join(",")}`, `BUILD_METHOD=${method}`, `DELAY=${Math.round(timeline.delay)}`)
      for (const [index, child] of node.children.entries()) write(child, childIds[index])
    } else if (node.kind === "frames") {
      lines.push("CATEGORY=2", `ANIM_PATH=${node.frames[0]?.image ?? ""}`)
    } else if (node.kind === "opaque" && node.format === "bds.particles") {
      const emitter = node.blob as MotionEmitter
      lines.push("CATEGORY=3", `TYPE=${emitter.type === "complex" ? 1 : 0}`, `PARTICLE_IMAGE=${emitter.images.join("|")}`)
      lines.push(`TOTAL_NUMBER=${emitter.count}`, `BIRTH_RATE=${emitter.birthRate}`, `EMIT_REGION=${emitter.region.position.x},${emitter.region.position.y},${emitter.region.size.width},${emitter.region.size.height}`)
      lines.push(`LIFE=${rangeText(emitter.life)}`, `VELOCITY=${rangeText(emitter.velocity)}`, `VELOCITY_DIRECTION=${rangeText(emitter.velocityDirection)}`)
      lines.push(`ACCELERATION=${rangeText(emitter.acceleration)}`, `ACCELERATION_DIRECTION=${rangeText(emitter.accelerationDirection)}`)
      lines.push(`INIT_SCALE=${rangeText(emitter.scale)}`, `SCALE_SPEED=${rangeText(emitter.scaleSpeed)}`)
      lines.push(`INIT_ROTATE=${rangeText(emitter.rotation)}`, `ROTATE_SPEED=${rangeText(emitter.rotationSpeed)}`)
      lines.push(`INIT_ALPHA=${rangeText(emitter.alpha)}`, `ALPHA_SPEED=${rangeText(emitter.alphaSpeed)}`)
      lines.push(`DURATION=${Math.round(timeline.duration)}`, `DELAY=${Math.round(timeline.delay)}`)
    } else if (node.kind === "opaque") {
      // 不认识的动画段：按原字段写回，不重新解释。
      for (const [name, value] of (node.blob as LegacyAnimationEntry).fields) lines.push(`${name}=${value}`)
    }
    lines.push(
      `REPEAT_CNT=${timeline.repeat < 0 ? "inf" : timeline.repeat}`,
      `REPEAT_MODE=${timeline.reverse ? 1 : 0}`,
      `REMOVE=${timeline.clear ? 1 : 0}`,
      "",
    )
  }
  for (const [id, node] of motions) write(node, id)
  return `${lines.join("\n")}\n`
}

/* —— 模型 —— */

/** 字符串字段表：`Info.txt` 的整张表、样式表 `[GLOBAL]` 的字段都走这一种形状。 */
function textFieldsOf(value: unknown): Map<string, string> {
  const fields = new Map<string, string>()
  if (!(value instanceof Map)) return fields
  for (const [key, item] of value) {
    if (typeof key === "string" && typeof item === "string") fields.set(key, item)
  }
  return fields
}

/** `opaque` 里样式段保留的原始行；值不是字符串数组时当作没有。 */
function styleFieldsOf(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return
  const lines: string[] = []
  for (const item of value) {
    if (typeof item !== "string") return
    lines.push(item)
  }
  return lines
}

function infoOf(access: DocumentAccess): { name?: string; author?: string; version?: string; fields: Map<string, string>; exists: boolean } {
  const document = access.text("Info.txt")
  const fields = new Map<string, string>()
  if (!document) return { fields, exists: false }
  for (const entry of document.entries()) fields.set(entry.key, entry.value)
  const value = (key: string): string | undefined => {
    const hit = [...fields].find(([name]) => name.toLowerCase() === key.toLowerCase())
    return hit?.[1].trim() || undefined
  }
  return {
    ...(value("Name") ? { name: value("Name") } : {}),
    ...(value("Author") ? { author: value("Author") } : {}),
    ...(value("Version") ? { version: value("Version") } : {}),
    fields,
    exists: true,
  }
}

/**
 * 布局文件的容器尺寸：`[PANEL] SIZE` 是声明值；没有声明时用所有 `VIEW_RECT` 的右下外框，
 * 那是能从文件算出的下界，并明确标成「不是声明的」。两者都没有就没有容器，返回 undefined。
 */
function panelSizeOf(document: IniDocument, keys: ReadonlyArray<{ rect: LayoutBox }>): { size: Size<number>; declared: boolean } | undefined {
  const parts = numbersOf(document.get("PANEL", "SIZE"))
  if (parts.length === 2 && parts.every((value) => value > 0)) {
    return { size: { width: parts[0], height: parts[1] }, declared: true }
  }
  if (!keys.length) return
  const width = Math.max(...keys.map((key) => key.rect.position.x + key.rect.size.width))
  const height = Math.max(...keys.map((key) => key.rect.position.y + key.rect.size.height))
  if (!(width > 0) || !(height > 0)) return
  return { size: { width, height }, declared: false }
}

/**
 * 组件在画布上的矩形：优先 `VIEW_RECT`，没有就按 `SIZE` + `ANCHOR_TYPE` + `POS` 摆到面板上。
 * 候选栏铺满整板；其余组件没给尺寸就没有几何。
 */
function componentRect(document: IniDocument, section: string, panel: Size<number>): LayoutBox | undefined {
  const read = (name: string): string | undefined => document.get(section, name)?.trim() || undefined
  const viewRect = numbersOf(read("VIEW_RECT"))
  const size = numbersOf(read("SIZE"))
  const spansPanel = section === "PANEL" || section === "CAND"
  const width = viewRect.length === 4 ? viewRect[2] : spansPanel ? panel.width : size[0] ?? 0
  const height = viewRect.length === 4 ? viewRect[3] : spansPanel ? panel.height : size[1] ?? 0
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
  if (viewRect.length === 4) {
    return { position: { x: viewRect[0], y: viewRect[1] }, size: { width, height } }
  }
  if (section === "PANEL") return { position: { x: 0, y: 0 }, size: { width, height } }
  const position = numbersOf(read("POS"))
  const anchor = Number(read("ANCHOR_TYPE"))
  const offsetX = Number.isFinite(position[0]) ? position[0] : 0
  const offsetY = Number.isFinite(position[1]) ? position[1] : 0
  const xAnchor = ((anchor - 1) % 3) + 1
  const yAnchor = Math.ceil(anchor / 3)
  return {
    position: {
      x: xAnchor === 2 ? panel.width / 2 + offsetX : xAnchor === 3 ? panel.width + offsetX : offsetX,
      y: yAnchor === 2 ? panel.height / 2 + offsetY : yAnchor === 3 ? panel.height + offsetY : offsetY,
    },
    size: { width, height },
  }
}

/** 组件段的样式引用；`CAND.FORE_STYLE` 是候选词的运行时样式，不算整条候选栏的前景。 */
function componentStyles(document: IniDocument, section: string): { back?: string; fore: string[] } {
  const read = (name: string): string | undefined => document.get(section, name)?.trim() || undefined
  return {
    ...(read("BACK_STYLE")?.split(",")[0] ? { back: read("BACK_STYLE")!.split(",")[0] } : {}),
    fore: section === "CAND" ? [] : read("FORE_STYLE")?.split(",").map((token) => token.trim()).filter(Boolean) ?? [],
  }
}

/** 预览画布的缺省尺寸：文件既没声明 `SIZE` 又没有按键时，编辑器仍要有一块画布才画得出。 */
const PREVIEW_CONTAINER: Size<number> = { width: 1080, height: 600 }

/**
 * 一份布局文档解析成板：按键、布局树、面板样式与状态池。
 * 编辑器的画布与检查器共用这一份板，不再各自回文档取数。
 */
export function bdsBoardOf(
  document: IniDocument,
  options: { id: string; orientation: Orientation; theme: Theme },
): Board {
  const entries = keysOf(document)
  const placed = entries.filter((entry) => entry.placed)
  const measured = panelSizeOf(document, placed)
  const panel = measured?.size ?? PREVIEW_CONTAINER
  const panelStyle = document.get("PANEL", "BACK_STYLE")?.trim() || undefined
  const panelFore = document.get("PANEL", "FORE_STYLE")?.trim() || undefined
  const keyCount = keyCountOf(document)
  const tipCount = tipCountOf(document)
  // 组件几何写进板：画布只读板，不再回文档算位置。
  const backdropRect = componentRect(document, "PANEL", panel)
  const candidateRect = componentRect(document, "CAND", panel)
  const listRect = componentRect(document, "LIST", panel)
  const moreRect = componentRect(document, "MORE", panel)
  const hintRect = componentRect(document, "HINT", panel)
  const candidateStyles = componentStyles(document, "CAND")
  const panels: BoardPanels = {
    ...(panelStyle || panelFore || backdropRect
      ? {
        backdrop: {
          ...(panelStyle ? { style: panelStyle } : {}),
          ...(panelFore ? { foreStyle: panelFore } : {}),
          size: panel,
          ...(backdropRect ? { viewRect: backdropRect } : {}),
        },
      }
      : {}),
    ...(candidateRect
      ? {
        candidates: [{
          ...(candidateStyles.back ? { style: candidateStyles.back } : {}),
          ...(document.get("CAND", "CELL_STYLE")?.trim() ? { cellStyle: document.get("CAND", "CELL_STYLE")!.trim() } : {}),
          viewRect: candidateRect,
        }],
      }
      : {}),
    ...(listRect ? { list: { viewRect: listRect } } : {}),
    ...(moreRect ? { more: { layouts: new Map(), viewRect: moreRect } } : {}),
    ...(hintRect ? { hint: { viewRect: hintRect } } : {}),
    ...(keyCount !== undefined ? { keyCount } : {}),
    ...(tipCount !== undefined ? { tipCount } : {}),
    tips: tipPoolOf(document, { actionOf }),
  }
  return {
    id: options.id,
    kind: "main",
    theme: options.theme,
    orientation: options.orientation,
    geometry: { kind: "document" },
    container: knownContainer(panel),
    layout: absoluteBoard(placed.map((entry) => ({ id: entry.key.id, ...entry.rect }))),
    ...(panelStyle ? { backdrop: panelStyle } : {}),
    keys: entries.map((entry) => entry.key),
    panels,
  }
}

/** 同一主题方向下的布局文件：去掉 `gen.ini` 与面板专用文件，只保留真有按键段的。 */
function layoutFiles(access: DocumentAccess, theme: Theme, orientation: Orientation): string[] {
  // 这几类与手写区同目录，即便带按键段也不是键盘布局。
  return access.paths().filter((name) => {
    // 先按路径规则判断是不是布局，再按内容确认有没有按键段。
    if (!isBdsLayoutPath(name)) return false
    if (appearanceOf(name) !== theme || orientationOf(name) !== orientation) return false
    const leaf = `${bdsBoardName(name)?.toLowerCase() ?? ""}.ini`
    if (leaf === "gen.ini" || leaf === "more.ini" || leaf === "toolbar.ini") return false
    // `bh.ini`、`hw_*.ini` 是手写区自己的布局，不是键盘板。
    if (leaf === "bh.ini" || /^hw_/.test(leaf)) return false
    return (textContent(access, name) ?? "").includes("[KEY")
  })
}

/** 板种类由布局文件名推断；找不到特征名时归入其它。 */
function boardKindOf(layout: string): BoardKind {
  const name = (layout.split("/").pop() ?? "").replace(/\.ini$/i, "").toLowerCase()
  if (/symbol|^zy|^bq|emoji|^sel|_ch$/.test(name)) return "symbol"
  if (/^cand|^hy/.test(name)) return "candidate"
  // `bh` 是笔画键盘：B1~B9 的横竖撇捺折，与数字九宫格是两种输入形态。
  if (/^bh/.test(name)) return "stroke"
  // 九宫格的名字带 `_9`，要在 `py`/`en` 之前判断，否则会被当成 26 键主板。
  if (/(?:^|_)(?:9)$|^num/.test(name)) return "number"
  if (/^(?:py|en|def|hw|big)/.test(name)) return "main"
  return "other"
}

/** 一个 `[KEYn]` 段的原始字段，按 BDS 自己的写法逐个读；缺失就是缺失。 */
type KeyFields = {
  rect?: LayoutBox
  show?: string
  center?: string
  up?: string
  down?: string
  left?: string
  right?: string
  hold?: string
}

/**
 * 读一个按键段的字段表。`DOWN` 只在文件里写出时才算有下滑动作：
 * 「缺省时下滑等于字面」是客户端的运行时规则，不是这个文件的事实，不能在这里补进去，
 * 否则写回会凭空多出 `DOWN=` 行。
 */
function keyFieldsOf(document: IniDocument, section: string): KeyFields {
  const read = (name: string): string | undefined => document.get(section, name)?.trim() || undefined
  const rect = numbersOf(read("VIEW_RECT"))
  return {
    ...(rect.length === 4
      ? { rect: { position: { x: rect[0], y: rect[1] }, size: { width: rect[2], height: rect[3] } } }
      : {}),
    ...(read("SHOW") ? { show: read("SHOW") } : {}),
    ...(read("CENTER") ? { center: read("CENTER") } : {}),
    ...(read("UP") ? { up: read("UP") } : {}),
    ...(read("DOWN") ? { down: read("DOWN") } : {}),
    ...(read("LEFT") ? { left: read("LEFT") } : {}),
    ...(read("RIGHT") ? { right: read("RIGHT") } : {}),
    ...(read("HOLD") ? { hold: read("HOLD") } : {}),
  }
}

/**
 * 一份布局文档里的按键：动作按事件拆分，样式从按键容器上取。
 * 几何单独返回：它只喂布局推导，不进按键。
 */
function keysOf(document: IniDocument): Array<{ key: Key; rect: LayoutBox; placed: boolean }> {
  return document.sections().flatMap((section) => {
    if (!/^KEY\d+$/i.test(section)) return []
    const item = keyFieldsOf(document, section)
    const read = (name: string): string | undefined => document.get(section, name)?.trim() || undefined
    const touchRect = numbersOf(read("TOUCH_RECT"))
    const padding = numbersOf(read("PADDING"))
    const positionTypes = read("POS_TYPE")?.split(",").map((token) => Number(token.trim())).filter((each) => Number.isFinite(each)) ?? []
    const foreStyles = read("FORE_STYLE")?.split(",").map((token) => token.trim()).filter(Boolean) ?? []
    const foreOffsets = read("FORE_OFFSET")?.split(";").map((token) => {
      const parts = numbersOf(token)
      return parts.length === 2 ? { x: parts[0], y: parts[1] } : undefined
    }) ?? []
    const foreAnims = read("FORE_ANIM_STYLE")?.split(",").map((token) => token.trim()) ?? []
    const actions: Key["actions"] = {}
    const press = actionOf(item.center || item.show)
    if (press) actions.press = press
    const label = item.show
    const hold = actionOf(item.hold)
    if (hold) actions["long-press"] = hold
    const up = actionOf(item.up)
    if (up) actions["swipe-up"] = up
    // 按下与下滑是不同事件，即使动作相同也要各自写回。
    const down = actionOf(item.down)
    if (down) actions["swipe-down"] = down
    const left = actionOf(item.left)
    if (left) actions["swipe-left"] = left
    const right = actionOf(item.right)
    if (right) actions["swipe-right"] = right
    // 皮肤状态下的另一套样式与动作写在 `[TIPn]` 里；按键只记状态名与段号。
    const refs = tipsOf(read("STAT_STYLE"))
    const back = read("BACK_STYLE")
    const pressed = read("HL_BACK_STYLE")
    const backAnim = read("BACK_ANIM_STYLE")
    const showing = read("SHOW")
    const foreRect = numbersOf(read("FOREGROUND_RECT"))
    const rect = item.rect ?? { position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }
    const placed = rect.size.width > 0
    // TOUCH_RECT 是绝对像素，归一到显示区的四边内缩；全零表示显式没有触摸区，
    // 与显示区重合说明触摸区就是显示区，不是一层「内缩了 0」的覆盖。
    const hitArea: Key["hitArea"] = touchRect.length === 4
      ? touchRect.every((each) => each === 0)
        ? { kind: "none" }
        : placed
          ? (() => {
            const edges = {
              left: touchRect[0] - rect.position.x,
              top: touchRect[1] - rect.position.y,
              right: rect.position.x + rect.size.width - (touchRect[0] + touchRect[2]),
              bottom: rect.position.y + rect.size.height - (touchRect[1] + touchRect[3]),
            }
            const same = edges.left === 0 && edges.top === 0 && edges.right === 0 && edges.bottom === 0
            return same ? { kind: "same" as const } : { kind: "inset" as const, edges }
          })()
          : undefined
      : undefined
    // FOREGROUND_RECT 是绝对像素，归一到显示区内的比例；只有知道显示区才算得出。
    const foreground: Key["foreground"] = placed && foreRect.length === 4 && rect.size.width > 0 && rect.size.height > 0
      ? {
        left: (foreRect[0] - rect.position.x) / rect.size.width,
        top: (foreRect[1] - rect.position.y) / rect.size.height,
        right: (rect.position.x + rect.size.width - (foreRect[0] + foreRect[2])) / rect.size.width,
        bottom: (rect.position.y + rect.size.height - (foreRect[1] + foreRect[3])) / rect.size.height,
      }
      : undefined
    const key: Key = {
      id: section,
      // 只有进布局树的键才有节点；没有 VIEW_RECT 的段是「有身份、无几何」，不填 layoutId。
      ...(placed ? { layoutId: section } : {}),
      ...(hitArea ? { hitArea } : {}),
      ...(padding.length === 4 ? { padding: { left: padding[0], top: padding[1], right: padding[2], bottom: padding[3] } } : {}),
      ...(foreground ? { foreground } : {}),
      ...(label ? { label } : {}),
      // 长按弹出的符号串，原文件给什么就带回什么。
      ...(read("HOLDSYM") ? { holdSymbol: read("HOLDSYM") } : {}),
      ...(read("INFO") ? { info: read("INFO") } : {}),
      ...(positionTypes.length ? { labelPosition: positionTypes } : {}),
      actions,
      // 按键自己的容器：背景一层、前景若干层（各带偏移与动画）、文字层。
      container: {
        ...(back || pressed || backAnim
          ? {
            back: {
              ...(back ? { style: back } : {}),
              ...(pressed ? { pressed } : {}),
              ...(backAnim ? { anim: backAnim } : {}),
            },
          }
          : {}),
        fore: foreStyles.map((styleName, index) => ({
          style: styleName,
          ...(foreOffsets[index] ? { offset: foreOffsets[index] } : {}),
          ...(foreAnims[index] ? { anim: foreAnims[index] } : {}),
        })),
        ...(showing || positionTypes.length
          ? {
            text: {
              ...(showing ? { content: showing } : {}),
              ...(positionTypes.length ? { placement: positionTypes } : {}),
            },
          }
          : {}),
        // `ANIM_STYLE` 与 `PRESS_STYLE` 是原文件里两个不同字段：前者是按下时的动效样式，
        // 后者是按下样式。合成一个会让写回只能挑一个，另一个直接丢。
        ...(read("ANIM_STYLE") ? { pressAnim: read("ANIM_STYLE") } : {}),
        ...(read("PRESS_STYLE") ? { press: read("PRESS_STYLE") } : {}),
      },
      ...(refs.length ? { stateRefs: refs } : {}),
    }
    return [{ key, rect, placed }]
  })
}

/** 图集名：单页叫 `atlas`，多页追加页码。 */
function atlasName(page: number): string {
  return page === 0 ? "atlas" : `atlas${page}`
}

export type LayoutBoards = {
  boards: Board[]
  /** 面板文件的原路径，导出时沿用。 */
  paths: PanelPaths
  /** 没有几何、建不成板的布局文件；它们的原文由调用方原样保留。 */
  skipped: string[]
}

/**
 * 只读布局：把主题方向下的布局文件解析成板与按键几何，不碰样式。
 * BDS 的样式在 `default.css`，BDA 的样式在外观配置里，两者共用这份布局解析。
 */
/** 布局文件里声明但内容为空的段；有字段的段必须在 IR 里有对应字段。 */
function emptySectionsOf(document: IniDocument): string[] {
  return document.sections().filter((section) => {
    if (/^KEY\d+$/i.test(section) || /^TIP\d+$/i.test(section)) return false
    return document.entries(section).length === 0
  })
}

/** `[KEYn]` 里按结构化字段读出的字段名；其余字段原样保留。 */
const KEY_MODELED = new Set([
  "VIEW_RECT", "TOUCH_RECT", "PADDING", "FOREGROUND_RECT", "POS_TYPE", "SHOW", "HOLDSYM", "INFO",
  "STAT_STYLE", "CENTER", "UP", "DOWN", "LEFT", "RIGHT", "HOLD",
  "BACK_STYLE", "HL_BACK_STYLE", "FORE_STYLE", "FORE_OFFSET", "FORE_ANIM_STYLE", "BACK_ANIM_STYLE",
  "PRESS_STYLE", "ANIM_STYLE", "SOUND_STYLE",
])

/** `[TIPn]` 里按结构化字段读出的字段名。 */
const TIP_MODELED = new Set([
  "VIEW_RECT", "POS_TYPE", "SHOW", "HOLDSYM", "INFO",
  "CENTER", "UP", "DOWN", "LEFT", "RIGHT", "HOLD",
  "BACK_STYLE", "HL_BACK_STYLE", "FORE_STYLE",
])

/** 固定段名里的已建模字段；没列出的字段进 `extraFields` 原样保留。 */
const SECTION_MODELED: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["PANEL", new Set(["SIZE", "BACK_STYLE", "FORE_STYLE", "NO_BLUR", "HW_FORE_STYLE", "KEY_NUM", "TIP_NUM"])],
  ["LIST", new Set(["BACK_STYLE", "FORE_STYLE", "CELL_STYLE", "CELL_SIZE", "LIST_NUM", "LIST_ORDER", "NAMES", "POS", "PADDING", "TYPE", "VALUES"])],
  ["HINT", new Set(["LAYOUT_NAME", "TYPE"])],
  ["MORE", new Set(["CELL_STYLE", "FORE_STYLE", "GRID", "LAYOUT_NAME"])],
])

function modeledField(section: string, field: string): boolean {
  const name = field.toUpperCase()
  if (/^KEY\d+$/i.test(section)) return KEY_MODELED.has(name) || /^[A-Z]+_ANIM$/.test(name)
  if (/^TIP\d+$/i.test(section)) return TIP_MODELED.has(name)
  const modeled = SECTION_MODELED.get(section.toUpperCase())
  if (!modeled) return false
  return modeled.has(name) || (section.toUpperCase() === "MORE" && /_LAYOUT$/.test(name))
}

/**
 * 布局文件里没有被建模的字段，按段名收集原始行。
 * 这些字段的语义还不知道，但它们是文件里的事实：原样保留、原样写回，不猜也不丢。
 * 同一个键在一个段里重复出现时，只有第一次算建模过，其余都按未建模保留——
 * 客户端读哪一份不确定，丢掉其中一份就是替它做选择。
 */
function unmodeledFieldsOf(document: IniDocument): ReadonlyMap<string, readonly string[]> {
  const extra = new Map<string, readonly string[]>()
  for (const section of document.sections()) {
    const seen = new Set<string>()
    const lines: string[] = []
    for (const entry of document.entries(section)) {
      const name = entry.key.toUpperCase()
      const duplicated = seen.has(name)
      seen.add(name)
      if (!duplicated && modeledField(section, entry.key)) continue
      lines.push(`${entry.key}=${entry.value}`)
    }
    if (lines.length) extra.set(section, lines)
  }
  return extra
}

/** 布局文件里只被输入法自己读的字段，逐个建模。 */
function boardExtrasOf(document: IniDocument): Pick<BoardPanels, "handwritingStyle"> {
  const handwritingStyle = document.get("PANEL", "HW_FORE_STYLE")?.trim()
  return {
    ...(handwritingStyle ? { handwritingStyle } : {}),
  }
}

/** `[MORE]` 段：各类别指向哪块布局，外加它自己的网格与样式。 */
function moreMenuOf(document: IniDocument): MoreMenu | undefined {
  const layouts = new Map<string, string>()
  for (const entry of document.entries("MORE")) {
    if (!/_LAYOUT$/i.test(entry.key)) continue
    const value = entry.value.trim()
    if (value) layouts.set(entry.key.toUpperCase(), value)
  }
  const cellStyle = document.get("MORE", "CELL_STYLE")?.trim()
  const foreStyle = document.get("MORE", "FORE_STYLE")?.trim()
  const grid = numbersOf(document.get("MORE", "GRID"))
  const layoutName = document.get("MORE", "LAYOUT_NAME")?.trim()
  const menu: MoreMenu = {
    layouts,
    ...(cellStyle ? { cellStyle } : {}),
    ...(foreStyle ? { foreStyle } : {}),
    ...(grid.length === 2 ? { grid: { width: grid[0], height: grid[1] } } : {}),
    ...(layoutName ? { layoutName } : {}),
  }
  return layouts.size || cellStyle || foreStyle || grid.length || layoutName ? menu : undefined
}

/** 布局文件里的 `[LIST]` 段：列表的位置、尺寸、条目与取值。 */
function listExtrasOf(document: IniDocument): ListPanel | undefined {
  const style = document.get("LIST", "BACK_STYLE")?.trim()
  const foreStyle = document.get("LIST", "FORE_STYLE")?.trim()
  const cellStyle = document.get("LIST", "CELL_STYLE")?.trim()
  const cell = numbersOf(document.get("LIST", "CELL_SIZE"))
  const order = document.get("LIST", "LIST_ORDER")?.trim()
  const names = document.get("LIST", "NAMES")?.split(/\s+/).filter(Boolean)
  const pos = numbersOf(document.get("LIST", "POS"))
  const padding = numbersOf(document.get("LIST", "PADDING"))
  const type = Number(document.get("LIST", "TYPE")?.trim())
  const values = document.get("LIST", "VALUES")?.split(/\s+/).filter(Boolean)
  const count = Number(document.get("LIST", "LIST_NUM")?.trim())
  const panel: ListPanel = {
    ...(style ? { style } : {}),
    ...(foreStyle ? { foreStyle } : {}),
    ...(cellStyle ? { cellStyle } : {}),
    ...(cell.length === 2 ? { cellSize: { width: cell[0], height: cell[1] } } : {}),
    ...(Number.isFinite(count) ? { count } : {}),
    ...(order ? { order } : {}),
    ...(names?.length ? { names } : {}),
    ...(pos.length === 2 ? { offset: { x: pos[0], y: pos[1] } } : {}),
    ...(padding.length === 4 ? { padding: { left: padding[0], top: padding[1], right: padding[2], bottom: padding[3] } } : {}),
    ...(Number.isFinite(type) ? { type } : {}),
    ...(values?.length ? { values } : {}),
  }
  return Object.keys(panel).length ? panel : undefined
}

/** 两块符号键盘菜单合成一块：布局文件里的声明优先，两侧的类别引用并集。 */
function mergeMore(base: MoreMenu | undefined, extra: MoreMenu | undefined): MoreMenu | undefined {
  if (!base && !extra) return undefined
  const layouts = new Map([...(base?.layouts ?? []), ...(extra?.layouts ?? [])])
  return {
    layouts,
    ...(extra?.cellStyle ?? base?.cellStyle ? { cellStyle: extra?.cellStyle ?? base?.cellStyle } : {}),
    ...(extra?.foreStyle ?? base?.foreStyle ? { foreStyle: extra?.foreStyle ?? base?.foreStyle } : {}),
    ...(extra?.grid ?? base?.grid ? { grid: extra?.grid ?? base?.grid } : {}),
    ...(extra?.layoutName ?? base?.layoutName ? { layoutName: extra?.layoutName ?? base?.layoutName } : {}),
  }
}
function hintExtrasOf(document: IniDocument): Pick<HintBubble, "layoutName" | "type"> {
  const layoutName = document.get("HINT", "LAYOUT_NAME")?.trim()
  const type = Number(document.get("HINT", "TYPE")?.trim())
  return {
    ...(layoutName ? { layoutName } : {}),
    ...(Number.isFinite(type) ? { type } : {}),
  }
}
/** 布局文件声明的状态槽位数；它与实际写出的 `[TIPn]` 段数可以不一致。 */
function tipCountOf(document: IniDocument): number | undefined {
  const value = Number(document.get("PANEL", "TIP_NUM")?.trim())
  return Number.isFinite(value) ? value : undefined
}

/** 布局文件自己声明的面板背景；与 gen.ini 的全局面板样式是两回事。 */
function panelStyleOf(document: IniDocument): string | undefined {
  return document.get("PANEL", "BACK_STYLE")?.trim() || undefined
}

/** 布局文件声明的键数；它可能与实际读出的键数不同。 */
function keyCountOf(document: IniDocument): number | undefined {
  const value = Number(document.get("PANEL", "KEY_NUM")?.trim())
  return Number.isFinite(value) ? value : undefined
}

/**
 * 一块板的布局树：`VIEW_RECT` 就是左上角与尺寸，每键一个绝对节点。
 * 布局是树的形状，不是矩形集合——矩形只是这棵树算出来的结果。
 */
function layoutOfKeys(keys: ReadonlyArray<{ key: Key; rect: LayoutBox }>): ReturnType<typeof absoluteBoard> {
  return absoluteBoard(keys.map((each) => ({ id: each.key.id, ...each.rect })))
}

export async function layoutBoards(
  access: DocumentAccess,
  theme: Theme,
  orientation: Orientation,
  primaryLayout: string,
  primaryKind: BoardKind,
  _options?: ImportOptions,
): Promise<LayoutBoards> {
  const document = access.text(primaryLayout)
  if (!document) throw new Error(`包里没有这个布局：${primaryLayout}`)
  const allKeys = keysOf(document)
  // 有 VIEW_RECT 的键进布局树；没有的那些仍是键（只有身份与样式），只是不填 layoutId。
  const keys = allKeys.filter((each) => each.placed)
  // 容器尺寸是布局的输入：既没声明又没按键可量时，这块板没有可用的布局，不编一个出来。
  const measured = panelSizeOf(document, keys)
  if (!measured) throw new Error(`布局既没有 SIZE 也没有按键，容器尺寸无从确定：${primaryLayout}`)
  const size = measured.size
  const directory = bdsDirectory(theme, orientation)
  const genDocument = access.text(`${directory}gen.ini`)
  const parsedPanels = genDocument
    ? panelsOf(access, directory, genDocument, actionOf)
    : { panels: {} as BoardPanels, paths: {} }
  // 模型里的键顺序就是写回顺序：有几何的在前，只有样式的在后，与 `layoutText` 的分组一致。
  const orderedMainKeys = [...keys, ...allKeys.filter((each) => !each.placed)]
  const boards: Board[] = [{
    id: primaryLayout,
    kind: primaryKind,
    theme,
    orientation,
    geometry: { kind: "document" },
    container: knownContainer(size),
    layout: layoutOfKeys(keys),
    ...(panelStyleOf(document) ? { backdrop: panelStyleOf(document) } : {}),
    keys: orderedMainKeys.map((each) => each.key),
    panels: panelsMerged(parsedPanels.panels, document),
  }]
  // 同一主题方向下其余布局文件也是板：九宫格、符号、候选等，一并读进来。
  const skipped: string[] = []
  for (const layoutPath of layoutFiles(access, theme, orientation)) {
    if (layoutPath === primaryLayout) continue
    const other = access.text(layoutPath)
    if (!other) continue
    const boardAll = keysOf(other)
    if (!boardAll.length) continue
    const boardKeys = boardAll.filter((each) => each.placed)
    const boardMeasured = panelSizeOf(other, boardKeys)
    // 没有几何的布局建不成板；它的原文由调用方按原样保留，不硬塞一个容器尺寸。
    if (!boardMeasured) {
      skipped.push(layoutPath)
      continue
    }
    // 同上：有几何的键在前，只有样式的键在后，顺序与写回一致。
    const orderedKeys = [...boardKeys, ...boardAll.filter((each) => !each.placed)]
    boards.push({
      id: layoutPath,
      kind: boardKindOf(layoutPath),
      theme,
      orientation,
      geometry: { kind: "document" },
      container: knownContainer(boardMeasured.size),
      layout: layoutOfKeys(boardKeys),
      ...(panelStyleOf(other) ? { backdrop: panelStyleOf(other) } : {}),
      keys: orderedKeys.map((each) => each.key),
      panels: panelsMerged(undefined, other),
    })
  }
  return { boards, paths: parsedPanels.paths, skipped }
}

/** 布局文件自身声明的面板字段与 `gen.ini` 的面板组件合并；布局文件优先。 */
function panelsMerged(base: BoardPanels | undefined, document: IniDocument): BoardPanels {
  const merged: BoardPanels = {
    ...base,
    // 布局文件的 `[HINT]` 段指明用哪个气泡面板，gen.ini 那边只有样式，两边合并。
    ...(Object.keys(hintExtrasOf(document)).length
      ? { hint: { ...base?.hint, ...hintExtrasOf(document) } }
      : {}),
    ...(listExtrasOf(document) ? { list: { ...base?.list, ...listExtrasOf(document) } } : {}),
    emptySections: emptySectionsOf(document),
    extraFields: unmodeledFieldsOf(document),
    containerDeclared: document.get("PANEL", "SIZE") !== undefined,
    // 布局文件里只有「有字段的段」才归它写；空段由 `emptySections` 单独保留。
    layoutSections: document.sections().filter((section) =>
      !/^KEY\d+$/i.test(section) && !/^TIP\d+$/i.test(section) && document.entries(section).length > 0),
    ...(document.get("PANEL", "NO_BLUR") !== undefined ? { layoutNoBlur: document.get("PANEL", "NO_BLUR")?.trim() === "1" } : {}),
    tips: tipPoolOf(document, { actionOf }),
    ...(mergeMore(base?.more, moreMenuOf(document)) ? { more: mergeMore(base?.more, moreMenuOf(document)) } : {}),
    ...boardExtrasOf(document),
    ...(tipCountOf(document) !== undefined ? { tipCount: tipCountOf(document) } : {}),
    ...(keyCountOf(document) !== undefined ? { keyCount: keyCountOf(document) } : {}),
    // 布局文件与 gen.ini 各自的面板声明分开存：两个文件里的同名字段不是同一份内容。
    ...(listExtrasOf(document) ? { layoutList: listExtrasOf(document) } : {}),
    ...(Object.keys(hintExtrasOf(document)).length ? { layoutHint: hintExtrasOf(document) } : {}),
    ...(moreMenuOf(document) ? { layoutMore: moreMenuOf(document) } : {}),
    ...(base?.list ? { genList: base.list } : {}),
    ...(base?.hint ? { genHint: base.hint } : {}),
    ...(base?.more ? { genMore: base.more } : {}),
  }
  return merged
}

/** 某主题方向下的主布局：优先 26 键拼音，其次任意 26 键，最后第一个有按键段的布局。 */
function primaryLayoutOf(access: DocumentAccess, theme: Theme, orientation: Orientation): string | undefined {
  const prefix = bdsDirectory(theme, orientation)
  const candidates = access.paths().filter((path) => {
    if (!path.startsWith(prefix) || !path.endsWith(".ini") || /gen\.ini$/i.test(path)) return false
    const document = access.text(path)
    return document !== undefined && document.sections().some((section) => /^KEY/i.test(section))
  })
  return candidates.find((path) => /\/py_26\.ini$/i.test(path))
    ?? candidates.find((path) => /_26\.ini$/i.test(path))
    ?? candidates[0]
}

/** 读取时决定主布局与方向的外部输入；不含包本身。 */
export type BdsReadHints = {
  layout: string
  styles?: string
  animation?: string
  theme: Theme
  orientation: Orientation
  kind: BoardKind
}

/** 从原生数据里取出读取提示；包本身留在外面。 */
export function bdsHintsOf(source: BdsSource): BdsReadHints {
  return {
    layout: source.layout,
    ...(source.styles ? { styles: source.styles } : {}),
    ...(source.animation ? { animation: source.animation } : {}),
    theme: source.theme,
    orientation: source.orientation,
    kind: source.kind,
  }
}

/**
 * 解析产物 → 模型。
 * 签名里没有 SkinPackage：转换阶段只能看文档，拿不到原始文件。
 */
export async function bdsToModel(
  documents: SkinDocuments,
  hints: BdsReadHints,
  options?: ImportOptions,
): Promise<SkinModel> {
  const access = accessOf(documents)
  const roles = documents.roles
  const layout = access.text(hints.layout)
  if (!layout) throw new Error(`包里没有这个布局：${hints.layout}`)
  // 没有样式表的布局（官方基础布局）按空样式读，样式由后续的外观覆盖。
  const styleDocument = (hints.styles ? access.text(hints.styles) : undefined) ?? IniDocument.parse("")
  const primaryPlaced = keysOf(layout).filter((entry) => entry.placed)
  const measured = panelSizeOf(layout, primaryPlaced)
  if (!measured) throw new Error(`布局既没有 SIZE 也没有按键，容器尺寸无从确定：${hints.layout}`)
  const info = infoOf(access)
  const model = emptyModel({
    ...(info.name ? { name: info.name } : {}),
    ...(info.author ? { author: info.author } : {}),
    ...(info.version ? { version: info.version } : {}),
    theme: hints.theme,
    orientation: hints.orientation,
    resolution: measured.size,
  }, "bds")
  // 一个包里可以有多个主题与方向，每套都是完整的键盘；它们都是事实，都要进模型。
  const packagedThemes = [...new Set<Theme>([...roles.keys()].flatMap((path) => {
    const theme = appearanceOf(path)
    return theme ? [theme] : []
  }))]
  const themes = [...new Set<Theme>([hints.theme, ...packagedThemes])]
  const orientationsOf = (theme: Theme): Orientation[] => [...new Set<Orientation>([...roles].flatMap(([path, role]) =>
    ("orientation" in role) && appearanceOf(path) === theme ? [role.orientation] : []))]
  const boards: Board[] = []
  const panelPaths = new Map<string, PanelPaths>()
  const skippedLayouts: string[] = []
  for (const theme of themes) {
    for (const orientation of orientationsOf(theme)) {
      const isPrimary = theme === hints.theme && orientation === hints.orientation
      const primary = isPrimary ? hints.layout : primaryLayoutOf(access, theme, orientation)
      if (!primary) continue
      const parsedLayouts = await layoutBoards(access, theme, orientation, primary, isPrimary ? hints.kind : "main", options)
      boards.push(...parsedLayouts.boards)
      panelPaths.set(`${theme}/${orientation}`, parsedLayouts.paths)
      skippedLayouts.push(...parsedLayouts.skipped)
    }
  }
  model.boards.push(...boards)
  const parsed = stylesOf(access, hints.theme, hints.orientation, styleDocument)
  model.styles = parsed.styles
  model.images = parsed.images
  // 图集是打包方式：`.til` 的切片与全局声明都进模型，写回时按原图重建。
  const atlasFiles = atlasesOf(access, parsed.images)
  model.atlases = atlasFiles.atlases
  // 每套主题方向一个外观；BDS 用目录区分主题。
  model.appearances = appearancesOf(boards)
  // 格式能力与 `gen.ini` 声明的原值。
  model.profiles = [profileOf(access)]
  // 散图也要进资源表：它们不属于任何图集，但导出时要原样写回。
  const allImages = new Map(model.images)
  for (const [path, role] of documents.roles) {
    if (role.kind !== "image" || allImages.has(path)) continue
    const data = documents.binaries.get(path)
    if (!data) continue
    try {
      allImages.set(path, decodePng(data))
    } catch {
      // 不是 PNG 的文件不进图片表；它本来也不该被识别成 image。
    }
  }
  model.images = allImages
  const resources = new Map(model.resources)
  // 音效与字体要带字节：模型得能独立写出它们，不能靠导出时回源包捡。
  const locate = (name: string): string | undefined =>
    access.paths().find((path) => path === name || path.endsWith(`/${name}`))
  const bytesOf = (name: string): Uint8Array | undefined => {
    const path = locate(name)
    if (!path) return
    return access.bytes(path) ?? (textContent(access, path) ? new TextEncoder().encode(textContent(access, path)) : undefined)
  }
  for (const style of parsed.styles.values()) {
    for (const layer of [...style.normal, ...(style.pressed ?? [])]) {
      if (layer.kind !== "sound") continue
      const path = locate(layer.binding.sound) ?? layer.binding.sound
      const data = bytesOf(layer.binding.sound)
      resources.set(layer.binding.sound, { kind: "audio", path, ...(data ? { data } : {}) })
    }
  }
  // 样式文档里声明的字体也算资源，导出时按名称找回。
  for (const section of styleDocument.sections()) {
    const font = styleDocument.get(section, "FONT_FILE")?.trim() || styleDocument.get(section, "FONT_NAME")?.trim()
    if (!font) continue
    const path = locate(font) ?? font
    const data = bytesOf(font)
    resources.set(font, { kind: "font", path, family: font, ...(data ? { data } : {}) })
  }
  model.resources = resources
  // 按键动作里指向另一块板的，就是板间跳转。
  for (const board of model.boards) {
    const transitions = board.keys.flatMap((key) => {
      const action = key.actions.press
      if (action?.kind !== "switch") return []
      return [{ trigger: "press" as const, target: action.board }]
    })
    const unique = transitions.filter((entry, index) => transitions.findIndex((other) => other.target === entry.target) === index)
    if (unique.length) board.panels = { ...(board.panels ?? {}), transitions: unique }
  }
  if (hints.animation) {
    const animationText = textContent(access, hints.animation)
    if (animationText) model.motions = motionsOf(animationText)
  }
  // 非按键窗口：候选栏、提示气泡、手写区。它们不属于键盘布局，原样保留在 opaque 里。
  const opaque = new Map(model.opaque)
  for (const [path, role] of roles) {
    const kind = role.kind === "candidate-window" ? "candidate" as const
      : role.kind === "hint-window" ? "hint" as const
        : role.kind === "handwriting" ? "handwriting" as const
          : undefined
    if (!kind) continue
    const document = documents.texts.get(path)
    if (!document) continue
    const sections = new Map<string, ReadonlyMap<string, string>>()
    for (const section of document.sections()) {
      sections.set(section, new Map(document.entries(section).map((entry) => [entry.key, entry.value])))
    }
    // 方向从路径取：同一份皮肤的两套窗口各在自己的方向目录里。
    const windowOrientation: Orientation = /\/land\//i.test(path) ? "land" : /\/port\//i.test(path) ? "port" : hints.orientation
    opaque.set(`window:${path}`, { kind, theme: hints.theme, orientation: windowOrientation, sections })
  }
  // 面板文件的原路径也要记住，导出时沿用原名，避免重建后出现两份面板文件。
  if (panelPaths.size) opaque.set("panelPaths", Object.fromEntries(panelPaths))
  // 主样式表已经进了 `styles`；其它方向/主题的样式表用同一批段号表达不同内容，单张样式表装不下，
  // 按原路径原样保留，导出时照抄。
  if (hints.styles) opaque.set("stylePath", hints.styles)
  for (const [path, role] of roles) {
    if (role.kind !== "style" || path === hints.styles) continue
    const text = textContent(access, path)
    if (text !== undefined) opaque.set(`style:${path}`, { text })
  }
  // `Info.txt` 里除名字/作者/版本之外的字段也原样带回，写回时逐行还原。
  if (info.exists) opaque.set("info", info.fields)
  // 样式段里没有建模的字段（`BORDER_SIZE`、`FONT_CLEARTYPE` 这类）按段号原样带回。
  for (const [id, fields] of parsed.fields) opaque.set(`styleFields:${id}`, fields)
  // 样式表的 `[GLOBAL]` 段同样原样带回。
  if (parsed.global.size) opaque.set("styleGlobal", parsed.global)
  // 识别不出角色的文件不猜用途，按原字节保留；导出时按原路径写回。
  for (const [path, role] of roles) {
    if (role.kind !== "unknown") continue
    const data = documents.binaries.get(path)
    if (data) opaque.set(`raw:${path}`, data)
  }
  // 没有几何、建不成板的布局文件：原文照抄，不按板重建。
  for (const path of skippedLayouts) {
    const text = textContent(access, path)
    if (text !== undefined) opaque.set(`layout:${path}`, { text })
  }
  // 每个主题方向各有一份 `anim.ini`；只有主方向那份解析进了 `motions`，其余原文保留。
  if (hints.animation) opaque.set("animationPath", hints.animation)
  for (const [path, role] of roles) {
    if (role.kind !== "motion") continue
    const text = textContent(access, path)
    if (text !== undefined) opaque.set(`animation:${path}`, { text })
  }
  // `.til` 的 `[GLOBAL]` 段还没有 IR 语义；写回时按原字段还原。
  for (const [name, global] of atlasFiles.globals) opaque.set(`atlas:${name}`, { global })
  model.opaque = opaque
  return model
}

/** 文件路径或图集引用的最后一段，去掉扩展名：`light/skin/res/fore1.til` → `fore1`，`sxi:default:anjian` → `anjian`。 */
function leafName(reference: string): string {
  const match = /[^/:]+$/.exec(reference)
  return (match?.[0] ?? reference).replace(/\.[^.]+$/, "")
}

/**
 * 切片在 `.til` 里的 `[IMG<n>]` 编号。编号是 BDS 的打包细节，不是 IR 的标识：
 * `AtlasSlice.id` 是跨格式的稳定标识（BDS 的 `图集#12`、SXI 的 `sxi:default:anjian#IMG1`），
 * 它不承担这个职责。所以 BDS 读进来时把编号记在切片 `extra.tilIndex`，写回时优先用它；
 * 别的格式转来的切片没有这个字段，按它在数组里的位置从 1 开始编号。
 */
function tilIndexOf(slice: AtlasSlice, position: number): number {
  const recorded = slice.extra?.get("tilIndex")
  if (recorded === undefined) return position + 1
  if (typeof recorded !== "number" || !Number.isInteger(recorded) || recorded < 0) {
    throw new Error(`切片 ${slice.id} 的 tilIndex 不是非负整数：${String(recorded)}`)
  }
  return recorded
}

/** `INNER_RECT` 的四个数；写下的值不是四个有限数说明模型被改坏了。 */
function innerRectOf(value: unknown, slice: AtlasSlice): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    throw new Error(`切片 ${slice.id} 的内切矩形不合法：${JSON.stringify(value)}`)
  }
  return [value[0], value[1], value[2], value[3]]
}

/** `.til` 文本：`[GLOBAL]` 原值加每个切片一条 `[IMGn]`，编号由调用方按图集分配。 */
function atlasText(atlas: Atlas, global: AtlasGlobal | undefined, indexes: ReadonlyMap<AtlasSlice, number>): string {
  const lines = ["[GLOBAL]"]
  for (const [key, value] of Object.entries(global ?? {})) {
    if (key.toUpperCase() === "TILE_NUM") continue
    lines.push(`${key}=${value}`)
  }
  // 工具书 V6 p43：`TILE_NUM` 必须与切片数一致，所以它从切片重算而不沿用原值。
  lines.push(`TILE_NUM=${atlas.slices.length}`, "")
  for (const slice of atlas.slices) {
    const index = indexes.get(slice)
    if (index === undefined) throw new Error(`切片没有分配 .til 编号：${slice.id}`)
    lines.push(`[IMG${index}]`, `SOURCE_RECT=${slice.rect.x},${slice.rect.y},${slice.rect.width},${slice.rect.height}`)
    const inner = slice.extra?.get("innerRect")
    if (inner !== undefined) lines.push(`INNER_RECT=${innerRectOf(inner, slice).join(",")}`)
    const scale = slice.extra?.get("scale")
    if (scale !== undefined) {
      if (typeof scale !== "string") throw new Error(`切片 ${slice.id} 的 SCALE 不是字符串`)
      lines.push(`SCALE=${scale}`)
    }
    // 切片段里没建模的字段（`INFO` 这类）原样写回；`tilIndex` 是 BDS 自己的编号，已经在段头上。
    // 别的格式的 `extra`（SXI 的 `rect2`/`scales`）不是 `.til` 的行，BDS 也不认识，跳过。
    for (const [key, value] of slice.extra ?? []) {
      if (key === "innerRect" || key === "scale" || key === "tilIndex") continue
      if (typeof value !== "string") continue
      lines.push(`${key}=${value}`)
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

/**
 * 图集源图：整图在图片表里就用它，否则把切片按原位置贴回去。
 * 一个切片都没有像素时返回 undefined——原包只有 `.til` 声明，不凭空造图；
 * 只缺一部分说明模型不一致，直接报错，不拿半张图冒充整张。
 */
function atlasImage(atlas: Atlas, images: ReadonlyMap<string, SkinImage>): SkinImage | undefined {
  const whole = images.get(atlas.source)
  if (whole) return whole
  if (!atlas.slices.length) return
  const present = atlas.slices.flatMap((slice) => {
    const image = images.get(slice.id)
    return image ? [{ slice, image }] : []
  })
  if (!present.length) return
  if (present.length !== atlas.slices.length) {
    const missing = atlas.slices.filter((slice) => !images.has(slice.id)).map((slice) => slice.id)
    throw new Error(`图集只有部分切片有像素，无法重建 ${atlas.source}：${missing.join("、")}`)
  }
  const width = Math.max(...atlas.slices.map((slice) => slice.rect.x + slice.rect.width))
  const height = Math.max(...atlas.slices.map((slice) => slice.rect.y + slice.rect.height))
  const data = new Uint8Array(width * height * 4)
  for (const { slice, image } of present) {
    if (image.width !== slice.rect.width || image.height !== slice.rect.height) {
      throw new Error(`切片 ${slice.id} 的像素 ${image.width}x${image.height} 与矩形 ${slice.rect.width}x${slice.rect.height} 不符`)
    }
    for (let row = 0; row < image.height; row++) {
      const from = row * image.width * 4
      const to = ((slice.rect.y + row) * width + slice.rect.x) * 4
      data.set(image.data.subarray(from, from + image.width * 4), to)
    }
  }
  return { width, height, data }
}

/** `opaque` 里的 `[GLOBAL]` 原值；不是记录就当作没有声明。 */
function atlasGlobalOf(value: unknown): AtlasGlobal | undefined {
  if (typeof value !== "object" || value === null || !("global" in value)) return
  const global = (value as { global: unknown }).global
  if (typeof global !== "object" || global === null) return
  const fields: AtlasGlobal = {}
  for (const [key, item] of Object.entries(global)) {
    if (typeof item === "string") fields[key] = item
  }
  return fields
}

/** `opaque` 里按原文保留的文本载荷：`{ text }`。 */
function opaqueText(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("text" in value)) return
  const text = (value as { text: unknown }).text
  return typeof text === "string" ? text : undefined
}

/** `opaque` 里按主题方向记下的面板文件原路径；值不是记录时当作没有记录。 */
function panelPathsOf(value: unknown): Map<string, PanelPaths> {
  const groups = new Map<string, PanelPaths>()
  if (typeof value !== "object" || value === null) return groups
  for (const [group, item] of Object.entries(value)) {
    if (typeof item !== "object" || item === null) continue
    const paths: PanelPaths = {}
    for (const field of ["candidate", "hint", "more", "gen"] as const) {
      const path = (item as Record<string, unknown>)[field]
      if (typeof path === "string") paths[field] = path
    }
    groups.set(group, paths)
  }
  return groups
}

/**
 * 板在 BDS 里的布局文件路径。BDS 自己读的板 id 已经是完整路径；
 * 别的格式的板 id 是标识符，落到主题方向目录下并补 `.ini`。
 */
function layoutPathOf(board: Board): string {
  if (board.id.includes("/")) return board.id
  return `${board.theme}/skin/${board.orientation}/${board.id.replace(/[^A-Za-z0-9_.-]/g, "_")}.ini`
}

/**
 * 模型 → 文档。
 * 写出时我们清楚每个文件是什么角色，所以角色在这里直接登记，不靠路径猜。
 */
async function bdsFromModel(model: SkinModel): Promise<SkinDocuments> {
  // 主键盘决定方向目录；模型里板多起来之后，第一块不一定是主键盘。
  const board = model.boards.find((each) => each.kind === "main") ?? model.boards[0]
  if (!board) throw new Error("模型里没有板")
  const theme = model.meta.theme
  const orientation = board.orientation
  const root = `${theme}/skin`
  // 几何只有布局树这一个来源；每块板各自算，不按动作合并按键（合并会让同位置的键丢掉 VIEW_RECT）。
  const rendersOf = async (each: Board): Promise<Array<Pick<KeyRender, "key" | "rect">>> => {
    const container = containerOf(each)
    if (!container) return []
    const rects = await computeLayout(each.layout, container)
    return each.keys.flatMap((key) => {
      const rect = rects.get(key.id)
      return rect ? [{ key, rect: { x: rect.position.x, y: rect.position.y, width: rect.size.width, height: rect.size.height } }] : []
    })
  }
  // 只打包图层真正用到的图片；序号就是新图集里的切片号。
  const used = new Set<string>()
  for (const style of model.styles.values()) {
    for (const layer of [...style.normal, ...(style.pressed ?? []), ...(style.disabled ?? [])]) {
      if (layer.kind === "image" || layer.kind === "icon") used.add(layer.image)
    }
  }
  // 已有图集原样重建：BDS 读进来的切片用 extra.tilIndex 保留原编号，
  // 其它格式转来的切片没有这个字段，按它在数组里的位置从 1 编号。
  const atlases = [...model.atlases]
  const placed = new Map<string, { path: string; index: number }>()
  const tilIndexes = new Map<AtlasSlice, number>()
  // 图集在 BDS 里的文件名：BDS 自己的路径原样沿用；别的格式转来的图集落到 `res/` 下，
  // 名字取图集引用的最后一段，重名顺延，不覆盖原图。
  const taken = new Set<string>()
  const atlasFiles = new Map<Atlas, { path: string; source: string }>()
  const reservePath = (base: string): string => {
    let path = `${root}/res/${base}.til`
    let suffix = 2
    while (taken.has(path)) {
      path = `${root}/res/${base}${suffix}.til`
      suffix += 1
    }
    taken.add(path)
    return path
  }
  for (const atlas of atlases) {
    const path = /\.til$/i.test(atlas.name) && atlas.name.includes("/") ? atlas.name : reservePath(leafName(atlas.name))
    taken.add(path)
    atlasFiles.set(atlas, { path, source: path.replace(/\.til$/i, ".png") })
    // `[IMG<n>]` 在一个图集里必须唯一；重复说明模型被改坏了，静默改号会让样式引用错位。
    const usedIndexes = new Set<number>()
    for (const [position, slice] of atlas.slices.entries()) {
      const index = tilIndexOf(slice, position)
      if (usedIndexes.has(index)) throw new Error(`图集 ${atlas.name} 的切片编号重复：[IMG${index}]`)
      usedIndexes.add(index)
      tilIndexes.set(slice, index)
      placed.set(slice.id, { path, index })
    }
  }
  // 不在任何图集里的图片重新打包成一张图集；图集名按 `atlas`、`atlas2` 顺延，不覆盖原图。
  const images = new Map(model.images)
  const loose = new Map([...images].filter(([id]) => used.has(id) && !placed.has(id)))
  let nextPage = 0
  const reserveAtlas = (): string => {
    let base = atlasName(nextPage)
    while (taken.has(`${root}/res/${base}.til`)) {
      nextPage += 1
      base = atlasName(nextPage)
    }
    nextPage += 1
    return reservePath(base)
  }
  // 页尺寸跟随板尺寸：小屏皮肤不该产出 2048 的图集，大屏也不该被压到 1024。
  // 容器未知时按最小页算——这是打包策略，不是几何，不能编一个板尺寸出来。
  const mainContainer = containerOf(board)
  const pageSize = Math.min(2048, Math.max(1024, Math.ceil(Math.max(mainContainer?.width ?? 0, mainContainer?.height ?? 0) / 512) * 512))
  const pages = loose.size ? packAtlasPages(loose, pageSize, pageSize) : []
  // 样式图层声明的拉伸区域：图集里的 `INNER_RECT` 是图集绝对坐标。
  const stretchByImage = new Map<string, Stretch>()
  for (const style of model.styles.values()) {
    for (const layer of [...style.normal, ...(style.pressed ?? []), ...(style.disabled ?? [])]) {
      if (layer.kind !== "image" || !layer.stretch) continue
      const seen = stretchByImage.get(layer.image)
      if (seen && JSON.stringify(seen) !== JSON.stringify(layer.stretch)) {
        throw new Error(`同一张图片声明了两种拉伸：${layer.image}`)
      }
      stretchByImage.set(layer.image, layer.stretch)
    }
  }
  for (const page of pages) {
    const path = reserveAtlas()
    const slices = page.placements.map((entry, index): AtlasSlice => {
      const stretch = stretchByImage.get(entry.id)
      const inner = stretch?.kind === "region"
        ? [entry.position.x + stretch.inner.x, entry.position.y + stretch.inner.y, stretch.inner.width, stretch.inner.height] as const
        : stretch?.kind === "nine-slice"
          ? [entry.position.x + stretch.edges.left, entry.position.y + stretch.edges.top, entry.size.width - stretch.edges.left - stretch.edges.right, entry.size.height - stretch.edges.top - stretch.edges.bottom] as const
          : undefined
      return {
        id: `${path}#${index + 1}`,
        rect: { x: entry.position.x, y: entry.position.y, width: entry.size.width, height: entry.size.height },
        ...(inner ? { extra: new Map([["innerRect", inner]]) } : {}),
      }
    })
    const source = path.replace(/\.til$/i, ".png")
    const atlas: Atlas = { name: path, source, slices }
    atlases.push(atlas)
    atlasFiles.set(atlas, { path, source })
    slices.forEach((slice, index) => tilIndexes.set(slice, index + 1))
    // 新图集的整页像素就是它自己，按源图路径记进图片表，写回时直接用它。
    images.set(source, page.image)
    // 样式引用的是原图片 id，不是切片 id：两者都要能反查到这张图集。
    page.placements.forEach((entry, index) => placed.set(entry.id, { path, index: index + 1 }))
  }
  const imageRef = (id: string): string | undefined => {
    const hit = placed.get(id)
    return hit === undefined ? undefined : `${leafName(hit.path)},${hit.index}`
  }
  const texts = new Map<string, IniDocument>()
  const binaries = new Map<string, Uint8Array>()
  const roles = new Map<string, FileRole>()
  const putText = (path: string, text: string, role: FileRole): void => {
    texts.set(path, IniDocument.parse(text))
    roles.set(path, role)
  }
  const putBytes = (path: string, data: Uint8Array, role: FileRole): void => {
    binaries.set(path, data)
    roles.set(path, role)
  }
  // 样式段名对所有板共用一份，按键引用与样式表必须用同一张表。
  const names = styleNames(model.styles)
  // `Info.txt` 只有原包有它时才写：这个文件是百度补的，不是皮肤必需的内容。
  if (model.opaque.has("info")) putText("Info.txt", infoText(model), { kind: "info" })
  // 面板文件与 gen.ini 属于主键盘所在的方向目录；原路径记在 opaque 里。
  const recordedPaths = panelPathsOf(model.opaque.get("panelPaths"))
  const pathsRecorded = model.opaque.has("panelPaths")
  const allWindows = [...model.opaque].flatMap(([key, value]) => key.startsWith("window:")
    ? [{ path: key.slice("window:".length), ...(value as Omit<WindowDocument, "path">) }]
    : [])
  // 每个主题方向各有一份面板文件；面板原路径只属于主方向，其余方向按目录重建。
  const panelGroups = new Map<string, Board>()
  for (const each of model.boards) {
    const key = `${each.theme}/${each.orientation}`
    const current = panelGroups.get(key)
    if (current === undefined || (each.kind === "main" && current.kind !== "main")) panelGroups.set(key, each)
  }
  for (const [group, main] of panelGroups) {
    const groupTheme = appearanceOf(`${group}/`) ?? theme
    const groupOrientation = orientationOf(`${group}/`) ?? orientation
    const paths = recordedPaths.get(group) ?? {}
    const directory = `${groupTheme}/skin/${groupOrientation}/`
    // 面板几何要一个确定的容器；未知时这块板的面板文件写不出来，跳过而不是编尺寸。
    const panelContainer = containerOf(main)
    if (!panelContainer) continue
    for (const file of panelFiles(main, directory, panelContainer, actionValue, paths)) {
      // 原包没有 gen.ini 时不要凭空造一份：这层配置在该包里本来就没有。
      if (pathsRecorded && file.path.endsWith("/gen.ini") && !paths.gen) continue
      putText(file.path, new TextDecoder().decode(file.data), { kind: "panel-config" })
    }
  }
  // 每块板各自一份布局文件；板 id 已带目录时沿用，其它格式转来的板放到方向目录下。
  const writtenLayouts = new Set<string>()
  for (const each of model.boards) {
    // 板 id 是完整路径时（BDS 自己读的）原样沿用；别的格式的板 id 是标识符，
    // 落到方向目录下并补 `.ini`，标识符里的 `:` 之类换成文件名能用的字符。
    const path = layoutPathOf(each)
    putText(path, layoutText(each, await rendersOf(each), names), { kind: "layout", board: each.kind, theme: each.theme, orientation: each.orientation })
    writtenLayouts.add(path)
  }
  // 没有几何、建不成板的布局文件按原文写回，不从别处重建。
  for (const [key, value] of model.opaque) {
    if (!key.startsWith("layout:")) continue
    const path = key.slice("layout:".length)
    if (writtenLayouts.has(path)) continue
    const text = opaqueText(value)
    if (text === undefined) continue
    putText(path, text, { kind: "layout", board: "other", theme: appearanceOf(path) ?? theme, orientation: orientationOf(path) ?? orientation })
  }
  // 样式表只在模型有样式时写；空样式表会覆盖掉输入法内置的样式。路径沿用原包。
  const recordedStylePath = model.opaque.get("stylePath")
  const writtenStyles = new Set<string>()
  if (model.styles.size) {
    const path = typeof recordedStylePath === "string" ? recordedStylePath : `${root}/res/default.css`
    putText(path, stylesText(model.styles, imageRef, names, (id) => styleFieldsOf(model.opaque.get(`styleFields:${id}`)), textFieldsOf(model.opaque.get("styleGlobal"))), { kind: "style", theme })
    writtenStyles.add(path)
  }
  // 其它方向/主题的样式表没有进单张样式表，按原路径原样写回。
  for (const [key, value] of model.opaque) {
    if (!key.startsWith("style:")) continue
    const path = key.slice("style:".length)
    if (writtenStyles.has(path)) continue
    const text = opaqueText(value)
    if (text === undefined) continue
    putText(path, text, { kind: "style", theme: appearanceOf(path) ?? theme })
  }
  // 每个图集按 BDS 路径写回：`.til` 从切片重建，`.png` 用原像素或由切片贴回。
  for (const atlas of atlases) {
    const file = atlasFiles.get(atlas)
    if (!file) continue
    putText(file.path, atlasText(atlas, atlasGlobalOf(model.opaque.get(`atlas:${atlas.name}`)), tilIndexes), { kind: "atlas", theme, orientation })
    const image = atlasImage(atlas, images)
    // 整图和切片都没有像素时（原包只有 `.til` 声明），不凭空造一张图。
    if (image) putBytes(file.source, encodePng(image), { kind: "image" })
  }
  // 没有图集也没有样式引用时，图片按原路径写回，不改名也不合并。
  if (!atlases.length) {
    for (const [id, image] of images) putBytes(id, encodePng(image), { kind: "image" })
  }
  // 主方向的 `anim.ini` 由 `motions` 重建；其余方向与没有动效的源文件按原文写回。
  const animationPath = model.opaque.get("animationPath")
  const mainAnimation = typeof animationPath === "string" ? animationPath : `${root}/res/anim.ini`
  if (model.motions.size) putText(mainAnimation, writeMotions(model.motions), { kind: "motion" })
  for (const [key, value] of model.opaque) {
    if (!key.startsWith("animation:")) continue
    const path = key.slice("animation:".length)
    if (path === mainAnimation && model.motions.size) continue
    const text = opaqueText(value)
    if (text !== undefined) putText(path, text, { kind: "motion" })
  }
  // 非按键窗口按原路径写回：候选栏、提示气泡、手写区。
  for (const window of allWindows) {
    const kind = window.kind === "candidate" ? "candidate-window" as const
      : window.kind === "hint" ? "hint-window" as const
        : "handwriting" as const
    const { path, ...content } = window
    putText(path, windowText(content), { kind })
  }
  // 音效与字体按模型里的路径写回；没有字节的说明源包里就没这个文件，不凭空造。
  for (const resource of model.resources.values()) {
    if (!resource.data) continue
    putBytes(resource.path, resource.data, { kind: resource.kind === "font" ? "font" : "audio" })
  }
  // 识别不出角色的文件按原字节写回，不解释也不改名。
  for (const [key, value] of model.opaque) {
    if (!key.startsWith("raw:") || !(value instanceof Uint8Array)) continue
    putBytes(key.slice("raw:".length), value, { kind: "unknown", reason: "源包里识别不出来，按原字节保留" })
  }
  // 主布局由模型决定，不靠打包阶段按文件名猜：同一份皮肤可能有多个方向的 `py_26.ini`。
  // 主布局由模型决定，不靠打包阶段按文件名猜：同一份皮肤可能有多个方向的 `py_26.ini`。
  // 跨格式的板可能没有 `main` 种类，这时挑第一块有按键的板——没有按键的布局读不回来。
  const primary = model.boards.find((each) => each.kind === "main" && each.orientation === model.meta.orientation)
    ?? model.boards.find((each) => each.kind === "main")
    ?? model.boards.find((each) => each.keys.length > 0)
  if (primary) {
    return { roles, texts, structs: new Map([["primaryLayout", layoutPathOf(primary)]]), binaries }
  }
  return { roles, texts, structs: new Map(), binaries }
}

/** 从文档里出现的路径取主题与方向；写出物本来就按目录分好了。 */
function bdsStructureOf(documents: SkinDocuments): SkinStructure {
  const themes = new Set<Theme>()
  const orientations = new Set<Orientation>()
  for (const path of documents.roles.keys()) {
    const theme = appearanceOf(path)
    const orientation = orientationOf(path)
    if (theme) themes.add(theme)
    if (orientation) orientations.add(orientation)
  }
  return { roles: documents.roles, themes: [...themes], orientations: [...orientations] }
}

/** 文档 → 包。这里只做序列化与「哪个文件是主布局」的定位。 */
function bdsPack(documents: SkinDocuments, structure: SkinStructure): BdsSource {
  const files: Array<{ path: string; data: Uint8Array }> = []
  const encoder = new TextEncoder()
  for (const [path, document] of documents.texts) files.push({ path, data: encoder.encode(document.toString()) })
  for (const [path, data] of documents.binaries) files.push({ path, data })
  // 主布局由模型在 `fromModel` 里指定；没有指定时才按文件名挑一块。
  const recorded = documents.structs.get("primaryLayout")
  const layouts = [...structure.roles].filter(([, role]) => role.kind === "layout").map(([path]) => path)
  const layout = (typeof recorded === "string" && layouts.includes(recorded) ? recorded : undefined)
    ?? layouts.find((path) => /\/py_26\.ini$/i.test(path))
    ?? layouts.find((path) => /_26\.ini$/i.test(path))
    ?? layouts[0]
  if (!layout) throw new Error("写出的包里没有布局文件")
  const layoutRole = structure.roles.get(layout)
  const theme = layoutRole && "theme" in layoutRole ? layoutRole.theme : "light"
  const orientation = layoutRole && "orientation" in layoutRole ? layoutRole.orientation : "port"
  const kind = layoutRole && "board" in layoutRole ? layoutRole.board : "main"
  const styles = [...structure.roles].find(([, role]) => role.kind === "style")?.[0]
  const animation = [...structure.roles].find(([, role]) => role.kind === "motion")?.[0]
  return {
    archive: SkinArchive.fromSourceFiles(files),
    layout,
    ...(styles ? { styles } : {}),
    theme,
    orientation,
    kind,
    ...(animation ? { animation } : {}),
  }
}

export const bdsFormat: SkinFormat<BdsSource> = {
  name: "bds",
  capabilities: new Map<Capability, CapabilityLevel>([
    ["board.geometry", "full"],
    ["board.keys", "full"],
    ["board.add-remove", "full"],
    ["key.actions", "full"],
    ["key.states", "full"],
    ["key.touch", "full"],
    ["style.image", "full"],
    ["style.nine-slice", "full"],
    ["style.color", "full"],
    ["style.text", "full"],
    ["style.border", "partial"],
    ["style.sound", "partial"],
    ["motion.track", "full"],
    ["motion.sequence", "full"],
    ["motion.frames", "partial"],
    ["motion.particles", "partial"],
    ["motion.binding", "partial"],
    ["sound", "full"],
    ["font", "partial"],
    ["panel.candidate", "partial"],
    ["panel.hint", "partial"],
    ["panel.list", "partial"],
    ["panel.toolbar", "partial"],
  ]),
  derive: { tolerance: 1 },
  open(archive) {
    return bdsSource(archive)
  },
  importer(source, options) {
    const hints = bdsHintsOf(source)
    return {
      identify: identifyBds,
      parse: parseBds,
      toModel: (documents) => bdsToModel(documents, hints, options),
    }
  },
  exporter: {
    fromModel: bdsFromModel,
    structure: bdsStructureOf,
    pack: bdsPack,
  },
}
