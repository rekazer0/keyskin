// 百度输入法皮肤（BDA）转换器：包内自带布局、外观、动效与音效。
//
// 读分两种：带 `layoutConfig` 的包用包内几何建板；只有外观的包（多数皮肤）用外部布局骨架
// 提供几何，没有骨架时只建外观板、不伪造坐标。写回时以模型为准重建整套配置，未建模的文件
// 与字段原样带在 `opaque` 里，避免导出时丢掉读不懂的内容。
import { type BdaAnimationBinding, type BdaAppearance, type BdaColorStyle, type BdaImageStyle, type BdaKey, type BdaList, type BdaPanel, type BdaStyleRef, type BdaTextStyle, bdaPanelKeyName } from "@/bda.ts"
import { decodeBdaAnimation, decodeBdaAppearance, decodeBdaLayout, decodeBdaSoundConfig } from "@/bda-decode.ts"
import { decodePng, encodePng } from "@/raster.ts"
import { SkinArchive } from "@/skin.ts"
import { atlasesOf, imagePathOf, infoOf, infoText, tilText } from "@/skin-model/formats/bda/assets.ts"
import { bdaStyleName, colorStyleOf, imageIDOf, imageStyleOf, styleRefOf, stylesOf, textStyleOf, type BdaStyleParts } from "@/skin-model/formats/bda/style.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import { containerOf } from "@/skin-model/board.ts"
import { absoluteBoard, computeLayout } from "@/skin-model/layout.ts"
import { accessOf, type DocumentAccess } from "@/skin-model/formats/public/access.ts"
import { identifyBds } from "@/skin-model/formats/bds/identify.ts"
import { parseBds } from "@/skin-model/formats/public/parse.ts"
import { actionOf, actionValue, layoutBoards } from "@/skin-model/formats/bds/index.ts"
import { packageOf, type FileRole, type SkinDocuments, type SkinStructure } from "@/skin-model/pipeline.ts"
import { encodeAnimation, encodeAppearance, encodeSoundConfig } from "@/skin-model/formats/bda/appearance.ts"
import { bdaBoardKind, boardsOfLayout, encodeBdaLayout, keyboardNameOf, KEYBOARD_EXTRA, keyContainerOf, layoutOfBoards, listPanelOf, PANEL_EXTRA, panelOf } from "@/skin-model/formats/bda/layout.ts"
import { configBytes, identifyBda, parseBda, pathsOfRole } from "@/skin-model/formats/bda/pipeline.ts"
import { animationOfMotions, motionsOfAnimation, soundConfigOf, soundsOfConfig, soundTypesOf, type BdaMotionParts } from "@/skin-model/formats/bda/motion.ts"
import type { ImportOptions, SkinFormat } from "@/skin-model/format.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import type { Key } from "@/skin-model/key.ts"
import { emptyModel, type SkinModel } from "@/skin-model/model.ts"
import type { SkinStyle } from "@/skin-model/style.ts"
import type { Theme, Orientation } from "@/skin-model/types.ts"
import type { AppearanceSet } from "@/skin-model/activation.ts"

/* —— 常量 —— */

/** `opaque` 里的键。 */
const EXTRA_FILES = "bda.files"
const PLACEMENT = "bda.placement"
const STYLE_PARTS = "bda.styleParts"
const IMAGE_BYTES = "bda.imageBytes"
const IMAGE_PATHS = "bda.imagePaths"
const MOTION_PARTS = "bda.motionParts"
const APPEARANCE_PARTS = "bda.appearance"
const ANIMATION_META = "bda.animation"
const SOUND_TYPES = "bda.soundTypes"
const PANEL_ORDER = "bda.panelOrder"
const TIL_GLOBALS = "bda.tilGlobals"

/** 写回位置：各配置与信息文件在归档里的规范路径。 */
type BdaPlacement = {
  appearancePath: string
  layoutPath?: string
  animationPath?: string
  soundPath?: string
  infoPath?: string
  /** 原始包的主题根目录：`light` 或空串（不带主题层）。 */
  themeRoot: string
  /** 图集名 → `.til` 的源路径。 */
  tilPaths: ReadonlyMap<string, string>
}

export type BdaSource = {
  /** BDA 包：外观、动画、音效与图片。 */
  archive: SkinArchive
  /** 布局骨架：没有 `layoutConfig` 的包靠它提供几何。 */
  base?: SkinArchive
  theme: Theme
  orientation: Orientation
  /** 原始包的主题根目录：`light` 或空串（不带主题层）。 */
  themeRoot: string
}

/* —— 套的定位 —— */

/** 目录前缀：归档把两种原始形态统一成 `<主题>/skin/<方向>/`。 */
function setPrefix(theme: Theme, orientation: Orientation): string {
  return `${theme}/skin/${orientation}/`
}

type BdaSet = { theme: Theme; orientation: Orientation }

/** 包里有哪几套外观：归档路径是 `<主题>/skin/<方向>/`，原始包是 `<主题>/<方向>/` 或 `<方向>/`。 */
function bdaSets(paths: readonly string[]): BdaSet[] {
  const sets = new Map<string, BdaSet>()
  for (const path of paths) {
    const match = /^(light|dark)\/skin\/(port|land)\//i.exec(path)
      ?? /^(?:(light|dark)\/)?(port|land)\//i.exec(path)
    if (!match) continue
    const theme = (match[1] ?? "light").toLowerCase() as Theme
    const set: BdaSet = { theme, orientation: match[2].toLowerCase() as Orientation }
    sets.set(`${set.theme}/${set.orientation}`, set)
  }
  return [...sets.values()].sort((left, right) => `${left.theme}/${left.orientation}`.localeCompare(`${right.theme}/${right.orientation}`))
}

/** 读取哪一套：优先 light/port，找不到就取第一套。 */
function defaultSet(sets: readonly BdaSet[]): BdaSet {
  return sets.find((set) => set.theme === "light" && set.orientation === "port")
    ?? sets[0]
    ?? { theme: "light", orientation: "port" }
}

/** 打开的包属于哪一套；原始主题根目录决定写回时用 `light/port/` 还是 `port/`。 */
export function bdaSource(archive: SkinArchive, base?: SkinArchive, theme?: Theme, orientation?: Orientation): BdaSource | undefined {
  const sets = bdaSets(archive.names())
  if (!sets.length) return
  const chosen = theme && orientation
    ? sets.find((set) => set.theme === theme && set.orientation === orientation) ?? defaultSet(sets)
    : defaultSet(sets)
  const canonical = `${chosen.theme}/skin/${chosen.orientation}/appearanceConfig`
  const raw = archive.sourcePath(canonical)
  const themeRoot = raw.startsWith(`${chosen.theme}/`) ? chosen.theme : ""
  return { archive, ...(base ? { base } : {}), ...chosen, themeRoot }
}

/* —— 能力 —— */

function capabilities(): ReadonlyMap<Capability, CapabilityLevel> {
  return new Map<Capability, CapabilityLevel>([
    ["board.geometry", "full"],
    ["board.keys", "full"],
    ["board.add-remove", "partial"],
    ["key.actions", "partial"],
    ["key.states", "partial"],
    ["key.touch", "none"],
    ["style.image", "full"],
    ["style.color", "full"],
    ["style.text", "full"],
    ["style.nine-slice", "partial"],
    ["panel.backdrop", "full"],
    ["panel.candidate", "partial"],
    ["panel.hint", "partial"],
    ["panel.list", "partial"],
    ["panel.toolbar", "partial"],
    ["panel.input", "partial"],
    ["motion.track", "partial"],
    ["motion.frames", "full"],
    ["motion.binding", "partial"],
    ["motion.custom", "partial"],
    ["sound", "full"],
    ["font", "partial"],
  ])
}

/* —— 读 —— */

type BdaReadHints = {
  theme: Theme
  orientation: Orientation
  /** 原始包的主题根目录：`light` 或空串；写回时决定目录形态。 */
  themeRoot: string
  /** 只有外观的包用骨架几何；骨架是外部输入，不属于这个包。 */
  base?: DocumentAccess
}

/** 骨架里的主板布局：优先 26 键，找不到就取该方向的第一份。 */
function layoutOf(access: DocumentAccess, theme: Theme, orientation: Orientation): string | undefined {
  const prefix = `${theme}/skin/${orientation}/`
  const names = access.paths().filter((name) => name.startsWith(prefix) && name.endsWith(".ini") && !/gen\.ini$/i.test(name))
  return names.find((name) => /(?:def|py|en)_26\.ini$/i.test(name)) ?? names[0]
}

/** 键名里的动作码：`KEY_F39_S17` → `F39`。 */
function actionCodeOfKeyName(name: string): string {
  return name.replace(/^KEY_/i, "").replace(/_S\d+$/i, "")
}

/**
 * 外观面板里的按键没有几何：每个键名一条 `Key`，`layoutId` 缺省、不可触摸。
 * `_S<n>` 变体保持独立——状态号的编码规则还没确认，合成 `states` 就得猜轴。
 */
function keysOfAppearancePanel(panel: BdaPanel): Key[] {
  return [...panel.keys].map(([name]) => {
    const code = actionCodeOfKeyName(name)
    // `F0` 是占位不是动作码（`actions.ts` 的动作码表里没有它），不能交给 `actionOf` 解。
    const action = code === "F0" ? undefined : actionOf(code)
    return {
      id: name,
      hitArea: { kind: "none" } as const,
      ...(action ? { actions: { press: action } } : {}),
      container: keyContainerOf(panel, name, bdaStyleName),
    }
  })
}

/** 没有包内布局时，每个外观面板一块板：几何标为客户端提供，画布未知，按键只有样式。 */
function panelsAsBoards(appearance: BdaAppearance, options: { theme: Theme; orientation: Orientation }): import("@/skin-model/board.ts").Board[] {
  return [...appearance.panels].map(([name, panel]) => {
    // 列表按方向索引：只取当前方向那一条，不把两个方向的样式混在一起。
    const list = listPanelOf(panel.lists.get(options.orientation), bdaStyleName)
    return {
      id: `${options.theme}/${options.orientation}/${name}`,
      kind: bdaBoardKind(name),
      theme: options.theme,
      orientation: options.orientation,
      geometry: { kind: "client", basis: "bda" },
      // 外观面板没有画布尺寸：designWidth 是基准宽，不是容器。骨架缺失时容器就是未知。
      container: { kind: "unknown" },
      layout: absoluteBoard([]),
      ...(panel.backStyle ? { backdrop: bdaStyleName(panel.backStyle) } : {}),
      ...(list ? { panels: { list } } : {}),
      keys: keysOfAppearancePanel(panel),
      extra: new Map<string, unknown>([[PANEL_EXTRA, panel]]),
    }
  })
}

/** 外观里的按键样式覆盖骨架布局里的按键；骨架的编号在 BDA 里不指向任何外观样式。 */
function applyPanelStyles(
  boards: readonly import("@/skin-model/board.ts").Board[],
  appearance: BdaAppearance,
  orientation: Orientation,
): void {
  for (const board of boards) {
    const panel = appearance.panels.get(keyboardNameOf(board))
    // 骨架带过来的是 BDS 的列表外观，对 BDA 是错的；BDA 外观没有列表就把这一层删掉。
    const list = listPanelOf(panel?.lists.get(orientation), bdaStyleName)
    const { list: _skeletonList, ...panels } = board.panels ?? {}
    board.panels = list ? { ...panels, list } : (Object.keys(panels).length ? panels : undefined)
    for (const key of board.keys) {
      // 没有动作的键（KEY_F0_*）直接按键名查；有动作的键在骨架里用的是 BDS 键名，靠动作码对齐。
      const action = actionValue(key.actions?.press)
      const name = action ? bdaPanelKeyName(action) : key.id
      key.container = keyContainerOf(panel, name, bdaStyleName)
    }
  }
}

/**
 * 解析产物 → 模型。
 * 签名里没有 SkinPackage：外观、布局、动画、音效、图片都从文档取。
 */
async function bdaToModel(documents: SkinDocuments, hints: BdaReadHints, options?: ImportOptions): Promise<SkinModel> {
  const prefix = setPrefix(hints.theme, hints.orientation)
  const appearanceBytes = configBytes(documents, "appearance", prefix)
  if (!appearanceBytes) throw new Error("BDA 包里没有外观配置")
  const appearance = decodeBdaAppearance(appearanceBytes)
  const resPrefix = `${hints.theme}/skin/res/`
  const imagePaths = pathsOfRole(documents, "image")
  const images = new Map<string, SkinImage>()
  /** 已经被 IR 图片表接管的文件；未接管的才需要原字节兜底。 */
  const usedImagePaths = new Set<string>()
  /** IR 图片 id → 源文件路径；写回时回到同一个文件，不改名。 */
  const imageFiles = new Map<string, string>()

  /** 资源名 → IR 图片 id；webp 没有解码器，只能把原字节留在 opaque 里。 */
  const image = (resourceID: string): string | undefined => {
    const id = imageIDOf(resourceID)
    if (images.has(id)) return id
    const path = imagePathOf(imagePaths, resourceID, resPrefix)
    const data = path ? documents.binaries.get(path) : undefined
    if (!path || !data || !/\.png$/i.test(path)) return
    try {
      images.set(id, decodePng(data))
      usedImagePaths.add(path)
      imageFiles.set(id, path)
      return id
    } catch {
      return
    }
  }

  const styled = stylesOf(appearance, image)
  const layoutBytes = configBytes(documents, "layout", prefix)
  let boards: import("@/skin-model/board.ts").Board[]
  if (layoutBytes) {
    boards = boardsOfLayout(decodeBdaLayout(layoutBytes), {
      theme: hints.theme,
      orientation: hints.orientation,
      panels: appearance.panels,
      ...(appearance.designWidth !== undefined ? { designWidth: appearance.designWidth } : {}),
      styleName: (ref) => bdaStyleName(ref) ?? `bda:${ref.type}:${ref.key}`,
    })
  } else if (hints.base) {
    const layout = layoutOf(hints.base, hints.theme, hints.orientation)
    if (layout) {
      const parsed = await layoutBoards(hints.base, hints.theme, hints.orientation, layout, "main", options)
      applyPanelStyles(parsed.boards, appearance, hints.orientation)
      boards = parsed.boards
    } else {
      boards = panelsAsBoards(appearance, hints)
    }
  } else {
    boards = panelsAsBoards(appearance, hints)
  }

  const info = infoOf(documents)
  const model = emptyModel({
    ...(info.values.get("Name") ? { name: info.values.get("Name") } : {}),
    ...(info.values.get("VersionCode") ? { version: info.values.get("VersionCode") } : {}),
    theme: hints.theme,
    orientation: hints.orientation,
    ...(appearance.designWidth !== undefined ? { designWidth: appearance.designWidth } : {}),
  }, "bda")
  model.boards.push(...boards)
  model.styles = styled.styles
  model.images = images
  // 动画与帧序列引用的是包里的原始资源名（`10055`），图片 id 是 `bda:10055`：
  // 这层对应关系由格式层建好，渲染层只查表，不碰 `bda:` 这个前缀。
  model.resourceIndex = new Map([...images.keys()].flatMap((id) => {
    const resourceID = id.replace(/^bda:/, "")
    return resourceID === id ? [] : [[resourceID, id] as [string, string]]
  }))

  // 音效与字体是包里的文件，字节要进模型。
  const resources = new Map(model.resources)
  for (const [path, data] of documents.binaries) {
    if (/\.(?:mp3|ogg|wav|m4a|ttf|otf|ttc)$/i.test(path)) {
      resources.set(path, /\.(?:ttf|otf|ttc)$/i.test(path) ? { kind: "font", path, data } : { kind: "audio", path, data })
    }
  }
  model.resources = resources

  const animationBytes = configBytes(documents, "animation", prefix)
  const motionParts = new Map<string, BdaMotionParts>()
  // 动画配置自己的元信息（设计宽、目标清单、悬空绑定）IR 不表达，写回时原样带回。
  let animationMeta: {
    designWidth?: number
    targets: string[]
    dangling?: Array<{ target: string; binding: BdaAnimationBinding }>
  } | undefined
  if (animationBytes) {
    try {
      const decoded = decodeBdaAnimation(animationBytes)
      const parsed = motionsOfAnimation(decoded)
      model.motions = parsed.motions
      for (const [id, part] of parsed.parts) motionParts.set(id, part)
      animationMeta = {
        ...(decoded.designWidth !== undefined ? { designWidth: decoded.designWidth } : {}),
        targets: decoded.targets,
        ...(parsed.dangling.length ? { dangling: parsed.dangling } : {}),
      }
    } catch {
      // 动画配置损坏时不影响皮肤本身的读取，留给调用方判断。
    }
  }
  const soundBytes = configBytes(documents, "sound", prefix)
  const soundTypes = new Map<string, number>()
  if (soundBytes) {
    try {
      const decoded = decodeBdaSoundConfig(soundBytes)
      model.sounds = soundsOfConfig(decoded)
      for (const [key, type] of soundTypesOf(decoded)) soundTypes.set(key, type)
    } catch {
      // 音效配置损坏同理。
    }
  }

  const til = atlasesOf(documents, resPrefix)
  model.atlases = til.atlases

  // 当前套的配置由 IR 重建；其余文件（其它主题方向、Token、开关、桌面信息）原样保留。
  const files = new Map<string, Uint8Array>()
  const imageBytes = new Map<string, Uint8Array>()
  for (const [path, data] of documents.binaries) {
    if (imagePaths.includes(path)) {
      // 已被 IR 接管的图片由图片表重建；其余（webp、未引用）保留原字节。
      if (!usedImagePaths.has(path)) imageBytes.set(path, data)
      continue
    }
    const currentConfig = path.startsWith(prefix) && /(appearanceConfig|layoutConfig|animationConfig|soundConfig)$/i.test(path)
    const currentAtlas = path.startsWith(resPrefix) && /\.til$/i.test(path)
    if (currentConfig || currentAtlas || path === info.path) continue
    files.set(path, data)
  }

  // 包里只有一套外观时没有"何时生效"可写；多于一套才有主题选择。
  const setCount = bdaSets([...documents.roles.keys(), ...documents.binaries.keys()]).length
  model.appearances = [{
    theme: hints.theme,
    orientation: hints.orientation,
    activation: setCount > 1 ? { kind: "theme", theme: hints.theme } : { kind: "always" },
    boards: boards.map((board) => board.id),
  } satisfies AppearanceSet]
  model.profiles = [{ format: "bda", capabilities: capabilities(), ...(info.values.size ? { declared: info.values } : {}) }]
  model.opaque = new Map<string, unknown>([
    ...model.opaque,
    [STYLE_PARTS, styled.parts],
    [MOTION_PARTS, motionParts],
    [IMAGE_BYTES, imageBytes],
    [IMAGE_PATHS, imageFiles],
    ...(animationMeta ? [[ANIMATION_META, animationMeta] as [string, unknown]] : []),
    ...(soundTypes.size ? [[SOUND_TYPES, soundTypes] as [string, unknown]] : []),
    [PANEL_ORDER, [...appearance.panels.keys()]],
    [TIL_GLOBALS, til.globals],
    [APPEARANCE_PARTS, {
      ...(appearance.colorPalette ? { colorPalette: appearance.colorPalette } : {}),
      ...(appearance.gamePanel ? { gamePanel: appearance.gamePanel } : {}),
      ...(appearance.dragBar ? { dragBar: appearance.dragBar } : {}),
    }],
    [EXTRA_FILES, files],
    [PLACEMENT, {
      appearancePath: `${prefix}appearanceConfig`,
      ...(layoutBytes ? { layoutPath: `${prefix}layoutConfig` } : {}),
      ...(animationBytes ? { animationPath: `${prefix}animationConfig` } : {}),
      ...(soundBytes ? { soundPath: `${prefix}soundConfig` } : {}),
      ...(info.path ? { infoPath: info.path } : {}),
      themeRoot: hints.themeRoot,
      tilPaths: til.paths,
    } satisfies BdaPlacement],
  ])
  return model
}

/* —— 写 —— */

function placementOf(model: SkinModel): BdaPlacement {
  const stored = model.opaque.get(PLACEMENT) as BdaPlacement | undefined
  if (stored) return stored
  const prefix = setPrefix(model.meta.theme, model.meta.orientation)
  return {
    appearancePath: `${prefix}appearanceConfig`,
    infoPath: "Info.txt",
    themeRoot: "",
    tilPaths: new Map(),
  }
}

/** 归档里的规范路径 → 原始包路径：带主题层时保留主题目录，否则去掉它。 */
function rawOf(path: string, themeRoot: string): string {
  const match = /^(light|dark)\/skin\/(.*)$/.exec(path)
  if (!match) return path
  return themeRoot ? `${match[1]}/${match[2]}` : match[2]
}

/** 样式里各图层决定它进哪张表；BDA 的样式表只装图片、文字与颜色。 */
function styleTypeOf(style: SkinStyle): BdaStyleRef["type"] | undefined {
  const layers = [...style.normal, ...(style.pressed ?? []), ...(style.disabled ?? [])]
  if (layers.some((layer) => layer.kind === "image")) return "image"
  if (layers.some((layer) => layer.kind === "text")) return "text"
  if (layers.some((layer) => layer.kind === "color")) return "color"
  return undefined
}

/**
 * IR 样式名 → BDA 的 `{类型, 编号}`。
 * 本来就是 BDA 编号的沿用原值；来自其它格式的按图层种类分配新编号，
 * 否则写回时会被当成不认识的样式全部丢掉。
 */
function styleRefsOf(model: SkinModel): Map<string, BdaStyleRef> {
  const refs = new Map<string, BdaStyleRef>()
  const used = { image: new Set<number>(), text: new Set<number>(), color: new Set<number>() }
  for (const name of model.styles.keys()) {
    const ref = styleRefOf(name)
    if (!ref) continue
    refs.set(name, ref)
    used[ref.type].add(ref.key)
  }
  const nexts = { image: 1, text: 1, color: 1 }
  for (const [name, style] of model.styles) {
    if (refs.has(name)) continue
    const type = styleTypeOf(style)
    if (!type) continue
    while (used[type].has(nexts[type])) nexts[type] += 1
    refs.set(name, { type, key: nexts[type] })
    used[type].add(nexts[type])
    nexts[type] += 1
  }
  return refs
}

/**
 * 板上的列表面板 → 外观的列表条目。
 * 只覆盖外观层；多条前景与偏移 IR 不表达，沿用原文。
 * `panel.lists` 按方向索引，只写当前方向那一条，不混两个方向。
 */
function listsOfBoard(
  board: import("@/skin-model/board.ts").Board,
  source: ReadonlyMap<string, BdaList> | undefined,
): Map<string, BdaList> | undefined {
  const appearance = board.panels?.list?.appearance
  const lists = new Map(source ?? [])
  if (!appearance) return lists.size ? lists : undefined
  const key = source?.has(board.orientation) ? board.orientation : [...(source?.keys() ?? [])][0] ?? board.orientation
  const original = lists.get(key)
  const backStyle = styleRefOf(appearance.style) ?? original?.backStyle
  const cellBackStyle = styleRefOf(appearance.cellStyle) ?? original?.cellBackStyle
  const cellForeStyle = styleRefOf(appearance.foreStyle) ?? original?.cellForeStyle
  lists.set(key, {
    ...(backStyle ? { backStyle } : {}),
    ...(cellBackStyle ? { cellBackStyle } : {}),
    ...(cellForeStyle ? { cellForeStyle } : {}),
    foreStyles: original?.foreStyles ?? [],
    foreStyleOffsets: original?.foreStyleOffsets ?? [],
  })
  return lists
}

/** 面板从模型重建：顺序按读取时的面板表，样式引用以按键容器为准。 */
function panelsOf(model: SkinModel, refs: ReadonlyMap<string, BdaStyleRef>): Map<string, BdaPanel> {
  const order = model.opaque.get(PANEL_ORDER) as readonly string[] | undefined
  const boards = new Map(model.boards.map((board) => [keyboardNameOf(board), board]))
  const names = [...(order ?? []).filter((name) => boards.has(name)), ...boards.keys()]
  const panels = new Map<string, BdaPanel>()
  for (const name of names) {
    const board = boards.get(name)
    if (!board) continue
    const source = panelOf(board)
    const back = refs.get(board.backdrop ?? "")
    panels.set(name, {
      hints: source?.hints ?? new Map(),
      lists: listsOfBoard(board, source?.lists) ?? new Map(),
      keys: keysOfBoard(board, source, refs),
      ...(source?.cand ? { cand: source.cand } : {}),
      ...(source?.input ? { input: source.input } : {}),
      ...(source?.more ? { more: source.more } : {}),
      ...(back ?? source?.backStyle ? { backStyle: back ?? source?.backStyle } : {}),
      ...(source?.shouldBgBlur !== undefined ? { shouldBgBlur: source.shouldBgBlur } : {}),
      ...(source?.trackColor !== undefined ? { trackColor: source.trackColor } : {}),
      ...(source?.wholeBackStyle ? { wholeBackStyle: source.wholeBackStyle } : {}),
      ...(source?.shouldKeySlotting !== undefined ? { shouldKeySlotting: source.shouldKeySlotting } : {}),
      ...(source?.inputRegionBackStyle ? { inputRegionBackStyle: source.inputRegionBackStyle } : {}),
    })
  }
  return panels
}

/** BDA 面板的键名是 `KEY_<动作码>`；来自其它格式的按键 id 不是这个形状，按动作码补。 */
function panelKeyNameOf(key: Key, used: ReadonlySet<string>): string {
  if (/^KEY_/i.test(key.id)) return key.id
  const code = actionValue(key.actions?.press)
  const name = code ? bdaPanelKeyName(code) : undefined
  return name && !used.has(name) ? name : key.id
}

/** 一块板的按键表：以面板原来的顺序为底，样式引用从容器取。 */
function keysOfBoard(
  board: import("@/skin-model/board.ts").Board,
  source: BdaPanel | undefined,
  refs: ReadonlyMap<string, BdaStyleRef>,
): Map<string, BdaKey> {
  const keys = new Map<string, BdaKey>(source?.keys ?? [])
  for (const key of board.keys) {
    const name = panelKeyNameOf(key, new Set(keys.keys()))
    const original = keys.get(name) ?? keys.get(key.id)
    const back = refs.get(key.container.back?.style ?? "") ?? original?.backStyle
    const pressed = refs.get(key.container.back?.pressed ?? "") ?? original?.backStyleState
    const fore = key.container.fore.flatMap((layer) => {
      const ref = refs.get(layer.style ?? "")
      return ref ? [ref] : []
    })
    // BDA 的偏移表可以比前景表长；以原文为底按模型覆盖，往返才不会丢多出的项。
    const offsets = (original?.foreStyleOffsets ?? []).map((offset) => ({ x: offset.x, y: offset.y }))
    for (const [index, layer] of key.container.fore.entries()) {
      if (!layer.offset) continue
      if (index < offsets.length) offsets[index] = { x: layer.offset.x, y: layer.offset.y }
      else offsets.push({ x: layer.offset.x, y: layer.offset.y })
    }
    if (!original && !back && !pressed && !fore.length) continue
    keys.set(name, {
      ...(back ? { backStyle: back } : {}),
      foreStyles: fore.length ? fore : original?.foreStyles ?? [],
      foreStyleOffsets: offsets.length ? offsets : original?.foreStyleOffsets ?? [],
      ...(pressed ? { backStyleState: pressed } : {}),
    })
  }
  return keys
}

/** 模型的三张样式表 → 外观。 */
function appearanceOf(model: SkinModel, refs: ReadonlyMap<string, BdaStyleRef>): BdaAppearance {
  const parts = model.opaque.get(STYLE_PARTS) as ReadonlyMap<string, BdaStyleParts> | undefined
  const extra = model.opaque.get(APPEARANCE_PARTS) as Partial<Pick<BdaAppearance, "colorPalette" | "gamePanel" | "dragBar">> | undefined
  const imageStyles = new Map<number, BdaImageStyle>()
  const textStyles = new Map<number, BdaTextStyle>()
  const colorStyles = new Map<number, BdaColorStyle>()
  for (const [name, style] of model.styles) {
    const ref = refs.get(name)
    if (!ref) continue
    const part = parts?.get(name)
    if (ref.type === "image") imageStyles.set(ref.key, imageStyleOf(style, part?.image))
    else if (ref.type === "text") textStyles.set(ref.key, textStyleOf(style, part?.text))
    else colorStyles.set(ref.key, colorStyleOf(style, part?.color))
  }
  return {
    imageStyles,
    textStyles,
    colorStyles,
    panels: panelsOf(model, refs),
    ...(extra?.colorPalette ? { colorPalette: extra.colorPalette } : {}),
    ...(extra?.gamePanel ? { gamePanel: extra.gamePanel } : {}),
    ...(extra?.dragBar ? { dragBar: extra.dragBar } : {}),
    ...(model.meta.designWidth !== undefined ? { designWidth: model.meta.designWidth } : {}),
  }
}

/** 模型 → 文档。BDA 的写出物全是二进制配置、图片与两份文本。 */
async function bdaFromModel(model: SkinModel): Promise<SkinDocuments> {
  const placement = placementOf(model)
  const theme = model.meta.theme
  const orientation = model.meta.orientation
  const prefix = setPrefix(theme, orientation)
  const resPrefix = `${theme}/skin/res/`
  const roles = new Map<string, FileRole>()
  const binaries = new Map<string, Uint8Array>()
  /** 规范路径 → 原始包路径；写回用的是原始目录形态。 */
  const toRaw = (path: string): string => rawOf(path, placement.themeRoot)
  const put = (path: string, data: Uint8Array, role: FileRole): void => {
    const raw = toRaw(path)
    binaries.set(raw, data)
    roles.set(raw, role)
  }
  // 未建模文件与原图先写；下面重建的文件覆盖同名项。
  for (const [path, data] of model.opaque.get(EXTRA_FILES) as ReadonlyMap<string, Uint8Array> | undefined ?? []) binaries.set(toRaw(path), data)
  for (const [path, data] of model.opaque.get(IMAGE_BYTES) as ReadonlyMap<string, Uint8Array> | undefined ?? []) binaries.set(toRaw(path), data)

  const declared = new Map(model.profiles.find((profile) => profile.format === "bda")?.declared ?? [])
  if (model.meta.name !== undefined) declared.set("Name", model.meta.name)
  if (model.meta.version !== undefined) declared.set("VersionCode", model.meta.version)
  if (declared.size) put(placement.infoPath ?? "Info.txt", new TextEncoder().encode(infoText(declared)), { kind: "info" })

  // 三张表的编号在这一次写回里只算一遍，样式表与按键引用必须用同一份映射。
  const refs = styleRefsOf(model)
  put(placement.appearancePath, encodeAppearance(appearanceOf(model, refs)), { kind: "appearance" })

  // 只有读自带布局的包才写布局配置；只读外观的包没有几何可写。
  if (model.boards.some((board) => board.extra?.has(KEYBOARD_EXTRA))) {
    const rects = new Map<string, ReadonlyMap<string, import("@/skin-model/layout.ts").LayoutBox>>()
    for (const board of model.boards) {
      // 容器未知的板没有布局可写；它的几何本来就来自骨架，不在这里编一个矩形集合。
      const container = containerOf(board)
      if (!container) continue
      rects.set(board.id, await computeLayout(board.layout, container))
    }
    put(placement.layoutPath ?? `${prefix}layoutConfig`, encodeBdaLayout(layoutOfBoards(model.boards, rects)), {
      kind: "layout",
      board: "main",
      theme,
      orientation,
    })
  }

  if (model.motions.size) {
    const parts = model.opaque.get(MOTION_PARTS) as ReadonlyMap<string, BdaMotionParts> | undefined
    const meta = model.opaque.get(ANIMATION_META) as {
      designWidth?: number
      targets: string[]
      dangling?: Array<{ target: string; binding: BdaAnimationBinding }>
    } | undefined
    const rebuilt = animationOfMotions(model.motions, meta?.designWidth, parts, meta?.targets)
    // 指向不存在效果的绑定原样写回，否则读一次就少一条。
    for (const { target, binding } of meta?.dangling ?? []) {
      const list = rebuilt.animation.targetBindings.get(target) ?? []
      rebuilt.animation.targetBindings.set(target, [...list, binding])
    }
    put(placement.animationPath ?? `${prefix}animationConfig`, encodeAnimation(rebuilt.animation), { kind: "motion" })
  }
  if (model.sounds.length) {
    const types = model.opaque.get(SOUND_TYPES) as ReadonlyMap<string, number> | undefined
    put(placement.soundPath ?? `${prefix}soundConfig`, encodeSoundConfig(soundConfigOf(model.sounds, types)), { kind: "sound-config" })
  }

  // 图片写回原来的文件；没有源路径的（新加图片）放到当前套的 res 下。
  const imageFiles = model.opaque.get(IMAGE_PATHS) as ReadonlyMap<string, string> | undefined
  for (const [id, image] of model.images) {
    const name = id.replace(/^bda:/, "").split("/").pop()!.replace(/\.[^.]+$/, "")
    const path = imageFiles?.get(id) ?? `${resPrefix}${name}.png`
    put(path, encodePng(image), { kind: "image" })
  }

  const globals = model.opaque.get(TIL_GLOBALS) as ReadonlyMap<string, Map<string, string>> | undefined
  for (const atlas of model.atlases) {
    const path = placement.tilPaths.get(atlas.name) ?? `${resPrefix}${atlas.name}.til`
    put(path, new TextEncoder().encode(tilText(atlas, globals?.get(atlas.name))), { kind: "atlas", theme, orientation })
  }
  return { roles, texts: new Map(), structs: new Map(), binaries }
}

/** 从路径取主题与方向；两种形态（归档的 `light/skin/port/` 与原始包的 `light/port/`）都要认。 */
function bdaStructureOf(documents: SkinDocuments): SkinStructure {
  const themes = new Set<Theme>()
  const orientations = new Set<Orientation>()
  const paths = [...documents.roles.keys(), ...documents.binaries.keys()]
  for (const path of paths) {
    const match = /^(light|dark)\/skin\/(port|land)\//i.exec(path)
      ?? /^(?:(light|dark)\/)?(port|land)\//i.exec(path)
    if (!match) continue
    themes.add(((match[1] ?? "light")).toLowerCase() as Theme)
    orientations.add(match[2].toLowerCase() as Orientation)
  }
  return {
    roles: documents.roles,
    themes: themes.size ? [...themes].sort() : ["light"],
    orientations: orientations.size ? [...orientations].sort() : ["port"],
  }
}

/** 文档 → 包。 */
function bdaPack(documents: SkinDocuments): BdaSource {
  const files = [...documents.binaries].map(([path, data]) => ({ path, data }))
  const structure = bdaStructureOf(documents)
  const sets = bdaSets([...documents.binaries.keys()])
  const chosen = sets.find((set) => set.theme === structure.themes[0] && set.orientation === structure.orientations[0])
    ?? sets[0]
    ?? { theme: structure.themes[0] ?? "light", orientation: structure.orientations[0] ?? "port" }
  // 写回时用的是原始目录形态；想知道有没有主题层，看文件名是不是直接落在方向目录下。
  const themeRoot = [...documents.binaries.keys()].some((path) => /^light\//i.test(path)) ? chosen.theme : ""
  return { archive: SkinArchive.fromSourceFiles(files), ...chosen, themeRoot }
}

export const bdaFormat: SkinFormat<BdaSource> = {
  name: "bda",
  capabilities: capabilities(),
  open(archive, context) {
    return bdaSource(archive, context.base)
  },
  importer(source, options) {
    const hints: BdaReadHints = {
      theme: source.theme,
      orientation: source.orientation,
      themeRoot: source.themeRoot,
      ...(source.base ? { base: accessOf(parseBds(packageOf(source.base, "bds"), identifyBds(packageOf(source.base, "bds")))) } : {}),
    }
    return {
      identify: identifyBda,
      parse: parseBda,
      toModel: (documents) => bdaToModel(documents, hints, options),
    }
  },
  exporter: {
    fromModel: bdaFromModel,
    structure: bdaStructureOf,
    pack: bdaPack,
  },
}
