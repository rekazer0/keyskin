import { IniDocument } from "./ini.ts"
import { type Rect, type PreviewItem } from "./preview-items.ts"
import { type BdaAnimation, type BdaAnimationSequence, type BdaAnimationBinding, type BdaAnimationEffect, type BdaTransformAnimation, type BdaEmitterAnimation } from "./bda.ts"

export type LegacyAnimationFrame = {
  type: "opacity" | "translate" | "scale" | "rotate"
  start: number
  duration: number
  delay: number
  repeat: number
  reverse: boolean
  relative: boolean
  easing: readonly [number, number]
  from: readonly [number, number]
  to: readonly [number, number]
}

export type LegacyParticleEmitter = {
  images: string[]
  life: readonly [number, number]
  emitRegion: readonly [number, number, number, number]
  totalNumber: number
  birthRate: number
  velocity: readonly [number, number]
  velocityDirection: readonly [number, number]
  acceleration: readonly [number, number]
  accelerationDirection: readonly [number, number]
  initialScale: readonly [number, number]
  scaleSpeed: readonly [number, number]
  initialRotation: readonly [number, number]
  rotationSpeed: readonly [number, number]
  initialAlpha: readonly [number, number]
  alphaSpeed: readonly [number, number]
}

export type LegacyParticleFrame = {
  styleID: string
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
}

export type LegacyAnimationEffect = {
  frames: LegacyAnimationFrame[]
  particles: LegacyParticleEmitter[]
  parallel: boolean
}

export type LegacyAnimation = Map<string, LegacyAnimationEffect>

export function animationEasing(type: number, progress: number): number {
  if (type === 1) return progress * progress
  if (type === 2) return 1 - (1 - progress) ** 2
  if (type === 3) return Math.cos((progress + 1) * Math.PI) / 2 + 0.5
  if (type === 4) {
    const bounce = (value: number) => value * value * 8
    const value = progress * 1.1226
    if (value < 0.3535) return bounce(value)
    if (value < 0.7408) return bounce(value - 0.54719) + 0.7
    if (value < 0.9644) return bounce(value - 0.8526) + 0.9
    return bounce(value - 1.0435) + 0.95
  }
  return progress
}

export function animationDuration(frame: LegacyAnimationFrame): number {
  return frame.duration * frame.repeat * (frame.reverse ? 2 : 1)
}

/** 旧版 FROM/TO 允许 rand(a,b) 随机写法（手册第 182 页）；预览取区间中点，保持结果稳定。 */
function legacyNumbers(value: string | undefined): number[] {
  if (!value) return []
  const numbers: number[] = []
  for (const match of value.matchAll(/rand\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)|(-?\d+(?:\.\d+)?)/g)) {
    const number = match[3] === undefined
      ? (Number(match[1]) + Number(match[2])) / 2
      : Number(match[3])
    if (Number.isFinite(number)) numbers.push(number)
  }
  return numbers
}

export function scalePair(value: string | undefined): [number, number] | undefined {
  const parts = legacyNumbers(value)
  if (parts.length < 2) return
  return [parts[0] / 100, parts[1] / 100]
}

export function pixelPair(value: string | undefined): [number, number] | undefined {
  const parts = legacyNumbers(value)
  if (parts.length < 2) return
  return [parts[0], parts[1]]
}

export function opacityPair(value: string | undefined): [number, number] | undefined {
  const number = legacyNumbers(value)[0]
  if (number === undefined) return
  const opacity = Math.max(0, Math.min(1, number / 255))
  return [opacity, opacity]
}

export function scalarPair(value: string | undefined): [number, number] | undefined {
  const number = legacyNumbers(value)[0]
  return number === undefined ? undefined : [number, number]
}

export function numberRange(value: string | undefined, fallback: readonly [number, number]): [number, number] {
  const parts = legacyNumbers(value)
  return [parts[0] ?? fallback[0], parts[1] ?? parts[0] ?? fallback[1]]
}

export function parseLegacyParticleEmitter(animations: IniDocument, section: string): LegacyParticleEmitter | undefined {
  const images = (animations.get(section, "PARTICLE_IMAGE") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean)
  if (!images.length) return
  const region = (animations.get(section, "EMIT_REGION") ?? "0,0,1,1").split(",").map(Number)
  return {
    images,
    life: numberRange(animations.get(section, "LIFE"), [1000, 1000]),
    emitRegion: region.length === 4 && region.every(Number.isFinite)
      ? region as [number, number, number, number]
      : [0, 0, 1, 1],
    totalNumber: Math.max(1, Number(animations.get(section, "TOTAL_NUMBER")) || 1),
    birthRate: Math.max(0.1, Number(animations.get(section, "BIRTH_RATE")) || 1),
    velocity: numberRange(animations.get(section, "VELOCITY"), [0, 0]),
    velocityDirection: numberRange(animations.get(section, "VELOCITY_DIRECTION"), [0, 0]),
    acceleration: numberRange(animations.get(section, "ACCELERATION"), [0, 0]),
    accelerationDirection: numberRange(animations.get(section, "ACCELERATION_DIRECTION"), [90, 90]),
    initialScale: numberRange(animations.get(section, "INIT_SCALE"), [1, 1]),
    scaleSpeed: numberRange(animations.get(section, "SCALE_SPEED"), [0, 0]),
    initialRotation: numberRange(animations.get(section, "INIT_ROTATE"), [0, 0]),
    rotationSpeed: numberRange(animations.get(section, "ROTATE_SPEED"), [0, 0]),
    initialAlpha: numberRange(animations.get(section, "INIT_ALPHA"), [255, 255]),
    alphaSpeed: numberRange(animations.get(section, "ALPHA_SPEED"), [0, 0]),
  }
}

export function seededUnit(seed: number): number {
  let value = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  value = Math.imul(value ^ value >>> 13, 0xc2b2ae35)
  return ((value ^ value >>> 16) >>> 0) / 0x1_0000_0000
}

export function ranged(range: readonly [number, number], seed: number): number {
  return range[0] + (range[1] - range[0]) * seededUnit(seed)
}

export function legacyParticleFrames(
  emitter: LegacyParticleEmitter,
  elapsed: number,
  panelWidth: number,
  panelHeight: number,
): LegacyParticleFrame[] {
  // ponytail: deterministic ballistic preview; add EMIT_TYPE modes when a real skin needs distinct emitters.
  const interval = 1000 / emitter.birthRate
  const emitted = Math.min(emitter.totalNumber, Math.max(0, Math.floor(elapsed / interval)))
  const maxLife = Math.max(...emitter.life)
  const first = Math.max(0, emitted - Math.ceil(maxLife / interval) - 1)
  const normalized = emitter.emitRegion.every((value) => Math.abs(value) <= 1)
  const [regionX, regionY, regionWidth, regionHeight] = normalized
    ? [
        emitter.emitRegion[0] * panelWidth,
        emitter.emitRegion[1] * panelHeight,
        emitter.emitRegion[2] * panelWidth,
        emitter.emitRegion[3] * panelHeight,
      ]
    : emitter.emitRegion
  const result: LegacyParticleFrame[] = []
  for (let index = first; index < emitted; index++) {
    const age = elapsed - (index + 1) * interval
    const life = ranged(emitter.life, index * 17 + 1)
    if (age < 0 || age > life) continue
    const seconds = age / 1000
    const velocity = ranged(emitter.velocity, index * 17 + 2)
    const velocityDirection = ranged(emitter.velocityDirection, index * 17 + 3) * Math.PI / 180
    const acceleration = ranged(emitter.acceleration, index * 17 + 2)
    const direction = ranged(emitter.accelerationDirection, index * 17 + 3) * Math.PI / 180
    const distance = acceleration * seconds * seconds / 2
    result.push({
      styleID: emitter.images[Math.floor(seededUnit(index * 17 + 4) * emitter.images.length)],
      x: regionX + seededUnit(index * 17 + 5) * regionWidth + Math.cos(velocityDirection) * velocity * seconds + Math.cos(direction) * distance,
      y: regionY + seededUnit(index * 17 + 6) * regionHeight + Math.sin(velocityDirection) * velocity * seconds + Math.sin(direction) * distance,
      scale: Math.max(0, ranged(emitter.initialScale, index * 17 + 7) + ranged(emitter.scaleSpeed, index * 17 + 8) * seconds),
      rotation: ranged(emitter.initialRotation, index * 17 + 9) + ranged(emitter.rotationSpeed, index * 17 + 10) * seconds,
      opacity: Math.max(0, Math.min(1, (ranged(emitter.initialAlpha, index * 17 + 11) + ranged(emitter.alphaSpeed, index * 17 + 12) * seconds) / 255)),
    })
  }
  return result
}

export function parseLegacyAnimation(
  styles: IniDocument,
  animations: IniDocument,
): LegacyAnimation {
  const result: LegacyAnimation = new Map()
  for (const section of styles.sections()) {
    const styleID = section.match(/^STYLE(.+)$/)?.[1]
    const animationID = styles.get(section, "PRESS_ANIM") ?? styles.get(section, "SHOW_ANIM")
    if (!styleID || !animationID) continue
    const build = `ANIM${animationID}`
    const ids = (animations.get(build, "BUILD_LIST") ?? animationID)
      .split(",").map((value) => value.trim()).filter(Boolean)
    const parallel = animations.get(build, "BUILD_METHOD") === "0"
    let start = 0
    const particles: LegacyParticleEmitter[] = []
    const frames = ids.flatMap((id) => {
      const frame = `ANIM${id}`
      const particle = parseLegacyParticleEmitter(animations, frame)
      if (particle) {
        particles.push(particle)
        return []
      }
      const type = animations.get(frame, "TYPE")
      const fromPixels = animations.get(frame, "FROM_PX")
      const toPixels = animations.get(frame, "TO_PX")
      const from = type === "0"
        ? opacityPair(animations.get(frame, "FROM"))
        : type === "1"
          ? scalarPair(animations.get(frame, "FROM"))
        : type === "2"
          ? pixelPair(fromPixels ?? animations.get(frame, "FROM"))
          : scalePair(animations.get(frame, "FROM"))
      const to = type === "0"
        ? opacityPair(animations.get(frame, "TO"))
        : type === "1"
          ? scalarPair(animations.get(frame, "TO"))
        : type === "2"
          ? pixelPair(toPixels ?? animations.get(frame, "TO"))
          : scalePair(animations.get(frame, "TO"))
      if (!["0", "1", "2", "3", "4"].includes(type ?? "") || !from || !to) return []
      const duration = Math.max(0, Number(animations.get(frame, "DURATION")) || 0)
      const delay = Math.max(0, Number(animations.get(frame, "DELAY")) || 0)
      const repeat = Math.max(1, Number(animations.get(frame, "REPEAT_CNT")) || 1)
      const reverse = animations.get(frame, "REPEAT_MODE") === "1"
      const easingValues = (animations.get(frame, "INTPOL") ?? "0")
        .split(",").map((value) => Number(value.trim()) || 0)
      const parsed = {
        type: type === "0"
          ? "opacity" as const
          : type === "1"
            ? "rotate" as const
            : type === "2"
              ? "translate" as const
              : "scale" as const,
        start: parallel ? 0 : start,
        duration,
        delay,
        repeat,
        reverse,
        relative: type === "2" && fromPixels === undefined && toPixels === undefined,
        easing: [easingValues[0] ?? 0, easingValues[1] ?? easingValues[0] ?? 0] as const,
        from,
        to,
      }
      if (!parallel) start += delay + animationDuration(parsed)
      return [parsed]
    })
    if (frames.length || particles.length) result.set(styleID, { frames, particles, parallel })
  }
  return result
}

export function legacyAnimationPair(
  animation: LegacyAnimation | undefined,
  styleID: string | undefined,
  elapsed: number,
  type: "opacity" | "translate" | "scale" | "rotate",
  relativeSize?: Pick<Rect, "width" | "height">,
): readonly [number, number] | undefined {
  const effect = styleID ? animation?.get(styleID) : undefined
  const frames = effect?.frames
  if (!frames?.length) return
  const total = Math.max(...frames.map((frame) => frame.start + frame.delay + animationDuration(frame)))
  if (elapsed > total) return
  const relativeValue = (
    frame: LegacyAnimationFrame,
    value: readonly [number, number],
  ): readonly [number, number] => frame.relative && relativeSize
    ? [value[0] * relativeSize.width / 100, value[1] * relativeSize.height / 100]
    : value
  const valueAt = (frame: LegacyAnimationFrame): readonly [number, number] => {
    const start = frame.start + frame.delay
    const duration = animationDuration(frame)
    if (elapsed < start) return relativeValue(frame, frame.from)
    if (elapsed > start + duration) return relativeValue(frame, frame.reverse ? frame.from : frame.to)
    let progress = duration ? (elapsed - start) / duration : 1
    if (progress < 1 && frame.repeat > 1) progress = (progress * frame.repeat) % 1
    if (frame.reverse) {
      progress *= 2
      if (progress > 1) progress = 2 - progress
    }
    const x = animationEasing(frame.easing[0], progress)
    const y = animationEasing(frame.easing[1], progress)
    return relativeValue(frame, [
      frame.from[0] + (frame.to[0] - frame.from[0]) * x,
      frame.from[1] + (frame.to[1] - frame.from[1]) * y,
    ])
  }
  const matching = frames.filter((frame) => frame.type === type)
  if (effect?.parallel && matching.length) {
    const multiply = type === "scale" || type === "opacity"
    return matching.reduce<readonly [number, number]>((combined, frame) => {
      const value = valueAt(frame)
      return multiply
        ? [combined[0] * value[0], combined[1] * value[1]]
        : [combined[0] + value[0], combined[1] + value[1]]
    }, multiply ? [1, 1] : [0, 0])
  }
  let previous: (typeof frames)[number] | undefined
  for (const frame of matching) {
    const start = frame.start + frame.delay
    const duration = animationDuration(frame)
    const end = start + duration
    if (elapsed < start) return previous
      ? relativeValue(previous, previous.reverse ? previous.from : previous.to)
      : relativeValue(frame, frame.from)
    if (elapsed <= end) return valueAt(frame)
    previous = frame
  }
  return previous ? relativeValue(previous, previous.reverse ? previous.from : previous.to) : undefined
}

export function legacyAnimationScale(
  animation: LegacyAnimation | undefined,
  styleID: string | undefined,
  elapsed: number,
): readonly [number, number] | undefined {
  return legacyAnimationPair(animation, styleID, elapsed, "scale")
}

export function legacyAnimationTranslation(
  animation: LegacyAnimation | undefined,
  styleID: string | undefined,
  elapsed: number,
  relativeSize?: Pick<Rect, "width" | "height">,
): readonly [number, number] | undefined {
  return legacyAnimationPair(animation, styleID, elapsed, "translate", relativeSize)
}

export function legacyAnimationOpacity(
  animation: LegacyAnimation | undefined,
  styleID: string | undefined,
  elapsed: number,
): number | undefined {
  return legacyAnimationPair(animation, styleID, elapsed, "opacity")?.[0]
}

export function legacyAnimationRotation(
  animation: LegacyAnimation | undefined,
  styleID: string | undefined,
  elapsed: number,
): number | undefined {
  return legacyAnimationPair(animation, styleID, elapsed, "rotate")?.[0]
}

export function animationSequenceForKey(
  animation: BdaAnimation | undefined,
  item: PreviewItem,
): BdaAnimationSequence | undefined {
  if (!animation) return
  const target = bdaTargetForKey(animation, item)
  if (target) {
    const sequence = animation.bindings.get(target)
    return animation.sequences.get(sequence ?? target) ?? animation.sequences.get(target.replace(/^KEY_/, ""))
  }
  if (animation.sequences.size === 1) return animation.sequences.values().next().value
}

export function bdaTargetForKey(animation: BdaAnimation, item: PreviewItem): string | undefined {
  const candidates = [item.section, item.center, item.down, `KEY_${item.center}`]
    .map((value) => value.trim().toUpperCase()).filter(Boolean)
  const exact = animation.targets.find((value) => candidates.includes(value.toUpperCase()))
  if (exact) return exact
  const main = /^[A-Z]$/i.test(item.center.trim())
  const semantic = main ? "MAIN_KEY" : "FUNCTION_KEY"
  return animation.targets.find((value) => value.toUpperCase() === semantic)
}

export function bdaAnimationBindingsForKey(
  animation: BdaAnimation | undefined,
  item: PreviewItem,
  event = 1,
): BdaAnimationBinding[] {
  if (!animation) return []
  const target = bdaTargetForKey(animation, item)
  return target ? (animation.targetBindings.get(target) ?? []).filter((binding) => binding.event === event) : []
}

export function bdaBindingEffects(animation: BdaAnimation, binding: BdaAnimationBinding): BdaAnimationEffect[] {
  const effect = animation.effects.get(`${binding.kind}:${binding.key}`)
  if (!effect) return []
  if (effect.kind !== "group") return [effect]
  return effect.items.flatMap((item) => {
    const child = animation.effects.get(`${item.kind}:${item.key}`)
    return child ? [child] : []
  })
}

export function bdaEffectDuration(effect: BdaAnimationEffect): number {
  if (effect.kind === "emitter") return Math.max(
    effect.duration * 1000,
    effect.totalNumber / Math.max(0.1, effect.birthRate) * 1000 + effect.life[1],
  )
  if (["alpha", "scale", "shift", "rotate"].includes(effect.kind)) {
    const transform = effect as BdaTransformAnimation
    return transform.delay + transform.duration * Math.max(1, transform.repeatCount) * (transform.repeatMode === 1 ? 2 : 1)
  }
  if (effect.kind === "image") return effect.sequence.frames.reduce((sum, frame) => sum + Math.max(16, frame.duration ?? 100), 0)
  return 0
}

export type BdaTransformState = {
  scale?: readonly [number, number]
  translation?: readonly [number, number]
  rotation?: number
  opacity?: number
}

export function bdaTransforms(
  animation: BdaAnimation | undefined,
  item: PreviewItem,
  elapsed: number,
  scope: "back" | "fore",
): BdaTransformState {
  if (!animation || elapsed < 0) return {}
  const result: BdaTransformState = {}
  const accepts = (binding: BdaAnimationBinding) => binding.scope === 2 || binding.scope === (scope === "back" ? 1 : 0)
  for (const binding of bdaAnimationBindingsForKey(animation, item).filter(accepts)) {
    for (const effect of bdaBindingEffects(animation, binding)) {
      if (!["alpha", "scale", "shift", "rotate"].includes(effect.kind)) continue
      const transform = effect as BdaTransformAnimation
      const start = transform.delay
      const repetitions = Math.max(1, transform.repeatCount)
      const cycles = repetitions * (transform.repeatMode === 1 ? 2 : 1)
      const total = transform.duration * cycles
      if (elapsed < start || elapsed > start + total) continue
      const raw = transform.duration ? (elapsed - start) / transform.duration : cycles
      let progress = raw >= cycles ? (transform.repeatMode === 1 ? 0 : 1) : raw % (transform.repeatMode === 1 ? 2 : 1)
      if (transform.repeatMode === 1 && progress > 1) progress = 2 - progress
      progress = animationEasing(transform.interpolation, Math.max(0, Math.min(1, progress)))
      // ponytail: random protobuf ranges use their midpoint for a stable editor preview.
      const midpoint = (range: readonly [number, number]) => (range[0] + range[1]) / 2
      const value = (axis: 0 | 1) => midpoint(transform.from[axis]) + (midpoint(transform.to[axis]) - midpoint(transform.from[axis])) * progress
      if (transform.kind === "alpha") result.opacity = value(0) / 255
      else if (transform.kind === "scale") result.scale = [value(0) / 100, value(1) / 100]
      else if (transform.kind === "rotate") result.rotation = value(0)
      else result.translation = transform.relative
        ? [value(0) * item.rect.width / 100, value(1) * item.rect.height / 100]
        : [value(0), value(1)]
    }
  }
  return result
}

export function bdaParticleEmitter(effect: BdaEmitterAnimation): LegacyParticleEmitter {
  const [left, top, right, bottom] = effect.emitRegion
  const region: [number, number, number, number] = left === 0 && top === 0 && right === 0 && bottom === 0
    ? [0, 0, 1, 1]
    : [left, top, right - left, bottom - top]
  return {
    images: effect.resources.map((item) => item.resourceID),
    life: effect.life,
    emitRegion: region,
    totalNumber: Math.max(1, effect.totalNumber),
    birthRate: Math.max(0.1, effect.birthRate),
    velocity: effect.velocity,
    velocityDirection: effect.velocityDirection,
    acceleration: effect.acceleration,
    accelerationDirection: effect.accelerationDirection,
    initialScale: effect.scale,
    scaleSpeed: effect.scaleSpeed,
    initialRotation: effect.rotation,
    rotationSpeed: effect.spin,
    initialAlpha: effect.alpha,
    alphaSpeed: effect.alphaSpeed,
  }
}
