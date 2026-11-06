// 字体烘焙：百度安卓（13.3 反编译与真机复现）每次初始化键盘都把画笔字体重置为系统字体或 keymap.ttf，
// [GLOBAL] FONT_PATH 只加载进内存、不作用于按键文字，[STYLE*] FONT_NAME 完全不解析。
// 字重（FONT_WEIGHT）百度格式里没有，同样只能切片。
// 唯一能在真机上显示皮肤字体的办法是把按键上的固定文字（STYLE 的 SHOW）画成图片，样式改用 NM_IMG / HL_IMG。
// 导出 BDI/BDS 时切片（app/font-bake-export.ts）。原来的文字字段改名为 BAKED_* 留在样式里，
// 再次导出时据此重新切片，打开皮肤时可据此还原成文字。
import { IniDocument } from "./ini.ts"
import { type TileRect } from "./tiles.ts"

/** 烘焙图集的资源名：写在 CSS 同目录的 res 里（`<name>.png` + `<name>.til`）。 */
export const BAKED_IMAGE = "keyskin_font"

const TEXT_KEYS = ["SHOW", "FONT_SIZE", "FONT_NAME", "FONT_PATH", "FONT_WEIGHT", "FONT_CLEARTYPE", "NM_COLOR", "HL_COLOR"]
const BAKED_PREFIX = "BAKED_"
const TILE_GAP = 2
const ATLAS_WIDTH = 1024

export type BakeStyle = {
  id: string
  /** 烘焙前的文字字段（SHOW、FONT_SIZE、NM_COLOR……）。 */
  fields: Record<string, string>
  /** 之前导出时切过：不论现在有没有字体都要重切，不然会留下旧字形。 */
  baked?: boolean
}

/** 布局里按键前景（[KEYn] FORE_STYLE，可逗号分隔多层）引用到的样式编号。 */
export function keyForegroundStyleIDs(layouts: readonly string[]): Set<string> {
  const ids = new Set<string>()
  for (const text of layouts) {
    const document = IniDocument.parse(text)
    for (const section of document.sections()) {
      if (!/^KEY\d+$/i.test(section)) continue
      for (const token of document.get(section, "FORE_STYLE")?.split(",") ?? []) {
        if (/^\d+$/.test(token.trim())) ids.add(token.trim())
      }
    }
  }
  return ids
}

function bakedFields(document: IniDocument, section: string): Record<string, string> {
  return Object.fromEntries(document.entries(section).flatMap(({ key, value }) =>
    key.startsWith(BAKED_PREFIX) ? [[key.slice(BAKED_PREFIX.length), value]] : []))
}

/**
 * 需要烘焙的样式：按键前景引用、写了 SHOW、自己没有图片的文字样式；
 * 之前烘焙过的样式（带 BAKED_SHOW）不论是否仍被引用都重新烘焙，换字体后不会留下旧字形。
 */
export function bakeableStyles(css: string, foregroundIDs: ReadonlySet<string>): BakeStyle[] {
  const document = IniDocument.parse(css)
  const styles: BakeStyle[] = []
  for (const section of document.sections()) {
    const id = section.match(/^STYLE(\d+)$/)?.[1]
    if (!id) continue
    const baked = bakedFields(document, section)
    if (baked.SHOW?.trim()) {
      styles.push({ id, fields: baked, baked: true })
      continue
    }
    const show = document.get(section, "SHOW")?.trim()
    if (!show || !foregroundIDs.has(id)) continue
    if (document.get(section, "NM_IMG") !== undefined || document.get(section, "HL_IMG") !== undefined) continue
    styles.push({ id, fields: Object.fromEntries(document.entries(section).flatMap(({ key, value }) =>
      TEXT_KEYS.includes(key) ? [[key, value]] : [])) })
  }
  return styles
}

/** 逐行排列切片（行宽 1024，间隔 2px），返回每块的 SOURCE_RECT 与整张图尺寸。 */
export function packTiles(sizes: ReadonlyArray<{ width: number; height: number }>): { rects: TileRect[]; width: number; height: number } {
  const rects: TileRect[] = []
  let x = 0
  let y = 0
  let rowHeight = 0
  let width = 1
  for (const size of sizes) {
    if (x > 0 && x + size.width > ATLAS_WIDTH) {
      x = 0
      y += rowHeight + TILE_GAP
      rowHeight = 0
    }
    rects.push([x, y, size.width, size.height])
    width = Math.max(width, x + size.width)
    rowHeight = Math.max(rowHeight, size.height)
    x += size.width + TILE_GAP
  }
  return { rects, width, height: Math.max(1, y + rowHeight) }
}

/** 烘焙图集的 .til：IMG 按 rects 顺序从 1 编号。 */
export function bakedTileText(rects: readonly TileRect[]): string {
  const lines = ["[GLOBAL]", "USE_ALPHA=1", `TILE_NUM=${rects.length}`, ""]
  rects.forEach((rect, index) => lines.push(`[IMG${index + 1}]`, `SOURCE_RECT=${rect.join(",")}`, ""))
  return lines.join("\r\n")
}

/** 把样式换成烘焙图片：文字字段改名为 BAKED_*，写入 NM_IMG / HL_IMG（切片编号从 1 起）。 */
export function withBakedStyles(css: string, tiles: ReadonlyArray<{ id: string; normal: number; highlight: number }>): string {
  const document = IniDocument.parse(css)
  for (const { id, normal, highlight } of tiles) {
    const section = `STYLE${id}`
    const fields = { ...bakedFields(document, section) }
    for (const key of TEXT_KEYS) {
      const value = document.get(section, key)
      if (value === undefined) continue
      fields[key] ??= value
      document.remove(section, key)
    }
    for (const [key, value] of Object.entries(fields)) document.set(section, `${BAKED_PREFIX}${key}`, value)
    document.set(section, "NM_IMG", `${BAKED_IMAGE},${normal}`)
    document.set(section, "HL_IMG", `${BAKED_IMAGE},${highlight}`)
  }
  return document.toString()
}

/** 移除烘焙：BAKED_* 改回原字段，去掉指向烘焙图集的 NM_IMG / HL_IMG。没有烘焙过返回 undefined。 */
export function withoutBakedStyles(css: string): string | undefined {
  const document = IniDocument.parse(css)
  let changed = false
  for (const section of document.sections()) {
    const fields = bakedFields(document, section)
    if (!Object.keys(fields).length) continue
    changed = true
    for (const [key, value] of Object.entries(fields)) {
      document.remove(section, `${BAKED_PREFIX}${key}`)
      document.set(section, key, value)
    }
    for (const key of ["NM_IMG", "HL_IMG"]) {
      if (document.get(section, key)?.split(",")[0]?.trim() === BAKED_IMAGE) document.remove(section, key)
    }
  }
  return changed ? document.toString() : undefined
}

/** CSS 所在目录下的烘焙图集路径（不含扩展名）。 */
export function bakedImageBase(stylePath: string): string {
  return `${stylePath.slice(0, stylePath.lastIndexOf("/"))}/${BAKED_IMAGE}`
}

/**
 * 使用这份 CSS 的布局文件：方向目录（port / land）有自己的 res/default.css 时用它，
 * 否则落到主题的 skin/res/default.css。
 */
export function layoutsUsingStyle(names: readonly string[], stylePath: string): string[] {
  const skin = stylePath.match(/^(.*\/skin)\//)?.[1]
  if (!skin) return []
  const available = new Set(names)
  return names.filter((name) => {
    const match = name.match(/^(.*\/skin)\/(?:([^/]+)\/)?[^/]+\.ini$/i)
    if (!match || match[1] !== skin) return false
    const own = match[2] ? `${skin}/${match[2]}/res/default.css` : undefined
    return (own && available.has(own) ? own : `${skin}/res/default.css`) === stylePath
  })
}
