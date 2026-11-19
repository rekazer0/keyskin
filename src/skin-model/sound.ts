// 音效：按槽位组织，资源只记录路径与增益；播放由编辑器负责。
export type SoundSlot =
  | "default"
  | "key"
  | "backspace"
  | "enter"
  | "space"
  | "delete"
  | "panel-show"
  | "panel-hide"
  | "popup"
  | "candidate"
  | "other"

export type SkinSound = {
  slot: SoundSlot
  resource: string
  gain?: number
  loop?: boolean
}

export type SkinSounds = ReadonlyMap<string, SkinSound>
