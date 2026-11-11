import { IniDocument } from "../ini.ts"
import { bdaPanelKeyName } from "../bda.ts"
import { applyBdaLayoutImage } from "../bda-layout-image.ts"
import { layoutKeyRects, planLayoutImage } from "../layout-image.ts"
import { resolveCandidateRect } from "../candidate-style.ts"
import { type TileRect } from "../tiles.ts"
import { type Change } from "../history.ts"
import { closeDialog } from "../motion.ts"
import { preview } from "./canvas-interaction"
import { appState } from "./state"
import { layoutImageDialog, orientation, theme } from "./dom"
import { currentBdaAppearance, refreshBdaLayout, refreshSelectedBdaSource, textDocument } from "./bda-documents"
import { effectiveKeySection, currentSkinState, genConfigPath, toolbarConfigPath } from "./config-context"
import { commitBatch, updateDirty } from "./edit-history"
import { composePng, fitPngTo, pngImage, showStatus } from "./file-operations"
import { renderFiles } from "./file-tree"
import { populateKeyInspector } from "./key-inspector"
import { layoutImageTargetLabel, nextResourceBase, showLayoutImageError, sliceLayoutImage } from "./layout-image-replace"
import { panelSizeFrom } from "./panel-copy"
import { refreshPreview } from "./preview-render"

export async function replaceBdaLayoutImage(): Promise<void> {
  const info = currentBdaAppearance()
  const layout = appState.layoutDocument
  const archive = appState.archive
  const name = appState.layoutPath.split("/").pop()?.replace(/\.ini$/i, "") ?? ""
  const panel = info?.appearance.panels.get(name)
  if (!info || !layout || !panel || !archive) return showLayoutImageError("请先在画布上打开一个 BDA 键盘布局。")
  const target = appState.layoutImageTarget!
  let source = appState.layoutImageBytes!
  let plan
  if (target === "candidate") {
    const path = toolbarConfigPath()
    const cand = path && textDocument(path)
    if (!cand) return showLayoutImageError("当前布局未找到候选栏配置。")
    const rect = resolveCandidateRect(cand, textDocument(genConfigPath()))
    const width = Math.round(rect.width), height = Math.round(rect.height)
    source = await fitPngTo(source, width, height)
    plan = planLayoutImage(target, [], IniDocument.parse(""), width, height)
  } else {
    // Native BDA layouts often inherit SIZE from gen.ini; use the same resolved size as the canvas.
    const size = panelSizeFrom(layout) ?? [preview.panelWidth, preview.panelHeight]
    const keys = layoutKeyRects(layout, appState.selectedKeySections, [size[0], size[1]])
      .map(({ section, rect }) => ({ section, rect: rect.map(Math.round) as TileRect }))
    if (target !== "panel" && !keys.length) return showLayoutImageError("当前布局没有可替换的按键。")
    const sliced = await sliceLayoutImage(keys, Math.round(size[0]), Math.round(size[1]), () => undefined)
    if (!sliced) return
    ;({ source, plan } = sliced)
  }
  const state = currentSkinState()
  const keyNames = new Map(plan.keys.map(({ section }) => {
    const names = [layout.get(section, "CENTER"), layout.get(section, "DOWN")]
      .filter((value): value is string => Boolean(value)).map(bdaPanelKeyName)
    const stateName = state !== undefined && effectiveKeySection(section) !== section
      ? names.map((key) => `${key}_S${state}`).find((key) => panel.keys.has(key)) : undefined
    return [section, stateName ?? names.find((key) => panel.keys.has(key)) ?? names[0]]
  }))
  const root = `${theme.value}/skin/${orientation.value}/res`
  const base = nextResourceBase(root).split("/").pop()!
  const result = applyBdaLayoutImage(info.path, info.bytes, name, plan, keyNames, base)
  const changes: Change[] = []
  const image = await pngImage(source)
  try {
    for (const slice of plan.slices) {
      const path = `${root}/${base}_${slice.index}.png`
      const [, , width, height] = slice.source
      const after = await composePng(width, height, [{ image, source: slice.source, rect: [0, 0, width, height] }])
      changes.push({ kind: "bytes", path, before: archive.getBytes(path), after })
    }
  } finally {
    image.close()
  }
  for (const [id, after] of result.resources) {
    const path = `${root}/${id}.png`
    changes.push({ kind: "bytes", path, before: archive.getBytes(path), after })
  }
  changes.push({ kind: "bytes", path: info.path, before: info.bytes, after: result.bytes })
  commitBatch(changes)
  refreshBdaLayout(appState.layoutPath)
  refreshSelectedBdaSource()
  closeDialog(layoutImageDialog)
  renderFiles()
  refreshPreview()
  populateKeyInspector()
  updateDirty()
  showStatus(`已应用「${layoutImageTargetLabel(target)}」替换`)
}
