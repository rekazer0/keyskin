// 百度输入法皮肤（BDA）转换器：读外观配置，几何来自外部布局骨架。
//
// BDA 包只描述外观：样式表按数字编号索引图片、颜色与文字，形状与位置在布局文件里。
// 因此读取分两步：先从布局骨架拿到板与按键几何，再用外观覆盖样式与图片。
import { bdaAppearancePath, bdaStyleRef, type BdaAppearance, type BdaStyleRef } from "@/bda.ts"
import { decodeBdaAppearance } from "@/bda-decode.ts"
import { decodePng } from "@/raster.ts"
import type { SkinArchive } from "@/skin.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import { layoutBoards } from "@/skin-model/formats/bds.ts"
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
  write(): never {
    throw new Error("BDA 写回尚未实现")
  },
}
