// BDS/BDI 转换器：覆盖布局、按键、动作、样式图层、动效与音效。
//
// 格式原生数据是归档加路径；read 解析成 IR，write 从 IR 重新生成全部文件（含重新打包的图集）。
import { appearanceOf, bdsBoardName, bdsDirectory, isBdsLayoutPath, orientationOf } from "@/skin-model/board-paths.ts"
import { IniDocument, numbersOf } from "@/ini.ts"
import { accessOf, textContent, type DocumentAccess } from "@/skin-model/formats/bds-access.ts"
import { identifyBds } from "@/skin-model/formats/bds-identify.ts"
import { parseBds } from "@/skin-model/formats/bds-parse.ts"
import type { FileRole, SkinDocuments, SkinStructure } from "@/skin-model/pipeline.ts"
import { parseLegacyAnimationFile, type LegacyAnimationEntry } from "@/legacy-animation.ts"
import { previewItems } from "@/preview-items.ts"
import { decodePng, encodePng, type RgbaImage } from "@/raster.ts"
import { SkinArchive } from "@/skin.ts"
import { tileSlices } from "@/tiles.ts"
import type { Size } from "taffy-layout"
import type { Appearance, BoardKind, KeyEvent, Orientation, SkinAction, SkinWindow } from "@/skin-model/types.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import type { LayoutBox } from "@/skin-model/layout.ts"
import type { SkinKey } from "@/skin-model/key.ts"
import type { SkinLayer, SkinStyle, SkinStyles } from "@/skin-model/style.ts"
import type { HintBubble, ListPanel, MoreMenu, SkinBoard } from "@/skin-model/board.ts"
import type { MotionEmitter, MotionNode, MotionRange, MotionTimeline, MotionTrack, MotionVector, SkinMotion, SkinMotions } from "@/skin-model/motion.ts"
import { emptyModel, type SkinModel } from "@/skin-model/model.ts"
import { cutTiles, packAtlasPages, tileDocument, type SkinImage } from "@/skin-model/image.ts"
import { panelFiles, panelsOf, type PanelPaths } from "@/skin-model/formats/bds-panels.ts"
import { tipLines, tipPoolOf, tipsOf } from "@/skin-model/formats/bds-tips.ts"
import { buildBoard, type KeyRender } from "@/skin-model/build.ts"
import { deriveBoard } from "@/skin-model/derive/layout.ts"
import type { ImportOptions, SkinFormat } from "@/skin-model/format.ts"

export type BdsSource = {
  archive: SkinArchive
  layout: string
  /** 样式文件；官方基础布局没有样式，此时为空。 */
  styles?: string
  animation?: string
  theme: Appearance
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
  const layout = options.layout
    ?? candidates.find((name) => /\/py_26\.ini$/.test(name))
    ?? candidates.find((name) => /_26\.ini$/.test(name))
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

export function actionOf(value: string | undefined): SkinAction | undefined {
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

export function actionValue(action: SkinAction | undefined): string | undefined {
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

function tilePath(access: DocumentAccess, theme: Appearance, orientation: Orientation, file: string): string | undefined {
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

function imageLayer(
  access: DocumentAccess,
  images: Map<string, SkinImage>,
  theme: Appearance,
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
  const [, , sw, sh] = tile.source
  const inner = tile.inner
    ? {
      left: tile.inner[0] - tile.source[0],
      top: tile.inner[1] - tile.source[1],
      right: tile.source[0] + sw - (tile.inner[0] + tile.inner[2]),
      bottom: tile.source[1] + sh - (tile.inner[1] + tile.inner[3]),
    }
    : undefined
  const stretched = inner && (inner.left > 0 || inner.top > 0 || inner.right > 0 || inner.bottom > 0)
  return {
    kind: "image",
    image: `${path}#${tile.index}`,
    ...(stretched ? { fit: "nine-slice" as const, nineSlice: { inner } } : {}),
  }
}

function styleLayers(
  access: DocumentAccess,
  images: Map<string, SkinImage>,
  theme: Appearance,
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
    if (sound) layers.push({ kind: "sound", file: sound })
  }
  return layers
}

function stylesOf(
  access: DocumentAccess,
  theme: Appearance,
  orientation: Orientation,
  document: IniDocument,
): { styles: SkinStyles; images: Map<string, SkinImage> } {
  const styles = new Map<string, SkinStyle>()
  const images = new Map<string, SkinImage>()
  for (const section of document.sections()) {
    const match = /^STYLE(\d+)$/i.exec(section)
    if (!match) continue
    const normal = styleLayers(access, images, theme, orientation, document, section, false)
    const pressed = styleLayers(access, images, theme, orientation, document, section, true)
    if (normal.length || pressed.length) styles.set(match[1], { normal, ...(pressed.length ? { pressed } : {}) })
  }
  return { styles, images }
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

function stylesText(styles: SkinStyles, imageRef: (id: string) => string | undefined, names: ReadonlyMap<string, string>): string {
  const lines: string[] = []
  for (const [id, style] of styles) {
    const name = names.get(id)
    if (!name) continue
    const image = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const pressedImage = (style.pressed ?? []).find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const text = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "text" }> => layer.kind === "text")
    const color = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
    const sound = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "sound" }> => layer.kind === "sound")
    const normalRef = image && imageRef(image.image)
    const pressedRef = pressedImage && imageRef(pressedImage.image)
    const textColor = text?.style.color ?? color?.value
    // 只有文字没有颜色的样式也要写，否则按键引用会指向不存在的段。
    const hasText = text?.text !== undefined || text?.style.fontSize !== undefined
    if (!normalRef && !pressedRef && !textColor && !sound && !hasText) continue
    lines.push(`[STYLE${name}]`)
    if (normalRef) lines.push(`NM_IMG=${normalRef}`)
    if (pressedRef) lines.push(`HL_IMG=${pressedRef}`)
    if (textColor) lines.push(`NM_COLOR=${textColor}`)
    if (text?.text !== undefined) lines.push(`SHOW=${text.text}`)
    if (text?.style.fontSize !== undefined) lines.push(`FONT_SIZE=${text.style.fontSize}`)
    if (sound) lines.push(`PRESS_SOUND_PATH=${sound.file}`)
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

/** `Info.txt` 文本。 */
function infoText(model: SkinModel): string {
  const lines: string[] = []
  if (model.meta.name) lines.push(`Name=${model.meta.name}`)
  if (model.meta.author) lines.push(`Author=${model.meta.author}`)
  if (model.meta.version) lines.push(`Version=${model.meta.version}`)
  return `${lines.join("\n")}\n`
}

/** 布局文件文本；`VIEW_RECT` 用构建后的矩形，其余字段从按键模型原样写回。 */
/** 把窗口的分段结构拼回 INI 文本；段与字段顺序按模型里的顺序。 */
function windowText(window: SkinWindow): string {
  const document = IniDocument.parse("")
  for (const [section, fields] of window.sections) {
    document.appendSection(section, [...fields].map(([key, value]) => ({ key, value })))
  }
  return document.toString()
}

export function layoutText(board: SkinBoard, renders: readonly KeyRender[], names?: ReadonlyMap<string, string>): string {
  const lines: string[] = []
  // 空段按原顺序声明；它们的配置在 gen.ini 与面板文件里，段本身只表明存在这个面板。
  for (const section of board.emptySections ?? []) lines.push(`[${section}]`, "")
  lines.push("[PANEL]")
  if (board.backdrop?.blur !== undefined) lines.push(`NO_BLUR=${board.backdrop.blur ? 0 : 1}`)
  if (board.handwritingStyle) lines.push(`HW_FORE_STYLE=${board.handwritingStyle}`)
  if (board.panelStyle) lines.push(`BACK_STYLE=${board.panelStyle}`)
  lines.push(`SIZE=${board.size.width},${board.size.height}`, `KEY_NUM=${board.keyCount ?? board.keys.length}`)
  // TIP_NUM 是原文件声明的槽位数，可能与实际定义数不同；没有声明时按写出的 TIP 段计。
  const tipCount = board.tipCount ?? board.tips?.size ?? 0
  if (tipCount) lines.push(`TIP_NUM=${tipCount}`)
  lines.push("")
  // 列表段：尺寸、条目、位置与取值都按 IR 里的字段写回。
  if (board.list && Object.keys(board.list).length) {
    const list = board.list
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
    lines.push("")
  }
  if (board.hint?.layoutName || board.hint?.type !== undefined) {
    lines.push("[HINT]")
    if (board.hint.layoutName) lines.push(`LAYOUT_NAME=${board.hint.layoutName}`)
    if (board.hint.type !== undefined) lines.push(`TYPE=${board.hint.type}`)
    lines.push("")
  }
  // 符号键盘菜单：类别引用原样写回，顺序按布局名排，稳定可复现。
  if (board.more && (board.more.layouts.size || board.more.cellStyle || board.more.foreStyle || board.more.grid || board.more.layoutName)) {
    const menu = board.more
    lines.push("[MORE]")
    if (menu.cellStyle) lines.push(`CELL_STYLE=${menu.cellStyle}`)
    if (menu.foreStyle) lines.push(`FORE_STYLE=${menu.foreStyle}`)
    if (menu.grid) lines.push(`GRID=${menu.grid.width},${menu.grid.height}`)
    if (menu.layoutName) lines.push(`LAYOUT_NAME=${menu.layoutName}`)
    for (const [key, value] of [...menu.layouts].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`${key}=${value}`)
    }
    lines.push("")
  }
  const tipBlocks: string[] = []
  // 板上的状态段全写：有引用的和没引用的都写，孤儿段同样是文件的一部分。
  for (const [section, override] of board.tips ?? []) {
    tipBlocks.push(...tipLines(override, section, actionValue))
  }
  // 没有 VIEW_RECT 的模板键不进布局树，但段本身要写回。
  const unplaced = new Set((board.unplacedKeys ?? []).map((key) => key.id))
  for (const key of [...board.keys, ...(board.unplacedKeys ?? [])]) {
    // 几何只有布局树这一个来源：taffy 算出矩形，写回的就是它。
    const rect = renders.find((render) => render.key.id === key.id)?.rect
    // 树里没有这个键、它也不是模板段，就没有几何，不写半截的 VIEW_RECT。
    if (!rect && !unplaced.has(key.id)) continue
    lines.push(`[${key.id}]`)
    if (rect) {
      lines.push(`VIEW_RECT=${rect.position.x},${rect.position.y},${rect.size.width},${rect.size.height}`)
    }
    if (key.touchRect === null) {
      lines.push("TOUCH_RECT=0,0,0,0")
    } else if (key.touchRect) {
      lines.push(`TOUCH_RECT=${key.touchRect.position.x},${key.touchRect.position.y},${key.touchRect.size.width},${key.touchRect.size.height}`)
    }
    if (key.padding) lines.push(`PADDING=${key.padding.left},${key.padding.top},${key.padding.right},${key.padding.bottom}`)
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
    if (key.style.back) lines.push(`BACK_STYLE=${styleName(key.style.back)}`)
    if (key.style.pressedBack) lines.push(`HL_BACK_STYLE=${styleName(key.style.pressedBack)}`)
    if (key.style.fore.length) lines.push(`FORE_STYLE=${key.style.fore.map(styleName).join(",")}`)
    if (key.sound) lines.push(`SOUND_STYLE=${key.sound}`)
    // 按键自身的动效引用：一张表里按键 id → 动效 id。
    const motions = Object.entries(key.motions ?? {}).flatMap(([slot, id]) => (id ? [`${slot.toUpperCase()}_ANIM=${id}`] : []))
    lines.push(...motions)
    lines.push("")
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

function nodeOf(entries: Map<string, LegacyAnimationEntry>, entry: LegacyAnimationEntry, seen: Set<string>): MotionNode {
  if (entry.kind === "basic") {
    const track = trackOf(entry)
    return track
      ? { kind: "track", delay: numberField(entry, "DELAY") ?? 0, duration: numberField(entry, "DURATION") ?? 0, track }
      : { kind: "track", delay: 0, duration: 0, track: { property: "alpha", from: [[0, 0], [0, 0]], to: [[0, 0], [0, 0]], relative: false, easing: { kind: "linear" } } }
  }
  if (entry.kind === "combination") {
    const ids = field(entry, "BUILD_LIST")?.split(",").map((part) => part.trim()).filter(Boolean) ?? []
    const children = ids.flatMap((id) => {
      const section = /^\d+$/.test(id) ? `ANIM${id}` : id
      const child = entries.get(section)
      return child && !seen.has(section) ? [nodeOf(entries, child, new Set([...seen, section]))] : []
    })
    const method = field(entry, "BUILD_METHOD") === "2" ? "random" : field(entry, "BUILD_METHOD") === "1" ? "sequential" : "parallel"
    return { kind: "sequence", children, method, delay: numberField(entry, "DELAY") ?? 0, duration: 0 }
  }
  if (entry.kind === "frame") {
    const file = field(entry, "ANIM_PATH")
    return { kind: "frames", frames: file ? [{ file }] : [], loop: 1, delay: 0, duration: 0 }
  }
  return { kind: "particles", emitter: emitterOf(entry), delay: numberField(entry, "DELAY") ?? 0, duration: numberField(entry, "DURATION") ?? 0 }
}

function motionsOf(text: string): SkinMotions {
  const document = parseLegacyAnimationFile(text)
  const entries = new Map(document.entries.map((entry) => [entry.section, entry]))
  const motions = new Map<string, SkinMotion>()
  for (const entry of document.entries) {
    motions.set(entry.section, {
      id: entry.section,
      root: nodeOf(entries, entry, new Set([entry.section])),
      timeline: {
        delay: numberField(entry, "DELAY") ?? 0,
        duration: numberField(entry, "DURATION") ?? 0,
        repeat: field(entry, "REPEAT_CNT")?.toLowerCase() === "inf" ? -1 : numberField(entry, "REPEAT_CNT") ?? 1,
        reverse: field(entry, "REPEAT_MODE") === "1",
        clear: field(entry, "REMOVE") === "1",
      },
      bindings: [],
    })
  }
  return motions
}

function rangeText(value: MotionRange): string {
  return value[0] === value[1] ? String(value[0]) : `rand(${value[0]},${value[1]})`
}

function vectorText(value: MotionVector): string {
  return `${rangeText(value[0])},${rangeText(value[1])}`
}

function animationIndex(id: string): string {
  return id.match(/\d+/)?.[0] ?? id
}

export function writeMotions(motions: SkinMotions): string {
  const lines: string[] = []
  let counter = Math.max(0, ...[...motions.keys()].map((id) => Number(id.match(/^ANIM(\d+)$/)?.[1] ?? 0))) + 1
  const write = (node: MotionNode, id: string, timeline: MotionTimeline): void => {
    lines.push(`[${id}]`)
    if (node.kind === "track") {
      const type = node.track.property === "alpha" ? 0 : node.track.property === "rotate" ? 1 : node.track.property === "translate" ? 2 : node.track.property === "scale" ? 3 : 5
      lines.push("CATEGORY=0", `TYPE=${type}`, `DELAY=${Math.round(node.delay)}`, `DURATION=${Math.round(node.duration)}`)
      if (type === 2) lines.push(`FROM_PX=${vectorText(node.track.from)}`, `TO_PX=${vectorText(node.track.to)}`)
      else lines.push(`FROM=${rangeText(node.track.from[0])}`, `TO=${rangeText(node.track.to[0])}`)
      if (node.track.pivot) lines.push(`PIVOT=${node.track.pivot.x},${node.track.pivot.y}`)
    } else if (node.kind === "sequence") {
      const childIds = node.children.map(() => `ANIM${counter++}`)
      const method = node.method === "random" ? 2 : node.method === "sequential" ? 1 : 0
      lines.push("CATEGORY=1", `BUILD_LIST=${childIds.map(animationIndex).join(",")}`, `BUILD_METHOD=${method}`, `DELAY=${Math.round(node.delay)}`)
      for (const [index, child] of node.children.entries()) {
        write(child, childIds[index], { delay: 0, duration: 0, repeat: 1, reverse: false, clear: false })
      }
    } else if (node.kind === "frames") {
      lines.push("CATEGORY=2", `ANIM_PATH=${node.frames[0]?.file ?? ""}`)
    } else if (node.kind === "particles") {
      const emitter = node.emitter
      lines.push("CATEGORY=3", `TYPE=${emitter.type === "complex" ? 1 : 0}`, `PARTICLE_IMAGE=${emitter.images.join("|")}`)
      lines.push(`TOTAL_NUMBER=${emitter.count}`, `BIRTH_RATE=${emitter.birthRate}`, `EMIT_REGION=${emitter.region.position.x},${emitter.region.position.y},${emitter.region.size.width},${emitter.region.size.height}`)
      lines.push(`LIFE=${rangeText(emitter.life)}`, `VELOCITY=${rangeText(emitter.velocity)}`, `VELOCITY_DIRECTION=${rangeText(emitter.velocityDirection)}`)
      lines.push(`ACCELERATION=${rangeText(emitter.acceleration)}`, `ACCELERATION_DIRECTION=${rangeText(emitter.accelerationDirection)}`)
      lines.push(`INIT_SCALE=${rangeText(emitter.scale)}`, `SCALE_SPEED=${rangeText(emitter.scaleSpeed)}`)
      lines.push(`INIT_ROTATE=${rangeText(emitter.rotation)}`, `ROTATE_SPEED=${rangeText(emitter.rotationSpeed)}`)
      lines.push(`INIT_ALPHA=${rangeText(emitter.alpha)}`, `ALPHA_SPEED=${rangeText(emitter.alphaSpeed)}`)
      lines.push(`DURATION=${Math.round(node.duration)}`, `DELAY=${Math.round(node.delay)}`)
    }
    lines.push(
      `REPEAT_CNT=${timeline.repeat < 0 ? "inf" : timeline.repeat}`,
      `REPEAT_MODE=${timeline.reverse ? 1 : 0}`,
      `REMOVE=${timeline.clear ? 1 : 0}`,
      "",
    )
  }
  for (const motion of motions.values()) write(motion.root, motion.id, motion.timeline)
  return `${lines.join("\n")}\n`
}

/* —— 模型 —— */

function infoOf(access: DocumentAccess): { name?: string; author?: string; version?: string } {
  const text = textContent(access, "Info.txt")
  if (!text) return {}
  const value = (key: string) => text.match(new RegExp(`^${key}=(.+)$`, "mi"))?.[1]?.trim()
  return {
    ...(value("Name") ? { name: value("Name") } : {}),
    ...(value("Author") ? { author: value("Author") } : {}),
    ...(value("Version") ? { version: value("Version") } : {}),
  }
}

function parsePanelSize(document: IniDocument): Size<number> {
  const size = document.get("PANEL", "SIZE")?.split(",").map((part) => Number(part.trim()))
  if (size && size.length === 2 && size.every(Number.isFinite)) return { width: size[0], height: size[1] }
  return { width: 1080, height: 600 }
}

/** 同一主题方向下的布局文件：去掉 `gen.ini` 与面板专用文件，只保留真有按键段的。 */
function layoutFiles(access: DocumentAccess, theme: Appearance, orientation: Orientation): string[] {
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
  // 九宫格的名字带 `_9`，要在 `py`/`en` 之前判断，否则会被当成 26 键主板。
  if (/(?:^|_)(?:9)$|^num|^bh/.test(name)) return "number"
  if (/^(?:py|en|def|hw|big)/.test(name)) return "main"
  return "other"
}

/**
 * 一份布局文档里的按键：动作按事件拆分，样式从预览项上取。
 * 几何单独返回：它只喂布局推导，不进按键。
 */
function keysOf(document: IniDocument, size: Size<number>): Array<{ key: SkinKey; rect: LayoutBox; placed: boolean }> {
  // 第六个参数放行没有 VIEW_RECT 的按键段，它们只有定义没有几何。
  return previewItems(document, size.width, size.height, undefined, false, true).flatMap((item) => {
    // 没有 VIEW_RECT 的键不进布局树，它们是模板/示例段，另走 unplacedKeys。
    if (!/^KEY\d+$/i.test(item.section)) return []
    const actions: SkinKey["actions"] = {}
    const press = actionOf(item.center || item.show)
    if (press) actions.press = press
    // SHOW 是键上显示的字符；没有 CENTER 时它才兼作动作，两件事分开记。
    const label = item.show || undefined
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
    const refs = tipsOf(item.statStyle)
    return [{
      key: {
      id: item.section,
      // TOUCH_RECT 写了全零表示显式没有触摸区，与没写是两种状态。
      ...(item.touchRect === null
        ? { touchRect: null }
        : item.touchRect
          ? { touchRect: { position: { x: item.touchRect.x, y: item.touchRect.y }, size: { width: item.touchRect.width, height: item.touchRect.height } } }
          : {}),
      ...(item.padding ? { padding: { left: item.padding[0], top: item.padding[1], right: item.padding[2], bottom: item.padding[3] } } : {}),
      ...(label ? { label } : {}),
      // 长按弹出的符号串，原文件给什么就带回什么。
      ...(item.holdSymbols ? { holdSymbol: item.holdSymbols } : {}),
      ...(item.info ? { info: item.info } : {}),
      // POS_TYPE 是放置类型，原文件给几个就带回几个。
      ...(item.positionTypes.length
        ? { labelPosition: item.positionTypes.map((value) => Number(value)) }
        : {}),
      actions,
      style: {
        ...(item.backStyle ? { back: item.backStyle } : {}),
        ...(item.highlightBackStyle ? { pressedBack: item.highlightBackStyle } : {}),
        fore: item.foreStyles,
      },
      ...(refs.length ? { stateRefs: refs } : {}),
      },
      rect: { position: { x: item.rect.x, y: item.rect.y }, size: { width: item.rect.width, height: item.rect.height } },
      placed: item.rect.width > 0,
    }]
  })
}

/** 图集名：单页叫 `atlas`，多页追加页码。 */
function atlasName(page: number): string {
  return page === 0 ? "atlas" : `atlas${page}`
}

export type LayoutBoards = {
  boards: SkinBoard[]
  /** 面板文件的原路径，导出时沿用。 */
  paths: PanelPaths
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

/** 布局文件里只被输入法自己读的字段，逐个建模。 */
function boardExtrasOf(document: IniDocument): Pick<SkinBoard, "handwritingStyle"> {
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
function blurOf(document: IniDocument): boolean | undefined {
  const noBlur = document.get("PANEL", "NO_BLUR")?.trim()
  return noBlur === undefined ? undefined : noBlur !== "1"
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

export async function layoutBoards(
  access: DocumentAccess,
  theme: Appearance,
  orientation: Orientation,
  primaryLayout: string,
  primaryKind: BoardKind,
  options?: ImportOptions,
): Promise<LayoutBoards> {
  const document = access.text(primaryLayout)
  if (!document) throw new Error(`包里没有这个布局：${primaryLayout}`)
  const size = parsePanelSize(document)
  const deriveOptions = {
    ...bdsFormat.derive,
    ...options?.derive,
    weights: { ...bdsFormat.derive?.weights, ...options?.derive?.weights },
  }
  const allKeys = keysOf(document, size)
  // 只有带 VIEW_RECT 的键参与布局推导；模板段另存，写回时附在末尾。
  const keys = allKeys.filter((each) => each.placed)
  const unplacedKeys = allKeys.filter((each) => !each.placed).map((each) => each.key)
  const derived = await deriveBoard("board", keys.map((each) => ({ id: each.key.id, ...each.rect })), size, deriveOptions)
  const directory = bdsDirectory(theme, orientation)
  const genDocument = access.text(`${directory}gen.ini`)
  const parsedPanels = genDocument
    ? panelsOf(access, directory, genDocument, actionOf)
    : { panels: {}, paths: {} }
  const boards: SkinBoard[] = [{
    ...parsedPanels.panels,
    // 布局文件的 `[HINT]` 段指明用哪个气泡面板，gen.ini 那边只有样式，两边合并。
    ...(Object.keys(hintExtrasOf(document)).length
      ? { hint: { ...parsedPanels.panels.hint, ...hintExtrasOf(document) } }
      : {}),
    ...(listExtrasOf(document) ? { list: { ...parsedPanels.panels.list, ...listExtrasOf(document) } } : {}),
    ...(blurOf(document) !== undefined ? { backdrop: { ...parsedPanels.panels.backdrop, blur: blurOf(document) } } : {}),
    id: primaryLayout,
    kind: primaryKind,
    geometry: "document",
    orientation,
    size,
    layout: derived.layout,
    keys: keys.map((each) => each.key),
    ...(unplacedKeys.length ? { unplacedKeys } : {}),
    emptySections: emptySectionsOf(document),
    tips: tipPoolOf(document, { actionOf }),
    ...(mergeMore(parsedPanels.panels.more, moreMenuOf(document)) ? { more: mergeMore(parsedPanels.panels.more, moreMenuOf(document)) } : {}),
    ...boardExtrasOf(document),
    ...(tipCountOf(document) !== undefined ? { tipCount: tipCountOf(document) } : {}),
    ...(keyCountOf(document) !== undefined ? { keyCount: keyCountOf(document) } : {}),
    ...(panelStyleOf(document) ? { panelStyle: panelStyleOf(document) } : {}),
  }]
  // 同一主题方向下其余布局文件也是板：九宫格、符号、候选等，一并读进来。
  for (const layoutPath of layoutFiles(access, theme, orientation)) {
    if (layoutPath === primaryLayout) continue
    const other = access.text(layoutPath)
    if (!other) continue
    const boardSize = parsePanelSize(other)
    const boardAll = keysOf(other, boardSize)
    const boardKeys = boardAll.filter((each) => each.placed)
    const boardUnplaced = boardAll.filter((each) => !each.placed).map((each) => each.key)
    if (!boardAll.length) continue
    const boardDerived = await deriveBoard("board", boardKeys.map((each) => ({ id: each.key.id, ...each.rect })), boardSize, deriveOptions)
    boards.push({
      id: layoutPath,
      kind: boardKindOf(layoutPath),
      geometry: "document",
      orientation,
      size: boardSize,
      layout: boardDerived.layout,
      keys: boardKeys.map((each) => each.key),
      ...(boardUnplaced.length ? { unplacedKeys: boardUnplaced } : {}),
      emptySections: emptySectionsOf(other),
      tips: tipPoolOf(other, { actionOf }),
      ...(mergeMore(undefined, moreMenuOf(other)) ? { more: mergeMore(undefined, moreMenuOf(other)) } : {}),
      ...(Object.keys(hintExtrasOf(other)).length ? { hint: hintExtrasOf(other) } : {}),
      ...(listExtrasOf(other) ? { list: listExtrasOf(other) } : {}),
      ...(blurOf(other) !== undefined ? { backdrop: { blur: blurOf(other) } } : {}),
      ...boardExtrasOf(other),
      ...(tipCountOf(other) !== undefined ? { tipCount: tipCountOf(other) } : {}),
      ...(keyCountOf(other) !== undefined ? { keyCount: keyCountOf(other) } : {}),
      ...(panelStyleOf(other) ? { panelStyle: panelStyleOf(other) } : {}),
    })
  }
  return { boards, paths: parsedPanels.paths }
}

/** 某主题方向下的主布局：优先 26 键拼音，其次任意 26 键，最后第一个有按键段的布局。 */
function primaryLayoutOf(access: DocumentAccess, theme: Appearance, orientation: Orientation): string | undefined {
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
  theme: Appearance
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
  const packagedOrientations = [...new Set<Orientation>([...roles.values()].flatMap((role) => ("orientation" in role ? [role.orientation] : [])))]
  const layout = access.text(hints.layout)
  if (!layout) throw new Error(`包里没有这个布局：${hints.layout}`)
  // 没有样式表的布局（官方基础布局）按空样式读，样式由后续的外观覆盖。
  const styleDocument = (hints.styles ? access.text(hints.styles) : undefined) ?? IniDocument.parse("")
  const size = parsePanelSize(layout)
  const model = emptyModel({
    ...infoOf(access),
    appearance: hints.theme,
    orientation: hints.orientation,
    resolution: size,
  }, "bds")
  // 同一皮肤可能有竖屏与横屏两套完整键盘，两套都是事实，都要进模型。
  const orientations = [...new Set<Orientation>([hints.orientation, ...packagedOrientations])]
  const boards: SkinBoard[] = []
  let panelPaths: PanelPaths = {}
  for (const orientation of orientations) {
    const primary = orientation === hints.orientation
      ? hints.layout
      : primaryLayoutOf(access, hints.theme, orientation)
    if (!primary) continue
    const parsedLayouts = await layoutBoards(
      access,
      hints.theme,
      orientation,
      primary,
      orientation === hints.orientation ? hints.kind : "main",
      options,
    )
    boards.push(...parsedLayouts.boards)
    if (orientation === hints.orientation) panelPaths = parsedLayouts.paths
  }
  model.boards.push(...boards)
  const parsed = stylesOf(access, hints.theme, hints.orientation, styleDocument)
  model.styles = parsed.styles
  model.images = parsed.images
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
      const path = locate(layer.file) ?? layer.file
      const data = bytesOf(layer.file)
      resources.set(layer.file, { kind: "audio", path, ...(data ? { data } : {}) })
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
    if (unique.length) board.transitions = unique
  }
  if (hints.animation) {
    const animationText = textContent(access, hints.animation)
    if (animationText) model.motions = motionsOf(animationText)
  }
  // 非按键窗口：候选栏、提示气泡、手写区。它们不是键盘布局，但导出时要原样写回。
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
    model.windows.push({ kind, path, appearance: hints.theme, orientation: windowOrientation, sections })
  }
  const provenance = new Map(model.boards.flatMap((board) => board.keys.map((key) => [key.id, { path: board.id }] as const)))
  // 面板文件的原路径也要记住，导出时沿用原名，避免重建后出现两份面板文件。
  for (const [kind, path] of Object.entries(panelPaths)) provenance.set(`panel:${kind}`, { path })
  model.provenance = { format: "bds", nodes: provenance }
  return model
}

/**
 * 模型 → 文档。
 * 写出时我们清楚每个文件是什么角色，所以角色在这里直接登记，不靠路径猜。
 */
async function bdsFromModel(model: SkinModel): Promise<SkinDocuments> {
  // 主键盘决定方向目录；模型里板多起来之后，第一块不一定是主键盘。
  const board = model.boards.find((each) => each.kind === "main") ?? model.boards[0]
  if (!board) throw new Error("模型里没有板")
  const theme = model.meta.appearance
  const renders = await buildBoard(model, board)
  const orientation = board.orientation
  const root = `${theme}/skin`
  // 只打包图层真正用到的图片；序号就是新图集里的切片号。
  const used = new Set<string>()
  for (const style of model.styles.values()) {
    for (const layer of [...style.normal, ...(style.pressed ?? []), ...(style.disabled ?? [])]) {
      if (layer.kind === "image" || layer.kind === "icon") used.add(layer.image)
    }
  }
  // 包里没有样式表时（样式编号指向输入法内置样式），图片不属于任何图集，原样写回。
  const atlas = used.size > 0
  const selected = atlas ? new Map([...model.images].filter(([id]) => used.has(id))) : new Map<string, SkinImage>()
  // 页尺寸跟随板尺寸：小屏皮肤不该产出 2048 的图集，大屏也不该被压到 1024。
  const pageSize = Math.min(2048, Math.max(1024, Math.ceil(Math.max(board.size.width, board.size.height) / 512) * 512))
  const pages = atlas ? packAtlasPages(selected, pageSize, pageSize) : []
  const placement = new Map<string, { page: number; index: number }>()
  pages.forEach((page, pageIndex) => {
    page.placements.forEach((entry, index) => placement.set(entry.id, { page: pageIndex, index }))
  })
  const inner = new Map<string, readonly [number, number, number, number]>()
  for (const style of model.styles.values()) {
    for (const layer of style.normal) {
      const nine = layer.kind === "image" ? layer.nineSlice?.inner : undefined
      if (nine) inner.set(layer.kind === "image" ? layer.image : "", [nine.left, nine.top, nine.right, nine.bottom])
    }
  }
  const imageRef = (id: string): string | undefined => {
    const hit = placement.get(id)
    return hit === undefined ? undefined : `${atlasName(hit.page)},${hit.index}`
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
  putText("Info.txt", infoText(model), { kind: "info" })
  // 面板文件与 gen.ini 属于主键盘所在的方向目录。
  const panelPaths = {
    ...(model.provenance.nodes.get("panel:candidate") ? { candidate: model.provenance.nodes.get("panel:candidate")!.path } : {}),
    ...(model.provenance.nodes.get("panel:hint") ? { hint: model.provenance.nodes.get("panel:hint")!.path } : {}),
    ...(model.provenance.nodes.get("panel:more") ? { more: model.provenance.nodes.get("panel:more")!.path } : {}),
  }
  // 每个方向各有一份面板文件；面板原路径只属于主方向，其余方向按目录重建。
  for (const eachOrientation of new Set(model.boards.map((each) => each.orientation))) {
    const main = model.boards.find((each) => each.orientation === eachOrientation && each.kind === "main")
      ?? model.boards.find((each) => each.orientation === eachOrientation)
    if (!main) continue
    // 非主方向沿用该方向窗口的原文件名，否则会与原包的面板文件重名两次。
    const windows = model.windows.filter((each) => each.orientation === eachOrientation)
    const paths = eachOrientation === orientation ? panelPaths : {
      ...(windows.find((each) => each.kind === "candidate") ? { candidate: windows.find((each) => each.kind === "candidate")!.path } : {}),
      ...(windows.find((each) => each.kind === "hint") ? { hint: windows.find((each) => each.kind === "hint")!.path } : {}),
    }
    for (const file of panelFiles(main, `${root}/${eachOrientation}/`, main.size, actionValue, paths)) {
      putText(file.path, new TextDecoder().decode(file.data), { kind: "panel-config" })
    }
  }
  // 每块板各自一份布局文件；板 id 已带目录时沿用，其它格式转来的板放到方向目录下。
  for (const each of model.boards) {
    const boardRenders = each === board ? renders : await buildBoard(model, each)
    const path = each.id.includes("/") ? each.id : `${root}/${orientation}/${each.id}`
    putText(path, layoutText(each, boardRenders, names), { kind: "layout", board: each.kind, theme, orientation: each.orientation })
  }
  // 样式表只在模型有样式时写；空样式表会覆盖掉输入法内置的样式。
  if (model.styles.size) putText(`${root}/res/default.css`, stylesText(model.styles, imageRef, names), { kind: "style", theme })
  if (atlas) {
    pages.forEach((page, pageIndex) => {
      const name = atlasName(pageIndex)
      putText(`${root}/res/${name}.til`, tileDocument(page, inner), { kind: "atlas", theme, orientation })
      putBytes(`${root}/res/${name}.png`, encodePng(page.image), { kind: "image" })
    })
  } else {
    // 没有样式表时图片按原路径写回，不改名也不合并。
    for (const [id, image] of model.images) putBytes(id, encodePng(image), { kind: "image" })
  }
  if (model.motions.size) putText(`${root}/res/anim.ini`, writeMotions(model.motions), { kind: "motion" })
  // 非按键窗口按原路径写回：候选栏、提示气泡、手写区。
  for (const window of model.windows) {
    const kind = window.kind === "candidate" ? "candidate-window" as const
      : window.kind === "hint" ? "hint-window" as const
        : "handwriting" as const
    putText(window.path, windowText(window), { kind })
  }
  // 音效与字体按模型里的路径写回；没有字节的说明源包里就没这个文件，不凭空造。
  for (const resource of model.resources.values()) {
    if (!resource.data) continue
    putBytes(resource.path, resource.data, { kind: resource.kind === "font" ? "font" : "audio" })
  }
  return { roles, texts, structs: new Map(), binaries }
}

/** 从文档里出现的路径取主题与方向；写出物本来就按目录分好了。 */
function bdsStructureOf(documents: SkinDocuments): SkinStructure {
  const themes = new Set<Appearance>()
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
  // 主布局：带按键段的布局里挑一块，优先 26 键拼音。
  const layouts = [...structure.roles].filter(([, role]) => role.kind === "layout").map(([path]) => path)
  const layout = layouts.find((path) => /\/py_26\.ini$/i.test(path))
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
