// 动效的模型编辑：读关键帧、改关键帧、改时间与作用对象。
//
// 编辑器对动画的改动都落在 `MotionNode` 上：属性轨道改 `keyframes`，帧序列改 `frames`，
// 组合改子节点顺序，时间信息改 `timeline`。这里只做不可变的模型运算，
// 不碰文档、不碰归档——写回由格式侧负责。
import type { MotionNode, MotionTarget, MotionTimeline } from "./motion.ts"
import type { SkinModel } from "./model.ts"

/** 动效树里的一个节点：从根到它的子索引路径，根是空数组。 */
export type MotionNodeRef = {
  path: readonly number[]
  node: MotionNode
}

/** 深度优先列出动效树里的所有节点，根在前。 */
export function motionNodes(node: MotionNode, path: readonly number[] = []): MotionNodeRef[] {
  const refs: MotionNodeRef[] = [{ path, node }]
  if (node.kind === "group") {
    node.children.forEach((child, index) => refs.push(...motionNodes(child, [...path, index])))
  }
  return refs
}

/** 按路径取节点；路径不存在时返回 undefined。 */
export function motionNodeAt(node: MotionNode, path: readonly number[]): MotionNode | undefined {
  let current: MotionNode | undefined = node
  for (const index of path) {
    if (current?.kind !== "group") return undefined
    current = current.children[index]
  }
  return current
}

/** 动效里第一个属性轨道；没有轨道（帧、纯组合、不透明节点）时返回 undefined。 */
export function firstTrackOf(node: MotionNode): MotionNodeRef | undefined {
  return motionNodes(node).find((ref) => ref.node.kind === "track")
}

/** 关键帧列表；非轨道节点没有关键帧。 */
export function keyframesOf(node: MotionNode | undefined): readonly { time: number; value: number }[] {
  return node?.kind === "track" ? node.keyframes : []
}

/** 动效的时长：时间轴优先，没有时间轴时取最后一个关键帧的时间。 */
export function motionDuration(node: MotionNode): number {
  if (node.timeline) return node.timeline.duration
  if (node.kind === "track") return node.keyframes[node.keyframes.length - 1]?.time ?? 0
  return 0
}

/** 用新节点替换树里的一条路径；路径不存在时原样返回。 */
function replaceAt(node: MotionNode, path: readonly number[], replace: (node: MotionNode) => MotionNode): MotionNode {
  if (!path.length) return replace(node)
  if (node.kind !== "group") return node
  const [head, ...rest] = path
  const child = node.children[head]
  if (!child) return node
  const next = replaceAt(child, rest, replace)
  if (next === child) return node
  return { ...node, children: node.children.map((item, index) => index === head ? next : item) }
}

function withMotion(model: SkinModel, id: string, update: (node: MotionNode) => MotionNode): SkinModel {
  const node = model.motions.get(id)
  if (!node) return model
  const next = update(node)
  if (next === node) return model
  return { ...model, motions: new Map([...model.motions, [id, next]]) }
}

/** 改一个关键帧；`index` 越界或值非法时原样返回模型。 */
export function setKeyframe(
  model: SkinModel,
  id: string,
  path: readonly number[],
  index: number,
  patch: { time?: number; value?: number },
): SkinModel {
  if (patch.time !== undefined && !Number.isFinite(patch.time)) return model
  if (patch.value !== undefined && !Number.isFinite(patch.value)) return model
  return withMotion(model, id, (node) => replaceAt(node, path, (target) => {
    if (target.kind !== "track" || !target.keyframes[index]) return target
    const current = target.keyframes[index]
    const next = {
      time: patch.time ?? current.time,
      value: patch.value ?? current.value,
    }
    if (next.time === current.time && next.value === current.value) return target
    return { ...target, keyframes: target.keyframes.map((item, at) => at === index ? next : item) }
  }))
}

/** 在末尾追加一个关键帧；时间取最后一个关键帧之后，值沿用最后一个。 */
export function addKeyframe(model: SkinModel, id: string, path: readonly number[], at?: { time: number; value: number }): SkinModel {
  return withMotion(model, id, (node) => replaceAt(node, path, (target) => {
    if (target.kind !== "track") return target
    const last = target.keyframes[target.keyframes.length - 1]
    const next = at ?? { time: (last?.time ?? 0) + 100, value: last?.value ?? 0 }
    if (!Number.isFinite(next.time) || !Number.isFinite(next.value)) return target
    return { ...target, keyframes: [...target.keyframes, { time: next.time, value: next.value }] }
  }))
}

/** 删一个关键帧；轨道至少保留一个，删到空时原样返回。 */
export function removeKeyframe(model: SkinModel, id: string, path: readonly number[], index: number): SkinModel {
  return withMotion(model, id, (node) => replaceAt(node, path, (target) => {
    if (target.kind !== "track" || target.keyframes.length <= 1 || !target.keyframes[index]) return target
    return { ...target, keyframes: target.keyframes.filter((_, at) => at !== index) }
  }))
}

/** 改时间轴；没给时间轴时按默认值建一条。 */
export function setMotionTiming(model: SkinModel, id: string, patch: Partial<MotionTimeline>): SkinModel {
  return withMotion(model, id, (node) => {
    const current: MotionTimeline = node.timeline ?? { delay: 0, duration: 0, repeat: 1, reverse: false, clear: false }
    const next = { ...current, ...patch }
    if (next.delay === current.delay && next.duration === current.duration && next.repeat === current.repeat
      && next.reverse === current.reverse && next.clear === current.clear) return node
    return { ...node, timeline: next }
  })
}

/** 改作用对象；只对轨道节点有意义。 */
export function setMotionTarget(model: SkinModel, id: string, path: readonly number[], patch: Partial<MotionTarget>): SkinModel {
  return withMotion(model, id, (node) => replaceAt(node, path, (target) => {
    if (target.kind !== "track") return target
    const next: MotionTarget = { ...target.target, ...patch }
    if (next.subject === target.target.subject && next.name === target.target.name
      && next.property === target.target.property) return target
    return { ...target, target: next }
  }))
}

/** 动效的读投影：编辑器列表与参数行共用。 */
export type MotionView = {
  id: string
  kind: MotionNode["kind"]
  /** 帧序列的帧数 / 轨道的关键帧数 / 组合的子节点数。 */
  count: number
  duration: number
  target?: MotionTarget
  /** 不透明节点的格式名；其余节点为 undefined。 */
  format?: string
  bindings: number
}

/** 把模型里的动效投影成可展示的摘要。 */
export function motionViews(model: SkinModel): MotionView[] {
  return [...model.motions].map(([id, node]) => ({
    id,
    kind: node.kind,
    count: node.kind === "frames" ? node.frames.length
      : node.kind === "track" ? node.keyframes.length
        : node.kind === "group" ? node.children.length
          : 0,
    duration: motionDuration(node),
    ...(node.kind === "track" ? { target: node.target } : {}),
    ...(node.kind === "opaque" ? { format: node.format } : {}),
    bindings: node.bindings?.length ?? 0,
  }))
}
