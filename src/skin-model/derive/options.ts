// 推导参数：容差、成本权重与深度上限。
//
// 三层叠加：全局默认 → 格式转换器的默认 → 调用方（导入操作）传入的覆盖。
// 后一层只覆盖显式给出的字段，权重逐项合并。
export type DeriveWeights = {
  /** 绝对定位节点：说明这一层没有被理解，权重最高。 */
  absolute: number
  /** 相对定位容器：内部放弃 flow。 */
  relative: number
  /** margin 使用次数：均匀间距本应由 gap 表达。 */
  margin: number
  /** 容器节点数：结构层数越多越贵。 */
  container: number
  /** 深度：每深一层加一次。 */
  depth: number
}

export type DeriveOptions = {
  /** 判定“与输入一致”的像素容差。 */
  tolerance: number
  weights: DeriveWeights
  /** 递归深度上限，超过即回退。 */
  maxDepth: number
}

export const DEFAULT_DERIVE_OPTIONS: DeriveOptions = {
  tolerance: 1,
  weights: { absolute: 100, relative: 20, margin: 5, container: 2, depth: 1 },
  maxDepth: 8,
}

export type DeriveOverrides = {
  tolerance?: number
  weights?: Partial<DeriveWeights>
  maxDepth?: number
}

/** 按顺序合并，后者覆盖前者的显式字段；权重逐项合并。 */
export function resolveDeriveOptions(...layers: ReadonlyArray<DeriveOverrides | undefined>): DeriveOptions {
  return layers.reduce<DeriveOptions>((current, layer) => {
    if (!layer) return current
    return {
      tolerance: layer.tolerance ?? current.tolerance,
      maxDepth: layer.maxDepth ?? current.maxDepth,
      weights: { ...current.weights, ...layer.weights },
    }
  }, { ...DEFAULT_DERIVE_OPTIONS, weights: { ...DEFAULT_DERIVE_OPTIONS.weights } })
}
