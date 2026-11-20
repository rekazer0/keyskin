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
  // 每次都用当前骨架校验一次：模型可能是按「无骨架」建好的，骨架到位后要重建。
  // `ensure` 的 `fresh` 只比较归档、修订与两个引用，命中时立即返回，不会反复重建模型。
  if (model === undefined) {
    const archive = appState.archive
    if (archive) skinModel.ensure(archive, archive.format === "bda" ? { base: appState.bdaBase } : {})
  }
  const board = boardId === undefined ? undefined : current?.boards.find((item) => item.id === boardId)
  return board ? traitsOf(board, format) : fallbackTraits(format)
}

export type { BoardTraits }
