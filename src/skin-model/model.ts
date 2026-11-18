// 皮肤 IR：完整模型。
//
// 元信息、资源、板、样式、动效、音效、来源都在这里；模型不出现任何格式的字段名。
// 格式只在 import/export 边界出现，转换是模型之间的运算。
import type { BoardKind } from "./types.ts"
import type { SkinBoard } from "./board.ts"
import type { SkinMeta, SkinResource } from "./types.ts"
import type { SkinStyles } from "./style.ts"
import type { SkinMotions } from "./motion.ts"
import type { SkinSounds } from "./sound.ts"
import type { Provenance } from "./provenance.ts"

export type SkinModel = {
  meta: SkinMeta
  resources: ReadonlyMap<string, SkinResource>
  boards: SkinBoard[]
  styles: SkinStyles
  motions: SkinMotions
  sounds: SkinSounds
  provenance: Provenance
}

/** 一份空模型；导入器从它开始填充，编辑器从它开始新建。 */
export function emptyModel(meta: SkinMeta, format = ""): SkinModel {
  return {
    meta,
    resources: new Map(),
    boards: [],
    styles: new Map(),
    motions: new Map(),
    sounds: new Map(),
    provenance: { format, nodes: new Map() },
  }
}

/** 按板种类筛选；转换与检查器共用。 */
export function boardsOfKind(model: SkinModel, kind: BoardKind): SkinBoard[] {
  return model.boards.filter((board) => board.kind === kind)
}
