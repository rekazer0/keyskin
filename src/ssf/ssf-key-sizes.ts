// 搜狗官方骨架里每个按键类的最大显示尺寸。
//
// 百度皮肤把按键图按原图分辨率切成独立 PNG，搜狗客户端再把它拉伸进骨架的按键矩形
// （`VIEW_RECT`）：原图比骨架按键大出来的像素只会让 `.ssf` 变大，不会更清晰。
// 导出时按本表等比缩图。尺寸取自 `public/sogou-template.bds`，这个 BDS 由官方 APK 的布局生成，
// 每个 `[KEYn]` 的 `VIEW_RECT` 就是官方布局里这个键占的矩形，`CENTER` 决定它落到哪个按键类。
// 同一个类出现在多个布局和横竖屏里，宽、高各取最大值：一份背景图要覆盖所有外观。

import { IniDocument } from "../ini.ts"
import type { SkinArchive } from "../skin.ts"
import { ssfKeyBinding } from "./ssf-keymap.ts"

/** 宽、高，单位是骨架画布（通常 1080 宽）上的像素。 */
export type SogouKeySize = [number, number]

function numbers(value: string | undefined): number[] {
  return value?.split(",").map((part) => Number(part.trim())) ?? []
}

/**
 * 每个按键类（含 `KeyBg_*` 默认背景类）在官方骨架里的最大显示尺寸。
 * 没有骨架布局（不是 BDS 树）的模板返回空表，导出时保持原图。
 */
export function sogouKeySizes(template: SkinArchive): Map<string, SogouKeySize> {
  const official = new Map<string, SogouKeySize>()
  // 骨架的 `SSF_SECTION` 是官方布局里这个键自己的类名；没有它的模板按布局名和动作推类名，
  // 推出来的类名正是百度皮肤导出时用的名字（如 `Key_Q`、`Key_Q_Land`），补上官方没直接命名的类。
  const computed = new Map<string, SogouKeySize>()
  const record = (sizes: Map<string, SogouKeySize>, binding: ReturnType<typeof ssfKeyBinding>, width: number, height: number) => {
    for (const name of [binding.sections[0], ...binding.defaults]) {
      if (!name) continue
      const previous = sizes.get(name)
      sizes.set(name, [Math.max(previous?.[0] ?? 0, width), Math.max(previous?.[1] ?? 0, height)])
    }
  }
  for (const path of template.names()) {
    const match = path.match(/\/(port|land)\/([^/]+)\.ini$/)
    if (!match || match[2] === "gen") continue
    const landscape = match[1] === "land"
    const layout = match[2]
    const document = IniDocument.parse(template.getText(path))
    for (const section of document.sections().filter((name) => /^KEY\d+$/.test(name))) {
      const action = document.get(section, "CENTER")?.trim()
      const [, , width, height] = numbers(document.get(section, "VIEW_RECT"))
      if (!action || !(width > 0 && height > 0)) continue
      const plain = ssfKeyBinding(layout, action, landscape)
      const sourceSection = document.get(section, "SSF_SECTION")?.trim()
      const sourceBackground = document.get(section, "SSF_BG")?.trim()
      record(computed, plain, width, height)
      // 官方骨架写着自己的类名，比按布局名推更准（14 键这类变体布局的类不同）。
      record(official, sourceSection ? ssfKeyBinding(layout, action, landscape, sourceSection, sourceBackground) : plain, width, height)
    }
  }
  for (const [name, size] of computed) if (!official.has(name)) official.set(name, size)
  return official
}
