// 新版百度安卓启用 BDS 前会做完整性检查，加载时也有限制。以下规则都是在 MuMu 上逐项试出来的，
// 对照的是能正常启用的官方皮肤（孤岛记录、简）。
import { IniDocument } from "./ini.ts"
import { SkinArchive } from "./skin.ts"
import { skinStylePaths } from "./font-files.ts"
import { BAKED_IMAGE, packTiles } from "./font-bake.ts"
import { type TileRect } from "./tiles.ts"

/** 百度只加载 css 里先出现的这么多张图片，之后的图片整张不画。 */
export const MAX_IMAGE_FILES = 128
const ATLAS_MAX_HEIGHT = 2048
const ATLAS_NAME = "keyskin_atlas"
/** 每个面板都要有的空段（沿用 gen.ini）；缺 [CAND] 时这个面板不显示候选栏和工具栏。 */
const INHERITED_SECTIONS = ["INPUT", "CAND", "MORE"]

export type AtlasPart = { png: Uint8Array; x: number; y: number }
/** 把若干 PNG 画到一张 width×height 的透明图上；应用里用画布实现，测试里可以替换。 */
export type ComposeAtlas = (width: number, height: number, parts: AtlasPart[]) => Promise<Uint8Array>

const rectOf = (value: string | undefined): TileRect | undefined => {
  const parts = value?.split(",").map((part) => Number(part.trim()))
  return parts?.length === 4 && parts.every(Number.isFinite) ? parts as TileRect : undefined
}

/** 补齐百度安卓要求的 BDS 结构；已经符合时原样返回。 */
export async function completeBdsPackage(bytes: Uint8Array, compose: ComposeAtlas): Promise<Uint8Array> {
  const archive = SkinArchive.open(bytes, "bds")
  let changed = false
  const update = (path: string, text: string) => {
    if (archive.getBytes(path) && text === archive.getText(path)) return
    archive.setText(path, text)
    changed = true
  }
  // Info.txt 换行不是 CRLF 时报错 288（“当前皮肤不完整”）。
  if (archive.getBytes("Info.txt")) update("Info.txt", archive.getText("Info.txt").replace(/\r?\n/g, "\r\n"))
  // default.css 的 [GLOBAL] 不在开头时能启用，但键盘一片空白。
  for (const path of skinStylePaths(archive.names())) update(path, globalFirst(archive.getText(path)))

  for (const theme of ["light", "dark"]) {
    for (const orientation of ["port", "land"]) {
      const dir = `${theme}/skin/${orientation}/`
      const py9 = archive.getBytes(`${dir}py_9.ini`) ? IniDocument.parse(archive.getText(`${dir}py_9.ini`)) : undefined
      // 缺 symbol.ini 时报错 8192。
      if (py9 && !archive.getBytes(`${dir}symbol.ini`)) {
        const symbol = symbolLayoutFrom(py9)
        if (symbol) update(`${dir}symbol.ini`, symbol)
      }
      // 符号面板读 gen.ini 的 [MORE]：没有 SYM_LAYOUT 打不开，没有 FORE_STYLE 打开就崩溃。
      if (py9 && archive.getBytes(`${dir}gen.ini`)) update(`${dir}gen.ini`, withMoreDefaults(archive.getText(`${dir}gen.ini`), py9.get("LIST", "FORE_STYLE")))
      for (const path of archive.names()) {
        if (!path.startsWith(dir) || !/^[^/]+\.ini$/.test(path.slice(dir.length)) || /\/logo\.ini$/.test(path)) continue
        update(path, withInheritedSections(archive.getText(path)))
      }
    }
    if (await packImages(archive, theme, compose)) changed = true
  }
  return changed ? archive.toBytesAsync("bds") : bytes
}

export function globalFirst(css: string): string {
  const global = /^\[GLOBAL\][^\S\r\n]*(?:\r?\n(?!\[)[^\r\n]*)*(?:\r?\n|$)/m.exec(css)
  const body = css.replace(/^﻿/, "")
  if (!global || body.startsWith(global[0])) return css
  const ending = css.includes("\r\n") ? "\r\n" : "\n"
  const block = /\n$/.test(global[0]) ? global[0] : global[0] + ending
  return block + body.replace(global[0], "")
}

export function withInheritedSections(layout: string): string {
  const sections = IniDocument.parse(layout).sections()
  const missing = INHERITED_SECTIONS.filter((section) => !sections.includes(section))
  if (!missing.length) return layout
  const ending = layout.includes("\r\n") ? "\r\n" : "\n"
  return missing.map((section) => `[${section}]${ending}`).join("") + layout
}

export function withMoreDefaults(gen: string, listForeStyle: string | undefined): string {
  const document = IniDocument.parse(gen)
  const defaults = { SYM_LAYOUT: "symbol", GRID: "4,4", ...(listForeStyle ? { FORE_STYLE: listForeStyle } : {}) }
  const missing = Object.entries(defaults).filter(([key]) => document.get("MORE", key) === undefined)
  if (!missing.length) return gen
  if (!document.sections().includes("MORE")) document.appendSection("MORE", [])
  for (const [key, value] of missing) document.set("MORE", key, value)
  return document.toString()
}

/**
 * 用拼音九键的外观拼一个符号面板：左侧列表照搬，底行照搬（符号键改成返回），右侧删除键照搬，
 * 中间留给百度填符号（F55）。
 */
export function symbolLayoutFrom(py9: IniDocument): string | undefined {
  const size = py9.get("PANEL", "SIZE")
  const keys = py9.sections().filter((section) => /^KEY\d+$/.test(section))
    .flatMap((section) => {
      const rect = rectOf(py9.get(section, "VIEW_RECT"))
      return rect ? [{ section, rect, center: py9.get(section, "CENTER")?.trim() ?? "" }] : []
    })
  const width = Number(size?.split(",")[0])
  if (!size || !keys.length || !Number.isFinite(width)) return
  const bottomY = Math.max(...keys.map((key) => key.rect[1]))
  const top = Math.min(...keys.map((key) => key.rect[1]))
  const bottomRow = keys.filter((key) => key.rect[1] === bottomY)
  const backspace = keys.find((key) => key.center === "F36" && key.rect[1] !== bottomY)
  const listPos = rectOf(`${py9.get("LIST", "POS") ?? ""},${py9.get("LIST", "CELL_SIZE") ?? ""}`)
  const gridLeft = listPos ? listPos[0] + listPos[2] : 0
  const gridRight = backspace && backspace.rect[0] > gridLeft ? backspace.rect[0] : width
  const copied = [...bottomRow, ...(backspace ? [backspace] : [])]

  const out = IniDocument.parse("")
  out.appendSection("PANEL", [
    { key: "SIZE", value: size },
    { key: "KEY_NUM", value: String(copied.length + 1) },
    ...entriesOf(py9, "PANEL").filter(({ key }) => key === "BACK_STYLE"),
  ])
  if (listPos) out.appendSection("LIST", entriesOf(py9, "LIST").filter(({ key }) => key !== "NAMES" && key !== "VALUES" && key !== "TYPE"))
  out.appendSection("KEY1", [
    { key: "VIEW_RECT", value: [gridLeft, top, gridRight - gridLeft, bottomY - top].join(",") },
    { key: "CENTER", value: "F55" },
  ])
  copied.forEach((key, index) => out.appendSection(`KEY${index + 2}`, entriesOf(py9, key.section)
    .map(({ key: name, value }) => ({ key: name, value: name === "CENTER" && value.trim() === "F1" ? "F4" : value }))))
  return withInheritedSections(out.toString())
}

const entriesOf = (document: IniDocument, section: string) =>
  document.entries(section).map(({ key, value }) => ({ key, value }))

const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return png.byteLength >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : undefined
}

/** 图片超过 MAX_IMAGE_FILES 张时，把 res 根目录的图片合成几张图集，并改写 til 与样式引用。 */
async function packImages(archive: SkinArchive, theme: string, compose: ComposeAtlas): Promise<boolean> {
  const res = `${theme}/skin/res/`
  const images = archive.names()
    .filter((path) => path.startsWith(res) && /^[^/]+\.png$/i.test(path.slice(res.length)))
    .map((path) => ({ name: path.slice(res.length, -4), png: archive.getBytes(path)!, til: archive.getBytes(path.replace(/\.png$/i, ".til")) }))
    .filter((image) => image.til && !image.name.startsWith(BAKED_IMAGE))
    .flatMap((image) => {
      const size = pngSize(image.png)
      return size ? [{ ...image, ...size, tiles: IniDocument.parse(archive.getText(`${res}${image.name}.til`)) }] : []
    })
  if (images.length <= MAX_IMAGE_FILES) return false

  // 按高度分组，每组排成一张不超过 ATLAS_MAX_HEIGHT 的图。
  const groups: (typeof images)[] = []
  for (const image of images) {
    const group = groups.at(-1)
    if (group && packTiles([...group, image]).height <= ATLAS_MAX_HEIGHT) group.push(image)
    else groups.push([image])
  }
  const renamed = new Map<string, string>()
  for (const [index, group] of groups.entries()) {
    const atlas = `${ATLAS_NAME}${index + 1}`
    const { rects, width, height } = packTiles(group)
    const til = IniDocument.parse("")
    let tile = 0
    group.forEach((image, at) => {
      const [x, y] = rects[at]
      const slices = image.tiles.sections().filter((section) => /^IMG\d+$/.test(section)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
      for (const slice of slices) {
        tile++
        renamed.set(`${image.name},${slice.slice(3)}`, `${atlas},${tile}`)
        til.appendSection(`IMG${tile}`, entriesOf(image.tiles, slice).map(({ key, value }) => {
          // INNER_RECT 和 SOURCE_RECT 一样是整张图里的绝对坐标。
          const source = key === "SOURCE_RECT" || key === "INNER_RECT" ? rectOf(value) : undefined
          return { key, value: source ? [source[0] + x, source[1] + y, source[2], source[3]].join(",") : value }
        }))
      }
      archive.delete(`${res}${image.name}.png`)
      archive.delete(`${res}${image.name}.til`)
    })
    archive.setText(`${res}${atlas}.til`, `[GLOBAL]\r\nTILE_NUM=${tile}\r\n${til.toString().replace(/\r?\n/g, "\r\n")}`)
    archive.setBytes(`${res}${atlas}.png`, await compose(width, height, group.map((image, at) => ({ png: image.png, x: rects[at][0], y: rects[at][1] }))))
  }
  for (const path of archive.names()) {
    if (!path.startsWith(`${theme}/skin/`) || !/\.(?:css|ini|cnd)$/i.test(path)) continue
    const text = archive.getText(path)
    const next = text.replace(/^(\w*IMG\w*\s*=\s*)(.+)$/gm, (_, key: string, value: string) =>
      key + value.replace(/([A-Za-z_][\w.-]*)\s*,\s*(\d+)/g, (token, name: string, slice: string) => renamed.get(`${name},${slice}`) ?? token))
    if (next !== text) archive.setText(path, next)
  }
  return true
}
