// 替换键盘样式 for Palm and Sogou skins: the picture is sliced the way Baidu skins slice it
// (layout-image-replace.ts), then written in each format's own terms: skin.json tiles and styles for
// Palm, PNG files and phoneSkin.ini / keys.ini sections in every resolution folder for Sogou.

import { IniDocument } from "../ini.ts"
import { layoutKeyRects, planLayoutImage, type LayoutImagePlan } from "../layout-image.ts"
import { type TileRect } from "../tiles.ts"
import { type Change } from "../history.ts"
import { resolveCandidateRect } from "../candidate-style.ts"
import { PalmBoard, THEME_DIRECTORY, type PalmOrientation, type PalmTheme } from "../palm/palm-board.ts"
import { applySxiLayoutImage } from "../palm/sxi-layout-image.ts"
import { SXI_SKIN_PATH } from "../palm/sxi-json.ts"
import { asObject } from "../palm/sxi-ini.ts"
import { applySsfBackgroundImage, applySsfKeyImage } from "../ssf/ssf-layout-image.ts"
import { ssfKeyBinding, type SsfKeyBinding } from "../ssf/ssf-keymap.ts"
import { firstValue } from "../ssf/ssf-parts.ts"
import { ssfResolutionOf, ssfResolutionTwins } from "../ssf/ssf-resolutions.ts"
import { appState } from "./state"
import { layoutImageDialog, orientation } from "./dom"
import { setSourceValue, toolbarConfigPath } from "./config-context"
import { commitBatch, updateDirty } from "./edit-history"
import { composePng, pngImage, showStatus } from "./file-operations"
import { renderFiles } from "./file-tree"
import { populateKeyInspector } from "./key-inspector"
import { currentGenDocument, layoutImageTargetLabel, nextResourceBase, showLayoutImageError, sliceLayoutImage } from "./layout-image-replace"
import { panelSizeFrom } from "./panel-copy"
import { refreshPreview } from "./preview-render"
import { isSsfBoardPath, sourceEditPath, ssfPackage, ssfSkeleton, ssfTheme, ssfThemeFolder } from "./ssf-documents"
import { isSxiBoardAddress, palmSkin, refreshSxiDocument, sxiPointer } from "./sxi-documents"

/** Key rects of the open board in whole pixels: slices are cut on the pixel grid. */
function keyRects(layout: IniDocument, size: [number, number]) {
  return layoutKeyRects(layout, appState.selectedKeySections, size)
    .map(({ section, rect }) => ({ section, rect: rect.map(Math.round) as TileRect }))
}

/** The selected keys of a Palm board (else all of them), as skin.json places them; a backdrop key covering the panel is not one. */
function palmKeyRects(board: PalmBoard): Array<{ section: string; rect: TileRect }> {
  const selected = new Set(appState.selectedKeySections)
  return board.keys(undefined).flatMap(({ section, rect }) => {
    if (selected.size && !selected.has(section)) return []
    if (rect.x <= 0 && rect.y <= 0 && rect.width >= board.width * 0.9 && rect.height >= board.height * 0.9) return []
    return [{ section, rect: [rect.x, rect.y, rect.width, rect.height].map(Math.round) as TileRect }]
  })
}

function finish(): void {
  layoutImageDialog.close()
  renderFiles()
  refreshPreview()
  populateKeyInspector()
  updateDirty()
  showStatus(`已应用「${layoutImageTargetLabel(appState.layoutImageTarget!)}」替换`)
}

export async function replaceSxiLayoutImage(): Promise<void> {
  const archive = appState.archive!
  const target = appState.layoutImageTarget!
  const pointer = sxiPointer(appState.layoutPath)
  if (!pointer || !isSxiBoardAddress(appState.layoutPath)) return showLayoutImageError("请先在画布上打开一个手心键盘布局。")
  const skin = palmSkin(archive)
  const themeKey = pointer[0] as PalmTheme
  const board = new PalmBoard(skin, themeKey, pointer[1].replace(/_layout$/, "") as PalmOrientation, pointer[3])
  if (!(board.width > 0 && board.height > 0)) return showLayoutImageError("这个手心键盘布局没有面板尺寸。")
  let follow: { rects: Map<string, TileRect>; size: [number, number] } | undefined
  let plan: LayoutImagePlan
  let source: Uint8Array
  if (target === "candidate") {
    const size = board.candidateSize
    if (!size) return showLayoutImageError("这个手心键盘布局没有候选栏。")
    const [width, height] = [Math.round(size.width), Math.round(size.height)]
    const image = await pngImage(appState.layoutImageBytes!)
    source = await composePng(width, height, [{ image, rect: [0, 0, width, height] }])
    image.close()
    plan = planLayoutImage(target, [], IniDocument.parse(""), width, height)
  } else {
    const sliced = await sliceLayoutImage(palmKeyRects(board), board.width, board.height, (keys, cells) => {
      if (cells.length === keys.length) return keys
      showLayoutImageError(`手心皮肤不能增删按键：图片里识别出 ${cells.length} 个按键区域，当前布局有 ${keys.length} 个按键。`)
    })
    if (!sliced) return
    ;({ plan, source } = sliced)
    if (appState.layoutImageConfig === "layout-follows-image" && target !== "panel") {
      follow = { rects: new Map(plan.keys.map(({ section }, index) => [section, plan.slices[index].source])), size: [sliced.width, sliced.height] }
    }
  }
  const directory = THEME_DIRECTORY[themeKey]
  const base = nextResourceBase(`${directory}/skin/res`)
  const name = base.split("/").pop()!
  const resources = asObject(skin[themeKey] ?? null)?.r_info
  const nested = Array.isArray(resources) && resources.some((path) => typeof path === "string" && path.startsWith(`${directory}/skin/`))
  const before = archive.getText(SXI_SKIN_PATH)
  const after = applySxiLayoutImage(before, pointer, plan, { name, resource: `${directory}/${nested ? "skin/" : ""}res/${name}.png`, follow })
  commitBatch([
    { kind: "bytes", path: `${base}.png`, before: archive.getBytes(`${base}.png`), after: source },
    { kind: "text", path: SXI_SKIN_PATH, before, after },
  ])
  refreshSxiDocument()
  finish()
}

/** One PNG the picture becomes, drawn for a look folder `scale` times as wide as the open one. */
type SsfSlice = { file: string; draw: (scale: number, look: string) => Promise<Uint8Array> }

export async function replaceSsfLayoutImage(): Promise<void> {
  const archive = appState.archive!
  const target = appState.layoutImageTarget!
  const pkg = ssfPackage()
  const folder = ssfThemeFolder()
  const layout = appState.layoutDocument
  if (!pkg || !folder || !layout || !isSsfBoardPath(appState.layoutPath)) return showLayoutImageError("请先在画布上打开一个搜狗键盘。")
  if (appState.layoutImageConfig === "layout-follows-image" && target !== "panel" && target !== "candidate") {
    return showLayoutImageError("搜狗皮肤的按键位置由输入法决定，不能让布局跟随图片。")
  }
  const gen = currentGenDocument()
  const panel = panelSizeFrom(layout) ?? panelSizeFrom(gen)
  const candPath = toolbarConfigPath()
  const boards = ssfSkeleton()
  const bar = gen && candPath && boards?.isText(candPath) ? resolveCandidateRect(IniDocument.parse(boards.getText(candPath)), gen) : undefined
  if (!panel || !bar) return showLayoutImageError("无法读取这个搜狗键盘的尺寸。")
  const landscape = orientation.value === "land"
  const layoutName = appState.layoutPath.split("/").pop()!
  const names = archive.names()
  const folders = [folder, ...ssfResolutionTwins(names, `${folder}phoneSkin.ini`, pkg.folder("light").split("/")[1] || undefined).map((path) => path.slice(0, path.lastIndexOf("/") + 1))]
  const baseName = (() => {
    for (let index = 1; ; index += 1) {
      const name = index === 1 ? "replace_image" : `replace_image${index}`
      if (!names.some((path) => folders.some((look) => path.startsWith(`${look}${name}`)))) return name
    }
  })()
  // Decoded pictures stay open while every resolution folder's slices are drawn.
  const bitmaps: ImageBitmap[] = []
  const decode = async (bytes: Uint8Array) => {
    const bitmap = await pngImage(bytes)
    bitmaps.push(bitmap)
    return bitmap
  }
  try {
    await writeSsfLayoutImage(target, layout, layoutName, landscape, panel, bar.height, folders, baseName, decode)
  } finally {
    for (const bitmap of bitmaps) bitmap.close()
  }
}

async function writeSsfLayoutImage(
  target: NonNullable<typeof appState.layoutImageTarget>,
  layout: IniDocument,
  layoutName: string,
  landscape: boolean,
  panel: [number, number],
  barHeight: number,
  folders: string[],
  baseName: string,
  decode: (bytes: Uint8Array) => Promise<ImageBitmap>,
): Promise<void> {
  const archive = appState.archive!
  const pkg = ssfPackage()!
  const slices: SsfSlice[] = []
  const bindings: Array<{ binding: SsfKeyBinding; file: string }> = []
  let skipped = 0
  if (target === "panel" || target === "candidate") {
    const picture = await decode(appState.layoutImageBytes!)
    const height = target === "panel" ? barHeight + panel[1] : barHeight
    slices.push({ file: `${baseName}.png`, draw: async (scale, look) => {
      // RootView is drawn behind the bar and the keys: the old background keeps the bar's strip.
      const old = target === "panel" ? firstValue(IniDocument.parse(archive.isText(`${look}phoneSkin.ini`) ? archive.getText(`${look}phoneSkin.ini`) : "").get("RootView", "BG_IMAGE")) : undefined
      const oldBytes = old && /\.png$/i.test(old) ? archive.getBytes(`${look}${old}`) ?? pkg.file(ssfTheme(), old) : undefined
      const backdrop = oldBytes ? await decode(oldBytes) : undefined
      const [width, rows] = [panel[0] * scale, height * scale]
      const top = target === "panel" ? barHeight * scale : 0
      return composePng(width, rows, [...backdrop ? [{ image: backdrop, rect: [0, 0, width, rows] as TileRect }] : [], { image: picture, rect: [0, top, width, rows - top] }])
    } })
  } else {
    const sliced = await sliceLayoutImage(keyRects(layout, panel), panel[0], panel[1], (keys) => keys)
    if (!sliced) return
    const image = await decode(sliced.source)
    for (const { section, rect } of sliced.plan.keys) {
      const index = sliced.plan.indices.get(section)
      const slice = sliced.plan.slices.find((item) => item.index === index)
      const action = layout.get(section, "CENTER")?.trim()
      const binding = action ? ssfKeyBinding(layoutName, action, landscape, layout.get(section, "SSF_SECTION"), layout.get(section, "SSF_BG")) : undefined
      // Keys Sogou draws from its own artwork (digits on the letter board…) have no class to restyle.
      if (!slice || !binding?.sections.length) {
        skipped += 1
        continue
      }
      const file = `${baseName}_${index}.png`
      bindings.push({ binding, file })
      slices.push({ file, draw: (scale) => composePng(rect[2] * scale, rect[3] * scale, [{ image, source: slice.source, rect: [0, 0, rect[2] * scale, rect[3] * scale] }]) })
    }
    if (!bindings.length) return showLayoutImageError("选中的按键在搜狗皮肤里没有自己的样式类，无法单独替换。")
  }
  const changes: Change[] = []
  const resolution = ssfResolutionOf(`${folders[0]}phoneSkin.ini`)!
  for (const look of folders) {
    const scale = ssfResolutionOf(`${look}phoneSkin.ini`)! / resolution
    for (const slice of slices) changes.push({ kind: "bytes", path: `${look}${slice.file}`, before: archive.getBytes(`${look}${slice.file}`), after: await slice.draw(scale, look) })
    const text = (path: string) => archive.isText(path) ? archive.getText(path) : ""
    const skin = IniDocument.parse(text(`${look}phoneSkin.ini`))
    const keys = IniDocument.parse(text(`${look}keys.ini`))
    if (target === "panel" || target === "candidate") applySsfBackgroundImage(skin, target, slices[0].file, landscape)
    else for (const { binding, file } of bindings) applySsfKeyImage(skin, keys, binding, target, file)
    for (const [path, document] of [[`${look}phoneSkin.ini`, skin], [`${look}keys.ini`, keys]] as const) {
      if (document.toString() !== text(path)) changes.push({ kind: "text", path, before: text(path), after: document.toString() })
    }
  }
  commitBatch(changes)
  const shown = changes.find((change) => change.kind === "text" && change.path === sourceEditPath())
  if (shown?.kind === "text") setSourceValue(shown.after)
  finish()
  if (skipped) showStatus(`已应用「${layoutImageTargetLabel(target)}」替换，${skipped} 个按键在搜狗皮肤里没有自己的样式类，未替换`)
}
