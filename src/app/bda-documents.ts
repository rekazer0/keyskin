import { theme, orientation, layout } from "./dom"
import { appState } from "./state"
import { syncSegmentedControls } from "./mobile-layout"
import { variantCopyPaths, scaleIniDocument } from "../panel-tools.ts"
import { showError, showStatus } from "./file-operations"
import { scheduleSourceAutosave } from "./source-workspace"
import { renderFiles } from "./file-tree"
import { updateDirty, isEditing, commitBytes } from "./edit-history"
import { type BdaAppearance, bdaAppearancePath, type BdaAppearanceStyleGroup, type BdaAppearancePart, bdaLayoutDocument } from "../bda.ts"
import { decodeBdaAppearance } from "../bda-decode.ts"
import { decodedBdaAppearancePart, decodedBdaEditorSource, decodedBdaSource, applyDecodedBdaAppearancePart, bdaDecodedSourceEditable, applyDecodedBdaSource } from "../bda-source.ts"
import { bdaLayoutNames, BdaResolver } from "../bda-resolver.ts"
import { deferNumberInputRefresh } from "../number-input-wheel.ts"
import { layoutSource, setSourceValue } from "./config-context"
import { source } from "./canvas-interaction"
import { refreshPreview } from "./preview-render"
import { populateKeyInspector } from "./key-inspector"
import { IniDocument } from "../ini.ts"
import { type VisualResolver, AtlasResolver } from "../atlas.ts"
import { PalmStyles } from "../palm/palm-styles.ts"
import { palmSkin } from "./sxi-documents"

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

export function preferredVariantExists(path: string): boolean {
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
  if (!window.confirm(`当前皮肤没有${label}，是否从当前配置创建？`)) {
    theme.value = sourceTheme
    orientation.value = sourceOrientation
    syncSegmentedControls()
    return false
  }
  const copies = variantCopyPaths(appState.archive.names(), sourceTheme, sourceOrientation, targetTheme, targetOrientation)
  if (!copies.some(({ target }) => target === path)) {
    theme.value = sourceTheme
    orientation.value = sourceOrientation
    syncSegmentedControls()
    showError(new Error("当前配置没有可复制的对应布局"), `创建${label}`)
    return false
  }
  for (const { source, target } of copies) appState.archive.setBytes(target, appState.archive.getBytes(source)!.slice())
  scheduleSourceAutosave(copies.map(({ target }) => target))
  renderFiles()
  updateDirty()
  showStatus(`${label}已创建。`)
  return true
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
    if (info) setSourceValue(decodedBdaAppearancePart(info.bytes, part))
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
      const after = applyDecodedBdaAppearancePart(info.path, info.bytes, source.value, part)
      commitBytes(info.path, info.bytes, after)
      refreshBdaLayout(appState.layoutPath)
      setSourceValue(decodedBdaAppearancePart(after, part))
      refreshPreview()
      populateKeyInspector()
      updateDirty()
    } catch (error) {
      setSourceValue(decodedBdaAppearancePart(info.bytes, part))
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

/** Palm documents resolve styles from skin.json itself; Sogou boards draw with the official skeleton's styles. */
export function visualResolver(): VisualResolver | undefined {
  const source = layoutSource()
  if (!appState.archive || !source) return
  const appearancePath = appState.archive.format === "bda" ? bdaAppearancePath(appState.archive, theme.value, orientation.value) : undefined
  const appearanceBytes = appearancePath ? appState.archive.getBytes(appearancePath) : undefined
  // 新建解析器会重新解析样式、重新解码全部 PNG；归档内容（revision）与主题方向不变时复用，保留位图缓存。
  const key = [appState.archive, appState.archive.revision, appState.bdaBase, appState.bdaBase?.revision, source, appearanceBytes, theme.value, orientation.value]
  if (appState.cachedVisualResolver?.key.every((value, index) => value === key[index])) return appState.cachedVisualResolver.resolver
  const resolver = appearanceBytes
    ? new BdaResolver(appState.archive, appearanceBytes, appState.bdaBase, theme.value, orientation.value)
    : appState.archive.format === "sxi"
      ? new PalmStyles(appState.archive, palmSkin(appState.archive), theme.value === "dark" ? "night" : "default", orientation.value === "land" ? "land" : "port")
      : new AtlasResolver(source, theme.value, orientation.value)
  appState.cachedVisualResolver = { key, resolver }
  return resolver
}
