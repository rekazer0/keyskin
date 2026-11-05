// Which animation the 动效设计 / 粒子设计 inspector shows. One choice per file and view, so switching
// between motion and particles, or undoing an edit, comes back to the same animation.
import type { AnimationKeyFilter, AnimationListItem, AnimationStyleFilter, AnimationStyleItem } from "../animation-inspector.ts"
import { strToU8 } from "fflate"
import type { KeyboardPlayback } from "../animation-player.ts"
import { keyAnimationStyles, visiblePreviewItems, type PreviewItem } from "../preview-items.ts"
import { preview } from "./canvas-interaction"
import { asObject } from "../palm/sxi-ini.ts"
import { legacyAnimationConfigPath } from "./config-context"
import { theme } from "./dom"
import { commitBytes, isEditing, updateDirty } from "./edit-history"
import { populateKeyInspector } from "./key-inspector"
import { requestEditMode } from "./mobile-layout"
import { selectFile } from "./navigation"
import { renderFiles } from "./file-tree"
import { showStatus } from "./file-operations"
import { palmTheme } from "./sxi-documents"
import { editSxi } from "./sxi-fields"
import { appState } from "./state"

function selectionKey(): string {
  return `${appState.selectedPath}|${appState.animationDesignMode}`
}

/** Whether an animation belongs in the current view; the raw-file view shows everything. */
export function shownInAnimationView(particle: boolean): boolean {
  return appState.animationDesignMode === "all" || particle === (appState.animationDesignMode === "particle")
}

/** The remembered animation, or the first one when it is gone (deleted, undone, never chosen). */
export function selectedAnimation(items: readonly AnimationListItem[]): string | undefined {
  const remembered = appState.selectedAnimations[selectionKey()]
  const id = items.some((item) => item.id === remembered) ? remembered : items[0]?.id
  if (id !== undefined) appState.selectedAnimations[selectionKey()] = id
  return id
}

/** 编辑模式下在画布上选按键（可多选）筛选动画列表，清空时恢复；按键在画布上标为选中。 */
export function pickAnimationKeys(sections: readonly string[]): void {
  appState.animationStyleEditing = false
  if (sections.join() === appState.animationKeys.join()) return
  // 从没选到有选时先只看它们的动画；已在「全部」里挑动画时继续加选按键不打断。
  if (!appState.animationKeys.length) appState.animationKeyOnly = true
  // 按键筛选与样式筛选互斥：一次只看一个范围。
  if (sections.length) delete appState.animationStyle[selectionKey()]
  appState.animationKeys = [...sections]
  preview.setSelected(sections)
  populateKeyInspector()
}

/** 动效 / 粒子设计里按哪个样式（BDA 是按目标）筛动画列表，按文件与入口记住。 */
export function selectedAnimationStyle(): string | undefined {
  return appState.animationStyle[selectionKey()]
}

/** 选中一个样式：列表只留它播放的动画；和按键筛选互斥，一次只看一个范围。 */
export function selectAnimationStyle(id: string | undefined): void {
  const key = selectionKey()
  appState.animationStyleEditing = id !== undefined
  if (id === undefined) delete appState.animationStyle[key]
  else {
    appState.animationStyle[key] = id
    appState.animationKeys = []
    preview.setSelected([])
  }
  populateKeyInspector()
}

/** 按选中的样式筛列表：只留它引用的动画，并给出可清除的说明；记不住或该样式已没有动画时当作没筛。 */
export function styleAnimationItems<T extends AnimationListItem>(
  items: T[],
  styles: readonly AnimationStyleItem[],
  plays: (id: string, style: string) => boolean,
): { items: T[]; styleFilter?: AnimationStyleFilter } {
  const remembered = selectedAnimationStyle()
  if (remembered === undefined) return { items }
  const style = styles.find((item) => item.id === remembered)
  if (!style) {
    delete appState.animationStyle[selectionKey()]
    return { items }
  }
  return {
    items: items.filter((item) => plays(item.id, style.id)),
    styleFilter: { label: style.title, clear: () => selectAnimationStyle(undefined) },
  }
}

const keyLabel = (key: PreviewItem) => `按键 ${key.section.match(/\d+$/)?.[0] ?? key.section}`
const keysLabel = (keys: readonly PreviewItem[]) => keys.length === 1 ? keyLabel(keys[0]) : `${keys.length} 个按键`

function pickedKeys(): PreviewItem[] {
  const sections = new Set(appState.animationKeys)
  return sections.size ? visiblePreviewItems(preview.keys, preview.skinState).filter((key) => sections.has(key.section)) : []
}

/** The list for the picked keys: only the animations `plays` says one of them plays on press, or all of them. */
export function keyAnimationItems<T extends AnimationListItem>(
  items: T[],
  plays: (id: string, key: PreviewItem) => boolean,
): { items: T[]; keyFilter?: AnimationKeyFilter } {
  const keys = pickedKeys()
  if (!keys.length) return { items }
  const playing = items.filter((item) => keys.some((key) => plays(item.id, key)))
  // 一个都不播放时直接列全部，省掉一次点「全部」。
  const only = appState.animationKeyOnly && playing.length > 0
  return {
    items: only ? playing : items,
    keyFilter: {
      label: keysLabel(keys),
      only,
      none: !playing.length,
      total: items.length,
      toggle: () => {
        appState.animationKeyOnly = !appState.animationKeyOnly
        populateKeyInspector()
      },
      clear: () => pickAnimationKeys([]),
    },
  }
}

/** Remembers `id` without re-rendering, for edits that create an animation and re-render anyway. */
export function rememberAnimation(id: string): void {
  appState.selectedAnimations[selectionKey()] = id
}

export function selectAnimation(id: string): void {
  appState.animationStyleEditing = false
  rememberAnimation(id)
  populateKeyInspector()
}

/** The player's keyboard: the first key on the canvas that `plays` matches plays its press animation and emits the particles; without one they cover the panel. */
export function keyboardPlayback(plays: (key: PreviewItem) => boolean): KeyboardPlayback {
  const target = () => visiblePreviewItems(preview.keys, preview.skinState).find(plays)
  return {
    play() {
      const key = target()
      if (key) void preview.playAnimation(key)
    },
    particles(particles, elapsed) {
      preview.setPlayerParticles({ particles, elapsed, key: target() })
    },
  }
}

/** Hovering an animation style plays it on the canvas: on a selected key that uses it, else the first such key, else the panel. */
export function previewStyleAnimation(styleIDs: readonly string[]): void {
  const styles = new Set(styleIDs.filter(Boolean))
  if (!styles.size) return
  const keys = visiblePreviewItems(preview.keys, preview.skinState).filter((key) => keyPlaysStyle(key, styles))
  const key = keys.find((candidate) => appState.selectedKeySections.includes(candidate.section)) ?? keys[0]
  if (key) void preview.playAnimation(key)
  else if (styles.has(preview.panelAnimationStyle)) preview.restartLegacyPanelAnimation()
}

/** A key plays a style's press animation through its ANIM_STYLE, BACK_ANIM_STYLE, FORE_ANIM_STYLE or PRESS_STYLE. */
export function keyPlaysStyle(key: PreviewItem, styles: ReadonlySet<string>): boolean {
  return keyAnimationStyles(key).some((style) => styles.has(style))
}

/** Opens 动效设计 or 粒子设计 on `id`, e.g. from a style that plays it. */
export function openAnimation(path: string, particle: boolean, id: string): void {
  appState.animationStyleEditing = false
  const mode = particle ? "particle" : "motion"
  appState.selectedAnimations[`${path}|${mode}`] = id
  selectFile(path, "overview", mode)
}

/** Part of the inspector's selection context: another animation is another object (fresh change marks). */
export function animationSelectionContext(): string {
  return `${appState.animationDesignMode}|${appState.animationStyleEditing ? `style:${selectedAnimationStyle() ?? ""}` : appState.selectedAnimations[selectionKey()] ?? ""}`
}

/** Where 「自动创建」 puts the animation configuration of a skin that has none (BDI/BDS anim.ini, Palm ss_2). */
function newAnimationConfigLocation(): string | undefined {
  const format = appState.archive?.format
  if (format === "sxi") return `skin.json 的 ${palmTheme()}.s_info.ss_2`
  if (format === "bdi" || format === "bds") return `${theme.value}/skin/res/anim.ini`
}

/** The overview offers 动效设计 / 粒子设计 even without a configuration; this one creates it. */
export function canCreateAnimationConfig(): boolean {
  return Boolean(newAnimationConfigLocation())
}

/** Creates an empty animation configuration (one undo step, so no confirmation) and opens the view. */
export function askToCreateAnimationConfig(particle: boolean): void {
  const location = newAnimationConfigLocation()
  if (!location || !appState.archive) return
  if (!isEditing()) return requestEditMode()
  if (appState.archive.format === "sxi") {
    editSxi((skin) => {
      const info = asObject(asObject(skin[palmTheme()])?.s_info)
      if (!info) throw new Error("skin.json 中缺少当前主题")
      info.ss_2 = {}
    })
  } else {
    commitBytes(location, undefined, strToU8("[GLOBAL]\nANIM_NUM=0\n"))
    updateDirty()
  }
  const path = legacyAnimationConfigPath()
  if (!path) return
  selectFile(path, "overview", particle ? "particle" : "motion")
  renderFiles()
  showStatus("已创建动画配置")
}
