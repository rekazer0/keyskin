// Baidu permits candidate hit boxes outside the bar; Palm clips their artwork to those boxes.
import { numbers } from "./palm-board.ts"
import { asObject, rectParts, type JsonObject } from "./sxi-ini.ts"

export function fitCandidateIcons(boards: JsonObject, candidates: JsonObject): void {
  const global = asObject(asObject(boards.defaultGlobal)?.cand) ?? {}
  for (const [name, value] of Object.entries(candidates)) {
    const candidate = asObject(value)
    if (!candidate || !Array.isArray(candidate.icon_list)) continue
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
  }
}
