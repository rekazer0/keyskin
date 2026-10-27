// BDA 新版皮肤（protobuf animationConfig）到旧版百度皮肤 anim.ini 的动效转换。
//
// 旧版 anim.ini 的字段语义见官方手册《百度手机输入法皮肤教程 V6》第 169–185 页：
// [ANIM*] 里是基础动效（TYPE 0 透明度 / 1 旋转 / 2 平移 / 3 缩放目标区域 / 4 整体缩放）、
// 组合动效（BUILD_NUM / BUILD_LIST / BUILD_METHOD）、帧动效（CATEGORY=2 + ANIM_PATH）或
// 粒子动效（CATEGORY=3 + 发射/运动/外观参数）。引用方是 default.css 的 [STYLE*] 上的
// PRESS_ANIM / RELEASE_ANIM / SHOW_ANIM / HIDE_ANIM，所以这里只产动画定义和“目标→动效”的绑定，
// 写到哪些样式由 bda-convert 按 BDA 的 target / scope 解析。

import type {
  BdaAnimation,
  BdaAnimationEffect,
  BdaNumberRange,
  BdaResource,
  BdaResourceAnimation,
  BdaTransformAnimation,
} from "./bda.ts"

type LegacySection = Record<string, string>

/** BDA 绑定到旧版 CSS 的字段：按下 / 抬起 / 出现 / 消失。 */
export type LegacyStyleProp = "PRESS_ANIM" | "RELEASE_ANIM" | "SHOW_ANIM" | "HIDE_ANIM"

export type LegacyMotionBinding = {
  target: string
  event: number
  scope: number
  animation: number
}

export type LegacyMotion = {
  sections: Map<number, LegacySection>
  bindings: LegacyMotionBinding[]
  warnings: string[]
}

export type LegacyMotionResources = {
  /** 设备是否支持 FROM/TO 的 rand(a,b) 随机写法（Android 7.0+）；iOS 用区间中点。 */
  randomize?: boolean
  /** 粒子图片转成旧版 [STYLE*] 图片样式，返回样式编号；不支持的资源返回 undefined。 */
  imageStyle?: (resource: BdaResource) => number | undefined
  /** 帧动效资源（GIF）复制到输出包，返回 ANIM_PATH 用的文件名。 */
  animationPath?: (resource: BdaResource) => string | undefined
}

const EVENT_LABELS: Record<number, string> = {
  0: "键盘显示",
  1: "按下",
  2: "抬起",
  3: "元素显示",
  4: "元素隐藏",
  5: "空闲进入",
  6: "空闲退出",
  7: "长按",
  8: "输入文字",
  9: "切换皮肤",
}

/** 旧版 CSS 动画字段；EventType 里没有对应字段的事件返回 undefined。 */
export function legacyStyleProp(event: number): LegacyStyleProp | undefined {
  if (event === 1) return "PRESS_ANIM"
  if (event === 2) return "RELEASE_ANIM"
  if (event === 0 || event === 3) return "SHOW_ANIM"
  if (event === 4) return "HIDE_ANIM"
}

function legacyNumber(value: number): string {
  return String(Math.round(value))
}

/** BDA 的随机范围 [min,max] 转旧版 FROM/TO：支持随机的设备写 rand(a,b)，否则取中点。 */
function legacyValue(range: BdaNumberRange, randomize: boolean): string {
  const min = Math.round(range[0])
  const max = Math.round(range[1])
  if (min === max) return String(min)
  return randomize ? `rand(${min},${max})` : String(Math.round((min + max) / 2))
}

function legacyPair(x: BdaNumberRange, y: BdaNumberRange, randomize: boolean): string {
  return `${legacyValue(x, randomize)},${legacyValue(y, randomize)}`
}

function legacyFloat(value: number): string {
  return String(Math.round(value * 100) / 100)
}

export function buildLegacyMotion(animation: BdaAnimation, resources: LegacyMotionResources = {}): LegacyMotion {
  const sections = new Map<number, LegacySection>()
  const bindings: LegacyMotionBinding[] = []
  const warnings = new Set<string>()
  const converted = new Map<string, number | undefined>()
  let nextId = 1

  const warn = (message: string) => warnings.add(message)
  const randomize = resources.randomize !== false
  const addSection = (entries: LegacySection): number => {
    const id = nextId++
    sections.set(id, entries)
    return id
  }
  const commonTransform = (effect: BdaTransformAnimation, type: string): LegacySection => {
    const entries: LegacySection = { TYPE: type, DURATION: legacyNumber(Math.max(0, effect.duration)) }
    if (effect.delay > 0) entries.DELAY = legacyNumber(effect.delay)
    const repeat = Math.max(1, effect.repeatCount)
    if (repeat !== 1) entries.REPEAT_CNT = legacyNumber(repeat)
    if (effect.repeatMode) entries.REPEAT_MODE = "1"
    if (effect.interpolationXY) entries.INTPOL = `${legacyNumber(effect.interpolationXY[0])},${legacyNumber(effect.interpolationXY[1])}`
    else if (effect.interpolation) entries.INTPOL = legacyNumber(effect.interpolation)
    entries.REMOVE = effect.removeOnFinish ? "1" : "0"
    return entries
  }
  const addPivot = (entries: LegacySection, effect: BdaTransformAnimation) => {
    if (effect.pivotPx) entries.PIVOT_PX = `${legacyNumber(effect.pivotPx[0])},${legacyNumber(effect.pivotPx[1])}`
    else if (effect.pivot) entries.PIVOT = `${legacyNumber(effect.pivot[0])},${legacyNumber(effect.pivot[1])}`
  }

  const convertTransform = (effect: BdaTransformAnimation): number => {
    if (effect.kind === "alpha") {
      const entries = commonTransform(effect, "0")
      entries.FROM = legacyValue(effect.from[0], randomize)
      entries.TO = legacyValue(effect.to[0], randomize)
      return addSection(entries)
    }
    if (effect.kind === "rotate") {
      const entries = commonTransform(effect, "1")
      entries.FROM = legacyValue(effect.from[0], randomize)
      entries.TO = legacyValue(effect.to[0], randomize)
      addPivot(entries, effect)
      return addSection(entries)
    }
    if (effect.kind === "scale") {
      const entries = commonTransform(effect, "4")
      entries.FROM = legacyPair(effect.from[0], effect.from[1], randomize)
      entries.TO = legacyPair(effect.to[0], effect.to[1], randomize)
      addPivot(entries, effect)
      return addSection(entries)
    }
    const entries = commonTransform(effect, "2")
    if (effect.relative) {
      entries.FROM = legacyPair(effect.from[0], effect.from[1], randomize)
      entries.TO = legacyPair(effect.to[0], effect.to[1], randomize)
    } else {
      entries.FROM_PX = legacyPair(effect.from[0], effect.from[1], randomize)
      entries.TO_PX = legacyPair(effect.to[0], effect.to[1], randomize)
    }
    return addSection(entries)
  }

  const convertEmitter = (effect: Extract<BdaAnimationEffect, { kind: "emitter" }>): number | undefined => {
    const images = effect.resources.flatMap((resource) => {
      const style = resources.imageStyle?.(resource)
      return style === undefined ? [] : [style]
    })
    if (!images.length) {
      warn("粒子动效的图片资源无法转成旧版样式，已跳过该动效")
      return
    }
    const region = effect.emitRegion.every((value) => value === 0) ? [0, 0, 1, 1] as const : effect.emitRegion
    const entries: LegacySection = {
      CATEGORY: "3",
      TYPE: "0",
      LIFE: `${legacyNumber(effect.life[0])},${legacyNumber(effect.life[1])}`,
      EMIT_REGION: region.map(legacyFloat).join(","),
      TOTAL_NUMBER: legacyNumber(Math.max(1, effect.totalNumber)),
      BIRTH_RATE: legacyNumber(Math.max(0.1, effect.birthRate)),
      PARTICLE_IMAGE: images.join(","),
      VELOCITY: `${legacyFloat(effect.velocity[0])},${legacyFloat(effect.velocity[1])}`,
      VELOCITY_DIRECTION: `${legacyFloat(effect.velocityDirection[0])},${legacyFloat(effect.velocityDirection[1])}`,
      ACCELERATION: `${legacyFloat(effect.acceleration[0])},${legacyFloat(effect.acceleration[1])}`,
      ACCELERATION_DIRECTION: `${legacyFloat(effect.accelerationDirection[0])},${legacyFloat(effect.accelerationDirection[1])}`,
      INIT_SCALE: `${legacyFloat(effect.scale[0])},${legacyFloat(effect.scale[1])}`,
      SCALE_SPEED: `${legacyFloat(effect.scaleSpeed[0])},${legacyFloat(effect.scaleSpeed[1])}`,
      INIT_ROTATE: `${legacyFloat(effect.rotation[0])},${legacyFloat(effect.rotation[1])}`,
      ROTATE_SPEED: `${legacyFloat(effect.spin[0])},${legacyFloat(effect.spin[1])}`,
      INIT_ALPHA: `${legacyNumber(effect.alpha[0])},${legacyNumber(effect.alpha[1])}`,
      ALPHA_SPEED: `${legacyNumber(effect.alphaSpeed[0])},${legacyNumber(effect.alphaSpeed[1])}`,
    }
    entries.FINISH_AFTER_PRACTICES = legacyNumber(effect.finishAfterPractices)
    entries.REMOVE_INCLUDE_PRACTICES = legacyNumber(effect.keepParticlesOnRemove)
    entries.MIRROR_UP = legacyNumber(effect.mirrorUp)
    if (effect.emitterType) entries.TYPE = legacyNumber(effect.emitterType)
    if (effect.paths.length) warn("粒子路径（PARTICLE_PATH）旧版格式不同，已跳过路径只保留发射参数")
    if (effect.duration > 0) entries.DURATION = legacyNumber(effect.duration * 1000)
    const repeat = Math.max(1, effect.repeatCount)
    if (repeat !== 1) entries.REPEAT_CNT = legacyNumber(repeat)
    if (effect.repeatMode) entries.REPEAT_MODE = "1"
    if (effect.removeOnFinish) entries.REMOVE = "1"
    return addSection(entries)
  }

  const convertFrame = (effect: BdaResourceAnimation): number | undefined => {
    if (!effect.resource) {
      warn("帧动效缺少资源，已跳过")
      return
    }
    const path = resources.animationPath?.(effect.resource)
    if (!path) {
      warn("帧动效资源不是旧版支持的 GIF/图片序列文件，已跳过")
      return
    }
    return addSection({ CATEGORY: "2", ANIM_PATH: path })
  }

  const convertEffect = (effectID: string): number | undefined => {
    if (converted.has(effectID)) return converted.get(effectID)
    const effect = animation.effects.get(effectID)
    let id: number | undefined
    if (!effect) {
      warn(`缺少动效定义 ${effectID}`)
    } else if (effect.kind === "alpha" || effect.kind === "rotate" || effect.kind === "shift" || effect.kind === "scale") {
      id = convertTransform(effect)
    } else if (effect.kind === "emitter") {
      id = convertEmitter(effect)
    } else if (effect.kind === "frame") {
      id = convertFrame(effect)
    } else if (effect.kind === "group") {
      const childKinds = new Set(effect.items.map((item) => item.kind))
      const children = effect.items.flatMap((item) => {
        const child = convertEffect(`${item.kind}:${item.key}`)
        return child === undefined ? [] : [child]
      })
      if (children.length > 1 && [...childKinds].some((kind) => kind !== "alpha" && kind !== "scale" && kind !== "shift" && kind !== "rotate")) {
        warn(`组合动效 ${effect.key} 含非基础动效，旧版组合动画可能不完整`)
      }
      if (effect.delay || !effect.removeOnFinish || effect.repeatCount > 1 || effect.repeatMode) {
        warn(`组合动效 ${effect.key} 的延迟/重复设置旧版无法表达，已忽略`)
      }
      if (!children.length) {
        warn(`组合动效 ${effect.key} 没有可转换的子动效`)
      } else if (children.length === 1) {
        id = children[0]
      } else {
        id = addSection({
          BUILD_NUM: String(children.length),
          BUILD_LIST: children.join(","),
          BUILD_METHOD: effect.buildMode === 1 ? "1" : "0",
        })
      }
    } else if (effect.kind === "image") {
      warn("图片序列动效需要 GIF，旧版 anim.ini 无法直接表达，已跳过")
    } else if (effect.kind === "lottie") {
      warn("Lottie 动效旧版不支持，已跳过")
    } else {
      warn("视频动效旧版不支持，已跳过")
    }
    converted.set(effectID, id)
    return id
  }

  for (const target of animation.targets) {
    const targetBindings = animation.targetBindings.get(target) ?? []
    const combined = new Map<string, number[]>()
    for (const binding of targetBindings) {
      const prop = legacyStyleProp(binding.event)
      if (!prop) {
        warn(`目标 ${target} 的「${EVENT_LABELS[binding.event] ?? `事件 ${binding.event}`}」动效旧版没有对应触发方式，已跳过`)
        continue
      }
      if (binding.condition) warn(`目标 ${target} 的动效条件「${binding.condition}」旧版无法表达，已忽略`)
      const id = convertEffect(`${binding.kind}:${binding.key}`)
      if (id === undefined) continue
      const group = `${binding.event}:${binding.scope}`
      combined.set(group, [...(combined.get(group) ?? []), id])
    }
    for (const [group, ids] of combined) {
      const [event, scope] = group.split(":").map(Number)
      const animationID = ids.length === 1 ? ids[0] : addSection({
        BUILD_NUM: String(ids.length),
        BUILD_LIST: ids.join(","),
        BUILD_METHOD: "0",
      })
      bindings.push({ target, event, scope, animation: animationID })
    }
  }

  return { sections, bindings, warnings: [...warnings] }
}

/** anim.ini 文件内容；没有可转换的动效时返回 undefined（不生成空文件）。 */
export function legacyMotionIni(motion: LegacyMotion): string | undefined {
  if (!motion.sections.size) return
  const lines = ["[GLOBAL]", `ANIM_NUM=${motion.sections.size}`, ""]
  for (const id of [...motion.sections.keys()].sort((left, right) => left - right)) {
    lines.push(`[ANIM${id}]`)
    for (const [key, value] of Object.entries(motion.sections.get(id)!)) lines.push(`${key}=${value}`)
    lines.push("")
  }
  return lines.join("\n")
}
