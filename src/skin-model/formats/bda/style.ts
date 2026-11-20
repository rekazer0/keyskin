// BDA 的三张样式表 ↔ IR 图层。
//
// 样式引用保留外观里的原始编号（`bda:图片:12`），写回时按区间还原类型，不靠顺序编号。
// IR 表达不了的字段（内容内缩、高亮文字色、绘制类型）随原始条目带走，写回时作底。
import { type BdaAppearance, type BdaColorStyle, type BdaImageAtom, type BdaImageStyle, type BdaStyleRef, type BdaTextStyle, type BdaRect } from "@/bda.ts"
import { colorValue } from "@/bda-encode.ts"
import type { SkinLayer, SkinStyle } from "@/skin-model/style.ts"

/** 样式引用写成 `bda:图片:12`：原始类型与编号都留着，换顺序写回也还原得出类型。 */
const STYLE_PREFIX = "bda:"

/** BdaStyleRef → IR 的 StyleRef。 */
export function bdaStyleName(ref: BdaStyleRef | undefined): string | undefined {
  return ref ? `${STYLE_PREFIX}${ref.type}:${ref.key}` : undefined
}

/** IR 的 StyleRef → BdaStyleRef；不是 BDA 的样式名返回 undefined。 */
export function styleRefOf(name: string | undefined): BdaStyleRef | undefined {
  const match = name ? /^bda:(image|color|text):(\d+)$/.exec(name) : null
  return match ? { type: match[1] as BdaStyleRef["type"], key: Number(match[2]) } : undefined
}

/** 资源名 → IR 图片 id；资源名去扩展名，与包里的图片文件按名字对齐。 */
export function imageIDOf(resourceID: string): string {
  return `bda:${resourceID}`
}

/** BDA 的颜色是 0xAARRGGBB 的整数，IR 统一成 8 位十六进制。 */
function colorText(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0").toUpperCase()
}

/** 原始样式表条目：IR 表达不了的字段留在这里。 */
export type BdaStyleParts = {
  image?: BdaImageStyle
  text?: BdaTextStyle
  color?: BdaColorStyle
}

/** 图片原子 → IR 图片图层；内矩形是「可拉伸区」，归一到 `region`。 */
function imageLayerOf(atom: BdaImageAtom | undefined, image: (resourceID: string) => string | undefined): SkinLayer[] {
  if (!atom?.resource?.resourceID) return []
  const id = image(atom.resource.resourceID)
  if (!id) return []
  const inner = atom.innerRect
  return [{
    kind: "image",
    image: id,
    ...(inner ? { stretch: { kind: "region", inner: { x: inner.x, y: inner.y, width: inner.width, height: inner.height } } } : {}),
    ...(atom.alpha !== undefined ? { alpha: atom.alpha } : {}),
    ...(atom.filterColor !== undefined ? { tint: colorText(atom.filterColor) } : {}),
  }]
}

/** 图片样式的字体信息 → 文字图层；有字号、颜色或文字才建层。 */
function fontLayerOf(style: BdaImageStyle): SkinLayer[] {
  const font = style.fontInfo
  if (!font || (font.contentText === undefined && font.fontSize === undefined && font.normalColor === undefined)) return []
  return [{
    kind: "text",
    ...(font.contentText !== undefined ? { text: font.contentText } : {}),
    style: {
      ...(font.fontSize !== undefined ? { fontSize: font.fontSize } : {}),
      ...(font.normalColor !== undefined ? { color: colorText(font.normalColor) } : {}),
    },
  }]
}

/** 外观的三张样式表 → IR 样式表。 */
export function stylesOf(
  appearance: BdaAppearance,
  image: (resourceID: string) => string | undefined,
): { styles: Map<string, SkinStyle>; parts: Map<string, BdaStyleParts> } {
  const styles = new Map<string, SkinStyle>()
  const parts = new Map<string, BdaStyleParts>()
  for (const [key, style] of appearance.imageStyles) {
    const name = `${STYLE_PREFIX}image:${key}`
    styles.set(name, {
      normal: [...imageLayerOf(style.normalImage, image), ...fontLayerOf(style)],
      ...(style.highlightImage ? { pressed: imageLayerOf(style.highlightImage, image) } : {}),
    })
    parts.set(name, { image: style })
  }
  for (const [key, style] of appearance.textStyles) {
    const name = `${STYLE_PREFIX}text:${key}`
    styles.set(name, {
      normal: [{
        kind: "text",
        ...(style.contentText !== undefined ? { text: style.contentText } : {}),
        style: {
          ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
          ...(style.normalColor !== undefined ? { color: colorText(style.normalColor) } : {}),
        },
      }],
    })
    parts.set(name, { text: style })
  }
  for (const [key, style] of appearance.colorStyles) {
    const name = `${STYLE_PREFIX}color:${key}`
    const normal = style.normalColor !== undefined ? [{ kind: "color" as const, value: colorText(style.normalColor) }] : []
    styles.set(name, {
      normal,
      // 高亮色是常态色的按下态；没有常态色的条目只会被按键的高亮槽引用，原值随 `parts` 写回。
      ...(normal.length && style.highlightColor !== undefined
        ? { pressed: [{ kind: "color" as const, value: colorText(style.highlightColor) }] }
        : {}),
    })
    parts.set(name, { color: style })
  }
  return { styles, parts }
}

/** 图层里的第一层指定种类。 */
function firstLayer<T extends SkinLayer["kind"]>(layers: readonly SkinLayer[] | undefined, kind: T): Extract<SkinLayer, { kind: T }> | undefined {
  return layers?.find((layer): layer is Extract<SkinLayer, { kind: T }> => layer.kind === kind)
}

/** IR 图片图层 → 图片原子；资源名就是图片 id 去掉前缀。 */
function atomOf(layer: SkinLayer | undefined, source: BdaImageAtom | undefined): BdaImageAtom | undefined {
  if (!layer || layer.kind !== "image") return source
  const resourceID = layer.image.replace(/^bda:/, "").split("/").pop()!.replace(/\.[^.]+$/, "")
  const inner = layer.stretch?.kind === "region" ? layer.stretch.inner : undefined
  return {
    ...source,
    resource: { type: source?.resource?.type ?? 0, resourceID },
    ...(inner ? { innerRect: inner satisfies BdaRect } : {}),
    ...(layer.alpha !== undefined ? { alpha: layer.alpha } : {}),
    ...(layer.tint ? { filterColor: colorValue(layer.tint) } : {}),
  }
}

/** IR 样式 → 图片样式；原始条目作底，只覆盖 IR 能表达的部分。 */
export function imageStyleOf(style: SkinStyle, source: BdaImageStyle | undefined): BdaImageStyle {
  const text = firstLayer(style.normal, "text")
  return {
    ...source,
    normalImage: atomOf(firstLayer(style.normal, "image"), source?.normalImage),
    ...(style.pressed?.length ? { highlightImage: atomOf(firstLayer(style.pressed, "image"), source?.highlightImage) } : {}),
    ...(text
      ? {
        fontInfo: {
          ...source?.fontInfo,
          ...(text.style.fontSize !== undefined ? { fontSize: text.style.fontSize } : {}),
          ...(text.style.color ? { normalColor: colorValue(text.style.color) } : {}),
          ...(text.text !== undefined ? { contentText: text.text } : {}),
        },
      }
      : {}),
  }
}

/** IR 样式 → 文字样式。 */
export function textStyleOf(style: SkinStyle, source: BdaTextStyle | undefined): BdaTextStyle {
  const text = firstLayer(style.normal, "text")
  return {
    ...source,
    ...(text?.text !== undefined ? { contentText: text.text } : {}),
    ...(text?.style.fontSize !== undefined ? { fontSize: text.style.fontSize } : {}),
    ...(text?.style.color ? { normalColor: colorValue(text.style.color) } : {}),
  }
}

/** IR 样式 → 颜色样式。 */
export function colorStyleOf(style: SkinStyle, source: BdaColorStyle | undefined): BdaColorStyle {
  const normal = firstLayer(style.normal, "color")
  const pressed = firstLayer(style.pressed, "color")
  return {
    ...source,
    ...(normal ? { normalColor: colorValue(normal.value) } : {}),
    ...(pressed ? { highlightColor: colorValue(pressed.value) } : {}),
  }
}
