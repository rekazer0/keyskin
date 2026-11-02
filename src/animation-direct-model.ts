import { IniDocument } from "./ini.ts"
import { legacyAnimationValueParts, parseLegacyAnimationFile, writeLegacyAnimationFields } from "./legacy-animation.ts"
import type { Rect } from "./preview-items.ts"

export type AnimationHandle = { field: string; index: number; label: string; value: number; step: number; unit: string; min?: number; max?: number }

/** Only literal values can be manipulated: never replace a random expression with its sampled value. */
export function animationHandles(document: IniDocument, section: string): AnimationHandle[] {
  const entry = parseLegacyAnimationFile(document.toString()).entries.find((item) => item.section === section)
  if (!entry) return []
  const handles: AnimationHandle[] = []
  const add = (field: string, labels: string[], unit: string, step = 1, min?: number, max?: number) => {
    const parts = legacyAnimationValueParts(document.get(section, field) ?? "")
    if (parts.length !== labels.length || parts.some((part) => !part.trim() || !Number.isFinite(Number(part)))) return
    labels.forEach((label, index) => handles.push({ field, index, label, value: Number(parts[index]), step, unit, min, max }))
  }
  if (entry.kind === "particle") {
    add("VELOCITY_DIRECTION", ["方向下限", "方向上限"], "°")
    add("VELOCITY", ["速度下限", "速度上限"], "px/s", 1, 0)
  } else if (entry.kind === "basic") {
    if (entry.type === 3 || entry.type === 4) add("TO", ["缩放 X", "缩放 Y"], "%")
    if (entry.type === 2) {
      const pixels = document.get(section, "FROM_PX") !== undefined || document.get(section, "TO_PX") !== undefined
      add(pixels ? "TO_PX" : "TO", ["位移 X", "位移 Y"], pixels ? "px" : "%")
    }
    if (entry.type === 1) add("TO", ["终止角度"], "°")
    if (entry.type === 0) add("TO", ["终止透明度"], "", 1, 0, 255)
  }
  if (entry.kind === "basic" || entry.kind === "frame") add("DURATION", ["单程时长"], "ms", 10, 1, 60_000)
  return handles
}

export function moveAnimationHandle(text: string, section: string, handle: AnimationHandle, value: number): string {
  if (!Number.isFinite(value)) return text
  const document = IniDocument.parse(text)
  const current = animationHandles(document, section).find((item) => item.field === handle.field && item.index === handle.index)
  if (!current) return text
  const parts = legacyAnimationValueParts(document.get(section, handle.field)!)
  let next = Math.max(current.min ?? -Infinity, Math.min(current.max ?? Infinity, value))
  if (handle.field === "VELOCITY" || handle.field === "VELOCITY_DIRECTION") next = handle.index === 0 ? Math.min(next, Number(parts[1])) : Math.max(next, Number(parts[0]))
  parts[handle.index] = String(Math.round(next * 100) / 100)
  return writeLegacyAnimationFields(text, section, { [handle.field]: parts.join(",") })
}

/** Positions are in the player's stage coordinates, before the fit transform. */
export function animationHandlePoint(handle: AnimationHandle, key: Rect, pivot: readonly number[], value = handle.value): [number, number] {
  const cx = key.x + key.width * pivot[0], cy = key.y + key.height * pivot[1]
  if (handle.field === "VELOCITY_DIRECTION") {
    const angle = value * Math.PI / 180
    return [key.x + key.width / 2 + Math.cos(angle) * 60, key.y + key.height / 2 + Math.sin(angle) * 60]
  }
  if (handle.field === "VELOCITY") return [24 + Math.min(100, value * 0.5), handle.index ? 144 : 16]
  if (handle.label.startsWith("缩放")) {
    // Use the farther edge so pivots on an edge (or outside the key) remain editable.
    const edge = pivot[handle.index] > 0.5 ? 0 : 1
    return handle.index ? [cx, cy + key.height * (edge - pivot[1]) * value / 100] : [cx + key.width * (edge - pivot[0]) * value / 100, cy]
  }
  if (handle.label.startsWith("位移")) {
    const distance = value * (handle.unit === "%" ? (handle.index ? key.height : key.width) / 100 : key.width / 108)
    return handle.index ? [key.x + key.width / 2, key.y + key.height / 2 + distance] : [key.x + key.width / 2 + distance, key.y + key.height / 2]
  }
  return [key.x + key.width / 2 + Math.cos(value * Math.PI / 180) * 48, key.y + key.height / 2 + Math.sin(value * Math.PI / 180) * 48]
}

export function animationHandleValue(handle: AnimationHandle, point: readonly number[], key: Rect, pivot: readonly number[]): number {
  const cx = key.x + key.width / 2, cy = key.y + key.height / 2
  if (handle.field === "VELOCITY_DIRECTION" || handle.label === "终止角度") {
    const angle = Math.atan2(point[1] - cy, point[0] - cx) * 180 / Math.PI
    return angle + Math.round((handle.value - angle) / 360) * 360
  }
  if (handle.field === "VELOCITY") return (point[0] - 24) * 2
  if (handle.label.startsWith("缩放")) {
    const index = handle.index, size = index ? key.height : key.width, origin = (index ? key.y : key.x) + size * pivot[index]
    return (point[index] - origin) / (size * ((pivot[index] > 0.5 ? 0 : 1) - pivot[index])) * 100
  }
  if (handle.label.startsWith("位移")) return (point[handle.index] - (handle.index ? cy : cx)) / (handle.unit === "%" ? (handle.index ? key.height : key.width) / 100 : key.width / 108)
  return handle.value
}
