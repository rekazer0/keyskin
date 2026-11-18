// BDS/BDI 转换器：覆盖布局、按键、动作、样式图层、动效与音效。
//
// 格式原生数据是归档加路径；read 解析成 IR，write 从 IR 重新生成全部文件（含重新打包的图集）。
import { IniDocument } from "@/ini.ts"
import { parseLegacyAnimationFile, type LegacyAnimationEntry } from "@/legacy-animation.ts"
import { previewItems } from "@/preview-items.ts"
import { decodePng, encodePng, type RgbaImage } from "@/raster.ts"
import { SkinArchive } from "@/skin.ts"
import { tileSlices } from "@/tiles.ts"
import type { Size } from "taffy-layout"
import type { Appearance, BoardKind, KeyEvent, Orientation, SkinAction } from "@/skin-model/types.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import type { LayoutBox } from "@/skin-model/layout.ts"
import type { SkinKey } from "@/skin-model/key.ts"
import type { SkinLayer, SkinStyle, SkinStyles } from "@/skin-model/style.ts"
import type { SkinBoard } from "@/skin-model/board.ts"
import type { MotionEmitter, MotionNode, MotionRange, MotionTimeline, MotionTrack, MotionVector, SkinMotion, SkinMotions } from "@/skin-model/motion.ts"
import { emptyModel, type SkinModel } from "@/skin-model/model.ts"
import { cutTiles, packAtlasPages, tileDocument, type SkinImage } from "@/skin-model/image.ts"
import { panelFiles, panelsOf, type PanelPaths } from "@/skin-model/formats/bds-panels.ts"
import { deriveBoard } from "@/skin-model/derive/layout.ts"
import { buildBoard, type KeyRender } from "@/skin-model/build.ts"
import type { ImportOptions, SkinFormat } from "@/skin-model/format.ts"

export type BdsSource = {
  archive: SkinArchive
  layout: string
  styles: string
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
  const prefix = `${theme}/skin/${orientation}/`
  const layout = options.layout ?? archive.names().find((name) => name.startsWith(prefix) && name.endsWith("/py_26.ini"))
  if (!layout) return
  const styles = archive.names().find((name) => name.startsWith(`${theme}/`) && name.endsWith("/res/default.css"))
  if (!styles) return
  const animation = archive.names().find((name) => name.startsWith(`${theme}/`) && name.endsWith("/res/anim.ini"))
  return { archive, layout, styles, theme, orientation, kind, ...(animation ? { animation } : {}) }
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

function tilePath(archive: SkinArchive, theme: Appearance, orientation: Orientation, file: string): string | undefined {
  return [
    `${theme}/skin/${orientation}/res/${file}.til`,
    `${theme}/skin/res/${file}.til`,
    `${theme}/res/${file}.til`,
  ].find((candidate) => archive.getBytes(candidate))
}

/** 图集文件与它的 PNG；切图需要像素，所以两者都要在。 */
function atlasBytes(archive: SkinArchive, path: string): Uint8Array | undefined {
  return archive.getBytes(path.replace(/\.til$/i, ".png"))
}

/** 把一张图集切进图片资源表，返回 `<图集>#<序号>` 键。 */
function cutAtlas(images: Map<string, SkinImage>, archive: SkinArchive, path: string): void {
  if ([...images.keys()].some((key) => key.startsWith(`${path}#`))) return
  const bytes = atlasBytes(archive, path)
  if (!bytes) return
  let atlas: RgbaImage
  try {
    atlas = decodePng(bytes)
  } catch {
    return
  }
  const slices = tileSlices(IniDocument.parse(archive.getText(path)))
  for (const [id, image] of cutTiles(atlas, slices.map((slice) => ({ index: slice.index, source: slice.source })), path)) {
    images.set(id, image)
  }
}

function imageLayer(
  archive: SkinArchive,
  images: Map<string, SkinImage>,
  theme: Appearance,
  orientation: Orientation,
  document: IniDocument,
  section: string,
  field: string,
): SkinLayer | undefined {
  const ref = imageRef(document.get(section, field))
  if (!ref) return
  const path = tilePath(archive, theme, orientation, ref.file)
  if (!path) return
  cutAtlas(images, archive, path)
  const slices = tileSlices(IniDocument.parse(archive.getText(path)))
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
  archive: SkinArchive,
  images: Map<string, SkinImage>,
  theme: Appearance,
  orientation: Orientation,
  document: IniDocument,
  section: string,
  pressed: boolean,
): SkinLayer[] {
  const layers: SkinLayer[] = []
  const suffix = pressed ? "HL" : "NM"
  const image = imageLayer(archive, images, theme, orientation, document, section, `${suffix}_IMG`)
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
  archive: SkinArchive,
  theme: Appearance,
  orientation: Orientation,
  document: IniDocument,
): { styles: SkinStyles; images: Map<string, SkinImage> } {
  const styles = new Map<string, SkinStyle>()
  const images = new Map<string, SkinImage>()
  for (const section of document.sections()) {
    const match = /^STYLE(\d+)$/i.exec(section)
    if (!match) continue
    const normal = styleLayers(archive, images, theme, orientation, document, section, false)
    const pressed = styleLayers(archive, images, theme, orientation, document, section, true)
    if (normal.length || pressed.length) styles.set(match[1], { normal, ...(pressed.length ? { pressed } : {}) })
  }
  return { styles, images }
}

/** 样式表文本；图片引用交给调用方换算成「图集名,切片号」。 */
function stylesText(styles: SkinStyles, imageRef: (id: string) => string | undefined): string {
  const lines: string[] = []
  for (const [id, style] of styles) {
    const image = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const pressedImage = (style.pressed ?? []).find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const text = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "text" }> => layer.kind === "text")
    const color = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
    const sound = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "sound" }> => layer.kind === "sound")
    const normalRef = image && imageRef(image.image)
    const pressedRef = pressedImage && imageRef(pressedImage.image)
    const textColor = text?.style.color ?? color?.value
    if (!normalRef && !pressedRef && !textColor && !sound) continue
    lines.push(`[STYLE${id}]`)
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
function layoutText(board: SkinBoard, renders: readonly KeyRender[]): string {
  const lines = ["[PANEL]", `SIZE=${board.size.width},${board.size.height}`, `KEY_NUM=${board.keys.length}`, ""]
  for (const key of board.keys) {
    const rect: LayoutBox = renders.find((render) => render.key.id === key.id)?.rect ?? key.rect
    lines.push(`[${key.id}]`)
    lines.push(`VIEW_RECT=${rect.position.x},${rect.position.y},${rect.size.width},${rect.size.height}`)
    if (key.touchRect) {
      lines.push(`TOUCH_RECT=${key.touchRect.position.x},${key.touchRect.position.y},${key.touchRect.size.width},${key.touchRect.size.height}`)
    }
    if (key.padding) lines.push(`PADDING=${key.padding.left},${key.padding.top},${key.padding.right},${key.padding.bottom}`)
    for (const { event, field: name } of EVENT_FIELDS) {
      const value = actionValue(key.actions[event])
      if (value !== undefined) lines.push(`${name}=${value}`)
    }
    if (key.style.back) lines.push(`BACK_STYLE=${key.style.back}`)
    if (key.style.pressedBack) lines.push(`HL_BACK_STYLE=${key.style.pressedBack}`)
    if (key.style.fore.length) lines.push(`FORE_STYLE=${key.style.fore.join(",")}`)
    if (key.sound) lines.push(`SOUND_STYLE=${key.sound}`)
    // 按键自身的动效引用：一张表里按键 id → 动效 id。
    const motions = Object.entries(key.motions ?? {}).flatMap(([slot, id]) => (id ? [`${slot.toUpperCase()}_ANIM=${id}`] : []))
    lines.push(...motions)
    lines.push("")
  }
  return `${lines.join("\n")}\n`
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

function writeMotions(motions: SkinMotions): string {
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

function infoOf(archive: SkinArchive): { name?: string; author?: string; version?: string } {
  if (!archive.isText("Info.txt")) return {}
  const text = archive.getText("Info.txt")
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
function layoutFiles(archive: SkinArchive, theme: Appearance, orientation: Orientation): string[] {
  const directory = `${theme}/skin/${orientation}/`
  const panels = new Set(["gen.ini", "more.ini", "toolbar.ini"])
  return archive.names().filter((name) => {
    if (!name.startsWith(directory) || !name.endsWith(".ini")) return false
    const leaf = name.slice(directory.length).toLowerCase()
    if (panels.has(leaf)) return false
    return archive.getText(name).includes("[KEY")
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

/** 一份布局文档里的按键：动作按事件拆分，样式与几何从预览项上取。 */
function keysOf(document: IniDocument, size: Size<number>): SkinKey[] {
  return previewItems(document, size.width, size.height, undefined, false).flatMap((item) => {
    if (!/^KEY\d+$/i.test(item.section) || item.rect.width <= 0) return []
    const actions: SkinKey["actions"] = {}
    const press = actionOf(item.center || item.show)
    if (press) actions.press = press
    const hold = actionOf(item.hold)
    if (hold) actions["long-press"] = hold
    const up = actionOf(item.up)
    if (up) actions["swipe-up"] = up
    const down = item.down && item.down !== item.center ? actionOf(item.down) : undefined
    if (down) actions["swipe-down"] = down
    const left = actionOf(item.left)
    if (left) actions["swipe-left"] = left
    const right = actionOf(item.right)
    if (right) actions["swipe-right"] = right
    return [{
      id: item.section,
      rect: { position: { x: item.rect.x, y: item.rect.y }, size: { width: item.rect.width, height: item.rect.height } },
      ...(item.touchRect
        ? { touchRect: { position: { x: item.touchRect.x, y: item.touchRect.y }, size: { width: item.touchRect.width, height: item.touchRect.height } } }
        : {}),
      ...(item.padding ? { padding: { left: item.padding[0], top: item.padding[1], right: item.padding[2], bottom: item.padding[3] } } : {}),
      actions,
      style: {
        ...(item.backStyle ? { back: item.backStyle } : {}),
        ...(item.highlightBackStyle ? { pressedBack: item.highlightBackStyle } : {}),
        fore: item.foreStyles,
      },
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
export async function layoutBoards(
  archive: SkinArchive,
  theme: Appearance,
  orientation: Orientation,
  primaryLayout: string,
  primaryKind: BoardKind,
  options?: ImportOptions,
): Promise<LayoutBoards> {
  const document = IniDocument.parse(archive.getText(primaryLayout))
  const size = parsePanelSize(document)
  const deriveOptions = {
    ...bdsFormat.derive,
    ...options?.derive,
    weights: { ...bdsFormat.derive?.weights, ...options?.derive?.weights },
  }
  const keys = keysOf(document, size)
  const derived = await deriveBoard("board", keys.map((key) => ({ id: key.id, ...key.rect })), size, deriveOptions)
  const directory = `${theme}/skin/${orientation}/`
  const genPath = archive.names().find((name) => name === `${directory}gen.ini`)
  const parsedPanels = genPath
    ? panelsOf(archive, directory, IniDocument.parse(archive.getText(genPath)), actionOf)
    : { panels: {}, paths: {} }
  const boards: SkinBoard[] = [{
    ...parsedPanels.panels,
    id: primaryLayout,
    kind: primaryKind,
    geometry: "document",
    orientation,
    size,
    layout: derived.layout,
    keys,
  }]
  // 同一主题方向下其余布局文件也是板：九宫格、符号、候选等，一并读进来。
  for (const layoutPath of layoutFiles(archive, theme, orientation)) {
    if (layoutPath === primaryLayout) continue
    const other = IniDocument.parse(archive.getText(layoutPath))
    const boardSize = parsePanelSize(other)
    const boardKeys = keysOf(other, boardSize)
    if (!boardKeys.length) continue
    const boardDerived = await deriveBoard("board", boardKeys.map((key) => ({ id: key.id, ...key.rect })), boardSize, deriveOptions)
    boards.push({
      id: layoutPath,
      kind: boardKindOf(layoutPath),
      geometry: "document",
      orientation,
      size: boardSize,
      layout: boardDerived.layout,
      keys: boardKeys,
    })
  }
  return { boards, paths: parsedPanels.paths }
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
  async read(source, options?: ImportOptions) {
    const layout = IniDocument.parse(source.archive.getText(source.layout))
    const styleDocument = IniDocument.parse(source.archive.getText(source.styles))
    const size = parsePanelSize(layout)
    const model = emptyModel({
      ...infoOf(source.archive),
      appearance: source.theme,
      orientation: source.orientation,
      resolution: size,
    }, "bds")
    const layouts = await layoutBoards(source.archive, source.theme, source.orientation, source.layout, source.kind, options)
    model.boards.push(...layouts.boards)
    const parsed = stylesOf(source.archive, source.theme, source.orientation, styleDocument)
    model.styles = parsed.styles
    model.images = parsed.images
    const resources = new Map(model.resources)
    for (const style of parsed.styles.values()) {
      for (const layer of [...style.normal, ...(style.pressed ?? [])]) {
        if (layer.kind === "sound") resources.set(layer.file, { kind: "audio", path: layer.file })
      }
    }
    // 样式文档里声明的字体也算资源，导出时按名称找回。
    for (const section of styleDocument.sections()) {
      const font = styleDocument.get(section, "FONT_FILE")?.trim() || styleDocument.get(section, "FONT_NAME")?.trim()
      if (font) resources.set(font, { kind: "font", path: font, family: font })
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
    if (source.animation) model.motions = motionsOf(source.archive.getText(source.animation))
    const provenance = new Map(model.boards.flatMap((board) => board.keys.map((key) => [key.id, { path: board.id }] as const)))
    model.provenance = { format: "bds", nodes: provenance }
    return model
  },
  async write(model) {
    // 主键盘决定方向目录；模型里板多起来之后，第一块不一定是主键盘。
    const board = model.boards.find((each) => each.kind === "main") ?? model.boards[0]
    if (!board) throw new Error("模型里没有板")
    const renders = await buildBoard(model, board)
    const theme = model.meta.appearance
    const orientation = board.orientation
    const root = `${theme}/skin`
    // 只打包图层真正用到的图片；序号就是新图集里的切片号。
    const used = new Set<string>()
    for (const style of model.styles.values()) {
      for (const layer of [...style.normal, ...(style.pressed ?? []), ...(style.disabled ?? [])]) {
        if (layer.kind === "image" || layer.kind === "icon") used.add(layer.image)
      }
    }
    const selected = new Map([...model.images].filter(([id]) => used.has(id)))
    // 页尺寸跟随板尺寸：小屏皮肤不该产出 2048 的图集，大屏也不该被压到 1024。
    const pageSize = Math.min(2048, Math.max(1024, Math.ceil(Math.max(board.size.width, board.size.height) / 512) * 512))
    const pages = packAtlasPages(selected, pageSize, pageSize)
    // 每张图落在哪一页的第几个切片；样式的图片引用据此写成 `图集名,序号`。
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
    const text = (value: string) => new TextEncoder().encode(value)
    const files: Array<{ path: string; data: Uint8Array }> = []
    files.push({ path: "Info.txt", data: text(infoText(model)) })
    // 面板文件与 gen.ini 属于主键盘所在的方向目录。
    const panelPaths = {
      ...(model.provenance.nodes.get("panel:candidate") ? { candidate: model.provenance.nodes.get("panel:candidate")!.path } : {}),
      ...(model.provenance.nodes.get("panel:hint") ? { hint: model.provenance.nodes.get("panel:hint")!.path } : {}),
      ...(model.provenance.nodes.get("panel:more") ? { more: model.provenance.nodes.get("panel:more")!.path } : {}),
    }
    files.push(...panelFiles(board, `${root}/${orientation}/`, board.size, actionValue, panelPaths))
    // 每块板各自一份布局文件；板 id 已带目录时沿用，其它格式转来的板放到方向目录下。
    for (const each of model.boards) {
      const boardRenders = each === board ? renders : await buildBoard(model, each)
      const path = each.id.includes("/") ? each.id : `${root}/${orientation}/${each.id}`
      files.push({ path, data: text(layoutText(each, boardRenders)) })
    }
    files.push({ path: `${root}/res/default.css`, data: text(stylesText(model.styles, imageRef)) })
    pages.forEach((page, pageIndex) => {
      const name = atlasName(pageIndex)
      files.push({ path: `${root}/res/${name}.til`, data: text(tileDocument(page, inner)) })
      files.push({ path: `${root}/res/${name}.png`, data: encodePng(page.image) })
    })
    if (model.motions.size) files.push({ path: `${root}/res/anim.ini`, data: text(writeMotions(model.motions)) })
    const archive = SkinArchive.fromSourceFiles(files)
    return {
      archive,
      layout: board.id,
      styles: `${root}/res/default.css`,
      theme,
      orientation,
      kind: board.kind,
      ...(model.motions.size ? { animation: `${root}/res/anim.ini` } : {}),
    }
  },
}
