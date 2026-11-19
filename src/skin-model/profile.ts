// 格式能力声明：每个格式能表达什么，以及它自带的声明字段。
//
// `declared` 只记录原值不参与判定：BDA 的 `Abilities` 与实际内容矛盾，声明不可信。
import type { Capability, CapabilityLevel } from "./capability.ts"

export type { CapabilityLevel }

export type FormatProfile = {
  format: string
  capabilities: ReadonlyMap<Capability, CapabilityLevel>
  /** 这个格式自带的声明字段原值，只作参考。 */
  declared?: ReadonlyMap<string, string>
}
