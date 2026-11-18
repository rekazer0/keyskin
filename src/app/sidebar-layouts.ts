import { iconButton } from "../dom-element"
import { panelScaleButton } from "./dom"
import { isEditing } from "./edit-history"
import { requestEditMode } from "./mobile-layout"

/** 布局分组提供添加入口。 */
export function decorateLayoutGroup(body: HTMLElement): void {
  const summary = body.previousElementSibling!
  const add = iconButton("plus", "添加布局（面板复制）", () => {
    if (!isEditing()) return requestEditMode()
    panelScaleButton.click()
  })
  add.addEventListener("click", (event) => event.preventDefault())
  summary.append(add)
}
