import { save } from "@tauri-apps/plugin-dialog"
import { builtInProjectTemplateExtension } from "./operations.ts"
import { hydrateTemplateCardPreviews } from "./template-preview"

export type ProjectChoice = { templateID: string; name: string; savePath: string }

export function projectChoice(form: HTMLFormElement): ProjectChoice {
  const data = new FormData(form)
  return {
    templateID: String(data.get("project-template") ?? ""),
    name: String(data.get("project-name") ?? "").trim(),
    savePath: String(data.get("project-save-path") ?? ""),
  }
}

export function initializeProjectChooser(form: HTMLFormElement): void {
  form.classList.add("project-chooser")
  const heading = form.querySelector("h1, h2")!
  heading.textContent = "新建项目"
  const header = form.querySelector("header")!
  const hint = document.createElement("small")
  hint.textContent = "支持 .bdi · .bds · .bda · .ssf · .sxi"
  const title = document.createElement("div")
  title.className = "project-chooser-title"
  title.append(heading, hint)
  const upload = document.createElement("button")
  upload.type = "button"
  upload.className = "project-upload"
  upload.textContent = "上传文件"
  upload.addEventListener("click", () => form.dispatchEvent(new Event("project-import")))
  const close = document.createElement("button")
  close.type = "button"
  close.className = "project-close"
  close.textContent = "×"
  close.setAttribute("aria-label", "关闭新建项目")
  close.addEventListener("click", () => form.querySelector<HTMLButtonElement>("#cancel, button[value=cancel]")?.click())
  header.replaceChildren(title, upload, close)

  const body = document.createElement("div")
  body.className = "project-chooser-body"
  const options = [...form.querySelectorAll<HTMLLabelElement>("label:has(input[name=project-template])")]
  for (const [index, label] of ["百度官方模板", "更多内置模板"].entries()) {
    const section = document.createElement("fieldset")
    const legend = document.createElement("legend")
    const group = index === 0 ? options.slice(0, 2) : options.slice(2)
    legend.textContent = `${label} · ${group.length} 个模板`
    const grid = document.createElement("div")
    grid.className = "project-template-grid"
    for (const option of group) {
      const input = option.querySelector<HTMLInputElement>("input")!
      option.className = "template-card project-template-card"
      option.dataset.template = input.value
      const preview = document.createElement("span")
      preview.className = "template-preview"
      preview.setAttribute("aria-hidden", "true")
      preview.textContent = "正在加载预览…"
      option.prepend(preview)
      grid.append(option)
    }
    section.append(legend, grid)
    body.append(section)
  }
  const note = document.createElement("p")
  note.className = "project-license"
  note.textContent = "内置皮肤来自互联网整理，仅供技术交流，请勿商用。如有侵权，请联系作者下架。"
  body.append(note)
  for (const section of [...form.children]) {
    if (section !== header && section.tagName !== "FOOTER") section.remove()
  }
  header.after(body)
  const footer = form.querySelector("footer")!
  const fields = document.createElement("div")
  fields.className = "project-chooser-fields"
  fields.innerHTML = `<label>文件名称<span class="project-name-well"><input name="project-name" aria-label="文件名称" value="我的键盘皮肤" required maxlength="100" autocomplete="off"><output class="project-extension">.bda</output></span></label><label>保存位置<button type="button" class="project-location">首次保存时选择</button><input type="hidden" name="project-save-path"></label>`
  footer.prepend(fields)
  const name = fields.querySelector<HTMLInputElement>("[name=project-name]")!
  const location = fields.querySelector<HTMLButtonElement>(".project-location")!
  const path = fields.querySelector<HTMLInputElement>("[name=project-save-path]")!
  const extension = fields.querySelector<HTMLOutputElement>("output")!
  const validate = () => {
    name.setCustomValidity(!name.value.trim() || /[\\/:*?"<>|\x00-\x1f]/.test(name.value) || /[. ]$/.test(name.value)
      ? "请输入有效文件名称，不要包含路径或特殊字符。" : "")
  }
  name.addEventListener("input", () => { validate(); path.value = ""; location.textContent = "首次保存时选择" })
  form.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.name !== "project-template") return
    extension.value = builtInProjectTemplateExtension(event.target.value)
    path.value = ""
    location.textContent = "首次保存时选择"
  })
  if (!("__TAURI_INTERNALS__" in window)) {
    location.disabled = true
    location.title = "浏览器在首次保存时选择位置或下载到默认目录"
  }
  location.addEventListener("click", async () => {
    validate()
    if (!name.reportValidity()) return
    try {
      const selected = await save({ title: "新项目保存位置", defaultPath: `${name.value.trim().replace(/\.(bdi|bds|bda)$/i, "")}${extension.value}`, filters: [{ name: "键盘皮肤", extensions: [extension.value.slice(1)] }] })
      if (selected) { path.value = selected; location.textContent = selected; location.title = selected }
    } catch {
      location.textContent = "位置选择失败，点击重试"
    }
  })
  form.querySelector<HTMLButtonElement>("button[value=cancel]")?.setAttribute("formnovalidate", "")
  validate()
  void hydrateTemplateCardPreviews(body)
}
