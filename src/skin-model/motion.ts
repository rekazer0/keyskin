// 动效：树形模型。
//
// 轨道、组合、帧序列、粒子、路径、物理与自定义家族都是同一棵树上的节点；绑定单独记录目标与事件。
import type { MotionSlot, Point, Rect } from "./types.ts"

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

export type MotionTrack = {
  property: MotionProperty
  from: MotionVector
  to: MotionVector
  relative: boolean
  easing: Easing
  pivot?: Point
}

export type MotionEmitter = {
  images: string[]
  type: "simple" | "complex"
  life: MotionRange
  count: number
  birthRate: number
  region: Rect
  velocity: MotionVector
  velocityDirection: MotionVector
  acceleration: MotionVector
  accelerationDirection: MotionVector
  scale: MotionRange
  scaleSpeed: MotionRange
  rotation: MotionRange
  rotationSpeed: MotionRange
  alpha: MotionRange
  alphaSpeed: MotionRange
  finish: "emitted" | "gone"
  removeWithParticles: boolean
  mirror: number
  path?: readonly Point[]
}

export type MotionFrame = { file: string; duration?: number }

export type MotionNode =
  | { kind: "track"; track: MotionTrack; delay: number; duration: number }
  | { kind: "sequence"; children: MotionNode[]; method: "parallel" | "sequential" | "random"; delay: number; duration: number }
  | { kind: "frames"; frames: MotionFrame[]; loop: number; delay: number; duration: number }
  | { kind: "particles"; emitter: MotionEmitter; delay: number; duration: number }
  | { kind: "path"; points: readonly Point[]; speed: number; delay: number; duration: number }
  | { kind: "physics"; gravity: Point; drag: number; bounce: number; delay: number; duration: number }
  | { kind: "custom"; family: string; values: ReadonlyMap<string, number | string | boolean> }

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

export type SkinMotion = {
  id: string
  root: MotionNode
  timeline: MotionTimeline
  bindings: MotionBinding[]
}

export type SkinMotions = ReadonlyMap<string, SkinMotion>

/** 动效树里的节点类型；能力检查与导出按它统计。 */
export function motionNodeKinds(root: MotionNode): string[] {
  const kinds: string[] = []
  const visit = (node: MotionNode): void => {
    kinds.push(node.kind)
    if (node.kind === "sequence") node.children.forEach(visit)
  }
  visit(root)
  return kinds
}
