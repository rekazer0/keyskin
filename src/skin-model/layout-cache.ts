// 布局计算结果的派生缓存。
//
// 键是布局树本身：树被替换时缓存自然失效，不需要手动清理，也不会出现两份状态。
// 视图与检查器都读这里，避免同一块板反复跑布局。
import type { SkinBoard } from "./board.ts"
import type { LayoutBox, LayoutNode } from "./layout.ts"
import { computeLayout } from "./layout.ts"

const cache = new WeakMap<LayoutNode, ReadonlyMap<string, LayoutBox>>()

/** 算一遍布局并缓存；已经算过就直接给。 */
export async function layoutOf(board: SkinBoard): Promise<ReadonlyMap<string, LayoutBox>> {
  const cached = cache.get(board.layout)
  if (cached) return cached
  const rects = await computeLayout(board.layout, board.size)
  cache.set(board.layout, rects)
  return rects
}

/** 只读缓存；还没算过时返回 undefined，由调用方决定是等待还是先留空。 */
export function cachedLayout(board: SkinBoard): ReadonlyMap<string, LayoutBox> | undefined {
  return cache.get(board.layout)
}

/** 预热一块板的布局，用于模型更新后让同步渲染能直接读到。 */
export async function warmLayout(board: SkinBoard): Promise<void> {
  await layoutOf(board)
}
