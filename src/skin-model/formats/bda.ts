// 百度输入法皮肤（BDA）转换器：读外观配置，几何来自外部布局骨架。
//
// BDA 包只描述外观：样式表按数字编号索引图片、颜色与文字，形状与位置在布局文件里。
// 因此读取分两步：先从布局骨架拿到板与按键几何，再用外观覆盖样式与图片。
import { bdaAppearancePath, bdaPanelKeyName, bdaStyleRef, type BdaAppearance, type BdaColorStyle, type BdaImageAtom, type BdaImageStyle, type BdaKey, type BdaPanel, type BdaStyleRef, type BdaTextStyle } from "@/bda.ts"
import { decodeBdaAppearance } from "@/bda-decode.ts"
import { colorValue } from "@/bda-encode.ts"
import { decodePng, encodePng } from "@/raster.ts"
import { SkinArchive } from "@/skin.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import { actionValue, layoutBoards } from "@/skin-model/formats/bds.ts"
import { encodeAppearance } from "@/skin-model/formats/bda-appearance.ts"
import type { ImportOptions, SkinFormat } from "@/skin-model/format.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import type { SkinKey } from "@/skin-model/key.ts"
import { emptyModel, type SkinModel } from "@/skin-model/model.ts"
import type { SkinLayer, SkinStyle } from "@/skin-model/style.ts"
import type { SkinBoard } from "@/skin-model/board.ts"
import type { Appearance, Orientation } from "@/skin-model/types.ts"

export type BdaSource = {
  /** BDA 包：外观、动画、音效与图片。 */
  archive: SkinArchive
  /** 布局骨架：提供板与按键几何；BDA 包自己不带。 */
  base?: SkinArchive
  theme: Appearance
  orientation: Orientation
}

/** 样式引用写成 `bda:图片:12` 这种形式，与数字编号一一对应，便于回读。 */
const STYLE_PREFIX = "bda:"

/** 骨架里的样式编号（如 `10012`）换成外观样式名；不是编号就原样返回。 */
function styleNameOf(styleID: string): string | undefined {
  const ref = bdaStyleRef(styleID)
  return ref ? `${STYLE_PREFIX}${ref.type}:${ref.key}` : undefined
}

export function bdaStyleName(ref: BdaStyleRef | undefined): string | undefined {
  return ref ? `${STYLE_PREFIX}${ref.type}:${ref.key}` : undefined
}

/** 图片资源在包里的文件名；资源 ID 不带扩展名。 */
function imagePathOf(archive: SkinArchive, resourceID: string): string | undefined {
  const leaf = resourceID.replace(/\.png$/i, "")
  return archive.names().find((name) => {
    if (!/\.png$/i.test(name)) return
    return (name.split("/").pop() ?? "").replace(/\.png$/i, "") === leaf
  })
}

/** 把一张图片资源读进资源表；同一资源只解码一次。 */
function imageOf(archive: SkinArchive, images: Map<string, SkinImage>, resourceID: string): string | undefined {
  const path = imagePathOf(archive, resourceID)
  if (!path) return
  const id = `bda:${resourceID}`
  if (!images.has(id)) {
    const bytes = archive.getBytes(path)
    if (!bytes) return
    try {
      images.set(id, decodePng(bytes))
    } catch {
      return
    }
  }
  return id
}

/** 外观里的一个样式 → IR 图层；图片与颜色都可能出现。 */
function layersOf(appearance: BdaAppearance, archive: SkinArchive, images: Map<string, SkinImage>, ref: BdaStyleRef): SkinLayer[] {
  if (ref.type === "image") {
    const style = appearance.imageStyles.get(ref.key)
    const normal = style?.normalImage
    const highlighted = style?.highlightImage
    const id = normal?.resource ? imageOf(archive, images, normal.resource.resourceID) : undefined
    const pressed = highlighted?.resource ? imageOf(archive, images, highlighted.resource.resourceID) : undefined
    const inner = normal?.innerRect
    return [
      ...(id
        ? [{
          kind: "image" as const,
          image: id,
          ...(inner ? { fit: "nine-slice" as const, nineSlice: { inner: { left: inner.x, top: inner.y, right: inner.width, bottom: inner.height } } } : {}),
          ...(normal?.alpha !== undefined ? { alpha: normal.alpha } : {}),
        }]
        : []),
      ...(pressed ? [{ kind: "image" as const, image: `bda:${highlighted!.resource!.resourceID}` }] : []),
    ]
  }
  if (ref.type === "color") {
    const style = appearance.colorStyles.get(ref.key)
    return style?.normalColor !== undefined ? [{ kind: "color", value: colorText(style.normalColor) }] : []
  }
  const style = appearance.textStyles.get(ref.key)
  if (!style) return []
  return [{
    kind: "text",
    ...(style.contentText !== undefined ? { text: style.contentText } : {}),
    style: {
      ...(style.normalColor !== undefined ? { color: colorText(style.normalColor) } : {}),
      ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
    },
  }]
}

/** BDA 的颜色是 0xAARRGGBB 的整数。 */
function colorText(value: number): string {
  const hex = (value >>> 0).toString(16).padStart(8, "0")
  return `#${hex.slice(2)}${hex.slice(0, 2)}`
}

/** 样式名反解成外观的编号引用。 */
function refOfStyleName(name: string | undefined): BdaStyleRef | undefined {
  const match = name ? /^bda:(image|color|text):(\d+)$/.exec(name) : null
  if (!match) return
  return { type: match[1] as BdaStyleRef["type"], key: Number(match[2]) }
}

/** IR 按键动作换成 BDA 面板里的按键名，如 `q` → `KEY_Q`。 */
function panelKeyNameOf(key: SkinKey): string | undefined {
  const action = actionValue(key.actions.press)
  return action ? bdaPanelKeyName(action) : undefined
}

/** 板 id 的叶子名就是 BDA 的面板名。 */
function panelNameOf(boardID: string): string {
  return (boardID.split("/").pop() ?? boardID).replace(/\.ini$/i, "")
}

/** IR 图层 → 外观图片原子：图片 id 就是资源名，九宫格内边距落在 innerRect。 */
function imageAtomOf(layer: SkinLayer | undefined): BdaImageAtom | undefined {
  if (!layer || layer.kind !== "image") return
  const resourceID = layer.image.replace(/^bda:/, "")
  const inner = layer.nineSlice?.inner
  return {
    resource: { type: 0, resourceID },
    ...(inner ? { innerRect: { x: inner.left, y: inner.top, width: inner.right, height: inner.bottom } } : {}),
    ...(layer.alpha !== undefined ? { alpha: layer.alpha } : {}),
  }
}

/** IR 样式 → 外观图片样式。 */
function imageStyleOf(style: SkinStyle): BdaImageStyle {
  const normal = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
  const pressed = (style.pressed ?? []).find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
  const text = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "text" }> => layer.kind === "text")
  return {
    ...(normal ? { normalImage: imageAtomOf(normal) } : {}),
    ...(pressed ? { highlightImage: imageAtomOf(pressed) } : {}),
    ...(text
      ? {
        fontInfo: {
          ...(text.style.fontSize !== undefined ? { fontSize: text.style.fontSize } : {}),
          ...(text.text !== undefined ? { contentText: text.text } : {}),
        },
      }
      : {}),
  }
}

function colorStyleOf(style: SkinStyle): BdaColorStyle {
  const color = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
  const pressed = (style.pressed ?? []).find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
  return {
    ...(color ? { normalColor: colorValue(color.value) } : {}),
    ...(pressed ? { highlightColor: colorValue(pressed.value) } : {}),
  }
}

function textStyleOf(style: SkinStyle): BdaTextStyle {
  const text = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "text" }> => layer.kind === "text")
  return {
    ...(text?.text !== undefined ? { contentText: text.text } : {}),
    ...(text?.style.fontSize !== undefined ? { fontSize: text.style.fontSize } : {}),
    ...(text?.style.color ? { normalColor: colorValue(text.style.color) } : {}),
  }
}

function capabilities(): ReadonlyMap<Capability, CapabilityLevel> {
  return new Map<Capability, CapabilityLevel>([
    ["board.geometry", "none"],
    ["board.keys", "none"],
    ["board.add-remove", "partial"],
    ["key.actions", "none"],
    ["key.states", "partial"],
    ["key.touch", "none"],
    ["style.image", "full"],
    ["style.color", "full"],
    ["style.nine-slice", "partial"],
    ["panel.backdrop", "partial"],
    ["panel.candidate", "partial"],
    ["panel.hint", "partial"],
    ["panel.list", "partial"],
    ["panel.toolbar", "partial"],
    ["motion.track", "full"],
    ["motion.binding", "partial"],
    ["sound", "full"],
  ])
}

/** BDA 包的特征是 `appearanceConfig`；没有它就不是 BDA。 */
export function bdaSource(
  archive: SkinArchive,
  base?: SkinArchive,
  theme: Appearance = "light",
  orientation: Orientation = "port",
): BdaSource | undefined {
  const appearance = bdaAppearancePath(archive, theme, orientation)
  if (!appearance) return
  return { archive, ...(base ? { base } : {}), theme, orientation }
}

/** 外观里的样式表整理成 IR 样式，按键只换引用，不动几何。 */
function stylesOf(appearance: BdaAppearance): { styles: Map<string, SkinStyle>; refs: Map<string, BdaStyleRef> } {
  const styles = new Map<string, SkinStyle>()
  const refs = new Map<string, BdaStyleRef>()
  for (const [key, style] of appearance.imageStyles) {
    const name = `${STYLE_PREFIX}image:${key}`
    refs.set(name, { type: "image", key })
    const normal = style.normalImage?.resource?.resourceID
    const pressed = style.highlightImage?.resource?.resourceID
    styles.set(name, {
      normal: [
        ...(normal ? [{ kind: "image" as const, image: `bda:${normal}` }] : []),
        ...(style.fontInfo?.contentText !== undefined
          ? [{ kind: "text" as const, text: style.fontInfo.contentText, style: {
            ...(style.fontInfo.normalColor !== undefined ? { color: colorText(style.fontInfo.normalColor) } : {}),
            ...(style.fontInfo.fontSize !== undefined ? { fontSize: style.fontInfo.fontSize } : {}),
          } }]
          : []),
      ],
      ...(pressed ? { pressed: [{ kind: "image" as const, image: `bda:${pressed}` }] } : {}),
    })
  }
  for (const [key, style] of appearance.colorStyles) {
    const name = `${STYLE_PREFIX}color:${key}`
    refs.set(name, { type: "color", key })
    styles.set(name, { normal: style.normalColor !== undefined ? [{ kind: "color", value: colorText(style.normalColor) }] : [] })
  }
  for (const [key, style] of appearance.textStyles) {
    const name = `${STYLE_PREFIX}text:${key}`
    refs.set(name, { type: "text", key })
    styles.set(name, {
      normal: [{
        kind: "text",
        ...(style.contentText !== undefined ? { text: style.contentText } : {}),
        style: {
          ...(style.normalColor !== undefined ? { color: colorText(style.normalColor) } : {}),
          ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
        },
      }],
    })
  }
  return { styles, refs }
}

/** 骨架里的主板布局：优先 26 键，找不到就取该方向的第一份布局。 */
function layoutOf(base: SkinArchive, theme: Appearance, orientation: Orientation): string | undefined {
  const prefix = `${theme}/skin/${orientation}/`
  const names = base.names().filter((name) => name.startsWith(prefix) && name.endsWith(".ini") && !/gen\.ini$/i.test(name))
  return names.find((name) => /(?:def|py|en)_26\.ini$/i.test(name)) ?? names[0]
}

/** 没有原包时，从模型直接生成面板：每个板一个面板，按键按动作名对齐。 */
function panelsFromModel(model: SkinModel): Map<string, BdaPanel> {
  const panels = new Map<string, BdaPanel>()
  for (const board of model.boards) {
    const keys = new Map<string, BdaKey>()
    for (const key of board.keys) {
      const name = panelKeyNameOf(key)
      if (!name) continue
      const back = refOfStyleName(key.style.back)
      const pressed = refOfStyleName(key.style.pressedBack)
      const foreStyles = key.style.fore.map((item) => refOfStyleName(item)).filter((item): item is BdaStyleRef => Boolean(item))
      keys.set(name, {
        ...(back ? { backStyle: back } : {}),
        foreStyles,
        foreStyleOffsets: [],
        ...(pressed ? { backStyleState: pressed } : {}),
      })
    }
    const backStyle = refOfStyleName(board.backdrop?.style)
    panels.set(panelNameOf(board.id), { hints: new Map(), lists: new Map(), keys, ...(backStyle ? { backStyle } : {}) })
  }
  return panels
}

export const bdaFormat: SkinFormat<BdaSource> = {
  name: "bda",
  capabilities: capabilities(),
  async read(source: BdaSource, options?: ImportOptions): Promise<SkinModel> {
    if (!source.base) throw new Error("读取 BDA 皮肤需要布局骨架")
    const layout = layoutOf(source.base, source.theme, source.orientation)
    if (!layout) throw new Error("布局骨架里没有该主题方向的布局")
    const boards = await layoutBoards(source.base, source.theme, source.orientation, layout, "main", options)
    const model = emptyModel({
      appearance: source.theme,
      orientation: source.orientation,
      resolution: boards.boards[0]?.size ?? { width: 1080, height: 600 },
    }, "bda")
    model.boards.push(...boards.boards)
    const appearancePath = bdaAppearancePath(source.archive, source.theme, source.orientation)
    if (!appearancePath) throw new Error("BDA 包里没有外观配置")
    const bytes = source.archive.getBytes(appearancePath)
    if (!bytes) throw new Error("外观配置读不出来")
    const appearance = decodeBdaAppearance(bytes)
    const parsed = stylesOf(appearance)
    const images = new Map<string, SkinImage>(model.images)
    for (const [name, ref] of parsed.refs) {
      const layers = layersOf(appearance, source.archive, images, ref)
      if (!layers.length) continue
      parsed.styles.set(name, { ...parsed.styles.get(name), normal: layers })
    }
    // 骨架里的按键按样式编号指向外观；IR 里换成外观样式的名字。
    for (const board of model.boards) {
      for (const key of board.keys) {
        const back = key.style.back !== undefined ? styleNameOf(key.style.back) : undefined
        const pressed = key.style.pressedBack !== undefined ? styleNameOf(key.style.pressedBack) : undefined
        key.style = {
          ...(back ? { back } : {}),
          ...(pressed ? { pressedBack: pressed } : {}),
          fore: key.style.fore.map((name: string) => styleNameOf(name) ?? name),
        }
      }
    }
    model.styles = parsed.styles
    model.images = images
    model.provenance = {
      format: "bda",
      nodes: new Map(model.boards.flatMap((board: SkinBoard) => board.keys.map((key: SkinKey) => [key.id, { path: appearancePath }] as const))),
    }
    return model
  },
  write(model: SkinModel, source?: BdaSource): BdaSource {
    const theme: Appearance = source?.theme ?? "light"
    const orientation: Orientation = source?.orientation ?? "port"
    const appearancePath = `${theme}/skin/${orientation}/appearanceConfig`
    const bytes = source?.archive.getBytes(appearancePath)
    const current: BdaAppearance = bytes
      ? decodeBdaAppearance(bytes)
      : { imageStyles: new Map(), textStyles: new Map(), colorStyles: new Map(), panels: new Map() }
    const images = model.images
    // 三类样式表按 IR 里的样式名重建；编号就是外观里的键。
    const imageStyles = new Map<number, BdaImageStyle>()
    const textStyles = new Map<number, BdaTextStyle>()
    const colorStyles = new Map<number, BdaColorStyle>()
    for (const [name, style] of model.styles) {
      const ref = refOfStyleName(name)
      if (!ref) continue
      if (ref.type === "image") imageStyles.set(ref.key, imageStyleOf(style))
      else if (ref.type === "text") textStyles.set(ref.key, textStyleOf(style))
      else colorStyles.set(ref.key, colorStyleOf(style))
    }
    // 有原包时在原面板上换样式引用，没有时从模型生成整套面板。
    const panels = source ? new Map(current.panels) : panelsFromModel(model)
    if (source) {
      for (const board of model.boards) {
        const name = panelNameOf(board.id)
        const panel = panels.get(name)
        if (!panel) continue
        const keys = new Map(panel.keys)
        for (const key of board.keys) {
          const keyName = panelKeyNameOf(key)
          if (!keyName) continue
          const target = keys.get(keyName)
          if (!target) continue
          const back = refOfStyleName(key.style.back)
          const pressed = refOfStyleName(key.style.pressedBack)
          const foreStyles = key.style.fore.map((item) => refOfStyleName(item)).filter((item): item is BdaStyleRef => Boolean(item))
          keys.set(keyName, {
            ...target,
            ...(back ? { backStyle: back } : {}),
            ...(pressed ? { backStyleState: pressed } : {}),
            foreStyles,
          })
        }
        panels.set(name, { ...panel, keys })
      }
    }
    const next: BdaAppearance = { ...current, imageStyles, textStyles, colorStyles, panels }
    const files = source
      ? source.archive.names().flatMap((path) => {
        const data = source.archive.getBytes(path)
        return data ? [{ path, data }] : []
      }).filter((file) => file.path !== appearancePath)
      : []
    files.push({ path: appearancePath, data: encodeAppearance(next) })
    // 图片按资源名写成 PNG，与外观里的 resourceID 对应。
    for (const [id, image] of images) {
      if (!id.startsWith("bda:")) continue
      files.push({ path: `${theme}/skin/res/${id.slice(4)}.png`, data: encodePng(image) })
    }
    return { ...(source ?? {}), archive: SkinArchive.fromSourceFiles(files), theme, orientation }
  },
}
