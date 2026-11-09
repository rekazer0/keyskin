// Baidu permits candidate hit boxes outside the bar; Palm clips their artwork to those boxes.
import { numbers } from "./palm-board.ts"
import { asObject, rectParts, type JsonObject } from "./sxi-ini.ts"

export function fitCandidateIcons(boards: JsonObject, candidates: JsonObject, warnings: string[]): void {
  const global = asObject(asObject(boards.defaultGlobal)?.cand) ?? {}
  for (const [name, value] of Object.entries(candidates)) {
    const candidate = asObject(value)
    if (!candidate || !Array.isArray(candidate.icon_list)) continue
    if (candidate.icon_list.some((icon) => ["switchToChinese", "switchToEnglish", "numberBoard"].includes(String(asObject(icon)?.k)))) {
      const warning = "手心 Android 不支持百度候选栏中的自定义切换按钮，会使用手心原生工具栏；功能数量和顺序由手心设置决定"
      if (!warnings.includes(warning)) warnings.push(warning)
    }
    const sizes = Object.values(boards).flatMap((board) => {
      const own = asObject(asObject(board)?.cand) ?? {}
      if ((own.file ?? global.file) !== name) return []
      const rect = rectParts(candidate.rect ?? own.rect ?? global.rect)
      if (!rect || rect[2] <= 0 || rect[3] <= 0) return []
      const top = asObject(own.insets ?? global.insets)?.top
      return [[rect[2], Math.max(1, rect[3] - (typeof top === "number" ? Math.max(0, top) : 0))]]
    })
    if (!sizes.length) continue
    const width = Math.min(...sizes.map((size) => size[0]))
    const height = Math.min(...sizes.map((size) => size[1]))
    const oversized = candidate.icon_list.some((value) => (numbers(asObject(value)?.s)?.[1] ?? 0) > height)
    for (const value of candidate.icon_list) {
      const icon = asObject(value)
      const size = numbers(icon?.s)
      if (!icon || size?.length !== 2 || size.some((side) => side <= 0)) continue
      const [x, y] = numbers(icon.p) ?? [0, 0]
      const anchor = typeof icon.anchor === "number" ? icon.anchor : 1
      const ax = (anchor - 1) % 3 * width / 2
      const ay = (Math.ceil(anchor / 3) - 1) * height / 2
      const w = Math.min(size[0], width)
      // Off-screen icons deliberately hide Baidu's native row behind a custom toolbar.
      if (ax + x + size[0] <= 0 || ax + x >= width || ay + y + size[1] <= 0 || ay + y >= height) continue
      const h = Math.min(size[1], height)
      const px = Math.max(0, Math.min(ax + x, width - w)) - ax
      // An iOS toolbar with oversized edge hit boxes needs its native function row centred in the Palm bar.
      const py = oversized && icon.k === "switchContainer"
        ? (height - h) / 2 - ay
        : Math.max(0, Math.min(ay + y, height - h)) - ay
      if (w !== size[0] || h !== size[1]) icon.s = [w, h]
      if (px !== x || py !== y) icon.p = [px, py]
      const fixed = numbers(icon.f_size)
      if (fixed?.length !== 2 || fixed.some((side) => side <= 0)) continue
      // FIX_SIZE is in points; candidate geometry is in @3x pixels.
      const scale = Math.min(1, w / (fixed[0] * 3), h / (fixed[1] * 3))
      if (scale < 1) icon.f_size = fixed.map((side) => side * scale)
    }
    // Palm Android repeats the logo key's width for every native toolbar function; F14's size is ignored.
    const logo = candidate.icon_list.map(asObject).find((icon) => icon?.k === "logoMenu")
    const hide = candidate.icon_list.map(asObject).find((icon) => icon?.k === "hideBoard")
    const container = candidate.icon_list.map(asObject).find((icon) => icon?.k === "switchContainer")
    const containerSize = numbers(container?.s)
    const containerPos = numbers(container?.p) ?? [0, 0]
    const containerAnchor = typeof container?.anchor === "number" ? container.anchor : 1
    const containerX = (containerAnchor - 1) % 3 * width / 2 + containerPos[0]
    if (logo && hide && containerSize && containerX + containerSize[0] > 0 && containerX < width) {
      const slot = Math.floor(width / 7)
      if ((numbers(logo.s)?.[0] ?? 0) > slot) {
        logo.anchor = 1
        logo.p = [0, 0]
        logo.s = [slot, height]
      }
      if ((numbers(hide.s)?.[0] ?? 0) > slot) {
        hide.anchor = 3
        hide.p = [-slot, 0]
        hide.s = [slot, height]
      }
    }
  }
}
