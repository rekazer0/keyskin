// 动效：树形模型。
//
// 逐帧、属性轨道、组合、引用与不透明节点是同一棵树上的节点。
// 三种格式的形态不同：BDA 是帧序列，SXI 是两点过渡，SSF 是多点关键帧；
// 前两者不能互相降级，转换必须在损失报告里说明。
import type { Point } from "taffy-layout"
import type { MotionSlot } from "./types.ts"

export type MotionRange = readonly [number, number]
export type MotionVector = readonly [MotionRange, MotionRange]
export type MotionProperty = "alpha" | "scale" | "translate" | "rotate" | "rotate3d"

export type Easing =
  | { kind: "linear" }
  | { kind: "ease-in" }
  | { kind: "ease-out" }
  | { kind: "ease-in-out" }
  | { kind: "bounce" }
  | { kind: "cubic"; points: readonly [number, number, number, number] }

/** 相交轨道：一个属性从起点到终点的插值描述，供格式内部与写回使用。 */
export type MotionTrack = {
  property: MotionProperty
  from: MotionVector
  to: MotionVector
  relative: boolean
  easing: Easing
  pivot?: Point<number>
}

export type MotionEmitter = {
  images: string[]
  type: "simple" | "complex"
  life: MotionRange
  count: number
  birthRate: number
  region: { position: Point<number>; size: { width: number; height: number } }
  velocity: MotionRange
  velocityDirection: MotionRange
  acceleration: MotionRange
  accelerationDirection: MotionRange
  scale: MotionRange
  scaleSpeed: MotionRange
  rotation: MotionRange
  rotationSpeed: MotionRange
  alpha: MotionRange
  alphaSpeed: MotionRange
  finish: "emitted" | "gone"
  removeWithParticles: boolean
  mirror: number
  path?: readonly Point<number>[]
}

export type MotionFrame = { image: string; duration?: number }

/** 动效作用的对象：某个键、某类键、面板，以及改的是哪个属性。 */
export type MotionTarget = {
  /** 作用对象：某个键、某类键、还是面板。 */
  subject: "key" | "key-class" | "panel" | "unknown"
  name?: string
  /** 改哪个属性。 */
  property: "x" | "y" | "scale" | "alpha" | "rotation" | "image" | "unknown"
  /** 相对参照。SSF 的 RELATETO/POS_ANCHOR/RATE_KEY_W。 */
  relativeTo?: { anchor: string; rate: { width?: number; height?: number } }
}

/** 动效绑定：什么时机、对哪个对象播放。写回时按它还原格式自己的绑定表。 */
export type MotionBinding = {
  target: string
  slot: MotionSlot
  scope: "back" | "fore" | "both" | "panel"
  condition?: string
  isolated?: boolean
}

export type MotionTimeline = {
  delay: number
  duration: number
  repeat: number
  reverse: boolean
  clear: boolean
}

/**
 * 动效节点上的公共信息。
 *
 * `timeline` 与 `bindings` 不在设计稿的五个分支里，但格式写回需要它们：
 * BDA 的时长/循环、SXI 的样式时机绑定都只存在于这两处。
 * 删掉会让导出不可还原，因此保留为每个节点都可带的可选信息。
 */
export type MotionNodeInfo = {
  timeline?: MotionTimeline
  bindings?: MotionBinding[]
}

/** 动效节点：五个分支，各自携带轨道、帧或子节点。 */
export type MotionNode = MotionNodeInfo & (
  | { kind: "frames"; frames: Array<{ image: string; duration?: number }> }
  | {
    kind: "track"
    target: MotionTarget
    keyframes: Array<{ time: number; value: number }>
    /** 插值器与轴心；设计稿未含，写回 SXI/BDS 需要。 */
    easing?: Easing
    pivot?: Point<number>
    /**
     * 双轴起点终点。设计稿的关键帧是单值，而 BDA/SXI 的位移与缩放各有 x、y 两个分量；
     * 保留原始向量，写回时才不会把两轴压成一轴。
     */
    vector?: { from: MotionVector; to: MotionVector; relative: boolean }
  }
  | { kind: "group"; method: "sequential" | "simultaneous" | "random"; children: MotionNode[] }
  | { kind: "reference"; id: string }
  | { kind: "opaque"; format: string; blob: unknown }
)

export type SkinMotions = ReadonlyMap<string, MotionNode>

/** 动效树里的节点类型；能力检查与导出按它统计。 */
export function motionNodeKinds(root: MotionNode): string[] {
  const kinds: string[] = []
  const visit = (node: MotionNode): void => {
    kinds.push(node.kind)
    if (node.kind === "group") node.children.forEach(visit)
  }
  visit(root)
  return kinds
}

/** 把格式自己的属性名归一到 IR 的轨道目标属性。 */
export function motionPropertyOf(property: MotionProperty): MotionTarget["property"] {
  switch (property) {
    case "alpha": return "alpha"
    case "scale": return "scale"
    case "rotate":
    case "rotate3d": return "rotation"
    case "translate": return "x"
  }
}

/** 两点关键帧：从 from 到 to，时间用格式自己的时间轴。 */
export function keyframesOf(track: MotionTrack, duration: number): Array<{ time: number; value: number }> {
  return [
    { time: 0, value: track.from[0][0] },
    { time: duration, value: track.to[0][0] },
  ]
}
