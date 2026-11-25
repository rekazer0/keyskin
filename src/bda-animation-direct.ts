import type { AnimationDirectEdit } from "./animation-direct-controls.ts"
import type { AnimationHandle } from "./animation-direct-model.ts"
import { bdaPreviewClip, type PreviewClip } from "./animation-preview-model.ts"
import type { BdaAnimation, BdaAnimationEffect, BdaNumberRange } from "./bda.ts"

type Update = (value: number) => { effect: BdaAnimationEffect; fields: Record<string, number> }

/** The handles edit native protobuf fields; sampling a drag never writes the animation config. */
export function bdaDirectEdit(animation: BdaAnimation, id: string, clip: PreviewClip,
  write: (fields: Record<string, number>) => void): AnimationDirectEdit | undefined {
  const effect = animation.effects.get(id)
  if (!effect) return
  const edits = new Map<AnimationHandle, Update>()
  const track = clip.tracks[0]
  if ("from" in effect && track) {
    const labels = effect.kind === "scale" ? ["缩放 X", "缩放 Y"] : effect.kind === "shift" ? ["位移 X", "位移 Y"]
      : [effect.kind === "rotate" ? "终止角度" : "终止透明度"]
    const unit = effect.kind === "alpha" ? "" : effect.kind === "rotate" ? "°" : effect.kind === "shift" && !effect.relative ? "px" : "%"
    for (const [index, label] of labels.entries()) {
      const [start, end] = effect.to[index]
      // A random interval has no single endpoint to drag. Leave both bounds in the inspector.
      if (start !== end || !Number.isInteger(start)) continue
      const key = labels.length === 1 ? "to" : index === 0 ? "toX" : "toY"
      edits.set({ field: unit === "px" ? "TO_PX" : "TO", index, label, unit, value: start, step: 1,
        min: effect.kind === "alpha" ? 0 : -2_147_483_648, max: effect.kind === "alpha" ? 255 : 2_147_483_647 }, value => {
        const endpoint = Math.round(value)
        const to = [...effect.to] as typeof effect.to
        to[index] = [endpoint, endpoint]
        return { effect: { ...effect, to }, fields: { [`${key}Min`]: endpoint, [`${key}Max`]: endpoint } }
      })
    }
    if (Number.isInteger(effect.duration) && effect.duration >= 0) {
      edits.set({ field: "DURATION", index: 0, label: "单程时长", unit: "ms", value: effect.duration, step: 10, min: 1, max: 60_000 }, value => {
        const duration = Math.round(value)
        return { effect: { ...effect, duration }, fields: { duration } }
      })
    }
  } else if (effect.kind === "emitter" && clip.particles[0]?.emitter.images.length) {
    for (const [key, field, noun, unit] of [
      ["velocity", "VELOCITY", "速度", "px/s"], ["velocityDirection", "VELOCITY_DIRECTION", "方向", "°"],
    ] as const) {
      const [min, max] = effect[key]
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) continue
      for (const index of [0, 1] as const) {
        edits.set({ field, index, label: `${noun}${index ? "上" : "下"}限`, unit, value: effect[key][index], step: 1,
          ...(index ? { min } : { max }) }, value => {
          const range: BdaNumberRange = index ? [min, value] : [value, max]
          return { effect: { ...effect, [key]: range }, fields: { [`${key}${index ? "Max" : "Min"}`]: value } }
        })
      }
    }
  }
  if (!edits.size) return
  return {
    handles: [...edits.keys()],
    pivot: track?.pivot,
    delay: clip.lanes[0]?.start,
    preview(handle, value) {
      const draft = edits.get(handle)?.(value)
      return draft ? bdaPreviewClip({ ...animation, effects: new Map([[id, draft.effect]]) }, id) : clip
    },
    commit(handle, value) {
      const draft = edits.get(handle)?.(value)
      if (draft) write(draft.fields)
    },
  }
}
