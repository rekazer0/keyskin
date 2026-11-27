import { appState } from "./state"
import { theme, orientation, resourceSearch } from "./dom"
import { styleConfigPath } from "./config-context"
import { bdaAppearancePath } from "../bda"
import { bdaAppearanceStylePath } from "./bda-documents"
import { pickableImagePaths } from "./image-pickers"
import { selectFile } from "./navigation"
import { setSidebarView } from "./source-files"
import { showResourceList } from "./resource-inspector"

export function resourceNavigationPath(kind: "style" | "image" | "sound"): string | undefined {
  const archive = appState.archive
  if (!archive) return
  if (archive.format === "bda") {
    const path = bdaAppearancePath(archive, theme.value, orientation.value)
    return path && (kind === "style" ? bdaAppearanceStylePath(appState.selectedBdaStyleGroup) : path)
  }
  const styles = styleConfigPath()
  if (kind === "style") return archive.format === "sxi" || archive.isText(styles) ? styles : undefined
  return archive.isText(styles) ? styles : pickableImagePaths()[0] ?? appState.layoutPath
}

/** 桌面与手机共用资源入口，不再依赖概览中的资源磁贴。 */
export function openResources(kind: "style" | "image" | "sound" = "style", imageFolder = ""): void {
  const path = resourceNavigationPath(kind)
  if (!path) {
    if (kind === "style") openResources("image")
    return
  }
  resourceSearch.value = ""
  appState.resourceImageFolder = imageFolder
  appState.inspectorTab = "properties"
  selectFile(path, "overview", kind)
  setSidebarView("overview")
  if (kind === "image") showResourceList()
}
