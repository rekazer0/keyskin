import { chooseReferenceValue } from "./ask.ts"
import { element } from "../dom-element.ts"
import { styleReferenceCard, soundStyleSample } from "../style-card.ts"

/** 音效文件、引用、试听与移除共用卡片；选择和取消不改配置。 */
export function soundControl(spec: { value: string; files: readonly string[]; sample?: HTMLElement }, label: string, disabled: boolean, commit: (value: string) => void): HTMLElement {
  const files = [...new Set([spec.value, ...spec.files].filter(Boolean))]
  const name = element("input", "ui-style-ref-name")
  name.value = spec.value
  name.placeholder = "未设置"
  name.disabled = disabled
  name.setAttribute("aria-label", label)
  name.addEventListener("input", () => name.setCustomValidity(""))
  name.addEventListener("change", () => {
    const next = name.value.trim()
    name.setCustomValidity(next && !files.includes(next) ? "请选择皮肤内的音效文件" : "")
    if (name.reportValidity()) commit(next)
  })
  const choose = () => {
    if (disabled) return
    chooseReferenceValue("音效", spec.value, files.map(file => [file, file]), value => {
      if (card.isConnected) commit(value)
    })
  }
  const sample = spec.sample ?? soundStyleSample(spec.value || undefined)
  sample.querySelector(".ui-style-sound-info > strong")?.remove()
  const card = styleReferenceCard({ name, states: [{ label: `更换${label === "文件" ? "音效" : label}`, content: sample, onClick: disabled ? undefined : choose }], disabled,
    remove: { label: `移除${label}`, run: () => commit("") },
  })
  return card
}
