// 皮肤 IR：完整模型。
//
// 元信息、能力声明、资源、图集、板、外观、样式、动效、音效与不透明内容都在这里；
// 模型不出现任何格式的字段名。格式只在 import/export 边界出现，转换是模型之间的运算。
import type { AppearanceSet } from "./activation.ts"
import type { Atlas } from "./atlas.ts"
import type { Board } from "./board.ts"
import type { SkinImage } from "./image.ts"
import type { MotionNode } from "./motion.ts"
import type { FormatProfile } from "./profile.ts"
import type { SoundBinding } from "./sound.ts"
import type { SkinStyle } from "./style.ts"
import type { BoardKind, SkinMeta, SkinResource } from "./types.ts"

export type SkinModel = {
  meta: SkinMeta
  /** 各格式的能力声明；导入时填，导出时读。 */
  profiles: FormatProfile[]
  /** 资源：音频、字体、帧序列。字节随模型走。 */
  resources: ReadonlyMap<string, SkinResource>
  /** 图片资源：导入时切出的像素，导出时重新打包。 */
  images: ReadonlyMap<string, SkinImage>
  /** 图集：打包方式，多个切片共用一张源图。 */
  atlases: Atlas[]
  boards: Board[]
  /** 外观集合：哪套在什么条件下生效。 */
  appearances: AppearanceSet[]
  styles: ReadonlyMap<string, SkinStyle>
  motions: ReadonlyMap<string, MotionNode>
  sounds: SoundBinding[]
  /** 格式专有、未建模的内容，原样保留，保证导出可还原。 */
  opaque: ReadonlyMap<string, unknown>
}

/** 一份空模型；导入器从它开始填充，编辑器从它开始新建。 */
export function emptyModel(meta: SkinMeta, format = ""): SkinModel {
  return {
    meta,
    profiles: format ? [{ format, capabilities: new Map() }] : [],
    resources: new Map(),
    images: new Map(),
    atlases: [],
    boards: [],
    appearances: [],
    styles: new Map(),
    motions: new Map(),
    sounds: [],
    opaque: new Map(),
  }
}

/** 按板种类筛选；转换与检查器共用。 */
export function boardsOfKind(model: SkinModel, kind: BoardKind): Board[] {
  return model.boards.filter((board) => board.kind === kind)
}
