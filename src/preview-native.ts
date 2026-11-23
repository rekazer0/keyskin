// Plays a native scene's animations on the canvas: a key's press, and the panel's clips, which keep
// the canvas redrawing while they show.

import type { NativeScene } from "./native-scene.ts"
import type { Preview } from "./preview.ts"
import type { PreviewItem } from "./preview-items.ts"

// A press clip that loops forever still ends with the press preview.
const LONGEST_PRESS = 3000
// Panel clips step at 25 fps (Palm's frame clips are 40 ms a frame).
const PANEL_FRAME = 40

export async function playNativePress(self: Preview, key: PreviewItem): Promise<void> {
  const playback = ++self.animationPlayback
  let scene = self.drawnScene
  if (!scene) {
    const pending = self.sceneForState()
    scene = await pending?.catch(() => undefined)
    // While building, another press, board change, or scene refresh can supersede this request.
    if (!scene || playback !== self.animationPlayback || pending !== self.sceneForState()) return
  }
  const effects = scene.effects
  if (!effects) return
  const seed = Math.floor(Math.random() * 1_000_000)
  const duration = Math.min(LONGEST_PRESS, effects.pressDuration(key.section, seed))
  if (!(duration > 0)) return
  const press = { section: key.section, startedAt: Date.now(), seed }
  self.nativePress = press
  const tick = () => {
    if (self.nativePress !== press) return
    if (Date.now() - press.startedAt >= duration) self.nativePress = undefined
    void self.draw()
    if (self.nativePress === press) requestAnimationFrame(tick)
  }
  tick()
}

/** Asks for the next panel frame while the scene has panel clips; a hidden page only waits. */
export function scheduleNativeFrame(self: Preview, scene: NativeScene | undefined): void {
  if (!scene?.effects?.panel || self.nativeFrame) return
  self.nativeFrame = window.setTimeout(() => {
    self.nativeFrame = 0
    if (document.hidden) scheduleNativeFrame(self, scene)
    else void self.draw()
  }, PANEL_FRAME)
}
