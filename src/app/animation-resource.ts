// Which animation the 动效设计 / 粒子设计 inspector shows. One choice per file and view, so switching
// between motion and particles, or undoing an edit, comes back to the same animation.

import { strToU8 } from "fflate"
import type { AnimationListItem } from "../animation-inspector.ts"
import type { KeyboardPlayback } from "../animation-player.ts"
import { visiblePreviewItems, type PreviewItem } from "../preview-items.ts"
import { preview } from "./canvas-interaction"
import { asObject } from "../palm/sxi-ini.ts"
import { legacyAnimationConfigPath } from "./config-context"
import { createAnimationDetail, createAnimationDialog, theme } from "./dom"
import { commitBytes, isEditing, updateDirty } from "./edit-history"
import { populateKeyInspector } from "./key-inspector"
import { requestEditMode } from "./mobile-layout"
import { selectFile } from "./navigation"
import { renderFiles } from "./file-tree"
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

/** Remembers `id` without re-rendering, for edits that create an animation and re-render anyway. */
export function rememberAnimation(id: string): void {
  appState.selectedAnimations[selectionKey()] = id
}

export function selectAnimation(id: string): void {
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

/** A key plays a style's press animation through its ANIM_STYLE, BACK_ANIM_STYLE or FORE_ANIM_STYLE. */
export function keyPlaysStyle(key: PreviewItem, styles: ReadonlySet<string>): boolean {
  return [key.animStyle, key.backAnimStyle, ...key.foreAnimStyles].some((style) => Boolean(style) && styles.has(style!))
}

/** Opens 动效设计 or 粒子设计 on `id`, e.g. from a style that plays it. */
export function openAnimation(path: string, particle: boolean, id: string): void {
  const mode = particle ? "particle" : "motion"
  appState.selectedAnimations[`${path}|${mode}`] = id
  selectFile(path, "overview", mode)
}

/** Part of the inspector's selection context: another animation is another object (fresh change marks). */
export function animationSelectionContext(): string {
  return `${appState.animationDesignMode}|${appState.selectedAnimations[selectionKey()] ?? ""}`
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

/** Asks, then creates an empty animation configuration (one undo step) and opens the view. */
export function askToCreateAnimationConfig(particle: boolean): void {
  const location = newAnimationConfigLocation()
  if (!location || createAnimationDialog.open) return
  if (!isEditing()) return requestEditMode()
  createAnimationDetail.textContent = `要自动创建一份空的动画配置（${location}）吗？之后可以在${particle ? "粒子" : "动效"}设计里新建动画，可以撤销。`
  createAnimationDialog.returnValue = ""
  createAnimationDialog.showModal()
  createAnimationDialog.addEventListener("close", () => {
    if (createAnimationDialog.returnValue !== "create" || !appState.archive || !isEditing()) return
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
  }, { once: true })
}
