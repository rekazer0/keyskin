// 图集：打包方式，不是语义；但不建模会丢信息。
//
// 一张图集一个源图、若干切片；未定字段（SXI 的 rect2/scales）放切片的 `extra`，
// 丢掉会让导出无法还原，塞进主结构又会假装已知。
import type { Box } from "./types.ts"

export type AtlasSlice = {
  id: string
  /** 切片在源图里的像素区域。 */
  rect: Box
  /** 格式专有的、还没建模的字段，原样保留。 */
  extra?: ReadonlyMap<string, unknown>
}

export type Atlas = {
  name: string
  /** 源图路径。 */
  source: string
  slices: AtlasSlice[]
}
