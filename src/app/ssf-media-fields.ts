import { element } from "../dom-element.ts"
import { ssfFieldLabel } from "../ssf/ssf-labels.ts"
import { styleKindIcon, styleReferenceAddButton, styleReferenceCard } from "../style-card.ts"
import type { StyleLibraryPayload } from "../picker-window"
import { openStylePicker } from "./style-picker"
import { isEditing } from "./edit-history"
import { fieldCaption } from "./property-rows"
import { ssfPackage, ssfTheme } from "./ssf-documents"
import { editSsfAnimation, openSsfAnimationPicker, ssfAnimationPreview } from "./ssf-animation-picker"
import { keySoundSample } from "./style-card-preview"
import { appState } from "./state"

const ANIMATION_FIELDS = new Set(["ANIM_STYLE", "BG_ANIM", "FG_ANIM", "DECO_ANIM"])

function soundPath(value: string): string | undefined {
  return ssfPackage()?.soundPath(ssfTheme(), value)
}

function soundOptions(): string[] {
  return [...new Set((appState.archive?.names() ?? []).flatMap(path => {
    const match = path.match(/^default\/(?:res\/)?([^/]+)\.(?:wav|ogg|mp3)$/i)
    return match ? [match[1]] : []
  }))].sort()
}

function chooseSound(current: string, commit: (value: string) => void): void {
  if (!isEditing()) return
  const archive = appState.archive
  const input = element("input")
  input.value = current
  input.dataset.ssfSound = "true"
  input.addEventListener("change", () => {
    if (appState.archive === archive && isEditing() && soundOptions().includes(input.value)) commit(input.value)
  })
  openStylePicker(input)
}

export function ssfSoundLibraryPayload(input: HTMLInputElement): StyleLibraryPayload {
  return {
    sliceBack: false, editable: isEditing() && !input.disabled, canAdd: false,
    soundOnly: true, foreground: false, bda: false, kind: "sound", currentID: input.value,
    imagesCompatible: false, bitmaps: {}, animationText: "", animationFiles: {}, particleVisuals: {},
    styles: [], images: [], sounds: soundOptions().map(value => {
      const path = soundPath(value)
      return { styleID: value, label: value, filename: path?.split("/").pop() ?? value, playable: Boolean(path) }
    }),
  }
}

/** 动画和音效同百度共用引用卡；文件名输入与配置提交仍使用搜狗原始值。 */
export function ssfMediaField(path: string, key: string, value: string, commit: (value: string) => void): HTMLElement | undefined {
  if (key !== "sound" && !ANIMATION_FIELDS.has(key)) return
  const row = element("div", "ui-field style-reference-field")
  const label = ssfFieldLabel(key)
  fieldCaption(row, key, label)
  const choose = () => key === "sound" ? chooseSound(value, commit) : openSsfAnimationPicker(path, key, value, commit)
  if (!value.trim()) {
    row.firstElementChild?.append(styleReferenceAddButton(`添加${label}`, choose, !isEditing()))
    return row
  }
  const name = element("input", "ui-style-ref-name")
  name.value = value
  name.title = value
  name.disabled = !isEditing()
  name.spellcheck = false
  name.setAttribute("aria-label", label)
  name.addEventListener("change", () => commit(name.value.trim()))
  const file = key === "sound" ? soundPath(value) : undefined
  row.append(styleReferenceCard({ name, kind: styleKindIcon(key === "sound" ? "sound" : "anim"), disabled: !isEditing(),
    states: [{ label, content: key === "sound" ? keySoundSample(file?.split("/").pop() ?? value, file) : ssfAnimationPreview(path, key, value),
      onClick: edit => {
        if (edit && key !== "sound") editSsfAnimation(path, key, value)
        else choose()
      },
    }],
    remove: { label: `移除${label}`, run: () => commit("") },
  }))
  return row
}
