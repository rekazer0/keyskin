// 手心 `skin.json` 的取值工具。
//
// 手心的矩形是「原点对 + 尺寸对」两段数组；颜色有 6 位 RGB 与 8 位 ARGB 两种写法。
// IR 统一按 8 位 ARGB 存，写回时按原槽的写法回写，结构才不会因为归一化而变。
import type { Json, JsonObject } from "@/palm/sxi-ini.ts"
import { asObject, rectParts } from "@/palm/sxi-ini.ts"
import type { Box, Color } from "@/skin-model/types.ts"

export function numberOf(value: Json | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function textOf(value: Json | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function numbersOf(value: Json | undefined): number[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "number" && Number.isFinite(item) ? [item] : []))
    : []
}

export function arrayOf(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : []
}

export function objectOf(value: Json | undefined): JsonObject | undefined {
  return value === undefined ? undefined : asObject(value)
}

export function boxOf(value: Json | undefined): Box | undefined {
  const parts = rectParts(value ?? null)
  return parts ? { x: parts[0], y: parts[1], width: parts[2], height: parts[3] } : undefined
}

export function boxJson(box: Box): [[number, number], [number, number]] {
  return [[box.x, box.y], [box.width, box.height]]
}

/** 6 位 RGB 补上不透明通道；8 位原样。 */
export function colorOf(value: Json | undefined): Color | undefined {
  const text = textOf(value)?.trim()
  if (!text || !/^[0-9a-f]{6,8}$/i.test(text)) return
  return (text.length === 6 ? `FF${text}` : text).toUpperCase()
}

/** 写回颜色：原槽是 6 位就写 6 位，否则写 IR 的 8 位。 */
export function colorJson(color: Color, original: Json | undefined): string {
  return typeof original === "string" && original.trim().length === 6 ? color.slice(-6) : color
}
