// 手心皮肤的动效 ↔ IR 动效。
//
// `s_info.ss_2` 按编号存动画：`a1` 是属性从起点到终点的过渡，`a3` 是按顺序/同时/随机播放的
// 组合，子项是别的动画编号。`a1` 走 `track`（两点关键帧），`a3` 走 `group`；
// 其它家族原样保留成不透明节点，不猜语义。
import type { Json, JsonObject } from "@/palm/sxi-ini.ts"
import { asObject } from "@/palm/sxi-ini.ts"
import type { Easing, MotionNode, MotionRange, MotionTimeline, MotionVector, SkinMotions } from "@/skin-model/motion.ts"
import type { Theme } from "@/skin-model/types.ts"
import { numberOf, numbersOf, textOf } from "./json.ts"

const MOTION_PREFIX = "sxi:"

function motionRef(theme: Theme, key: string): string {
  return `${MOTION_PREFIX}${theme}:ss_2:${key}`
}

function parseMotionRef(ref: string): { theme: Theme; key: string } | undefined {
  const match = /^sxi:(light|dark):ss_2:(\d+)$/.exec(ref)
  if (!match) return
  return { theme: match[1] as Theme, key: match[2] }
}

/** 插值器编号：0 线性、1 缓入、2 缓出、3 平滑、4 弹跳。 */
function easingOf(value: Json | undefined): Easing {
  switch (numberOf(value)) {
    case 1: return { kind: "ease-in" }
    case 2: return { kind: "ease-out" }
    case 3: return { kind: "ease-in-out" }
    case 4: return { kind: "bounce" }
    default: return { kind: "linear" }
  }
}

function easingNumber(easing: Easing | undefined): number {
  switch (easing?.kind) {
    case "ease-in": return 1
    case "ease-out": return 2
    case "ease-in-out": return 3
    case "bounce": return 4
    default: return 0
  }
}

function pairOf(value: Json | undefined): [number, number] | undefined {
  const numbers = numbersOf(value)
  return numbers.length >= 2 ? [numbers[0], numbers[1]] : undefined
}

function rangeOf(value: number): MotionRange {
  return [value, value]
}

function timelineOf(model: JsonObject, duration: number): MotionTimeline {
  const base = asObject(model.b) ?? {}
  return {
    delay: (numberOf(model.delay) ?? numberOf(model.c_delay) ?? 0) / 1000,
    duration: duration / 1000,
    repeat: numberOf(base.count) ?? 1,
    reverse: base.back === true,
    clear: base.clear === true,
  }
}

/** `a1` 的变化属性：0 透明度、1 旋转、2 位移、其余按缩放。 */
function propertyOf(model: JsonObject): "alpha" | "rotation" | "x" | "scale" {
  switch (numberOf(asObject(model.b)?.t)) {
    case 0: return "alpha"
    case 1: return "rotation"
    case 2: return "x"
    default: return "scale"
  }
}

/** `a1` 的起点与终点：标量用 `from/to`，位移用 `from_px/to_px`，缩放用 `from_p/to_p`。 */
function vectorOf(model: JsonObject, property: "alpha" | "rotation" | "x" | "scale"): { from: MotionVector; to: MotionVector; relative: boolean } {
  if (property === "alpha" || property === "rotation") {
    const from = numberOf(model.from) ?? 0
    const to = numberOf(model.to) ?? 0
    return { from: [rangeOf(from), rangeOf(from)], to: [rangeOf(to), rangeOf(to)], relative: false }
  }
  const pixels = property === "x" && (model.from_px !== undefined || model.to_px !== undefined)
  const from = pairOf(pixels ? model.from_px : model.from_p) ?? [0, 0]
  const to = pairOf(pixels ? model.to_px : model.to_p) ?? [0, 0]
  return {
    from: [rangeOf(from[0]), rangeOf(from[1])],
    to: [rangeOf(to[0]), rangeOf(to[1])],
    relative: true,
  }
}

function familyOf(wrap: JsonObject): { kind: string; model: JsonObject } | undefined {
  for (const [key, value] of Object.entries(wrap)) {
    if (key === "id") continue
    const model = asObject(value)
    if (model) return { kind: key, model }
  }
  return
}

/** `ss_2` → IR 动效表。 */
export function motionsOfTheme(ss2: JsonObject, theme: Theme): SkinMotions {
  const motions = new Map<string, MotionNode>()
  for (const [key, value] of Object.entries(ss2)) {
    const wrap = asObject(value)
    const family = wrap ? familyOf(wrap) : undefined
    if (!family) continue
    const id = motionRef(theme, key)
    const { kind, model } = family
    if (kind === "a1") {
      const property = propertyOf(model)
      const vector = vectorOf(model, property)
      const duration = (numberOf(model.duration) ?? 0) / 1000
      const timeline = timelineOf(model, numberOf(model.duration) ?? 0)
      motions.set(id, {
        kind: "track",
        target: { subject: "unknown", property },
        keyframes: [
          { time: 0, value: vector.from[0][0] },
          { time: duration, value: vector.to[0][0] },
        ],
        easing: easingOf(model.style),
        vector,
        timeline,
      })
      continue
    }
    if (kind === "a3") {
      const ids = numbersOf(model.animations).map((item) => motionRef(theme, String(item)))
      const method = textOf(model.a_method)
      motions.set(id, {
        kind: "group",
        method: method === "sequential" ? "sequential" : method === "random" ? "random" : "simultaneous",
        children: ids.map((child) => ({ kind: "reference" as const, id: child })),
        timeline: timelineOf(model, numberOf(model.duration) ?? 0),
      })
      continue
    }
    // 未建模的家族原样保留；字段不展开，避免把语义不明的结构伪装成已知。
    motions.set(id, { kind: "opaque", format: `sxi.${kind}`, blob: model })
  }
  return motions
}

/** 一个 `a1` 节点的写回：属性、双轴起点终点、插值器、时长。 */
function a1Json(motion: Extract<MotionNode, { kind: "track" }>, original: JsonObject): JsonObject {
  const vector = motion.vector
  const scalar = motion.target.property === "alpha" || motion.target.property === "rotation"
  const type = motion.target.property === "alpha" ? 0
    : motion.target.property === "rotation" ? 1
      : motion.target.property === "x" ? 2
        : 3
  const timeline = motion.timeline
  const next: JsonObject = {
    ...original,
    b: { ...asObject(original.b) ?? {}, t: type, c: 0 },
    style: easingNumber(motion.easing),
    duration: Math.round((timeline?.duration ?? 0) * 1000),
  }
  if (timeline) {
    next.c_delay = Math.round(timeline.delay * 1000)
    const base = asObject(next.b) ?? {}
    next.b = {
      ...base,
      ...(timeline.repeat !== 1 ? { count: timeline.repeat } : {}),
      ...(timeline.reverse ? { back: true } : {}),
      ...(timeline.clear ? { clear: true } : {}),
    }
  }
  if (!vector) return next
  const from = vector.from
  const to = vector.to
  if (scalar) {
    next.from = from[0][0]
    next.to = to[0][0]
    delete next.from_p
    delete next.to_p
    delete next.from_px
    delete next.to_px
  } else if (motion.target.property === "x") {
    next.from_px = [from[0][0], from[1][0]]
    next.to_px = [to[0][0], to[1][0]]
    delete next.from_p
    delete next.to_p
    delete next.from
    delete next.to
  } else {
    next.from_p = [from[0][0], from[1][0]]
    next.to_p = [to[0][0], to[1][0]]
    delete next.from_px
    delete next.to_px
    delete next.from
    delete next.to
  }
  return next
}

/**
 * 动效表写回 `ss_2`。
 * 原表的家族字段先铺底，IR 能表达的字段覆盖它；`a3` 的 `method` 对象等未建模字段原样保留。
 */
export function motionsJson(theme: Theme, motions: SkinMotions, original: JsonObject): JsonObject {
  const table: JsonObject = { ...original }
  for (const [name, motion] of motions) {
    const parsed = parseMotionRef(name)
    if (!parsed || parsed.theme !== theme) continue
    const wrap = asObject(original[parsed.key]) ?? {}
    if (motion.kind === "track") {
      const before = asObject(wrap.a1) ?? {}
      table[parsed.key] = { id: `ANIM${parsed.key}`, a1: a1Json(motion, before) }
      continue
    }
    if (motion.kind === "group") {
      const before = asObject(wrap.a3) ?? {}
      const children = motion.children.flatMap((child) => {
        if (child.kind !== "reference") return []
        const reference = parseMotionRef(child.id)
        return reference ? [Number(reference.key)] : []
      })
      table[parsed.key] = {
        id: `ANIM${parsed.key}`,
        a3: {
          ...before,
          a_method: motion.method,
          animations: children.length ? children : numbersOf(before.animations),
        },
      }
      continue
    }
    if (motion.kind === "opaque") {
      const kind = motion.format.replace(/^sxi\./, "")
      table[parsed.key] = { id: `ANIM${parsed.key}`, [kind]: motion.blob as Json }
      continue
    }
    // 引用节点不是动画表的一行，跳过。
  }
  return table
}
