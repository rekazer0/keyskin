import type { Preview } from "./preview.ts"
import type { PreviewItem } from "./preview-items.ts"
import { keyAnimationStyles } from "./preview-items.ts"
import { animationDuration, animationSequenceForKey, bdaAnimationBindingsForKey, bdaBindingEffects, bdaEffectDuration, type LegacyParticleEmitter } from "./preview-animation.ts"
import { playNativePress } from "./preview-native.ts"

/** The first particle is born at the trigger, not one birth interval later. */
const particleDuration = (particle: LegacyParticleEmitter) => (particle.totalNumber - 1) / particle.birthRate * 1000 + Math.max(...particle.life)

export async function playAnimation(self: Preview, key: PreviewItem): Promise<void> {
  if (self.scene) return playNativePress(self, key)
  // Panel PRESS_ANIM is inherited by the pressed key, not emitted at the panel origin.
  stopLegacyPanelAnimation(self)
  playLegacyAnimation(self, key)
  const effects = self.animation
    ? bdaAnimationBindingsForKey(self.animation, key).flatMap((binding) => bdaBindingEffects(self.animation!, binding))
    : []
  const duration = Math.max(0, ...effects.map(bdaEffectDuration))
  if (self.bdaAnimationTimer) window.cancelAnimationFrame(self.bdaAnimationTimer)
  self.bdaAnimationState = duration ? { key, startedAt: Date.now() } : undefined
  if (duration) {
    const state = self.bdaAnimationState
    const tick = () => {
      if (self.bdaAnimationState !== state) return
      const elapsed = Date.now() - state!.startedAt
      if (elapsed >= duration) self.bdaAnimationState = undefined
      self.draw()
      self.bdaAnimationTimer = elapsed < duration ? window.requestAnimationFrame(tick) : undefined
    }
    tick()
  }
  // Invalidate pending image decoding as well as the old frame timeout.
  const playback = ++self.animationPlayback
  if (self.animationTimer) window.clearTimeout(self.animationTimer)
  self.animationVisual = undefined
  const sequence = animationSequenceForKey(self.animation, key)
  if (!sequence?.frames.length || !self.resolver?.resolveResource) return
  const play = async (index: number): Promise<void> => {
    if (playback !== self.animationPlayback) return
    const frame = sequence.frames[index]
    if (!frame) {
      self.animationVisual = undefined
      self.draw()
      return
    }
    if (frame.resourceID === undefined) return play(index + 1)
    const visual = await self.resolveResource(frame.resourceID).catch(() => undefined)
    if (playback !== self.animationPlayback) return
    if (!visual) return play(index + 1)
    self.animationVisual = { key, visual }
    self.draw()
    self.animationTimer = window.setTimeout(() => void play(index + 1), Math.max(16, frame.duration ?? 0))
  }
  await play(0)
}

export function stopLegacyPanelAnimation(self: Preview): void {
  if (self.legacyPanelAnimationTimer) window.cancelAnimationFrame(self.legacyPanelAnimationTimer)
  self.legacyPanelAnimationTimer = undefined
  self.legacyPanelAnimationStartedAt = 0
}

/** The panel's own particles: its SHOW_ANIM, then a panel PRESS_ANIM style. */
function panelParticles(self: Preview): LegacyParticleEmitter[] {
  return (self.legacyShowAnimation?.get(self.panelAnimationStyle)
    ?? self.legacyAnimation?.get(self.panelAnimationStyle))?.particles ?? []
}

function startPanelParticles(self: Preview, particles: readonly LegacyParticleEmitter[], startedAt: number): void {
  self.legacyPanelAnimationStartedAt = startedAt
  const duration = Math.max(...particles.map(particleDuration))
  const tick = () => {
    const elapsed = Date.now() - self.legacyPanelAnimationStartedAt
    if (elapsed >= duration) self.legacyPanelAnimationStartedAt = 0
    self.draw()
    self.legacyPanelAnimationTimer = elapsed < duration ? window.requestAnimationFrame(tick) : undefined
  }
  tick()
}

/** Replays the panel's particles from the start, e.g. the inspector's 「在画布预览」. */
export function restartLegacyPanelAnimation(self: Preview): void {
  stopLegacyPanelAnimation(self)
  const particles = panelParticles(self)
  if (particles.length) startPanelParticles(self, particles, Date.now())
}

/**
 * A panel SHOW_ANIM particle effect plays by itself when the panel appears; a preview refresh keeps
 * its running time instead of replaying it. `restart` is for a panel that switched its animation style.
 */
export function syncLegacyPanelAnimation(self: Preview, restart = false): void {
  const particles = self.legacyShowAnimation?.get(self.panelAnimationStyle)?.particles ?? []
  if (!particles.length) {
    stopLegacyPanelAnimation(self)
    return
  }
  if (self.legacyPanelAnimationTimer) window.cancelAnimationFrame(self.legacyPanelAnimationTimer)
  self.legacyPanelAnimationTimer = undefined
  startPanelParticles(self, particles, restart || !self.legacyPanelAnimationStartedAt ? Date.now() : self.legacyPanelAnimationStartedAt)
}

function playLegacyAnimation(self: Preview, key: PreviewItem): void {
  const duration = Math.max(0, ...keyAnimationStyles(key, self.panelAnimationStyle).flatMap((style) => {
    const effect = self.legacyAnimation?.get(style)
    return [
      ...effect?.frames.map((frame) => frame.start + frame.delay + animationDuration(frame)) ?? [],
      ...effect?.particles.map(particleDuration) ?? [],
    ]
  }))
  // A new press restarts this key, without cancelling animations on other keys.
  self.legacyAnimationStates.delete(key.section)
  if (duration) self.legacyAnimationStates.set(key.section, { key, startedAt: Date.now(), duration })
  if (self.legacyAnimationTimer) window.cancelAnimationFrame(self.legacyAnimationTimer)
  const tick = () => {
    for (const [section, state] of self.legacyAnimationStates) {
      if (Date.now() - state.startedAt >= state.duration) self.legacyAnimationStates.delete(section)
    }
    self.draw()
    self.legacyAnimationTimer = self.legacyAnimationStates.size ? window.requestAnimationFrame(tick) : undefined
  }
  tick()
}
