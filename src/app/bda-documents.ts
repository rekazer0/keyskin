import { theme, orientation, layout } from "./dom"
import { appState } from "./state"
import { syncSegmentedControls } from "./mobile-layout"
import { variantCopyPaths, scaleIniDocument } from "../panel-tools.ts"
import { showError, showStatus } from "./file-operations"
import { renderFiles } from "./file-tree"
import { updateDirty, isEditing, commitBytes, commitBatch } from "./edit-history"
import { type BdaAppearance, bdaAppearancePath, type BdaAppearanceStyleGroup, type BdaAppearancePart, bdaLayoutDocument } from "../bda.ts"
import { decodeBdaAppearance } from "../bda-decode.ts"
import { decodedBdaAppearancePart, decodedBdaEditorSource, decodedBdaSource, applyDecodedBdaAppearancePart, bdaDecodedSourceEditable, applyDecodedBdaSource } from "../bda-source.ts"
import { bdaLayoutNames } from "../bda-resolver.ts"
import { deferNumberInputRefresh } from "../number-input-wheel.ts"
import { layoutSource, setSourceValue } from "./config-context"
import { source } from "./canvas-interaction"
import { refreshPreview } from "./preview-render"
import { populateKeyInspector } from "./key-inspector"
import { IniDocument } from "../ini.ts"
import type { VisualResolver } from "../atlas.ts"
import { ModelResolver } from "../model-render.ts"
import { skinModel } from "./skin-model-state"
import type { Board } from "../skin-model/board.ts"

export function preferredPath(): string {
  return `${theme.value}/skin/${orientation.value}/${layout.value}`
}

export function selectedVariant(): { theme: "light" | "dark"; orientation: "port" | "land" } {
  const match = appState.layoutPath.match(/^(light|dark)\/skin\/(port|land)\//)
  return {
    theme: (match?.[1] as "light" | "dark") ?? theme.value as "light" | "dark",
    orientation: (match?.[2] as "port" | "land") ?? orientation.value,
  }
}

function preferredVariantExists(path: string): boolean {
  return appState.archive?.format === "bda"
    ? bdaAvailableLayoutPaths().includes(path)
    : Boolean(appState.archive?.names().includes(path))
}

export function createMissingVariant(path: string): boolean {
  if (!appState.archive || preferredVariantExists(path)) return true
  const { theme: sourceTheme, orientation: sourceOrientation } = selectedVariant()
  const targetTheme = theme.value as "light" | "dark"
  const targetOrientation = orientation.value
  const label = sourceTheme !== targetTheme
    ? `${targetTheme === "dark" ? "深色" : "浅色"}布局`
    : `${targetOrientation === "land" ? "横屏" : "竖屏"}布局`
  const copies = variantCopyPaths(appState.archive.names(), sourceTheme, sourceOrientation, targetTheme, targetOrientation)
  if (!copies.some(({ target }) => target === path)) {
    theme.value = sourceTheme
    orientation.value = sourceOrientation
    syncSegmentedControls()
    showError(new Error("当前配置没有可复制的对应布局"), `创建${label}`)
    return false
  }
  commitVariantCopies(copies, label)
  renderFiles()
  return true
}

export function createSkinTheme(target: string): boolean {
  const archive = appState.archive
  if (!archive) return false
  const label = `${target === "dark" ? "深色" : "浅色"}目录`
  const copies = variantCopyPaths(archive.names(), theme.value, orientation.value, target, orientation.value)
  if (!copies.length) {
    showError(new Error("当前外观没有可复制的文件"), `创建${label}`)
    return false
  }
  if (copies.some(({ target }) => archive.getSourceBytes(archive.sourcePath(target)))) {
    showError(new Error("目标路径已被其他文件占用"), `创建${label}`)
    return false
  }
  commitVariantCopies(copies, label)
  return true
}

function commitVariantCopies(copies: ReturnType<typeof variantCopyPaths>, label: string): void {
  const archive = appState.archive!
  commitBatch(copies.map(({ source, target }) => ({ kind: "bytes", path: target, before: archive.getBytes(target), after: archive.getBytes(source)!.slice() })))
  updateDirty()
  showStatus(`已创建${label}`)
}

export function bdaBasePath(path = preferredPath()): string {
  return path.replace(/^(?:dark|light)\/skin\//, "light/skin/")
}

export function currentBdaAppearance(): { path: string; bytes: Uint8Array; appearance: BdaAppearance } | undefined {
  if (!appState.archive || appState.archive.format !== "bda") return
  const path = bdaAppearancePath(appState.archive, theme.value, orientation.value)
  const bytes = path && appState.archive.getBytes(path)
  return path && bytes ? { path, bytes, appearance: decodeBdaAppearance(bytes) } : undefined
}

export const bdaAppearanceStyleGroups = [
  ["imageStyles", "图片样式"],
  ["textStyles", "文字样式"],
  ["colorStyles", "颜色样式"],
] as const satisfies ReadonlyArray<readonly [BdaAppearanceStyleGroup, string]>

export function bdaAppearanceStylePath(group: BdaAppearanceStyleGroup): string {
  return `${theme.value}/skin/${orientation.value}/.appearance/${group}.json`
}

export function bdaAppearancePart(path: string): BdaAppearancePart | undefined {
  if (!appState.archive || appState.archive.format !== "bda") return
  const prefix = `${theme.value}/skin/${orientation.value}/`
  if (!path.startsWith(prefix)) return
  const style = path.slice(prefix.length).match(/^\.appearance\/(imageStyles|textStyles|colorStyles)\.json$/)
  if (style) return { kind: "styles", group: style[1] as BdaAppearanceStyleGroup }
  if (path.slice(prefix.length).includes("/")) return
  const panelName = path.slice(prefix.length).replace(/\.ini$/i, "")
  if (!/\.ini$/i.test(path) || !currentBdaAppearance()?.appearance.panels.has(panelName)) return
  return { kind: "panel", name: panelName }
}

export function isBdaAppearancePartPath(path: string): boolean {
  return Boolean(bdaAppearancePart(path))
}

export function refreshSelectedBdaSource(): void {
  if (deferNumberInputRefresh(refreshSelectedBdaSource, refreshSelectedBdaSource)) return
  if (!appState.archive || appState.archive.format !== "bda") return
  const part = bdaAppearancePart(appState.selectedPath)
  if (part) {
    const info = currentBdaAppearance()
    if (info) setSourceValue(part.kind === "styles" ? decodedBdaEditorSource(info.path, info.bytes) : decodedBdaAppearancePart(info.bytes, part))
    return
  }
  if (appState.archive.isBdaConfig(appState.selectedPath)) {
    const bytes = appState.archive.getBytes(appState.selectedPath)
    if (bytes) setSourceValue(decodedBdaEditorSource(appState.selectedPath, bytes))
    return
  }
  if (!isBdaVirtualTextPath(appState.selectedPath)) return
  const info = currentBdaAppearance()
  if (info) setSourceValue(decodedBdaSource(info.path, info.bytes, appState.selectedPath.split("/").pop()))
}

export function commitBdaSourceEdit(): void {
  if (!isEditing() || !appState.archive) return
  const part = bdaAppearancePart(appState.selectedPath)
  if (part) {
    const info = currentBdaAppearance()
    if (!info) return
    try {
      const after = part.kind === "styles"
        ? applyDecodedBdaSource(info.path, info.bytes, source.value)
        : applyDecodedBdaAppearancePart(info.path, info.bytes, source.value, part)
      commitBytes(info.path, info.bytes, after)
      refreshBdaLayout(appState.layoutPath)
      refreshSelectedBdaSource()
      refreshPreview()
      populateKeyInspector()
      updateDirty()
    } catch (error) {
      refreshSelectedBdaSource()
      showError(error, "编辑 appearanceConfig 片段")
    }
    return
  }
  if (!appState.archive.isBdaConfig(appState.selectedPath) || !bdaDecodedSourceEditable(appState.selectedPath)) return
  const before = appState.archive.getBytes(appState.selectedPath)
  if (!before) return
  try {
    const after = applyDecodedBdaSource(appState.selectedPath, before, source.value)
    commitBytes(appState.selectedPath, before, after)
    if (/appearanceConfig$/i.test(appState.selectedPath)) refreshBdaLayout(appState.layoutPath)
    setSourceValue(decodedBdaEditorSource(appState.selectedPath, after))
    refreshPreview()
    populateKeyInspector()
    updateDirty()
  } catch (error) {
    setSourceValue(decodedBdaEditorSource(appState.selectedPath, before))
    showError(error, "编辑 BDA JSON")
  }
}

export function bdaAvailableLayoutPaths(): string[] {
  if (!appState.archive || appState.archive.format !== "bda") return []
  const path = bdaAppearancePath(appState.archive, theme.value, orientation.value)
  const appearanceBytes = path && appState.archive.getBytes(path)
  if (!appearanceBytes) return []
  const prefix = `${theme.value}/skin/${orientation.value}/`
  return bdaLayoutNames(appearanceBytes)
    .map((name) => `${prefix}${name.replace(/\.ini$/i, "")}.ini`)
    .filter((name) => appState.bdaBase?.isText(bdaBasePath(name)))
}

export function isBdaVirtualTextPath(path: string): boolean {
  return Boolean(appState.archive?.format === "bda" && appState.bdaBase?.isText(bdaBasePath(path)))
}

export function isBdaLayoutPath(path: string): boolean {
  return isBdaVirtualTextPath(path) && /\.ini$/i.test(path)
}

export function textDocument(path: string): IniDocument | undefined {
  const source = layoutSource()
  if (source?.isText(path)) return IniDocument.parse(source.getText(path))
  if (isBdaVirtualTextPath(path)) {
    let base = IniDocument.parse(appState.bdaBase!.getText(bdaBasePath(path)))
    const info = currentBdaAppearance()
    const width = Number(base.get("PANEL", "SIZE")?.split(",")[0])
    if (info?.appearance.designWidth && width) {
      base = scaleIniDocument(base, info.appearance.designWidth / width, info.appearance.designWidth / width)
    }
    return info ? bdaLayoutDocument(base, info.appearance, layout.value) : base
  }
}

export function refreshBdaLayout(path = preferredPath()): boolean {
  const info = currentBdaAppearance()
  const basePath = bdaBasePath(path)
  if (!info || !appState.bdaBase?.isText(basePath)) return false
  appState.layoutPath = path
  let base = IniDocument.parse(appState.bdaBase.getText(basePath))
  const width = Number(base.get("PANEL", "SIZE")?.split(",")[0])
  if (info.appearance.designWidth && width) {
    base = scaleIniDocument(base, info.appearance.designWidth / width, info.appearance.designWidth / width)
  }
  appState.layoutDocument = bdaLayoutDocument(
    base,
    info.appearance,
    path.split("/").pop() ?? layout.value,
  )
  return true
}

/** 样式与图片一律从模型取；板只提供工具栏这类板级数据，不碰格式包。 */
export function visualResolver(board?: Board): VisualResolver | undefined {
  const model = skinModel.model
  return model ? new ModelResolver(model, board) : undefined
}
