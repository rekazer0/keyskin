import type { AnimationDirectEdit } from "../animation-direct-controls.ts"
import type { AnimationHandle } from "../animation-direct-model.ts"
import type { PreviewClip } from "../animation-preview-model.ts"
import { palmPreviewClip } from "./palm-preview-clip.ts"
import { animationBase, animationModel } from "./sxi-animation.ts"
import { asObject, type Json, type JsonObject } from "./sxi-ini.ts"

const literal = (value: Json): value is number => typeof value === "number" && Number.isFinite(value)

type EditValue = { key: string; next(value: number): number | number[] }

/** Bind shared handles to the literal skin.json fields used by this preview, not its fallback values. */
export function sxiDirectEdit(table: JsonObject, id: string, clip: PreviewClip,
  write: (key: string, value: number | number[]) => void): AnimationDirectEdit | undefined {
  const wrap = asObject(table[id])
  const entry = wrap && animationModel(wrap)
  if (!entry) return
  const { kind, model } = entry
  const edits = new Map<AnimationHandle, EditValue>()
  const add = (field: string, key: string, labels: string[], unit: string,
    bounds: Pick<AnimationHandle, "min" | "max"> = {}, step = 1, range = false) => {
    const saved = model[key]
    const values = labels.length === 1 ? [saved] : saved
    if (!Array.isArray(values) || values.length !== labels.length || !values.every(literal)) return
    if (range && values[0] > values[1]) return
    labels.forEach((label, index) => {
      const { min, max } = range ? (index === 0 ? { max: values[1] } : { min: values[0] }) : bounds
      edits.set({ field, index, label, value: values[index], step, unit, min, max }, {
        key,
        next: (value) => labels.length === 1 ? value : values.map((part, axis) => axis === index ? value : part),
      })
    })
  }

  const track = clip.tracks[0]
  if (kind === "a1" && track) {
    const { t } = animationBase(model)
    if (t !== undefined && !literal(t)) return
    if (track.kind === "opacity") add("TO", "to", ["终止透明度"], "", { min: 0, max: 255 })
    if (track.kind === "rotate") add("TO", "to", ["终止角度"], "°")
    if (track.kind === "scale") add("TO", "to_p", ["缩放 X", "缩放 Y"], "%")
    if (track.kind === "translate") {
      if (track.relative) add("TO", "to_p", ["位移 X", "位移 Y"], "%")
      else add("TO_PX", "to_px", ["位移 X", "位移 Y"], "px")
    }
    if (literal(model.duration) && model.duration >= 0) add("DURATION", "duration", ["单程时长"], "ms", { min: 1, max: 60_000 }, 10)
  } else if (kind === "af2" && clip.images[0]?.file?.trim() && clip.images[0].duration > 0) {
    add("DURATION", "d", ["单程时长"], "ms", { min: 1, max: 60_000 }, 10)
  } else if (kind === "a4" && clip.particles.length) {
    add("VELOCITY_DIRECTION", "v_direction", ["方向下限", "方向上限"], "°", {}, 1, true)
    add("VELOCITY", "velocity", ["速度下限", "速度上限"], "px/s", {}, 1, true)
  }
  if (!edits.size) return

  return {
    handles: [...edits.keys()],
    pivot: track?.pivot,
    delay: clip.lanes[0]?.start,
    preview(handle, value) {
      const edit = edits.get(handle)
      if (!edit) return clip
      return palmPreviewClip({ [id]: { ...wrap, [kind]: { ...model, [edit.key]: edit.next(value) } } }, id)
    },
    commit(handle, value) {
      const edit = edits.get(handle)
      if (edit) write(edit.key, edit.next(value))
    },
  }
}
