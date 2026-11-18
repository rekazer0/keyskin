// BDS/BDI 转换器：覆盖布局、按键、动作、样式图层、动效与音效。
//
// 格式原生数据是归档加路径；read 解析成 IR，write 把 IR 写回同一份归档并保留未建模的内容。
import { IniDocument } from "@/ini.ts"
import { parseLegacyAnimationFile, type LegacyAnimationEntry } from "@/legacy-animation.ts"
import { previewItems } from "@/preview-items.ts"
import { SkinArchive } from "@/skin.ts"
import { tileSlices } from "@/tiles.ts"
import type { Size } from "taffy-layout"
import type { Appearance, BoardKind, KeyEvent, Orientation, SkinAction } from "@/skin-model/types.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import type { LayoutBox } from "@/skin-model/layout.ts"
import type { SkinKey } from "@/skin-model/key.ts"
import type { SkinLayer, SkinStyle, SkinStyles } from "@/skin-model/style.ts"
import type { MotionEmitter, MotionNode, MotionRange, MotionTimeline, MotionTrack, MotionVector, SkinMotion, SkinMotions } from "@/skin-model/motion.ts"
import { emptyModel } from "@/skin-model/model.ts"
import { deriveBoard } from "@/skin-model/derive/layout.ts"
import { buildBoard } from "@/skin-model/build.ts"
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

function imageLayer(archive: SkinArchive, theme: Appearance, orientation: Orientation, document: IniDocument, section: string, field: string): SkinLayer | undefined {
  const ref = imageRef(document.get(section, field))
  if (!ref) return
  const path = tilePath(archive, theme, orientation, ref.file)
  const emptyNine = ref.slice !== undefined
    ? { source: { position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }, inner: { left: 0, top: 0, right: 0, bottom: 0 }, index: ref.slice }
    : undefined
  if (!path) return { kind: "image", file: ref.file, ...(emptyNine ? { nineSlice: emptyNine } : {}) }
  const slices = tileSlices(IniDocument.parse(archive.getText(path)))
  const tile = ref.slice === undefined ? slices[0] : slices.find((candidate) => candidate.index === ref.slice)
  if (!tile) return { kind: "image", file: ref.file, ...(emptyNine ? { nineSlice: emptyNine } : {}) }
  const [sx, sy, sw, sh] = tile.source
  const [ix, iy, iw, ih] = tile.inner ?? tile.source
  return {
    kind: "image",
    file: ref.file,
    nineSlice: {
      source: { position: { x: sx, y: sy }, size: { width: sw, height: sh } },
      inner: { left: ix - sx, top: iy - sy, right: sx + sw - (ix + iw), bottom: sy + sh - (iy + ih) },
      ...(ref.slice !== undefined ? { index: ref.slice } : {}),
    },
  }
}

function styleLayers(archive: SkinArchive, theme: Appearance, orientation: Orientation, document: IniDocument, section: string, pressed: boolean): SkinLayer[] {
  const layers: SkinLayer[] = []
  const suffix = pressed ? "HL" : "NM"
  const image = imageLayer(archive, theme, orientation, document, section, `${suffix}_IMG`)
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

function stylesOf(archive: SkinArchive, theme: Appearance, orientation: Orientation, document: IniDocument): SkinStyles {
  const styles = new Map<string, SkinStyle>()
  for (const section of document.sections()) {
    const match = /^STYLE(\d+)$/i.exec(section)
    if (!match) continue
    const normal = styleLayers(archive, theme, orientation, document, section, false)
    const pressed = styleLayers(archive, theme, orientation, document, section, true)
    if (normal.length || pressed.length) styles.set(match[1], { normal, ...(pressed.length ? { pressed } : {}) })
  }
  return styles
}

function imageText(layer: Extract<SkinLayer, { kind: "image" }>): string {
  return layer.nineSlice?.index === undefined ? layer.file : `${layer.file},${layer.nineSlice.index}`
}

function writeStyles(styles: SkinStyles, document: IniDocument): void {
  const sections = new Set(document.sections())
  for (const [id, style] of styles) {
    const section = `STYLE${id}`
    if (!sections.has(section)) continue
    const image = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const pressedImage = (style.pressed ?? []).find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const text = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "text" }> => layer.kind === "text")
    const color = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
    const sound = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "sound" }> => layer.kind === "sound")
    if (image) document.set(section, "NM_IMG", imageText(image))
    else document.remove(section, "NM_IMG")
    if (pressedImage) document.set(section, "HL_IMG", imageText(pressedImage))
    else document.remove(section, "HL_IMG")
    const textColor = text?.style.color ?? color?.value
    if (textColor) document.set(section, "NM_COLOR", textColor)
    else document.remove(section, "NM_COLOR")
    if (text?.text !== undefined) document.set(section, "SHOW", text.text)
    else document.remove(section, "SHOW")
    if (text?.style.fontSize !== undefined) document.set(section, "FONT_SIZE", String(text.style.fontSize))
    else document.remove(section, "FONT_SIZE")
    if (sound) document.set(section, "PRESS_SOUND_PATH", sound.file)
    else document.remove(section, "PRESS_SOUND_PATH")
  }
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
    const items = previewItems(layout, size.width, size.height, undefined, false)
    const keys: SkinKey[] = items.flatMap((item) => {
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
    const derived = await deriveBoard("board", keys.map((key) => ({ id: key.id, ...key.rect })), size, {
      ...bdsFormat.derive,
      ...options?.derive,
      weights: { ...bdsFormat.derive?.weights, ...options?.derive?.weights },
    })
    model.boards.push({
      id: source.layout,
      kind: source.kind,
      geometry: "document",
      orientation: source.orientation,
      size,
      layout: derived.layout,
      keys,
    })
    model.styles = stylesOf(source.archive, source.theme, source.orientation, styleDocument)
    if (source.animation) model.motions = motionsOf(source.archive.getText(source.animation))
    model.provenance = { format: "bds", nodes: new Map(keys.map((key) => [key.id, { path: source.layout }])) }
    return model
  },
  async write(model, source) {
    if (!source) throw new Error("BDS 写回需要原始归档")
    const board = model.boards[0]
    if (!board) throw new Error("模型里没有板")
    const renders = await buildBoard(model, board)
    const layout = IniDocument.parse(source.archive.getText(source.layout))
    for (const key of board.keys) {
      if (!layout.sections().includes(key.id)) continue
      const rect = renders.find((render) => render.key.id === key.id)?.rect ?? key.rect
      layout.set(key.id, "VIEW_RECT", `${rect.position.x},${rect.position.y},${rect.size.width},${rect.size.height}`)
      if (key.touchRect) {
        layout.set(key.id, "TOUCH_RECT", `${key.touchRect.position.x},${key.touchRect.position.y},${key.touchRect.size.width},${key.touchRect.size.height}`)
      }
      if (key.padding !== undefined) {
        layout.set(key.id, "PADDING", `${key.padding.left},${key.padding.top},${key.padding.right},${key.padding.bottom}`)
      }
      for (const { event, field: name } of EVENT_FIELDS) {
        const value = actionValue(key.actions[event])
        if (value !== undefined) layout.set(key.id, name, value)
      }
      if (key.style.back) layout.set(key.id, "BACK_STYLE", key.style.back)
      if (key.style.pressedBack) layout.set(key.id, "HL_BACK_STYLE", key.style.pressedBack)
      if (key.style.fore.length) layout.set(key.id, "FORE_STYLE", key.style.fore.join(","))
    }
    source.archive.setBytes(source.layout, new TextEncoder().encode(layout.toString()))
    const styleDocument = IniDocument.parse(source.archive.getText(source.styles))
    writeStyles(model.styles, styleDocument)
    source.archive.setBytes(source.styles, new TextEncoder().encode(styleDocument.toString()))
    if (source.animation && model.motions.size) {
      source.archive.setBytes(source.animation, new TextEncoder().encode(writeMotions(model.motions)))
    }
    return source
  },
}
