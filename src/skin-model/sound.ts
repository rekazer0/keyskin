// 音效：触发主体到音效资源的绑定。
//
// 一个绑定一个主体；同一音效的其它格式版本放进 `variants`，不拆成多条绑定，
// 否则导出时会生成两份配置。
export type SoundBinding = {
  /** 触发主体：键名、键类、或功能图标。 */
  subject: string
  /** 音效资源路径。 */
  sound: string
  /** 平台限定；BDA 的双表与 SSF 的文件名本身带平台。 */
  platform?: "ios" | "android"
  /** 同一音效的其它格式版本（SXI 的 .aiff/.ogg 双份）。 */
  variants?: ReadonlyArray<{ format: string; path: string }>
}

export type SoundBindings = SoundBinding[]
