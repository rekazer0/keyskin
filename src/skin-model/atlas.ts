// 图集：打包方式，不是语义；但不建模会丢信息。
//
// 一张图集一个源图、若干切片；未定字段（SXI 的 rect2/scales）放切片的 `extra`，
// 丢掉会让导出无法还原，塞进主结构又会假装已知。
import type { Size } from "taffy-layout"
import type { SkinModel } from "./model.ts"
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

/** 图片 id → 它所属的图集与切片；不在任何图集里的独立图返回 undefined。 */
export function sliceOfImage(
  model: SkinModel,
  imageID: string,
): { path: string; rect: Box; size: Size<number> } | undefined {
  for (const atlas of model.atlases) {
    const slice = atlas.slices.find((entry) => entry.id === imageID)
    if (!slice) continue
    const image = model.images.get(atlas.source)
    return {
      path: atlas.source,
      rect: slice.rect,
      // 源图没解码时用切片自身的像素尺寸，不把 0 当尺寸。
      size: image ? { width: image.width, height: image.height } : { width: slice.rect.width, height: slice.rect.height },
    }
  }
  return undefined
}
