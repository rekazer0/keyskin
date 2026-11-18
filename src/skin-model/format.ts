// 格式转换器的契约。
//
// `T` 是格式自己的原生数据（归档、文档集合、JSON 对象等）；IR 只在 read/write 的结果里出现，
// 具体格式的字段不进入 IR。
import type { Capability, CapabilityLevel } from "./capability.ts"
import type { SkinModel } from "./model.ts"

export interface SkinFormat<T> {
  readonly name: string
  readonly capabilities: ReadonlyMap<Capability, CapabilityLevel>
  /** 格式原生数据 → IR。 */
  read(source: T): SkinModel
  /** IR → 格式原生数据；给了 `source` 时在原数据上写回，保留未建模的内容。 */
  write(model: SkinModel, source?: T): T
}
