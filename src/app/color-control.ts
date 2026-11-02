import { element } from "../dom-element.ts"

export function parseStyleColor(value: string): { hex: string; alpha: number } | undefined {
  const clean = value.trim().replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(clean)) return
  const normalized = clean.length === 6 ? `FF${clean}` : clean.toUpperCase()
  return { hex: normalized.slice(2), alpha: Number.parseInt(normalized.slice(0, 2), 16) / 255 }
}

/** 色块、色值、透明度共用一个提交入口，一次选择只记一步撤销。 */
export function colorValueControl(textInput: HTMLInputElement, label: string): HTMLElement {
  const control = element("span", "color-control ui-input ui-color")
  const picker = element("input")
  picker.type = "color"
  picker.setAttribute("aria-label", `${label}颜色选择器`)
  const alpha = element("input")
  alpha.type = "number"
  alpha.min = "0"
  alpha.max = "1"
  alpha.step = "0.01"
  alpha.setAttribute("aria-label", `${label}透明度`)
  textInput.setAttribute("aria-label", `${label}值`)
  const sync = () => {
    const parsed = parseStyleColor(textInput.value)
    picker.value = `#${parsed?.hex ?? "000000"}`
    alpha.value = String(parsed?.alpha ?? 1)
    picker.disabled = alpha.disabled = textInput.disabled
  }
  const write = () => {
    if (alpha.value === "" || !Number.isFinite(Number(alpha.value)) || Number(alpha.value) < 0 || Number(alpha.value) > 1) return
    textInput.value = `${Math.round(Number(alpha.value) * 255).toString(16).padStart(2, "0")}${picker.value.slice(1)}`.toUpperCase()
    textInput.dispatchEvent(new Event("change", { bubbles: true }))
  }
  textInput.addEventListener("input", sync)
  textInput.addEventListener("change", sync)
  picker.addEventListener("change", write)
  alpha.addEventListener("change", write)
  control.append(picker, textInput, alpha)
  sync()
  return control
}
