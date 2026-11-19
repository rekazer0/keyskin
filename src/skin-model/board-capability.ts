// 板的能力：几何是否可改、按键能否增删、触摸区能否编辑。
//
// 这些判断以前散在各处按格式写（`!bdaSelected && !ssfSelected`）。格式只决定大方向，
// 真正的事实是这块板的几何来源与它所属格式的能力。这里是纯函数，界面负责提供当前板。
import type { Board } from "./board.ts"

/** 一块板在编辑器里允许做什么。 */
export type BoardTraits = {
  /** 几何来源：文档、客户端、骨架。 */
  geometry: "document" | "client" | "basis"
  /** 能不能移动或缩放按键。 */
  geometryEditable: boolean
  /** 能不能增删按键。 */
  keyAdjustable: boolean
  /** 能不能编辑触摸区（比几何更严格：只有文档排布的皮肤有）。 */
  touchEditable: boolean
  /** 这个格式是否有专属的检查器界面。 */
  native: boolean
}

/** 有专属检查器界面的格式：它们的几何来自别处，不在这里改。 */
export function isNativeFormat(format: string | undefined): boolean {
  return format === "bda" || format === "ssf" || format === "sxi"
}

/** 模型里找不到这块板时，按格式给出保守判断。 */
export function fallbackTraits(format: string | undefined): BoardTraits {
  const native = isNativeFormat(format)
  return {
    geometry: native ? "basis" : "document",
    geometryEditable: !native,
    keyAdjustable: format !== "bda" && format !== "ssf",
    touchEditable: !native,
    native,
  }
}

/** 已知板时按它自己的属性判断。 */
export function traitsOf(board: Board, format: string | undefined): BoardTraits {
  const geometryEditable = board.geometry.kind === "document"
  return {
    geometry: board.geometry.kind,
    geometryEditable,
    // 客户端排布的板不能增删键；工具栏板也不在这里增删。
    keyAdjustable: geometryEditable && board.kind !== "toolbar",
    touchEditable: geometryEditable,
    native: isNativeFormat(format),
  }
}
