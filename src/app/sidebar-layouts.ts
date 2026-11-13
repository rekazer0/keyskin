import { iconButton } from "../dom-element"
import { panelScaleButton } from "./dom"
import { isEditing } from "./edit-history"
import { requestEditMode } from "./mobile-layout"

/** 布局分组提供添加入口，并标注键位数量。 */
export function decorateLayoutGroup(body: HTMLElement): void {
  const rows = Array.from(body.querySelectorAll<HTMLButtonElement>("button.nav-item"))
  const summary = body.previousElementSibling!
  const add = iconButton("plus", "添加布局（面板复制）", () => {
    if (!isEditing()) return requestEditMode()
    panelScaleButton.click()
  })
  add.addEventListener("click", (event) => event.preventDefault())
  summary.append(add)
  for (const row of rows) {
    const size = row.dataset.path?.split("/").pop()?.match(/(?:^|_)(9|14|26)(?=_|\.)/)?.[1]
    if (size) {
      const count = document.createElement("span")
      count.className = "source-item-count"
      count.textContent = size
      row.append(count)
    }
  }
}
