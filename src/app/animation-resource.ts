// Which animation the 动效设计 / 粒子设计 inspector shows. One choice per file and view, so switching
// between motion and particles, or undoing an edit, comes back to the same animation.

import { strToU8 } from "fflate"
import type { AnimationChoice, AnimationKeyFilter, AnimationListItem, AnimationUse } from "../animation-inspector.ts"
import type { KeyboardPlayback } from "../animation-player.ts"
import { keyAnimationStyles, visiblePreviewItems, type PreviewItem } from "../preview-items.ts"
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

/** 编辑模式下在画布上选按键（可多选）筛选动画列表，清空时恢复；按键在画布上标为选中。 */
export function pickAnimationKeys(sections: readonly string[]): void {
  if (sections.join() === appState.animationKeys.join()) return
  // 从没选到有选时先只看它们的动画；已在「全部」里挑动画时继续加选按键不打断。
  if (!appState.animationKeys.length) appState.animationKeyOnly = true
  appState.animationKeys = [...sections]
  preview.setSelected(sections)
  populateKeyInspector()
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

/** 把动画应用到按键：先选的几项（时机、部位），再对选中的按键执行。 */
export type KeyApply = { choices: AnimationChoice[]; run(keys: PreviewItem[]): void }

/**
 * 「引用」开头的按键：当前布局哪些按键按下时播放 `id`（点一下在画布上标出）；
 * 画布上选了按键时，`apply` 给出时机、部位和「应用」按钮（格式不支持时不给）。
 */
export function keyUses(id: string, plays: (id: string, key: PreviewItem) => boolean, apply?: KeyApply): AnimationUse[] {
  const keys = visiblePreviewItems(preview.keys, preview.skinState).filter((key) => plays(id, key))
  const sections = keys.map((key) => key.section)
  const uses: AnimationUse[] = [keys.length
    ? {
        icon: "keyboard", title: `当前布局 ${keys.length} 个按键`, detail: keys.map(keyLabel).join("、"),
        targets: [{ label: "在画布上标出", open: () => isEditing() ? pickAnimationKeys(sections) : preview.setSelected(sections) }],
      }
    : {
        icon: "keyboard", title: "当前布局没有按键播放它",
        detail: !apply ? "按键通过下面的样式或绑定播放它" : isEditing() ? "在画布上选按键（Shift / ⌘ 多选），再应用到它们" : "切到编辑模式后可以应用到按键",
      }]
  const picked = pickedKeys()
  if (picked.length && apply) {
    const label = keysLabel(picked)
    const playing = picked.filter((key) => plays(id, key))
    uses.push({
      icon: "pointer", title: `应用到${label}`,
      detail: `替换${picked.length > 1 ? "各" : "该"}按键在这个时机原来的动画，其他时机保留${playing.length ? `；${playing.map(keyLabel).join("、")} 按下时已在播放` : ""}`,
      choices: apply.choices,
      targets: [{ label: "应用", icon: "check", title: `应用到${label}`, open: () => isEditing() ? apply.run(picked) : requestEditMode() }],
    })
  }
  return uses
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
