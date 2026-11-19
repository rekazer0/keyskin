// 外观与激活条件：哪套外观在什么条件下生效。
//
// 外观身份（主题/时段）与它覆盖的板分开建模；压成一个 `theme` 字段会丢掉 SSF 的时段信息。
import type { Orientation, Theme } from "./types.ts"

export type Activation =
  | { kind: "always" }
  | { kind: "theme"; theme: Theme }
  | { kind: "time"; ranges: Array<{ startHour: number; endHour: number }> }

export type AppearanceSet = {
  theme: Theme
  orientation: Orientation
  activation: Activation
  /** 这套外观覆盖哪些板。 */
  boards: string[]
}
