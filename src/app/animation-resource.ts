// Which animation the 动效设计 / 粒子设计 inspector shows. One choice per file and view, so switching
// between motion and particles, or undoing an edit, comes back to the same animation.

import type { AnimationListItem } from "../animation-inspector.ts"
import { populateKeyInspector } from "./key-inspector"
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

/** Part of the inspector's selection context: another animation is another object (fresh change marks). */
export function animationSelectionContext(): string {
  return `${appState.animationDesignMode}|${appState.selectedAnimations[selectionKey()] ?? ""}`
}
