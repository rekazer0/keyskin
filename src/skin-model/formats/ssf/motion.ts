// 搜狗动画：`anim.ini` 的四层段与非键字段。
//
// 关键帧段（`Keyframe_*`）有确定的含义——`TIME` 与 `VALUE` 一一对应的多点曲线——落成 IR 的 `track`。
// 其余三层（`Anim_Style_*`、`Animation_*`、`Anim_Obj_*`）的字段语义还没吃透：
// 它们只描述「谁引用谁」和对象参数，硬塞进 `track` 会编出一个不存在的时间曲线。
// 因此这些段原样存成 `opaque` 节点，字段一个不少，写回时按原样重建。
import type { IniDocument } from "@/ini.ts"
import type { MotionNode } from "@/skin-model/motion.ts"
import type { SsfLook } from "@/skin-model/formats/ssf/read.ts"

/** 动效 id 带时段：两套外观各有一份 anim.ini，段名可能相同。 */
export function ssfMotionId(look: string, section: string): string {
  return `ssf:anim:${look}/${section}`
}

/** 动效 id 拆回时段与段名。 */
export function parseSsfMotionId(id: string): { look: string; section: string } | undefined {
  const match = /^ssf:anim:([^/]+)\/(.+)$/.exec(id)
  return match ? { look: match[1], section: match[2] } : undefined
}

type OpaqueAnimation = { section: string; entries: Array<[string, string]> }

function entriesOf(document: IniDocument, section: string): Array<[string, string]> {
  return document.entries(section).map((entry) => [entry.key, entry.value])
}

/** `TIME=0,0.5,1` 与 `VALUE=1,0.9,1` 一对一配对；长度不一致时只取两边都有的部分。 */
function keyframesOf(time: number[], value: number[]): Array<{ time: number; value: number }> {
  return time.slice(0, Math.min(time.length, value.length)).map((at, index) => ({ time: at, value: value[index] }))
}

function numbersOf(value: string | undefined): number[] {
  const numbers = value?.split(",").map((part) => Number(part.trim())) ?? []
  return numbers.every(Number.isFinite) ? numbers : []
}

/** 一个 `anim.ini` → 动效表；段名在前缀里带时段。 */
export function ssfMotions(look: SsfLook, document: IniDocument): Map<string, MotionNode> {
  const motions = new Map<string, MotionNode>()
  for (const section of document.sections()) {
    const id = ssfMotionId(look.name, section)
    if (/^Keyframe_/i.test(section)) {
      const keyframes = keyframesOf(numbersOf(document.get(section, "TIME")), numbersOf(document.get(section, "VALUE")))
      if (!keyframes.length) continue
      motions.set(id, {
        kind: "track",
        target: { subject: "unknown", property: "unknown" },
        keyframes,
      })
      continue
    }
    const entries = entriesOf(document, section)
    if (!entries.length) continue
    const blob: OpaqueAnimation = { section, entries }
    motions.set(id, { kind: "opaque", format: "ssf", blob })
  }
  return motions
}

/** 动效节点 → `anim.ini` 的段。关键帧段由 `track` 重建，其余按原字段写回。 */
export function ssfMotionText(motions: ReadonlyMap<string, MotionNode>): string {
  const lines: string[] = []
  for (const [id, node] of motions) {
    const parsed = parseSsfMotionId(id)
    if (!parsed) continue
    if (node.kind === "track") {
      lines.push(`[${parsed.section}]`)
      lines.push(`TIME=${node.keyframes.map((frame) => frame.time).join(",")}`)
      lines.push(`VALUE=${node.keyframes.map((frame) => frame.value).join(",")}`)
      lines.push("")
      continue
    }
    if (node.kind !== "opaque") continue
    const blob = node.blob as OpaqueAnimation | undefined
    if (!blob?.entries?.length) continue
    lines.push(`[${blob.section ?? parsed.section}]`)
    for (const [key, value] of blob.entries) lines.push(`${key}=${value}`)
    lines.push("")
  }
  return lines.join("\n")
}
