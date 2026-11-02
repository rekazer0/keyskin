// BDI/BDS layout → animation style → event binding. No preview-item values: comma slots and
// inherited state sections must be read from the source document without normalising other fields.
import { IniDocument } from "./ini.ts"
import { effectivePanelSection, stateTipSection } from "./panel-tools.ts"

export type LayoutAnimationField = "ANIM_STYLE" | "BACK_ANIM_STYLE" | "FORE_ANIM_STYLE"
export type AnimationBindingTarget = { section: string; field: LayoutAnimationField; index?: number; state?: number }
export type AnimationBinding = {
  section: string
  sourceSection: string
  field: LayoutAnimationField
  index: number
  raw: string | undefined
  style: string | undefined
  animation: string | undefined
}

/** Effective state section overrides a field as a whole; missing fields inherit from the key. */
export function readAnimationBinding(layout: IniDocument, styles: IniDocument, target: AnimationBindingTarget, trigger: string): AnimationBinding {
  const section = effectivePanelSection(layout, target.section, target.state)
  const sourceSection = layout.get(section, target.field) === undefined ? target.section : section
  const raw = layout.get(sourceSection, target.field)
  const index = target.field === "FORE_ANIM_STYLE" ? Math.max(0, Math.trunc(target.index ?? 0)) : 0
  const slots = raw?.split(",")
  const token = (target.field === "FORE_ANIM_STYLE" ? slots?.[index] ?? slots?.[0] : raw)?.trim()
  const style = token && /^\d+$/.test(token) && Number(token) > 0 ? token : undefined
  return { section, sourceSection, field: target.field, index, raw, style, animation: style ? styles.get(`STYLE${style}`, trigger)?.trim() : undefined }
}

type Field = { key: string; value: string }
const fieldsOf = (styles: IniDocument, id: string | undefined): Field[] =>
  id ? styles.entries(`STYLE${id}`).map(({ key, value }) => ({ key, value })) : []

// Include INFO, unknown fields, empty values and duplicates. Field order is not semantic, but the
// order of duplicate keys is (IniDocument reads the first), so compare each key's complete values.
function signature(fields: Field[]): string {
  const grouped = new Map<string, string[]>()
  for (const { key, value } of fields) grouped.set(key, [...grouped.get(key) ?? [], value])
  return JSON.stringify([...grouped].sort(([a], [b]) => a.localeCompare(b)))
}

function styleWith(styles: IniDocument, binding: AnimationBinding, trigger: string, animation: string | undefined, label: string): string | undefined {
  const original = fieldsOf(styles, binding.style)
  let replaced = false
  const fields = original.flatMap((field) => {
    if (field.key !== trigger) return [field]
    if (animation === undefined) return []
    if (replaced) return [field]
    replaced = true
    return [{ key: trigger, value: animation }]
  })
  if (animation !== undefined && !replaced) fields.push({ key: trigger, value: animation })
  // An empty style has no events left; release its slot, never the other foreground slots.
  if (!fields.length) return undefined
  const ids = styles.sections().flatMap((section) => section.match(/^STYLE(\d+)$/)?.[1] ?? []).filter((id) => Number(id) > 0)
  const matching = () => {
    const wanted = signature(fields)
    return ids.find((id) => signature(fieldsOf(styles, id)) === wanted)
  }
  const existing = matching()
  if (existing) return existing
  if (animation !== undefined && !original.some(({ key }) => key === "INFO")) {
    const base = binding.style && original.length ? `（基于样式 ${binding.style}）` : ""
    fields.unshift({ key: "INFO", value: `${label}播放动画 ${animation}${base}` })
    const labelled = matching()
    if (labelled) return labelled
  }
  const id = String(Math.max(0, ...ids.map(Number)) + 1)
  styles.appendSection(`STYLE${id}`, fields)
  if (Number(styles.get("GLOBAL", "STYLE_NUM") ?? -1) < Number(id)) {
    if (!styles.sections().includes("GLOBAL")) styles.appendSection("GLOBAL", [{ key: "STYLE_NUM", value: id }])
    else styles.set("GLOBAL", "STYLE_NUM", id)
  }
  return id
}

/** A TIP may be shared by other keys or states: redirect only this key's active mapping before editing. */
function privateStateSection(layout: IniDocument, target: AnimationBindingTarget, section: string): string {
  if (section === target.section) return section
  const tip = section.replace(/^TIP/, "")
  const mappings = layout.entries().filter(({ key }) => key === "STAT_STYLE")
    .flatMap(({ value }) => [...value.matchAll(/S\d+_(\d+)/g)]).filter((match) => match[1] === tip)
  if (mappings.length < 2) return section
  const id = String(Math.max(0, ...layout.sections().flatMap((name) => name.match(/^TIP(\d+)$/)?.[1] ?? []).map(Number)) + 1)
  const next = `TIP${id}`
  layout.appendSection(next, layout.entries(section))
  let replaced = false
  const mapping = layout.get(target.section, "STAT_STYLE") ?? ""
  layout.set(target.section, "STAT_STYLE", mapping.replace(/S\d+_\d+/g, (token) => {
    if (replaced || stateTipSection(token, target.state) !== Number(tip)) return token
    replaced = true
    return token.replace(/_\d+$/, `_${id}`)
  }))
  if (layout.sections().includes("PANEL")) layout.set("PANEL", "TIP_NUM", String(layout.sections().filter((name) => /^TIP\d+$/.test(name)).length))
  return next
}

/** Copy-on-write for both key and panel bindings. Inputs and shared styles are never mutated. */
export function writeAnimationBindings(
  layoutBefore: string, stylesBefore: string, targets: readonly AnimationBindingTarget[],
  trigger: string, animation: string | undefined, label: string,
): { layout: string; styles: string } {
  const layout = IniDocument.parse(layoutBefore)
  const styles = IniDocument.parse(stylesBefore)
  for (const target of targets) {
    if (!layout.sections().includes(target.section)) continue
    const binding = readAnimationBinding(layout, styles, target, trigger)
    if (animation === undefined ? !binding.animation || binding.animation === "0" : binding.animation === animation) continue
    const id = styleWith(styles, binding, trigger, animation, label)
    binding.section = privateStateSection(layout, target, binding.section)
    if (target.field === "FORE_ANIM_STYLE") {
      const slots = binding.raw?.split(",") ?? []
      while (slots.length <= binding.index) slots.push(slots[0] ?? "")
      slots[binding.index] = id ?? "0"
      layout.set(binding.section, target.field, slots.join(","))
    } else {
      // A state section inherits absent fields, so explicit 0 is needed when clearing an override.
      layout.set(binding.section, target.field, id ?? "0")
    }
  }
  return { layout: layout.toString(), styles: styles.toString() }
}
