// 当前板的可编辑能力：从应用状态取模型与格式，判断在模型层。
import type { ExportFormat } from "@/export.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import { fallbackTraits, traitsOf, type BoardTraits } from "@/skin-model/board-capability.ts"
import { skinModel } from "./skin-model-state"

/**
 * 指定板的可编辑能力。
 * 模型没建好、或模型里没有这块板时退回按格式判断，避免误判成只读。
 */
export function boardTraits(boardId: string | undefined, model?: SkinModel | undefined, format?: ExportFormat): BoardTraits {
  const current = model ?? skinModel.model
  const board = boardId === undefined ? undefined : current?.boards.find((item) => item.id === boardId)
  return board ? traitsOf(board, format) : fallbackTraits(format)
}

export type { BoardTraits }
