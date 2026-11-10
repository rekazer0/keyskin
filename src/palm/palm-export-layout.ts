// Baidu permits candidate hit boxes outside the bar; Palm clips their artwork to those boxes.
import { numbers } from "./palm-board.ts"
import { asObject, rectParts, type JsonObject } from "./sxi-ini.ts"

/** Android hides the dedicated English suggestion key; its gesture on the language key still works. */
export function fitEnglishEnter(boards: JsonObject): void {
  for (const [type, value] of Object.entries(boards)) {
    if (!type.startsWith("full26English")) continue
    const board = asObject(value)
    if (!Array.isArray(board?.keys)) continue
    const keys = board.keys.map(asObject).filter((key): key is JsonObject => Boolean(key))
    const center = (key: JsonObject) => {
      const values = Array.isArray(key.values) ? key.values : []
      for (let at = 0; at + 1 < values.length; at += 2) if (values[at] === 4) return values[at + 1]
    }
    const enter = keys.find((key) => center(key) === "enter")
    const toggle = keys.find((key) => center(key) === "toggleLettersSuggestions")
    const rect = rectParts(enter?.rect), other = rectParts(toggle?.rect)
    if (!enter || !toggle || !rect || !other || rect[1] !== other[1] || rect[3] !== other[3]
      || other[0] + other[2] !== rect[0]) continue
    // Do not discard the feature on skins that have no second way to reach it.
    if (!keys.some((key) => key !== toggle && Array.isArray(key.values)
      && key.values.some((action, at) => at % 2 === 1 && action === "toggleLettersSuggestions"))) continue
    const actions = [toggle.values, ...(numbers(toggle.fix_a) ?? []).flatMap((id, at) =>
      at % 2 === 1 ? [asObject(asObject(board.key_fix)?.[String(id)])?.v] : [])]
    if (actions.some((values) => Array.isArray(values)
      && values.some((action, at) => at % 2 === 1 && action !== "toggleLettersSuggestions"))) continue
    for (const key of keys) {
      const back = rectParts(key.rect)
      if (key === enter || Array.isArray(key.values) && key.values.length || !back
        || back[0] > rect[0] || back[1] > rect[1] || back[0] + back[2] < rect[0] + rect[2]
        || back[1] + back[3] < rect[1] + rect[3] || back[2] >= rect[2] + other[2]) continue
      // A separate shadow plate must grow with the key face.
      key.rect = [[back[0] - other[2], back[1]], [back[2] + other[2], back[3]]]
      const hit = rectParts(key.hit_rect)
      if (hit) key.hit_rect = [[hit[0] - other[2], hit[1]], [hit[2] + other[2], hit[3]]]
    }
    enter.rect = [[other[0], rect[1]], [rect[2] + other[2], rect[3]]]
    const hit = rectParts(enter.hit_rect), otherHit = rectParts(toggle.hit_rect)
    if (hit && otherHit) enter.hit_rect = [[otherHit[0], hit[1]], [hit[0] + hit[2] - otherHit[0], hit[3]]]
    board.keys = board.keys.filter((key) => key !== toggle)
  }
}

export function candidateDimensions(boards: JsonObject, candidate: JsonObject, name: string): { width: number; height: number } | undefined {
  const global = asObject(asObject(boards.defaultGlobal)?.cand) ?? {}
  const sizes = Object.values(boards).flatMap((board) => {
    const own = asObject(asObject(board)?.cand) ?? {}
    if ((own.file ?? global.file) !== name) return []
    const rect = rectParts(candidate.rect ?? own.rect ?? global.rect)
    if (!rect || rect[2] <= 0 || rect[3] <= 0) return []
    const top = asObject(own.insets ?? global.insets)?.top
    return [[rect[2], Math.max(1, rect[3] - (typeof top === "number" ? Math.max(0, top) : 0))]]
  })
  if (!sizes.length) return
  return { width: Math.min(...sizes.map((size) => size[0])), height: Math.min(...sizes.map((size) => size[1])) }
}

export function fitCandidateIcons(boards: JsonObject, candidates: JsonObject, warnings: string[]): void {
  for (const [name, value] of Object.entries(candidates)) {
    const candidate = asObject(value)
    if (!candidate || !Array.isArray(candidate.icon_list)) continue
    if (candidate.icon_list.some((icon) => ["switchToChinese", "switchToEnglish", "numberBoard"].includes(String(asObject(icon)?.k)))) {
      const warning = "手心 Android 不支持百度候选栏中的自定义切换按钮，会使用手心原生工具栏；功能数量和顺序由手心设置决定"
      if (!warnings.includes(warning)) warnings.push(warning)
    }
    const dimensions = candidateDimensions(boards, candidate, name)
    if (!dimensions) continue
    const { width, height } = dimensions
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
    // Palm Android repeats logo width + CELL_W/2 for every toolbar slot; F14's width is ignored.
    const logo = candidate.icon_list.map(asObject).find((icon) => icon?.k === "logoMenu")
    const hide = candidate.icon_list.map(asObject).find((icon) => icon?.k === "hideBoard")
    const container = candidate.icon_list.map(asObject).find((icon) => icon?.k === "switchContainer")
    const containerSize = numbers(container?.s)
    const containerPos = numbers(container?.p) ?? [0, 0]
    const containerAnchor = typeof container?.anchor === "number" ? container.anchor : 1
    const containerX = (containerAnchor - 1) % 3 * width / 2 + containerPos[0]
    if (logo && hide && containerSize && containerX + containerSize[0] > 0 && containerX < width) {
      const gap = typeof candidate.gap === "number" ? Math.max(0, candidate.gap) : 0
      const slot = Math.max(1, Math.floor(width / 7 - gap / 2))
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
