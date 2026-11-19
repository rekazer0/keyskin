// 格式转换器的契约。这一层固化后不再变动。
//
// 一个格式只有三件事：从归档取出自己的原生数据、给出导入三步、给出导出三步。
// 读写由驱动器串联，格式不提供「一步到位的 read/write」——
// 那会把包直接塞给转换阶段，等于留了回源包的后门。
import type { SkinArchive } from "@/skin.ts"
import type { Capability, CapabilityLevel } from "./capability.ts"
import type { DeriveOverrides } from "./derive/options.ts"
import type { Exporter, Importer } from "./pipeline.ts"

/** 打开时需要的外部输入：搜狗与 BDA 的几何来自官方骨架，不在包里。 */
export type OpenContext = {
  /** 搜狗皮肤自身没有几何，读取时必须有官方骨架。 */
  skeleton?: SkinArchive
  /** BDA 包只描述外观，几何来自布局骨架。 */
  base?: SkinArchive
}

export type ImportOptions = {
  /** 覆盖该转换器的推导默认；与全局默认逐项合并。 */
  derive?: DeriveOverrides
}

export interface SkinFormat<T> {
  readonly name: string
  readonly capabilities: ReadonlyMap<Capability, CapabilityLevel>
  /** 该格式的推导默认（容差、权重、深度）；调用方可在导入时覆盖。 */
  readonly derive?: DeriveOverrides
  /** 归档 → 原生数据；不是这个格式或缺少必需输入时返回 undefined。 */
  open(archive: SkinArchive, context: OpenContext): T | undefined
  /** 原生数据 → 导入三步。读取提示（主布局、方向）在闭包里，包不在。 */
  importer(source: T, options?: ImportOptions): Importer
  /** 导出三步：模型 → 文档 → 结构 → 原生数据。与源无关。 */
  readonly exporter: Exporter<T>
}
