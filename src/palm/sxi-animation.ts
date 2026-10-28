// The editing model behind `ss_2` (Palm's animation table). The nine animation families are the ones
// PalmSkin's `SkinAnimationWrapModel` decodes, so the visual inspector shows exactly the fields Palm reads
// (ANIMATION_FIELDS); everything here is pure so the mapping stays testable.

import { asObject, type Json, type JsonObject } from "./sxi-ini.ts"
import { ANIMATION_FIELDS, FLOATER_FIELDS } from "./sxi-style.ts"
import { buildAnimationWrap } from "./palm-animation.ts"

export type AnimationFieldKind = "number" | "text" | "bool" | "point" | "rect" | "color" | "list" | "select"
/** `value` is what goes into skin.json; `label` is what the inspector shows. */
export type AnimationOption = [value: string, label: string]
export type AnimationField = {
  key: string
  label: string
  kind: AnimationFieldKind
  options?: AnimationOption[]
  /** Effective value when skin.json omits a select or boolean field. */
  defaultValue?: string
  unit?: string
  axes?: [string, string]
  /** `base` for the playback fields every family shares in `b`. */
  scope?: AnimationScope
}
/** Base fields (`b.*`) sit in the wrap's base model; the rest in the family model itself. */
export type AnimationScope = "base" | "model"
export type AnimationGroup = { title: string; fields: AnimationField[] }

export type AnimationFamily = {
  id: string
  /** The family's category; the base model carries it as `b.c`. */
  category: number
  label: string
  summary: string
}

export const ANIMATION_FAMILIES: AnimationFamily[] = [
  { id: "a1", category: 0, label: "属性变化", summary: "透明度、旋转、位移或缩放" },
  { id: "a3", category: 1, label: "组合动画", summary: "把多个动画同时、顺序或随机播放" },
  { id: "af2", category: 2, label: "帧序列", summary: "按时间播放图片帧" },
  { id: "a4", category: 3, label: "粒子发射", summary: "粒子寿命、速度、缩放与透明度" },
  { id: "a10", category: 10, label: "路径跟踪", summary: "沿路径移动，空闲时恢复" },
  { id: "a11", category: 11, label: "碰撞物理", summary: "重力、碰撞、阻力与反弹" },
  { id: "a12", category: 12, label: "液体与浮动物", summary: "倾斜液体、波浪与浮动物体" },
  { id: "a13", category: 13, label: "底部嘉年华", summary: "底部物件循环、跳跃与落点" },
  { id: "a14", category: 14, label: "太空兔", summary: "背景、兔子状态与掉落物" },
]

const FAMILY_BY_ID = new Map(ANIMATION_FAMILIES.map((family) => [family.id, family]))
/** The order the wrap model checks; `a3` has no base model and is detected by its key alone. */
const FAMILY_IDS = ANIMATION_FAMILIES.map((family) => family.id)

export function animationFamily(wrap: JsonObject): string | undefined {
  return FAMILY_IDS.find((id) => asObject(wrap[id]))
}

export function animationFamilyInfo(id: string | undefined): AnimationFamily | undefined {
  return id === undefined ? undefined : FAMILY_BY_ID.get(id)
}

export function animationModel(wrap: JsonObject, id?: string): { kind: string; model: JsonObject } | undefined {
  const kind = id ?? animationFamily(wrap)
  const model = kind ? asObject(wrap[kind]) : undefined
  return kind && model ? { kind, model } : undefined
}

export function animationBase(model: JsonObject): JsonObject {
  return asObject(model.b) ?? {}
}

/** Animation categories whose model has a base (`b`) member; `a3` keeps its state in the wrap. */
export function animationHasBase(kind: string): boolean {
  return kind !== "a3"
}

/** Reuse the native model's defaults, with a visible 200ms opacity change for new a1 clips. */
export function newAnimation(kind: string, id: string): JsonObject {
  const family = animationFamilyInfo(kind)
  if (!family) throw new Error("不支持的动画类型")
  const entries: Record<string, string> = { CATEGORY: String(family.category) }
  if (kind === "a1") Object.assign(entries, { DURATION: "200", FROM: "255", TO: "0" })
  if (kind === "a3") Object.assign(entries, { BUILD_METHOD: "0", BUILD_NUM: "0", BUILD_LIST: "" })
  return asObject(buildAnimationWrap({ name: `ANIM${id}`, entries }))!
}

/* —— Field labels, enum choices, units —— */
const LABELS: Record<string, string> = {
  // Base model.
  t: "变化属性", count: "重复次数", back: "自动往返", clear: "结束后移除",
  // a1.
  style: "插值曲线", duration: "持续时间", delay: "延迟时间",
  from: "起始值", to: "结束值", from_p: "起始比例", to_p: "结束比例",
  from_px: "起始位移", to_px: "结束位移", pp: "变换中心", pxp: "变换中心（像素）",
  // af2 / a10.
  type: "帧修改方式", file: "图片序列", d: "播放时长", l: "显示层级", r: "作用区域",
  pos: "画面偏移", psr: "三段播放速率", rr: "空闲时恢复", pm: "路径模式", rm: "中断方式",
  sp: "起始位置", rp: "恢复位置", sd: "启动延迟", iri: "空闲恢复间隔", fs: "跟随速度",
  // a4.
  rate: "发射速率", clean: "结束后清理", remove: "清理发射物", m_up: "镜像方向",
  aera: "发射区域", use_touch: "跟随触摸", i_p: "粒子图片", paths: "粒子路径",
  life: "寿命范围", rotation: "初始旋转", spin: "旋转速度", scale: "初始缩放",
  s_scale: "缩放速度", alpha: "初始透明度", s_alpha: "透明度速度", velocity: "初速度",
  v_direction: "速度方向", acceleration: "加速度", a_direction: "加速度方向",
  // a11.
  g: "重力", v: "初速度", a_vel: "角速度", dir: "方向", rest: "反弹系数", fric: "摩擦系数",
  resist: "空气阻力", a_resist: "角阻力", region: "作用区域", launch_point: "发射位置",
  collision_rect: "碰撞区域",
  // a12.
  surface_color: "液体颜色", wave_color: "波浪颜色", highlight_color: "高光颜色",
  body_alpha: "液体透明度", fill: "液面比例", tilt_enabled: "响应倾斜",
  tilt_sensitivity: "倾斜灵敏度", sensor_filter_ms: "传感器滤波", dead_zone_deg: "死区角度",
  hysteresis_deg: "回差角度", max_angle_deg: "最大倾角", tilt_response_ms: "倾斜响应",
  samples: "采样数量", spring: "弹簧强度", damping: "阻尼", coupling: "波浪耦合",
  max_wave: "最大波幅", impulse: "触摸冲量", tilt_slosh_gain: "倾斜晃动增益",
  gravity: "液体重力",
  // a13.
  assetDir: "资源目录", loopPattern: "循环帧模板", jumpStartPattern: "跳跃开始模板",
  jumpApexPattern: "跳跃顶点模板", jumpFallPattern: "跳跃下落模板", waveDelayMs: "波浪延迟",
  jumpDurationMs: "跳跃时长", jumpHeightRatio: "跳跃高度比例", itemSizeDp: "物件大小",
  rowWidthRatio: "物件行宽比例", bottomMarginDp: "底部边距",
  // a14.
  backgroundPath: "背景图片", backgroundAnimationPath: "背景动画", idleRabbitPath: "静止兔子",
  runningRabbitPath: "奔跑兔子", crazyRabbitPath: "疯狂兔子", brakingRabbitPath: "刹停兔子",
  fallingPattern: "掉落物模板", fallingCount: "掉落物数量", backgroundHeightPx: "背景高度",
  rabbitSizePx: "兔子大小", rabbitCenterXRatio: "兔子横向比例", rabbitBottomMarginPx: "兔子底边距",
  typingWindowMs: "输入窗口", crazyThreshold: "疯狂阈值", stopToBrakeDelayMs: "刹停延迟",
  brakeDurationMs: "刹停时长", backgroundFlashMs: "背景闪烁时长", fallDurationMs: "掉落时长",
  fallDistancePx: "掉落距离", fallStartOffsetPx: "掉落起点偏移", fallSpreadPx: "掉落分散范围",
  fallSizePx: "掉落物大小",
  // a3.
  a_method: "组合方式", animations: "子动画列表",
  // a12 floaters.
  mode: "运动方式", mass: "质量", drag: "阻力", immersion: "浸没深度",
  downhill: "下坡加速度", max_speed: "最大速度", edge_rest: "边缘反弹",
  rotation_follow: "旋转跟随", swim_speed: "游动速度", swim_range: "游动范围",
  swim_pause: "游动停顿", flip: "允许翻转", anchor_x: "锚点横向", anchor_y: "锚点纵向",
  wave_suppression: "波浪抑制", wave_reflection: "波浪反射", ride: "搭载对象",
}

const SELECTS: Record<string, AnimationOption[]> = {
  t: [["0", "透明度"], ["1", "旋转"], ["2", "位移"], ["3", "缩放"]],
  style: [["0", "线性"], ["1", "缓入"], ["2", "缓出"], ["3", "平滑"], ["4", "弹跳"]],
  type: [["0", "模式 0"], ["1", "模式 1"], ["2", "模式 2"]],
  a_method: [["simultaneous", "同时"], ["sequential", "顺序"], ["random", "随机"]],
  pm: [["0", "模式 0"], ["1", "模式 1"], ["2", "模式 2"], ["3", "模式 3（默认）"]],
  rm: [["0", "模式 0"], ["1", "模式 1（默认）"]],
  l: [["0", "下层"], ["1", "上层"]],
  m_up: [["0", "关闭（0）"], ["1", "开启（1）"]],
  mode: [["0", "模式 0"], ["1", "模式 1"], ["2", "模式 2"]],
  r: [0, 1, 2, 3, 4].map((value) => [String(value), `区域 ${value}`]),
}

// The runtime default when the key is absent; `l` (LEVEL) notably defaults to 上层, not 下层.
const SELECT_DEFAULTS: Record<string, string> = {
  t: "0", style: "0", type: "0", a_method: "simultaneous", pm: "3", rm: "1", l: "1", m_up: "0", mode: "0",
}

const UNITS: Record<string, string> = {
  duration: "ms", delay: "ms", d: "ms", sd: "ms", iri: "ms", sensor_filter_ms: "ms",
  tilt_response_ms: "ms", waveDelayMs: "ms", jumpDurationMs: "ms", typingWindowMs: "ms",
  stopToBrakeDelayMs: "ms", brakeDurationMs: "ms", backgroundFlashMs: "ms", fallDurationMs: "ms",
  backgroundHeightPx: "px", rabbitSizePx: "px", rabbitBottomMarginPx: "px", fallDistancePx: "px",
  fallStartOffsetPx: "px", fallSpreadPx: "px", fallSizePx: "px", itemSizeDp: "dp", bottomMarginDp: "dp",
  fill: "×", jumpHeightRatio: "×", rowWidthRatio: "×", rabbitCenterXRatio: "×",
  tilt_sensitivity: "×", rotation_follow: "×",
}

/** A field row; enum fields get their choices and numeric rows their unit from the shared tables. */
function field(key: string, kind: AnimationFieldKind, overrides: Partial<AnimationField> = {}): AnimationField {
  return {
    key,
    label: overrides.label ?? LABELS[key] ?? key,
    kind,
    ...kind === "select" && SELECTS[key] ? { options: SELECTS[key] } : {},
    ...kind === "select" && SELECT_DEFAULTS[key] !== undefined ? { defaultValue: SELECT_DEFAULTS[key] } : {},
    ...kind === "number" && UNITS[key] !== undefined ? { unit: UNITS[key] } : {},
    ...kind === "bool" ? { defaultValue: key === "tilt_enabled" || key === "flip" ? "true" : "false" } : {},
    ...overrides,
  }
}

/** A group entry; its keys follow ANIMATION_FIELDS (the fields Palm reads) so nothing can silently drop. */
function group(title: string, keys: Array<[key: string, kind: AnimationFieldKind]>): AnimationGroup {
  return { title, fields: keys.map(([key, kind]) => field(key, kind)) }
}

function baseField(key: string, kind: AnimationFieldKind): AnimationField {
  return field(key, kind, { scope: "base" })
}

/** 时间与循环: the family's own timing first, then the repeat / reverse / remove every base model owns. */
function timing(keys: Array<[key: string, kind: AnimationFieldKind]> = []): AnimationGroup {
  return { title: "时间与循环", fields: [...keys.map(([key, kind]) => field(key, kind)), baseField("count", "number"), baseField("back", "bool"), baseField("clear", "bool")] }
}

/** Pivots only move rotations and scales; a translation or fade keeps them only when already set. */
function usesPivot(model: JsonObject): boolean {
  const type = Number(animationBase(model).t ?? 0)
  return type === 1 || a1IsScale(model) || model.pp !== undefined || model.pxp !== undefined
}

const FAMILY_GROUPS: Record<string, (model: JsonObject) => AnimationGroup[]> = {
  a1: (model) => {
    const variant = a1Variant(model)
    const pair = variant === "scalar"
      ? [["from", "number"], ["to", "number"]] as Array<[string, AnimationFieldKind]>
      : variant === "pixels"
        ? [["from_px", "point"], ["to_px", "point"]] as Array<[string, AnimationFieldKind]>
        : [["from_p", "point"], ["to_p", "point"]] as Array<[string, AnimationFieldKind]>
    const labels: Record<string, string> = variant === "pixels"
      ? { from_px: "起始位移（px）", to_px: "结束位移（px）" }
      : a1IsScale(model) ? { from_p: "起始缩放（%）", to_p: "结束缩放（%）" } : {}
    return [
      { title: "变化", fields: [baseField("t", "select"), ...pair.map(([key, kind]) => field(key, kind, labels[key] ? { label: labels[key] } : {}))] },
      timing([["duration", "number"], ["delay", "number"], ["style", "select"]]),
      ...usesPivot(model) ? [group("变换中心", [["pp", "point"], ["pxp", "point"]])] : [],
    ]
  },
  a3: () => [],
  af2: () => [
    group("帧资源", [["type", "select"], ["file", "text"], ["psr", "list"]]),
    timing([["d", "number"], ["delay", "number"]]),
    group("位置与层级", [["r", "select"], ["pos", "point"], ["l", "select"]]),
  ],
  a4: () => [
    group("发射", [["rate", "number"], ["count", "number"], ["aera", "rect"], ["i_p", "list"], ["paths", "list"],
      ["use_touch", "bool"], ["m_up", "select"]]),
    group("运动", [["life", "point"], ["velocity", "point"], ["v_direction", "point"],
      ["acceleration", "point"], ["a_direction", "point"]]),
    group("外观", [["rotation", "point"], ["spin", "point"], ["scale", "point"],
      ["s_scale", "point"], ["alpha", "point"], ["s_alpha", "point"]]),
    timing([["duration", "number"], ["delay", "number"], ["clean", "bool"], ["remove", "bool"]]),
  ],
  a10: () => [
    group("路径", [["file", "text"], ["sp", "point"], ["rp", "point"], ["pm", "select"], ["rm", "select"], ["fs", "number"]]),
    timing([["d", "number"], ["sd", "number"], ["iri", "number"], ["rr", "bool"]]),
    group("层级", [["l", "select"], ["r", "select"]]),
  ],
  a11: () => [
    group("物理参数", [["g", "number"], ["v", "point"], ["a_vel", "number"], ["dir", "point"],
      ["rest", "number"], ["fric", "number"], ["resist", "number"], ["a_resist", "number"],
      ["use_touch", "bool"], ["region", "number"]]),
    group("碰撞区域", [["collision_rect", "rect"]]),
    group("资源与位置", [["file", "text"], ["launch_point", "point"], ["l", "select"]]),
    timing([["duration", "number"], ["delay", "number"]]),
  ],
  a12: () => [
    group("液体外观", [["surface_color", "color"], ["wave_color", "color"],
      ["highlight_color", "color"], ["body_alpha", "number"], ["fill", "number"]]),
    group("传感器", [["tilt_enabled", "bool"], ["tilt_sensitivity", "number"],
      ["sensor_filter_ms", "number"], ["dead_zone_deg", "number"], ["hysteresis_deg", "number"],
      ["max_angle_deg", "number"], ["tilt_response_ms", "number"]]),
    group("波浪物理", [["samples", "number"], ["spring", "number"], ["damping", "number"],
      ["coupling", "number"], ["max_wave", "number"], ["impulse", "number"],
      ["tilt_slosh_gain", "number"], ["gravity", "number"]]),
    group("层级", [["l", "select"]]),
    timing(),
  ],
  a13: () => [
    group("资源", [["count", "number"], ["assetDir", "text"], ["loopPattern", "text"],
      ["jumpStartPattern", "text"], ["jumpApexPattern", "text"], ["jumpFallPattern", "text"]]),
    group("跳跃布局", [["waveDelayMs", "number"], ["jumpDurationMs", "number"],
      ["jumpHeightRatio", "number"], ["itemSizeDp", "number"], ["rowWidthRatio", "number"],
      ["bottomMarginDp", "number"]]),
    group("层级", [["l", "select"]]),
    timing(),
  ],
  a14: () => [
    group("资源", [["backgroundPath", "text"], ["backgroundAnimationPath", "text"],
      ["idleRabbitPath", "text"], ["runningRabbitPath", "text"], ["crazyRabbitPath", "text"],
      ["brakingRabbitPath", "text"], ["fallingPattern", "text"], ["fallingCount", "number"]]),
    group("布局与节奏", [["backgroundHeightPx", "number"], ["rabbitSizePx", "number"],
      ["rabbitCenterXRatio", "number"], ["rabbitBottomMarginPx", "number"]]),
    group("状态节奏", [["typingWindowMs", "number"], ["crazyThreshold", "number"],
      ["stopToBrakeDelayMs", "number"], ["brakeDurationMs", "number"]]),
    group("掉落物", [["backgroundFlashMs", "number"], ["fallDurationMs", "number"],
      ["fallDistancePx", "number"], ["fallStartOffsetPx", "number"], ["fallSpreadPx", "number"],
      ["fallSizePx", "number"]]),
    timing(),
  ],
}

// `count` means different things per family: the base model's repeat count, a4's particle count
// and a13's item count all share the key.
const FAMILY_LABELS: Record<string, Record<string, string>> = {
  a4: { count: "粒子总数" },
  a13: { count: "物件数量" },
}

/**
 * The parameter sections of one animation, in the inspector's order: what changes, then timing and
 * repetition (with the base model's playback fields), then where and how it is drawn.
 */
export function animationGroups(kind: string, model: JsonObject): AnimationGroup[] {
  const groups = FAMILY_GROUPS[kind]?.(model) ?? []
  const labels = FAMILY_LABELS[kind] ?? {}
  for (const item of groups) {
    for (const entry of item.fields) {
      if (entry.scope === "base") continue
      entry.label = labels[entry.key] ?? entry.label
      if (kind === "a4" && entry.kind === "point") entry.axes = ["最小", "最大"]
    }
  }
  if (kind === "a4") groups.flatMap((item) => item.fields).find((entry) => entry.scope === "base" && entry.key === "clear")!.defaultValue = "true"
  return groups
}

export function animationFieldKeys(kind: string, model: JsonObject = {}): string[] {
  return animationGroups(kind, model).flatMap((item) => item.fields.map((entry) => entry.key))
}

/** Every field key Palm reads for a family, for coverage tests. `a1` differs by its transform variant. */
export function knownFieldKeys(kind: string): string[] {
  return (ANIMATION_FIELDS[kind] ?? []).map(([key]) => key)
}

/* —— a1: one model, three spellings of "from/to" —— */
export type A1Variant = "scalar" | "point" | "pixels"

export function a1IsScale(model: JsonObject): boolean {
  const type = Number(animationBase(model).t ?? 0)
  return type !== 0 && type !== 1 && type !== 2
}

export function a1Variant(model: JsonObject): A1Variant {
  const type = Number(animationBase(model).t ?? 0)
  if (type === 0 || type === 1) return "scalar"
  if (type === 2) return model.from_px !== undefined || model.to_px !== undefined ? "pixels" : "point"
  return "point"
}

function point(value: Json): [number, number] | undefined {
  return Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "number")
    ? [value[0], value[1]]
    : undefined
}

function finite(value: Json): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export type AnimationPatch = { set: Array<[path: string[], value: Json]>; remove: string[] }

function scalarDefaults(type: number): { from: number; to: number } {
  return type === 0 ? { from: 255, to: 0 } : type === 1 ? { from: 0, to: 90 } : { from: 0, to: 1 }
}

function pointDefaults(type: number): { from: [number, number]; to: [number, number] } {
  return type === 2 ? { from: [0, 0], to: [0, 0] } : { from: [100, 100], to: [90, 90] }
}

/**
 * Switching `变化属性` rewrites `from/to` in the spelling the new type uses and drops the others: scalar
 * `from`, percent point `from_p` and pixel `from_px` are read from the same wrap, so leaving two
 * spellings would let one stand in for the other.
 */
export function a1TypePatch(model: JsonObject, nextType: number): AnimationPatch {
  const variant = a1Variant(model)
  const target: A1Variant = nextType === 0 || nextType === 1 ? "scalar"
    : nextType === 2 && variant === "pixels" ? "pixels" : "point"
  const remove = ["from", "to", "from_p", "to_p", "from_px", "to_px"]
    .filter((key) => target === "scalar" ? key.includes("_") : target === "pixels" ? !key.endsWith("_px") : key !== "from_p" && key !== "to_p")
  const set: Array<[string[], Json]> = [[["b", "t"], nextType]]
  if (target === "scalar") {
    const defaults = scalarDefaults(nextType)
    const values = variant === "scalar"
      ? { from: finite(model.from) ?? defaults.from, to: finite(model.to) ?? defaults.to }
      : defaults
    set.push([["from"], values.from], [["to"], values.to])
  } else if (target === "pixels") {
    const defaults = pointDefaults(2)
    set.push([["from_px"], point(model.from_px) ?? point(model.from_p) ?? defaults.from],
      [["to_px"], point(model.to_px) ?? point(model.to_p) ?? defaults.to])
  } else {
    const defaults = pointDefaults(nextType)
    set.push([["from_p"], point(model.from_p) ?? point(model.from_px) ?? defaults.from],
      [["to_p"], point(model.to_p) ?? point(model.to_px) ?? defaults.to])
  }
  return { set, remove }
}

/** `位移` (type 2) can be written as a share of the key or as pixels; switching moves the values. */
export function a1UnitPatch(model: JsonObject, unit: "percent" | "pixels"): AnimationPatch | undefined {
  if (Number(animationBase(model).t) !== 2) return
  if (a1Variant(model) !== "point" && a1Variant(model) !== "pixels") return
  if (unit === "pixels") {
    return {
      set: [
        [["from_px"], point(model.from_px) ?? point(model.from_p) ?? [0, 0]],
        [["to_px"], point(model.to_px) ?? point(model.to_p) ?? [0, 0]],
      ],
      remove: ["from_p", "to_p"],
    }
  }
  return {
    set: [
      [["from_p"], point(model.from_p) ?? point(model.from_px) ?? [0, 0]],
      [["to_p"], point(model.to_p) ?? point(model.to_px) ?? [0, 0]],
    ],
    remove: ["from_px", "to_px"],
  }
}

/* —— Timeline —— */
export type AnimationTimeline = {
  delay: number
  /** Undefined for effects that keep running while the skin is shown. */
  duration?: number
  /** Full active span including repetitions and reverse passes; absent when unknown or infinite. */
  totalDuration?: number
  unknown?: boolean
  continuous: boolean
  repeatText: string
  reverse: boolean
  clear: boolean
}

function durationOf(kind: string, model: JsonObject): number | undefined {
  const span = (value: Json) => finite(value)
  switch (kind) {
    case "a1": return span(model.duration)
    case "af2": return span(model.d)
    case "a4": return span(model.duration)
    case "a10": return span(model.d)
    case "a11": return span(model.duration)
    case "a13": {
      const jump = finite(model.jumpDurationMs) ?? 620
      const wave = finite(model.waveDelayMs) ?? 80
      const items = finite(model.count) ?? 7
      return jump + wave * Math.max(0, items - 1)
    }
    default: return undefined
  }
}

function repeatTextOf(model: JsonObject): string {
  const count = finite(animationBase(model).count) ?? 1
  if (count >= 2 ** 31) return "无限循环"
  return count > 1 ? `重复 ${count} 次` : "播放一次"
}

/** Delay, duration and repetition as the timeline draws them; `a3` sums the clips it composes. */
export function animationTimeline(kind: string, model: JsonObject, animations?: JsonObject, depth = 0): AnimationTimeline {
  const base = animationBase(model)
  if (depth > 8) {
    // A hand-edited combination can reference itself; stop rather than recursing forever.
    return { delay: 0, duration: undefined, continuous: true, repeatText: repeatTextOf(model), reverse: base.back === true, clear: base.clear === true }
  }
  const delay = (finite(model.delay) ?? finite(model.sd) ?? 0) + (kind === "a1" ? finite(model.c_delay) ?? 0 : 0)
  const reverse = base.back === true
  const clear = base.clear === true
  if (kind === "a3") {
    const entries = comboAnimations(model).map((id) => asObject(animations?.[String(id)]))
    const clips = entries.map((wrap) => wrap && animationModel(wrap)).filter((entry): entry is { kind: string; model: JsonObject } => Boolean(entry))
    const parts = clips.map((entry) => animationTimeline(entry.kind, entry.model, animations, depth + 1))
    const continuous = parts.some((part) => part.continuous)
    const known = clips.length > 0 && clips.length === entries.length && parts.every((part) => part.totalDuration !== undefined)
    const duration = known ? model.a_method === "sequential"
      ? parts.reduce((sum, part) => sum + part.delay + part.totalDuration!, 0)
      : Math.max(...parts.map((part) => part.delay + part.totalDuration!)) : undefined
    return { delay: 0, duration, totalDuration: duration, continuous, unknown: !continuous && !known, repeatText: "由子动画决定", reverse, clear }
  }
  const duration = durationOf(kind, model)
  const count = finite(base.count) ?? 1
  const continuous = kind === "a12" || kind === "a14" || count >= 2 ** 31
  return {
    delay, duration,
    totalDuration: !continuous && duration !== undefined ? duration * Math.max(1, count) * (reverse ? 2 : 1) : undefined,
    continuous, unknown: !continuous && duration === undefined,
    repeatText: repeatTextOf(model), reverse, clear,
  }
}

/** Animations that can be appended to `id`'s combination without making it reference itself. */
export function addableComboIds(animations: JsonObject, id: string): string[] {
  const reaches = (candidate: string, seen: Set<string>): boolean => {
    if (seen.has(candidate)) return false
    seen.add(candidate)
    const group = asObject(asObject(animations[candidate])?.a3)
    if (!group) return false
    return comboAnimations(group).some((child) => String(child) === id || reaches(String(child), seen))
  }
  return Object.keys(animations)
    .filter((candidate) => candidate !== id && !reaches(candidate, new Set()))
    .sort((left, right) => Number(left) - Number(right) || left.localeCompare(right))
}

/* —— a3 combination —— */
export function comboAnimations(model: JsonObject): number[] {
  return Array.isArray(model.animations)
    ? model.animations.filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item >= 0)
    : []
}

export function comboMethod(model: JsonObject): "simultaneous" | "sequential" | "random" {
  return model.a_method === "sequential" ? "sequential" : model.a_method === "random" ? "random" : "simultaneous"
}

/* —— a12 floaters —— */
export function floaterFields(): AnimationField[] {
  const labels: Record<string, string> = { file: "图片文件", mode: "运动模式" }
  return FLOATER_FIELDS.map(([key, , kind]) => {
    const fieldKind: AnimationFieldKind = kind === "bool" ? "bool" : kind === "point" ? "point" : kind === "string" ? "text" : "number"
    return field(key, key === "mode" ? "select" : fieldKind, {
      label: labels[key] ?? LABELS[key] ?? key,
      ...key === "swim_range" || key === "swim_pause" ? { axes: ["最小", "最大"] as [string, string] } : {},
    })
  })
}

export function floaterKeys(): string[] {
  return FLOATER_FIELDS.map(([key]) => key)
}

/** The floater `SkinPhysicalWaterAnimationModel` creates when a skin lists one without a value. */
export function floaterDefaults(): JsonObject {
  return {
    file: "", mode: 0, mass: 1, delay: 0, v: [0, -180], drag: 1.8, immersion: 8, downhill: 180,
    max_speed: 180, edge_rest: 0.25, rotation_follow: 0.65, swim_speed: 40, swim_range: [0.1, 0.9],
    swim_pause: [1000, 3000], flip: true, anchor_x: 0.5, anchor_y: -5, wave_suppression: 0.3,
    wave_reflection: 0.2,
  }
}

/* —— References (shown as context in the inspector) —— */
const ANIMATION_EVENTS: Array<[string, string]> = [["1", "按下"], ["2", "松开"], ["3", "显示"], ["4", "隐藏"], ["5", "长按"]]

export type AnimationReferences = { styles: Array<{ name: string; events: string[] }>; combos: number[]; contexts?: string[] }

/** Which text styles play animation `id` (`ss_1.*.s_5`) and which combinations list it. */
export function animationReferences(skin: JsonObject, tablePointer: ReadonlyArray<string | number>, id: string): AnimationReferences {
  const theme = asObject(skin[String(tablePointer[0])]) ?? {}
  const scope = String(tablePointer[1])
  const shared = asObject(theme.s_info) ?? {}
  const styles: AnimationReferences["styles"] = []
  const combos = new Set<number>()
  const contexts: string[] = []
  const scopes = scope === "s_info" ? ["s_info", "s_port", "s_land"] : [scope]
  for (const key of scopes) {
    const local = asObject(theme[key]) ?? {}
    if (key !== "s_info" && scope === "s_info" && asObject(local.ss_2)?.[id] !== undefined) continue
    const label = key === "s_port" ? "竖屏 · " : key === "s_land" ? "横屏 · " : ""
    const table = { ...asObject(shared.ss_1), ...asObject(local.ss_1) }
    for (const [styleID, style] of Object.entries(table)) {
      const bindings = asObject(asObject(style)?.s_5)
      const events = ANIMATION_EVENTS.filter(([event]) => bindings?.[event] !== undefined && String(bindings[event]) === id).map(([, name]) => name)
      if (!events.length) continue
      const name = `样式 ${styleID}`
      if (key === "s_info" || scope !== "s_info") styles.push({ name, events })
      else if (!styles.some((item) => item.name === name && item.events.join() === events.join())) styles.push({ name: `${label}${name}`, events })
    }
    const animations = { ...asObject(shared.ss_2), ...asObject(local.ss_2) }
    for (const [animationID, wrap] of Object.entries(animations)) {
      const group = asObject(asObject(wrap)?.a3)
      if (!group || !comboAnimations(group).some((child) => String(child) === id)) continue
      combos.add(Number(animationID))
      if (scope === "s_info" && key !== "s_info" && asObject(local.ss_2)?.[animationID] !== undefined) contexts.push(`${label}动画 ${animationID}`)
    }
  }
  return { styles, combos: [...combos], ...contexts.length ? { contexts } : {} }
}

/** `b.c` should name the family; skins edited by hand can carry a stale category. */
export function baseNeedsFix(kind: string, model: JsonObject): boolean {
  const category = animationFamilyInfo(kind)?.category
  return animationHasBase(kind) && category !== undefined && Number(animationBase(model).c) !== category
}
