import { builtInProjectTemplateExtension } from "./operations.ts"
import { hydrateTemplateCardPreviews } from "./template-preview"
import { bindListboxKeys, element, iconButton } from "./dom-element.ts"
import { createIcon } from "./icons.ts"

export function projectChoice(form: HTMLFormElement): string {
  return String(new FormData(form).get("project-template") ?? "")
}

export function initializeProjectChooser(form: HTMLFormElement): void {
  form.classList.add("project-chooser", "ui-form")
  const heading = form.querySelector("h1, h2")!
  heading.textContent = matchMedia("(max-width: 760px)").matches ? "新建皮肤" : "新建项目"
  const header = form.querySelector("header")!
  header.className = "ui-dialog-header"
  const title = element("div")
  const count = element("span", "project-template-count")
  title.append(heading, count, Object.assign(element("p"), { textContent: "社区模板仅供技术交流，请勿商用；如有侵权，请联系作者下架。" }))
  header.replaceChildren(title, iconButton("upload", "上传文件", () => form.dispatchEvent(new Event("project-import"))))

  const body = element("div", "ui-dialog-body project-chooser-body")
  const options = [...form.querySelectorAll<HTMLLabelElement>("label.project-template-option")]
  const section = document.createElement("fieldset")
  const legend = document.createElement("legend")
  count.textContent = `${options.length} 个模板`
  legend.textContent = "选择模板"
  const grid = element("div", "project-template-grid")
  grid.setAttribute("role", "listbox")
  grid.setAttribute("aria-label", "内置模板")
  for (const option of options) {
    const input = option.querySelector<HTMLInputElement>("input")!
    input.hidden = true
    option.className = "ui-project-card template-card project-template-card"
    option.dataset.template = input.value
    option.dataset.variant = "template"
    option.setAttribute("role", "option")
    option.title = "单击或按 Enter 新建皮肤"
    const preview = document.createElement("span")
    preview.className = "template-preview"
    preview.setAttribute("aria-hidden", "true")
    option.prepend(preview)
    const info = option.querySelector<HTMLSpanElement>("span:not(.template-preview)")!
    const row = element("span", "project-template-name")
    const check = createIcon("circle-check", 14)
    check.classList.add("project-template-check")
    row.append(info.querySelector("strong")!, check)
    const meta = element("span", "template-meta")
    const format = element("em")
    format.textContent = builtInProjectTemplateExtension(input.value)
    meta.append(info.querySelector("small")!, format)
    info.replaceChildren(row, meta)
    option.addEventListener("click", event => {
      event.preventDefault()
      input.checked = true
      syncSelection()
      form.requestSubmit()
    })
    option.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        option.click()
      }
    })
    grid.append(option)
  }
  const syncSelection = () => {
    for (const option of options) {
      const selected = option.querySelector<HTMLInputElement>("input")!.checked
      option.setAttribute("aria-selected", String(selected))
      option.tabIndex = selected ? 0 : -1
    }
  }
  bindListboxKeys(grid, option => {
    option.querySelector<HTMLInputElement>("input")!.checked = true
    syncSelection()
    option.focus()
    option.scrollIntoView({ block: "nearest" })
  })
  syncSelection()
  section.append(legend, grid)
  body.append(section)
  const intro = element("div", "mobile-project-intro")
  intro.append(Object.assign(element("h1"), { textContent: "选个模板，开始创作" }), Object.assign(element("p", "ui-field-note"), { textContent: "官方模板优先，也可从已有皮肤开始" }))
  body.prepend(intro)
  for (const section of [...form.children]) {
    if (section !== header) section.remove()
  }
  header.after(body)
  void hydrateTemplateCardPreviews(body, { lazy: true })
}
