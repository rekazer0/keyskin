export type ProtoField = {
  number: number
  wire: number
  varint?: number
  fixed32?: number
  bytes?: Uint8Array
}

export type BdaResource = { type: number; resourceID: string }
export type BdaStyleRef = { type: "image" | "color" | "text"; key: number }
export type BdaRect = { x: number; y: number; width: number; height: number }
export type BdaScaledOffset = { x: number; y: number }
type BdaFontAdaptInfo = {
  fontSize?: number
  normalColor?: number
  highlightColor?: number
  contentText?: string
  scaledOffset?: BdaScaledOffset
  drawType?: number
}
export type BdaImageAtom = {
  resource?: BdaResource
  innerRect?: BdaRect
  contentInset?: { top: number; left: number; bottom: number; right: number }
  alpha?: number
  filterColor?: number
}
export type BdaImageStyle = {
  normalImage?: BdaImageAtom
  highlightImage?: BdaImageAtom
  fontInfo?: BdaFontAdaptInfo
}
export type BdaTextStyle = {
  resource?: BdaResource
  fontName?: string
  fontSize?: number
  normalColor?: number
  highlightColor?: number
  contentText?: string
}
export type BdaColorStyle = { normalColor?: number; highlightColor?: number }
export type BdaKey = {
  backStyle?: BdaStyleRef
  foreStyles: BdaStyleRef[]
  foreStyleOffsets: Array<{ x: number; y: number }>
  backStyleState?: BdaStyleRef
}
export type BdaBar = { backStyle?: BdaStyleRef }
export type BdaTab = {
  backStyle?: BdaStyleRef
  cellForeStyle?: BdaStyleRef
  cellBackStyle?: BdaStyleRef
  decoratorBackStyle?: BdaStyleRef
}
export type BdaCorpusList = {
  backStyle?: BdaStyleRef
  cellForeStyle?: BdaStyleRef
  cellBackStyle?: BdaStyleRef
  corpusSecondTab?: BdaTab
}
export type BdaGamePanel = {
  backStyle?: BdaStyleRef
  corpusFirstTab?: BdaTab
  corpusList?: BdaCorpusList
  functionBar?: BdaBar
  keys: Map<string, BdaKey>
}
export type BdaSwitch = {
  normalBack?: BdaStyleRef
  selectBack?: BdaStyleRef
  normalFore?: BdaStyleRef
  selectFore?: BdaStyleRef
}
export type BdaCand = {
  candBarStyle?: BdaStyleRef
  candOnBarStyle?: BdaStyleRef
  cellBackStyle?: BdaStyleRef
  cellForeStyle?: BdaStyleRef
  firstCellForeStyle?: BdaStyleRef
  firstCellBackStyle?: BdaStyleRef
  subCandCellForeStyle?: BdaStyleRef
  subCandCellBackStyle?: BdaStyleRef
  switch?: BdaSwitch
  candKeys: Map<string, BdaKey>
  subCandBackStyle?: BdaStyleRef
  menuKeys: Map<string, BdaKey>
  aiIcon?: BdaKey
  accessoryBackStyle?: BdaStyleRef
  gridLeftForeStyle?: BdaStyleRef
  gridRightForeStyle?: BdaStyleRef
}
export type BdaList = {
  backStyle?: BdaStyleRef
  cellBackStyle?: BdaStyleRef
  cellForeStyle?: BdaStyleRef
  foreStyles: BdaStyleRef[]
  foreStyleOffsets: BdaScaledOffset[]
}
export type BdaHint = {
  offset?: BdaScaledOffset
  backStyle?: BdaStyleRef
  barStyle?: BdaStyleRef
  barOffset?: BdaScaledOffset
  foreStyle?: BdaStyleRef
  cellStyle?: BdaStyleRef
}
export type BdaInputTile = { backStyle?: BdaStyleRef; textStyle?: BdaStyleRef }
export type BdaGrid = {
  backStyle?: BdaStyleRef
  cellForeStyle?: BdaStyleRef
  cellBackStyle?: BdaStyleRef
}
export type BdaPanel = {
  hints: Map<string, BdaHint>
  lists: Map<string, BdaList>
  keys: Map<string, BdaKey>
  cand?: BdaCand
  input?: BdaInputTile
  more?: BdaGrid
  backStyle?: BdaStyleRef
  shouldBgBlur?: boolean
  wholeBackStyle?: BdaStyleRef
  shouldKeySlotting?: boolean
  inputRegionBackStyle?: BdaStyleRef
  trackColor?: number
}
export type BdaColorPalette = {
  labelColor?: number
  secondaryLabelColor?: number
  tertiaryLabelColor?: number
  quaternaryLabelColor?: number
  brandColor?: number
  systemBackgroundColor?: number
  secondarySystemBackgroundColor?: number
  tertiarySystemBackgroundColor?: number
  elevatedSystemBackgroundColor?: number
  secondaryElevatedSystemBackgroundColor?: number
  tertiaryElevatedSystemBackgroundColor?: number
  systemGroupedBackgroundColor?: number
  secondarySystemGroupedBackgroundColor?: number
  tertiarySystemGroupedBackgroundColor?: number
  separatorColor?: number
  opaqueSeparatorColor?: number
  systemFillColor?: number
  secondarySystemFillColor?: number
  tertiarySystemFillColor?: number
  quaternarySystemFillColor?: number
  maskColor?: number
  maskBlurColor?: number
  bulletWindowColor?: number
  opaqueBulletWindowColor?: number
  editBlueColor?: number
  editDeepBlueColor?: number
  editRedColor?: number
}
export type BdaAppearance = {
  designWidth?: number
  imageStyles: Map<number, BdaImageStyle>
  textStyles: Map<number, BdaTextStyle>
  colorStyles: Map<number, BdaColorStyle>
  panels: Map<string, BdaPanel>
  colorPalette?: BdaColorPalette
  gamePanel?: BdaGamePanel
  dragBar?: BdaBar
}
export type BdaAppearanceStyleGroup = "imageStyles" | "textStyles" | "colorStyles"
export type BdaAppearancePart =
  | { kind: "panel"; name: string }
  | { kind: "styles"; group: BdaAppearanceStyleGroup }
export type BdaAnimationFrame = { resourceID?: string; duration?: number }
export type BdaAnimationSequence = { name: string; frames: BdaAnimationFrame[] }
export type BdaAnimationKind = "group" | "alpha" | "scale" | "shift" | "rotate" | "frame" | "image" | "emitter" | "lottie" | "video"
export type BdaNumberRange = [number, number]
export type BdaVectorRange = [BdaNumberRange, BdaNumberRange]
export type BdaAnimationBinding = {
  kind: BdaAnimationKind
  key: string
  scope: number
  event: number
  isolated: boolean
  location?: number
  condition?: string
  removeOnInteraction?: boolean
}
export type BdaPoint = [number, number]
export type BdaAnimationPathElement = {
  type: number
  point1?: BdaPoint
  point2?: BdaPoint
  point3?: BdaPoint
}
export type BdaAnimationPath = { elements: BdaAnimationPathElement[] }
export type BdaTransformAnimation = {
  kind: "alpha" | "scale" | "shift" | "rotate"
  key: string
  repeatCount: number
  repeatMode: number
  delay: number
  removeOnFinish: boolean
  duration: number
  interpolation: number
  /** scale / shift 的 X、Y 插值器（IntpolXY），缺省时沿用 interpolation。 */
  interpolationXY?: [number, number]
  /** scale / rotate 的缩放或旋转中心，百分比 0–100。 */
  pivot?: BdaPoint
  /** scale / rotate 的缩放或旋转中心，像素坐标，优先于 pivot。 */
  pivotPx?: BdaPoint
  from: BdaVectorRange
  to: BdaVectorRange
  relative: boolean
}
export type BdaEmitterAnimation = {
  kind: "emitter"
  key: string
  repeatCount: number
  repeatMode: number
  removeOnFinish: boolean
  duration: number
  birthRate: number
  totalNumber: number
  emitRegion: [number, number, number, number]
  resources: BdaResource[]
  life: BdaNumberRange
  rotation: BdaNumberRange
  spin: BdaNumberRange
  scale: BdaNumberRange
  scaleSpeed: BdaNumberRange
  alpha: BdaNumberRange
  alphaSpeed: BdaNumberRange
  velocity: BdaNumberRange
  velocityDirection: BdaNumberRange
  acceleration: BdaNumberRange
  accelerationDirection: BdaNumberRange
  /** 粒子动效结束时机：0 = 发射完所有粒子，1 = 粒子全部消失（FINISH_AFTER_PRACTICES）。 */
  finishAfterPractices: number
  /** 移除动效时是否连已发射的粒子一起移除（REMOVE_INCLUDE_PRACTICES）。 */
  keepParticlesOnRemove: number
  /** 向父层级的镜像次数（MIRROR_UP）。 */
  mirrorUp: number
  /** 粒子运动路径；旧版用 [PATH*] 表达，编辑器只读展示。 */
  paths: BdaAnimationPath[]
  emitterType: number
}
export type BdaGroupAnimation = {
  kind: "group"
  key: string
  buildMode: number
  repeatCount: number
  repeatMode: number
  removeOnFinish: boolean
  delay: number
  items: Array<{ kind: BdaAnimationKind; key: string }>
}
export type BdaResourceAnimation = {
  kind: "frame" | "lottie" | "video"
  key: string
  repeatCount: number
  removeOnFinish: boolean
  resource?: BdaResource
  placeholder?: BdaResource
  startRepeatFrame?: number
}
export type BdaImageAnimation = {
  kind: "image"
  key: string
  repeatCount: number
  repeatMode: number
  removeOnFinish: boolean
  loopForever: boolean
  startRepeatFrame: number
  sequence: BdaAnimationSequence
}
export type BdaAnimationEffect = BdaTransformAnimation | BdaEmitterAnimation | BdaGroupAnimation | BdaResourceAnimation | BdaImageAnimation
export type BdaAnimation = {
  designWidth?: number
  targets: string[]
  sequences: Map<string, BdaAnimationSequence>
  bindings: Map<string, string>
  targetBindings: Map<string, BdaAnimationBinding[]>
  effects: Map<string, BdaAnimationEffect>
}
export type BdaSoundConfig = {
  keySounds: Map<string, BdaResource>
  iosKeySounds: Map<string, BdaResource>
}
type BdaConfigKind =
  | "appearance"
  | "animation"
  | "lightAnimation"
  | "sound"
  | "switch"
  | "sticker"
  | "scene"

const STYLE_BASE = { image: 1_000_000, color: 2_000_000, text: 3_000_000 } as const

export function bdaStyleID(style: BdaStyleRef | undefined): string {
  return style ? String(STYLE_BASE[style.type] + style.key) : ""
}

export function bdaStyleRef(styleID: string): BdaStyleRef | undefined {
  const value = Number(styleID)
  if (!Number.isInteger(value)) return
  for (const type of ["image", "color", "text"] as const) {
    const key = value - STYLE_BASE[type]
    if (key >= 0 && key < 1_000_000) return { type, key }
  }
}

export function bdaAppearancePath(
  archive: SkinArchive,
  theme: string,
  orientation: string,
): string | undefined {
  return bdaConfigPath(archive, theme, orientation, "appearance")
}

export function bdaConfigPath(
  archive: SkinArchive,
  theme: string,
  orientation: string,
  kind: BdaConfigKind,
): string | undefined {
  return bdaConfigPaths(archive, theme, orientation, kind)[0]
}

export function bdaConfigPaths(
  archive: SkinArchive,
  theme: string,
  orientation: string,
  kind: BdaConfigKind,
): string[] {
  const prefix = `${theme}/skin/${orientation}/`
  const config = new RegExp(`^\\d*${kind}Config$`)
  return archive.names().filter((path) => path.startsWith(prefix) && config.test(path.slice(prefix.length)))
    .sort((a, b) => (Number(a.slice(prefix.length).match(/^\d+/)?.[0]) || 0) - (Number(b.slice(prefix.length).match(/^\d+/)?.[0]) || 0))
}

export function bdaPanelKeyName(action: string): string {
  return `KEY_${action.trim().toUpperCase()}`
}

function bdaCandKeyName(action: string): string {
  return `CAND_${action.trim().toUpperCase()}`
}

function setBdaStyle(document: IniDocument, section: string, property: string, style: BdaStyleRef | undefined): void {
  if (style) document.set(section, property, bdaStyleID(style))
}

// sizeSection：前景偏移按哪个区段的尺寸换算。状态 TIP 没有 VIEW_RECT，取所属按键的。
function applyBdaKey(document: IniDocument, section: string, key: BdaKey, sizeSection = section): void {
  setBdaStyle(document, section, "BACK_STYLE", key.backStyle)
  setBdaStyle(document, section, "HL_BACK_STYLE", key.backStyleState)
  if (key.foreStyles.length) document.set(section, "FORE_STYLE", key.foreStyles.map(bdaStyleID).join(","))
  if (!key.foreStyleOffsets.length) return
  const rect = (document.get(sizeSection, "VIEW_RECT") ?? document.get(sizeSection, "SIZE"))?.split(",").map(Number)
  const width = rect?.at(-2) ?? 0
  const height = rect?.at(-1) ?? 0
  document.set(section, "FORE_OFFSET", key.foreStyleOffsets
    .map(({ x, y }) => `${Math.trunc(x * width)},${Math.trunc(y * height)}`)
    .join(";"))
}

function applyBdaStateKeys(
  document: IniDocument,
  sections: string[],
  keys: Map<string, BdaKey>,
  name: (action: string) => string,
): void {
  for (const section of sections) {
    const action = document.get(section, /^ICON|^TIP/.test(section) ? "KEY" : "CENTER") ??
      document.get(section, "DOWN")
    const states = document.get(section, "STAT_STYLE")
    if (!action || !states) continue
    for (const match of states.matchAll(/S(\d+)_(\d+)/g)) {
      const key = keys.get(`${name(action)}_S${match[1]}`)
      if (key) applyBdaKey(document, `TIP${match[2]}`, key, section)
    }
  }
}

export function bdaLayoutDocument(base: IniDocument, appearance: BdaAppearance, layout: string): IniDocument {
  const document = IniDocument.parse(base.toString())
  const panel = appearance.panels.get(layout.replace(/\.ini$/i, ""))
  if (!panel) return document
  const sections = document.sections()
  const keySections = sections.filter((name) => /^KEY\d+$/.test(name))
  for (const section of keySections) {
    const actions = [document.get(section, "CENTER"), document.get(section, "DOWN")]
      .filter((value): value is string => Boolean(value))
    const key = actions.map(bdaPanelKeyName).map((name) => panel.keys.get(name)).find(Boolean)
    if (key) applyBdaKey(document, section, key)
  }
  applyBdaStateKeys(document, keySections, panel.keys, bdaPanelKeyName)

  setBdaStyle(document, "PANEL", "BACK_STYLE", panel.backStyle)
  setBdaStyle(document, "INPUT", "BACK_STYLE", panel.input?.backStyle)
  setBdaStyle(document, "INPUT", "FORE_STYLE", panel.input?.textStyle)
  setBdaStyle(document, "SCAND", "INPUT_STYLE", panel.input?.textStyle)
  setBdaStyle(document, "MORE", "BACK_STYLE", panel.more?.backStyle)
  setBdaStyle(document, "MORE", "FORE_STYLE", panel.more?.cellForeStyle)
  setBdaStyle(document, "MORE", "CELL_STYLE", panel.more?.cellBackStyle)

  const list = panel.lists.get("port") ?? panel.lists.values().next().value
  setBdaStyle(document, "LIST", "BACK_STYLE", list?.backStyle)
  setBdaStyle(document, "LIST", "FORE_STYLE", list?.cellForeStyle)
  setBdaStyle(document, "LIST", "CELL_STYLE", list?.cellBackStyle)

  const cand = panel.cand
  setBdaStyle(document, "CAND", "BACK_STYLE", cand?.candBarStyle)
  setBdaStyle(document, "CAND", "FORE_STYLE", cand?.cellForeStyle)
  setBdaStyle(document, "CAND", "CELL_STYLE", cand?.cellBackStyle)
  setBdaStyle(document, "CAND", "FIRST_FORE", cand?.firstCellForeStyle)
  setBdaStyle(document, "SWITCH", "NML_BACK_STYLE", cand?.switch?.normalBack)
  setBdaStyle(document, "SWITCH", "SEL_BACK_STYLE", cand?.switch?.selectBack)
  setBdaStyle(document, "SWITCH", "NML_FONT_STYLE", cand?.switch?.normalFore)
  setBdaStyle(document, "SWITCH", "SEL_FONT_STYLE", cand?.switch?.selectFore)
  const candSections = sections.filter((name) => /^(?:ICON|TIP)\d+$/.test(name))
  for (const section of candSections) {
    const action = document.get(section, "KEY")
    const key = action && cand?.candKeys.get(bdaCandKeyName(action))
    if (key) applyBdaKey(document, section, key)
  }
  if (cand) applyBdaStateKeys(document, candSections, cand.candKeys, bdaCandKeyName)

  const fallbackHint = panel.hints.get("port") ?? panel.hints.values().next().value
  const shortHint = panel.hints.get("short") ?? fallbackHint
  const longHint = panel.hints.get("long") ?? fallbackHint
  if ((shortHint || longHint) && sections.includes("GLOBAL")) {
    const backIcon = document.get("HINT", "BACK_ICON")
    if (backIcon && shortHint) {
      const section = `ICON${backIcon}`
      setBdaStyle(document, section, "BACK_STYLE", shortHint.backStyle)
      setBdaStyle(document, section, "FORE_STYLE", shortHint.foreStyle)
      const size = document.get(section, "SIZE")?.split(",").map(Number)
      if (shortHint.offset && size?.length === 2) {
        document.set(section, "POS", `${Math.trunc(shortHint.offset.x * size[0])},${Math.trunc(shortHint.offset.y * size[1])}`)
      }
    }
    const longIcon = document.get("BAR", "BACK_ICON")
    if (longIcon && longHint) {
      const section = `ICON${longIcon}`
      setBdaStyle(document, section, "BACK_STYLE", longHint.backStyle)
      setBdaStyle(document, section, "FORE_STYLE", longHint.foreStyle)
      const size = document.get(section, "SIZE")?.split(",").map(Number)
      if (longHint.offset && size?.length === 2) {
        document.set(section, "POS", `${Math.trunc(longHint.offset.x * size[0])},${Math.trunc(longHint.offset.y * size[1])}`)
      }
    }
    const barIcon = document.get("BAR", "ARROW_ICON")
    if (barIcon && longHint) {
      const section = `ICON${barIcon}`
      setBdaStyle(document, section, "BACK_STYLE", longHint.barStyle)
      const size = document.get(section, "SIZE")?.split(",").map(Number)
      if (longHint.barOffset && size?.length === 2) {
        document.set(section, "POS", `${Math.trunc(longHint.barOffset.x * size[0])},${Math.trunc(longHint.barOffset.y * size[1])}`)
      }
    }
    setBdaStyle(document, "BAR", "CELL_STYLE", longHint?.cellStyle)
  }
  return document
}
import { IniDocument } from "./ini.ts"
import { SkinArchive } from "./skin.ts"

