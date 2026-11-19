// 能力与损失：每个格式声明它能表达哪些能力；跨格式转换前据此生成降级报告。
import type { SkinModel } from "./model.ts"
import type { SkinLayer } from "./style.ts"
import { motionNodeKinds } from "./motion.ts"
import { boardPanels } from "./panel.ts"

export type Capability =
  | "board.geometry"
  | "board.keys"
  | "board.add-remove"
  | "board.transitions"
  | "key.actions"
  | "key.states"
  | "key.touch"
  | "style.image"
  | "style.nine-slice"
  | "style.color"
  | "style.text"
  | "style.border"
  | "style.icon"
  | "style.gradient"
  | "style.sound"
  | "panel.backdrop"
  | "panel.candidate"
  | "panel.hint"
  | "panel.list"
  | "panel.toolbar"
  | "panel.input"
  | "motion.track"
  | "motion.sequence"
  | "motion.frames"
  | "motion.particles"
  | "motion.path"
  | "motion.physics"
  | "motion.custom"
  | "motion.binding"
  | "sound"
  | "font"

export type CapabilityLevel = "full" | "partial" | "none"
export type CapabilitySet = ReadonlyMap<Capability, CapabilityLevel>

export type LossReason = "no-equivalent" | "approximated" | "merged" | "dropped" | "clamped" | "needs-basis"

export type LossItem = {
  capability: Capability
  reason: LossReason
  subject?: string
  detail?: string
}

export type LossReport = { items: LossItem[] }

/** 模型里实际用到的能力；级别记录“是否需要目标格式完全支持”。 */
export function requiredCapabilities(model: SkinModel): CapabilitySet {
  const needed = new Map<Capability, CapabilityLevel>()
  const need = (capability: Capability, level: CapabilityLevel = "full"): void => {
    const current = needed.get(capability)
    if (current === undefined || level === "full") needed.set(capability, level)
  }
  for (const board of model.boards) {
    need("board.geometry", board.geometry.kind === "document" ? "full" : "partial")
    if (board.keys.length) need("board.keys")
    if (board.keys.some((key) => Object.keys(key.actions).length)) need("key.actions")
    if (board.keys.some((key) => (key.stateRefs?.length ?? 0) > 0)) need("key.states")
    if (board.keys.some((key) => key.hitArea !== undefined)) need("key.touch")
    const panels = boardPanels(board)
    if (panels?.transitions?.length) need("board.transitions")
    if (board.backdrop) need("panel.backdrop")
    if (panels?.candidates?.length) need("panel.candidate")
    if (panels?.hint) need("panel.hint")
    if (panels?.list) need("panel.list")
    if (panels?.toolbar) need("panel.toolbar")
    if (panels?.input) need("panel.input")
  }
  const layers: SkinLayer[] = []
  for (const style of model.styles.values()) {
    layers.push(...style.normal, ...(style.pressed ?? []), ...(style.disabled ?? []))
  }
  for (const layer of layers) {
    switch (layer.kind) {
      case "image":
        need("style.image")
        if (layer.stretch && layer.stretch.kind !== "none") need("style.nine-slice")
        break
      case "color":
        need("style.color")
        break
      case "text":
        need("style.text")
        break
      case "border":
        need("style.border")
        break
      case "icon":
        need("style.icon")
        break
      case "gradient":
        need("style.gradient")
        break
      case "sound":
        need("style.sound")
        break
    }
  }
  for (const motion of model.motions.values()) {
    for (const kind of motionNodeKinds(motion)) {
      switch (kind) {
        case "track":
          need("motion.track")
          break
        case "group":
          need("motion.sequence")
          break
        case "frames":
          need("motion.frames")
          break
        case "opaque":
          need("motion.custom")
          break
      }
    }
    if (motion.bindings?.length) need("motion.binding")
  }
  if (model.sounds.length) need("sound")
  for (const resource of model.resources.values()) if (resource.kind === "font") need("font")
  return needed
}

/** 目标格式能力与模型实际需求之间的差。 */
export function lossOf(model: SkinModel, target: CapabilitySet): LossReport {
  const items: LossItem[] = []
  for (const [capability, level] of requiredCapabilities(model)) {
    const available = target.get(capability) ?? "none"
    if (available === "full" && level === "full") continue
    if (available === "full") continue
    items.push({
      capability,
      reason: available === "none" ? "no-equivalent" : "approximated",
      detail: available === "none" ? "目标格式没有对应能力" : "目标格式只能近似表达",
    })
  }
  return { items }
}
