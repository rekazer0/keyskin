import { element } from "../dom-element.ts"
import { createIcon } from "../icons"
import { ANIMATION_FAMILIES, animationReferences, newAnimation } from "../palm/sxi-animation.ts"
import { asObject, type JsonObject } from "../palm/sxi-ini.ts"
import { editSxi, sxiValue, type SxiPointer } from "./sxi-fields"
import { isEditing } from "./edit-history"
import { appState } from "./state"

// IDs are shared by inherited animations as well as orientation-specific overrides.
function appendAnimation(skin: JsonObject, pointer: SxiPointer, create: (id: string) => JsonObject): void {
  const theme = asObject(skin[String(pointer[0])]) ?? {}
  const ids = new Set(["s_info", "s_port", "s_land"].flatMap((key) => Object.keys(asObject(asObject(theme[key])?.ss_2) ?? {})))
  let id = 1
  while (ids.has(String(id))) id += 1
  const table = asObject(sxiValue(skin, pointer))
  if (!table) throw new Error("skin.json 中缺少动画表")
  table[String(id)] = create(String(id))
}

export function animationCreateControl(pointer: SxiPointer): HTMLElement {
  const row = element("label", "ui-field document-property-field")
  const caption = element("span", "document-field-caption")
  caption.textContent = "添加动画"
  const control = element("span", "ui-input ui-select")
  const select = element("select")
  select.setAttribute("aria-label", "添加动画类型")
  select.disabled = !isEditing()
  select.append(new Option("选择动效类型…", ""))
  for (const family of ANIMATION_FAMILIES) {
    if (appState.animationDesignMode !== "all" && (family.id === "a4") !== (appState.animationDesignMode === "particle")) continue
    select.append(new Option(family.label, family.id))
  }
  select.addEventListener("change", () => {
    const kind = select.value
    if (kind) editSxi((skin) => appendAnimation(skin, pointer, (id) => newAnimation(kind, id)))
  })
  control.append(select)
  row.append(caption, control)
  return row
}

export function animationActions(pointer: SxiPointer, id: string, skin: JsonObject): HTMLElement {
  const actions = element("span", "sxi-combo-actions")
  const refs = animationReferences(skin, pointer, id)
  const used = refs.styles.length > 0 || refs.combos.length > 0
  for (const [icon, label, run] of [
    ["copy", `复制动画 ${id}`, () => editSxi((current) => appendAnimation(current, pointer, (next) => {
      const wrap = structuredClone(asObject(sxiValue(current, [...pointer, id])) ?? {})
      wrap.id = `ANIM${next}`
      return wrap
    }))],
    ["trash-2", `删除动画 ${id}`, () => editSxi((current) => {
      const latest = animationReferences(current, pointer, id)
      if (latest.styles.length || latest.combos.length) return
      const table = asObject(sxiValue(current, pointer))
      if (table) delete table[id]
    })],
  ] as const) {
    const button = element("button", "ui-icon-button")
    button.type = "button"
    button.dataset.size = "sm"
    button.setAttribute("aria-label", label)
    button.title = icon === "trash-2" && used ? "请先解除样式和组合引用" : label
    button.disabled = !isEditing() || icon === "trash-2" && used
    button.append(createIcon(icon, 14))
    button.addEventListener("click", run)
    actions.append(button)
  }
  return actions
}
