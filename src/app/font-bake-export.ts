// 导出 BDS 时把按键文字切成字体图片（规则见 font-bake.ts）。编辑器里的皮肤始终保持文字，
// 只有写出去的皮肤包被改写；打开带切片的皮肤时询问是否还原成文字。
import { IniDocument } from "../ini.ts"
import { SkinArchive } from "../skin.ts"
import { loadEmbeddedFont, parseColor } from "../atlas.ts"
import { fontSearchDirectories, resolveFontReference, skinStylePaths, themeOfPath } from "../font-files.ts"
import {
  bakeableStyles,
  bakedImageBase,
  bakedTileText,
  keyForegroundStyleIDs,
  layoutsUsingStyle,
  packTiles,
  withBakedStyles,
  withoutBakedStyles,
} from "../font-bake.ts"
import { composePng } from "./file-operations"
import { ask } from "./ask"

/** 一段按键文字：按 FONT_SIZE 画在透明底上，以文字中线居中，与真机前景图的居中方式一致。 */
function renderLabel(text: string, fontSize: number, family: string, color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) throw new Error("无法创建文字画布")
  const font = `${fontSize}px "${family}"`
  context.font = font
  canvas.width = Math.max(1, Math.ceil(context.measureText(text).width) + 4)
  canvas.height = Math.max(1, Math.ceil(fontSize * 1.5))
  // 改尺寸会重置画布状态，字体与对齐要在之后设置。
  context.font = font
  context.fillStyle = color
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(text, canvas.width / 2, canvas.height / 2)
  return canvas
}

/** 把一份 CSS 的按键文字用它的 GLOBAL 字体切成图片，直接改写 archive；返回切出的文字数。 */
async function bakeStyle(archive: SkinArchive, path: string): Promise<number> {
  const css = archive.getText(path)
  const reference = IniDocument.parse(css).get("GLOBAL", "FONT_PATH")?.trim()
  const fontPath = reference && resolveFontReference(archive.names(), reference, fontSearchDirectories(path))
  const font = fontPath ? loadEmbeddedFont(archive, fontPath) : undefined
  if (!font) return 0
  const layouts = layoutsUsingStyle(archive.names(), path).map((layout) => archive.getText(layout))
  const styles = bakeableStyles(css, keyForegroundStyleIDs(layouts))
  if (!styles.length) return 0
  await font.ready
  const fallbackColor = themeOfPath(path) === "dark" ? "#f5f5f7" : "#17191c"
  const labels: HTMLCanvasElement[] = []
  const tiles = styles.map(({ id, fields }) => {
    const fontSize = Number(fields.FONT_SIZE) > 0 ? Number(fields.FONT_SIZE) : 24
    const normalColor = parseColor(fields.NM_COLOR) ?? fallbackColor
    const highlightColor = parseColor(fields.HL_COLOR) ?? normalColor
    labels.push(renderLabel(fields.SHOW.trim(), fontSize, font.family, normalColor))
    const normal = labels.length
    if (highlightColor !== normalColor) labels.push(renderLabel(fields.SHOW.trim(), fontSize, font.family, highlightColor))
    return { id, normal, highlight: labels.length }
  })
  const atlas = packTiles(labels)
  const base = bakedImageBase(path)
  archive.setBytes(`${base}.png`, await composePng(atlas.width, atlas.height, labels.map((image, index) => ({ image, rect: atlas.rects[index] }))))
  archive.setBytes(`${base}.til`, new TextEncoder().encode(bakedTileText(atlas.rects)))
  archive.setText(path, withBakedStyles(css, tiles))
  return styles.length
}

/**
 * 百度安卓不会用皮肤字体画按键文字，导出的 BDS 把按键文字切成字体图片。
 * 没有可用的 GLOBAL 字体或没有可切的文字时原样返回，不重新打包。
 */
export async function bakeExportedBds(bytes: Uint8Array): Promise<Uint8Array> {
  const archive = SkinArchive.open(bytes, "bds")
  let baked = 0
  for (const path of skinStylePaths(archive.names())) baked += await bakeStyle(archive, path)
  return baked ? archive.toBytesAsync("bds") : bytes
}

/** 皮肤里是否有导出时切过的字体图片。 */
export function hasBakedFonts(archive: SkinArchive): boolean {
  return skinStylePaths(archive.names()).some((path) => /^BAKED_SHOW\s*=/m.test(archive.getText(path)))
}

/** 打开带字体切片的皮肤时询问是否还原成可编辑的文字；还原记为未保存的修改，保存时按当时的字体重新切片。 */
export async function offerBakedFontRestore(archive: SkinArchive): Promise<void> {
  if (archive.format !== "bds" && archive.format !== "bdi" || !hasBakedFonts(archive)) return
  const choice = await ask({
    title: "还原按键文字？",
    detail: "这个皮肤的按键文字是导出时用皮肤字体切成的图片。还原后可以直接修改文字、字号和颜色，导出 BDS 时会重新切片。",
    actions: [
      { value: "cancel", label: "保留图片" },
      { value: "restore", label: "还原文字", variant: "primary" },
    ],
  })
  if (choice !== "restore") return
  for (const path of skinStylePaths(archive.names())) {
    const restored = withoutBakedStyles(archive.getText(path))
    if (restored === undefined) continue
    archive.setText(path, restored)
    archive.delete(`${bakedImageBase(path)}.png`)
    archive.delete(`${bakedImageBase(path)}.til`)
  }
}
