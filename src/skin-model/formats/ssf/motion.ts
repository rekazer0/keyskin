// 动效写进搜狗皮肤包。
//
// 搜狗的动画是 `port/anim.ini`，结构与百度不同，转换由 `BaiduSsfMotion` 承担：
// 它读百度风格的 `anim.ini` 与带 `PRESS_ANIM` 的样式段，产出搜狗的动画段。
// 这里负责把 IR 动效翻译成那两份输入。
import { IniDocument } from "@/ini.ts"
import { BaiduSsfMotion } from "@/ssf/baidu-anim-to-ssf.ts"
import { writeMotions } from "@/skin-model/formats/bds/index.ts"
import type { SkinBoard } from "@/skin-model/board.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import { cachedLayout } from "@/skin-model/layout-cache.ts"

/**
 * 生成搜狗动画文档。
 * 搜狗按键只有「按下播放」一个入口，因此只处理 `press` 绑定。
 */
export async function ssfAnimationOf(
  model: SkinModel,
  board: SkinBoard,
  images: ReadonlyMap<string, SkinImage>,
): Promise<{ animation: IniDocument | undefined; warnings: string[] }> {
  const warnings: string[] = []
  if (!model.motions.size) return { animation: undefined, warnings }

  // 绑定目标有三种形态：`style:<样式名>`、按键 id、`KEY_<字母>`（按动作匹配）。
  const keyOfTarget = (target: string): string | undefined => {
    if (target.startsWith("style:") || target.startsWith("panel")) return
    const direct = board.keys.find((key) => key.id === target)
    if (direct) return direct.id
    const letter = /^KEY_([A-Z])$/.exec(target)
    if (!letter) return
    const wanted = letter[1].toLowerCase()
    return board.keys.find((key) => {
      const press = key.actions.press
      return press?.kind === "text" && press.value.toLowerCase() === wanted
    })?.id
  }
  const byKey = new Map<string, string>()
  for (const motion of model.motions.values()) {
    for (const binding of motion.bindings) {
      if (binding.slot !== "press") continue
      const keyId = keyOfTarget(binding.target)
      if (keyId !== undefined && !byKey.has(keyId)) byKey.set(keyId, motion.id)
    }
  }
  if (!byKey.size) return { animation: undefined, warnings }

  const animations = IniDocument.parse(writeMotions(model.motions))
  // 每个要动的按键分到一个样式号，样式段里写它该播的动画。
  const styleOf = new Map<string, number>()
  let nextStyle = 1
  for (const keyId of byKey.keys()) styleOf.set(keyId, nextStyle++)
  const styleLines = [...byKey].flatMap(([keyId, motionId]) => [`[STYLE${styleOf.get(keyId)}]`, `PRESS_ANIM=${motionId}`, ""])
  const styles = IniDocument.parse(styleLines.join("\n"))
  const layout = IniDocument.parse([
    "[PANEL]",
    `SIZE=${board.size.width},${board.size.height}`,
    "",
    ...board.keys.flatMap((key) => {
      const styleId = styleOf.get(key.id)
      return styleId === undefined ? [`[${key.id}]`, ""] : [`[${key.id}]`, `BACK_ANIM_STYLE=${styleId}`, ""]
    }),
  ].join("\n"))

  const animation = IniDocument.parse("")
  const picture = (id: string) => {
    const image = images.get(id)
    return image ? { file: id.split("/").pop() ?? id, width: image.width, height: image.height } : undefined
  }
  const motion = new BaiduSsfMotion(animations, styles, warnings, 1, picture, animation)
  // 按键尺寸来自布局树的派生缓存，与写回同一个来源。
  for (const key of board.keys) {
    const rect = cachedLayout(board)?.get(key.id)
    if (!rect) continue
    motion.press(layout, key.id, { width: rect.size.width, height: rect.size.height }, { width: board.size.width, height: board.size.height })
  }
  return { animation, warnings }
}
