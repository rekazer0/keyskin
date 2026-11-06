import { SkinArchive } from "../skin.ts"
import { type Change } from "../history.ts"
import { type AiSkinDraftChange } from "../ai-skin-workspace.ts"
import { type AiDesignConversation } from "../ai-design.ts"
import { IniDocument } from "../ini.ts"
import { type TileSlice } from "../tiles.ts"
import { type BdaStyleRef } from "../bda.ts"

export type LayoutImageConfig = "none" | "image-follows-layout" | "layout-follows-image"

/**
 * A finished AI run held for confirmation. Nothing reaches the archive until
 * the user applies it, so a draft can be discarded without side effects.
 */
export type AiDraft = {
  target: SkinArchive
  changes: Change[]
  drafts: AiSkinDraftChange[]
  sections: string[]
  conversation: AiDesignConversation
  response: string
  variants?: AiDraftVariant[]
}

export type AiDraftVariant = {
  id: string
  title: string
  changes: Change[]
  drafts: AiSkinDraftChange[]
  sections: string[]
  conversation: AiDesignConversation
  response: string
}

export type StyleImagePickerTarget = {
  source: "BACK_STYLE" | "FORE_STYLE"
  property: "NM_IMG" | "HL_IMG"
  document?: IniDocument
  path?: string
  sections?: string[]
  selectImage?(path: string, source?: TileSlice["source"]): void
}

export type NativeImagePickerPayload = {
  path: string
  dataURL: string
  slices: TileSlice[]
  selectedIndex?: number
  editable: boolean
  styleName?: string
  // 有样式引用输入框时，切片窗口的返回回到样式库「全部样式」。
  styleLibrary?: boolean
}

export type NativeResourcePickerPayload = { path: string; dataURL: string }[]

export type SourceTransfer = {
  mode: "copy" | "move"
  sourcePath: string
  folder: boolean
  files: { path: string; source: string; bytes: Uint8Array }[]
}

export type BdaTileUsage = {
  index: number
  ref: BdaStyleRef
  highlighted: boolean
  label: string
}

export type SourceFilePayload = { path: string; data: string }

export type SourceChangePayload = { path: string; data: number[] | null; directory: boolean }

export type SoundEntry = {
  id: string
  label: string
  filename: string
  path: string
  usage: string
}

export type StyleKind = "image" | "color" | "anim" | "text" | "sound" | "empty"

export type SourceUpload = { name: string; bytes: Uint8Array }

export type BrowserSaveFileHandle = {
  name: string
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>
}

export type ChosenFileData = Uint8Array | (() => Promise<Uint8Array | undefined>)

export interface RecentFile {
  path: string
  name: string
  at: number
  // 这份皮肤对应的源码目录；源码存储开启时从这里打开，而不是重新解析原包。
  source?: string
}

export interface RecentThumb {
  stamp: string
  // WKWebView 的 IndexedDB 存不进 Blob（put 静默失败），只能存原始字节。
  bytes: ArrayBuffer
  type: string
}

export type WindowMaterialKind = "glass" | "acrylic" | "none"
