// 其它格式的动效 → 搜狗 `anim.ini`。
//
// 搜狗的按键动画是 `Anim_Style_*` → `Animation_*` → `Anim_Obj_*` → `Keyframe_*` 四层结构，
// 与百度那套「样式号 + PRESS_ANIM」不同，转换由 `BaiduSsfMotion` 承担。
// 这里把 IR 动效翻成它要的两份输入，并记下每个按键落到哪个 `Anim_Style_*`，
// 写回时按键段的 `ANIM_STYLE` 才能指向真正存在的动画。
import { IniDocument } from "@/ini.ts"
import { BaiduSsfMotion } from "@/ssf/baidu-anim-to-ssf.ts"
import { writeMotions } from "@/skin-model/formats/bds/index.ts"
import type { Board } from "@/skin-model/board.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import { cachedLayout, layoutOf } from "@/skin-model/layout-cache.ts"

/**
 * 生成搜狗动画文档与按键绑定。
 * 搜狗按键只有「按下播放」一个入口，因此只处理 `press` 绑定。
 */
export async function ssfBaiduAnimationOf(
  model: SkinModel,
  board: Board,
  images: ReadonlyMap<string, SkinImage>,
): Promise<{ animation?: IniDocument; bindings: Map<string, string>; warnings: string[] }> {
  const warnings: string[] = []
  const bindings = new Map<string, string>()
  if (!model.motions.size) return { bindings, warnings }

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
  for (const [motionId, motion] of model.motions) {
    for (const binding of motion.bindings ?? []) {
      if (binding.slot !== "press") continue
      const keyId = keyOfTarget(binding.target)
      if (keyId !== undefined && !byKey.has(keyId)) byKey.set(keyId, motionId)
    }
  }
  if (!byKey.size) return { bindings, warnings }

  // `BaiduSsfMotion` 按 `ANIM<id>` 找段；IR 的 id 是格式自己的名字（`alpha:press`），
  // 这里补上百度侧的前缀，子段本来就是 `ANIM<n>`，不重复加。
  const raw = IniDocument.parse(writeMotions(model.motions))
  const animations = IniDocument.parse("")
  for (const section of raw.sections()) {
    animations.appendSection(/^ANIM/i.test(section) ? section : `ANIM${section}`, raw.entries(section))
  }
  // 每个要动的按键分到一个样式号，样式段里写它该播的动画。
  const styleOf = new Map<string, number>()
  let nextStyle = 1
  for (const keyId of byKey.keys()) styleOf.set(keyId, nextStyle++)
  const styleLines = [...byKey].flatMap(([keyId, motionId]) => [`[STYLE${styleOf.get(keyId)}]`, `PRESS_ANIM=${motionId}`, ""])
  const styles = IniDocument.parse(styleLines.join("\n"))
  const layout = IniDocument.parse([
    "[PANEL]",
    `SIZE=${board.container.width},${board.container.height}`,
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
  const converter = new BaiduSsfMotion(animations, styles, warnings, 1, picture, animation)
  // 按键尺寸来自布局树；导出前布局缓存可能还没热，先按同一来源算一次。
  const rects = cachedLayout(board) ?? (await layoutOf(board))
  for (const key of board.keys) {
    const rect = rects.get(key.id)
    if (!rect) continue
    const style = converter.press(layout, key.id, { width: rect.size.width, height: rect.size.height }, { width: board.container.width, height: board.container.height })
    if (style) bindings.set(key.id, style)
  }
  return { animation, bindings, warnings }
}
