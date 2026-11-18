// 格式转换器的契约。
//
// `T` 是格式自己的原生数据（归档、文档集合、JSON 对象等）；IR 只在 read/write 的结果里出现。
// 每个转换器可以声明自己的推导默认，调用方（导入操作）可以再覆盖。
import type { Capability, CapabilityLevel } from "./capability.ts"
import type { DeriveOverrides } from "./derive/options.ts"
import type { SkinModel } from "./model.ts"

export type ImportOptions = {
  /** 覆盖该转换器的推导默认；与全局默认逐项合并。 */
  derive?: DeriveOverrides
}

export interface SkinFormat<T> {
  readonly name: string
  readonly capabilities: ReadonlyMap<Capability, CapabilityLevel>
  /** 该格式的推导默认（容差、权重、深度）；调用方可在导入时覆盖。 */
  readonly derive?: DeriveOverrides
  /** 格式原生数据 → IR。 */
  read(source: T, options?: ImportOptions): SkinModel | Promise<SkinModel>
  /** IR → 格式原生数据；给了 `source` 时在原数据上写回，保留未建模的内容。 */
  write(model: SkinModel, source?: T): T | Promise<T>
}
