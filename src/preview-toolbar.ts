// 工具栏图标：只从当前板的 `panels.toolbar.items` 取图。
//
// BDS 的图标在客户端内置，模型里没有工具栏数据就是空数组；这里不造图标。
import { bitmapOf } from "./skin-model/image.ts"
import type { Board } from "./skin-model/board.ts"
import type { SkinModel } from "./skin-model/model.ts"
import type { ToolbarItem } from "./skin-model/panel.ts"
import type { LayerPaint } from "./paint/key.ts"

/** 按工具栏项取图标图层；没有 icon 或模型里没有这张图的项跳过。 */
export async function toolbarItemPaints(
  model: SkinModel | undefined,
  items: readonly ToolbarItem[],
): Promise<LayerPaint[]> {
  if (!model) return []
  const builds: Array<Promise<LayerPaint | undefined>> = []
  for (const item of items) {
    if (!item.icon) continue
    const imageID = model.resourceIndex.get(item.icon) ?? item.icon
    const image = model.images.get(imageID)
    if (!image) continue
    builds.push(bitmapOf(image).then((bitmap) => bitmap ? { layer: { kind: "image" as const, image: imageID }, bitmap } : undefined))
  }
  return (await Promise.all(builds)).filter((paint): paint is LayerPaint => paint !== undefined)
}

export async function toolbarPaints(model: SkinModel | undefined, board: Board | undefined): Promise<LayerPaint[]> {
  return toolbarItemPaints(model, board?.panels?.toolbar?.items ?? [])
}
