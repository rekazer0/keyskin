// 当前板的可编辑能力：从应用状态取模型与格式，判断在模型层。
import type { ExportFormat } from "@/export.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import { fallbackTraits, traitsOf, type BoardTraits } from "@/skin-model/board-capability.ts"
import { skinModel } from "./skin-model-state"
import { appState } from "./state"

/**
 * 指定板的可编辑能力。
 * 模型没建好、或模型里没有这块板时退回按格式判断，避免误判成只读。
 */
export function boardTraits(boardId: string | undefined, model?: SkinModel | undefined, format?: ExportFormat): BoardTraits {
  const current = model ?? skinModel.model
  // 模型为空通常是编辑让它失效了；这里把重建排上，下一次刷新就能用上新模型。
  if (!current && model === undefined) {
    const archive = appState.archive
    // BDA 只有外观的包靠官方基础布局补几何；不把骨架传进去就建不出按键。
    if (archive) skinModel.ensure(archive, archive.format === "bda" ? { base: appState.bdaBase } : {})
  }
  const board = boardId === undefined ? undefined : current?.boards.find((item) => item.id === boardId)
  return board ? traitsOf(board, format) : fallbackTraits(format)
}

export type { BoardTraits }
