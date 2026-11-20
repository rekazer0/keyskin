// 搜狗客户端骨架：官方 APP 里的键位表，皮肤包本身不带坐标。
//
// 读取时用它拿容器尺寸与键清单；写入时不碰它（皮肤只描述外观，几何由客户端决定）。
// 骨架是外部输入（`OpenContext.skeleton`），不属于任何皮肤包。
import { IniDocument } from "@/ini.ts"
import type { SkinArchive } from "@/skin.ts"
import type { Size } from "taffy-layout"
import type { Orientation, Theme } from "@/skin-model/types.ts"
import { flexBoardOf, type SkeletonKey, type SkeletonLayout } from "@/skin-model/formats/ssf/layout.ts"

/** 主键盘的布局名：官方骨架里六排拼音键盘就是客户端默认主键盘。 */
const MAIN_LAYOUT = /\/py_26\.ini$/i

function sizeOf(value: string | undefined): number[] {
  return value?.split(",").map((part) => Number(part.trim())) ?? []
}

/** 骨架里一块布局的容器尺寸与键表。 */
export type SkeletonBoard = SkeletonLayout & { path: string }

/**
 * 选骨架里的主键盘布局并解析成键表。
 * 返回键的矩形只用于推布局树，调用方不应把它们写进模型。
 */
export function skeletonBoardOf(
  template: SkinArchive,
  options: { theme: Theme; orientation: Orientation; layout?: string },
): SkeletonBoard | undefined {
  const prefix = `${options.theme}/skin/${options.orientation}/`
  const candidates = template.names().filter((path) => path.startsWith(prefix) && path.endsWith(".ini") && !/gen\.ini$/i.test(path))
  const path = options.layout
    ?? candidates.find((name) => MAIN_LAYOUT.test(name))
    ?? candidates.find((name) => /_26\.ini$/i.test(name))
    ?? candidates[0]
  if (!path) return
  const document = IniDocument.parse(template.getText(path))
  const panel = sizeOf(document.get("PANEL", "SIZE"))
  if (panel.length !== 2 || !panel.every(Number.isFinite)) return
  const container: Size<number> = { width: panel[0], height: panel[1] }
  const keys: SkeletonKey[] = []
  for (const section of document.sections()) {
    if (!/^KEY\d+$/i.test(section)) continue
    const rect = sizeOf(document.get(section, "VIEW_RECT"))
    if (rect.length !== 4 || !rect.every(Number.isFinite)) continue
    const action = document.get(section, "CENTER")?.trim()
    if (!action) continue
    const keySection = document.get(section, "SSF_SECTION")?.trim()
    keys.push({
      id: keySection || section,
      ...(keySection ? { section: keySection } : {}),
      action,
      ...(document.get(section, "SSF_BG")?.trim() ? { background: document.get(section, "SSF_BG")!.trim() } : {}),
      ...(document.get(section, "SSF_FG")?.trim() ? { foreground: document.get(section, "SSF_FG")!.trim() } : {}),
      rect: { x: rect[0], y: rect[1], width: rect[2], height: rect[3] },
    })
  }
  if (!keys.length) return
  return { path, container, keys, board: flexBoardOf(keys, container) }
}
