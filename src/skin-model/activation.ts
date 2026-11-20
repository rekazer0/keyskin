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
  /**
   * 外观在源格式里的标识（搜狗的 `status1`/`status2`）。
   * 导出要按它建目录与段名；换一个名字，写出的包就不是同一个外观了。
   */
  name?: string
  /** 这套外观覆盖哪些板。 */
  boards: string[]
}
