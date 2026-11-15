import { element, iconButton } from "../dom-element.ts"
import { closeDialog } from "../motion.ts"
import type { SkinArchive } from "../skin.ts"
import { MAX_ARCHIVE_BYTES } from "../skin-zip.ts"
import { conversionLayoutPaths, convertLayout, readConversionLayout } from "../layout-conversion.ts"
import { sxiAddressPointer } from "../palm/sxi-json.ts"
import { palmBoardLabel } from "../palm/palm-labels.ts"
import { boardFileName } from "../palm/sxi-layout.ts"
import { ask, bindDialog } from "./ask.ts"
import { deleteLayoutTemplate, layoutTemplates, loadLayoutTemplate, saveLayoutTemplate, type LayoutTemplate } from "../layout-templates.ts"
import { source } from "./canvas-interaction"
import { commitText, commitTextChanges, isEditing } from "./edit-history"
import { showStatus } from "./file-operations"
import { layoutLabel } from "./file-tree"
import { appState } from "./state"
import { refreshSxiDocument } from "./sxi-documents"

function layoutName(path: string): string {
  const pointer = sxiAddressPointer(path)
  return pointer ? palmBoardLabel(pointer[3]) : path.endsWith("/py_18.ini") ? "拼音 18 键" : layoutLabel(path.split("/").pop()!)
}

export function openLayoutConversionDialog(): void {
  const archive = appState.archive
  const path = appState.layoutPath
  if (!archive || !["bds", "bdi", "sxi"].includes(archive.format) || !isEditing() || appState.fileOperationRunning) return
  source.commit()
  try { readConversionLayout(archive, path) } catch (reason) {
    showStatus(reason instanceof Error ? reason.message : String(reason))
    return
  }
  const dialog = element("dialog", "ui-dialog")
  dialog.id = "layout-conversion-dialog"
  dialog.dataset.size = "sm"
  dialog.setAttribute("aria-label", "布局转换")
  const form = element("form", "ui-form")
  form.method = "dialog"
  const header = element("header", "ui-dialog-header")
  const heading = element("div")
  heading.append(Object.assign(element("h2"), { textContent: "布局转换" }))
  header.append(heading)
  const body = element("div", "ui-dialog-body")
  const current = element("p", "ui-field-note")
  current.textContent = `当前布局：${layoutName(path)}`
  heading.append(current)
  const templates = element("select", "ui-select")
  templates.id = "layout-conversion-template"
  templates.disabled = true
  const templateLabel = element("label", "ui-field")
  templateLabel.append(Object.assign(element("span"), { textContent: "模板" }), templates)
  const file = element("input")
  file.type = "file"
  file.id = "layout-conversion-file"
  file.accept = ".bds,.bdi,.sxi"
  file.hidden = true
  const upload = element("button", "ui-button")
  upload.type = "button"
  upload.textContent = "上传模板…"
  upload.addEventListener("click", () => file.click())
  const remove = iconButton("trash-2", "删除模板")
  remove.id = "layout-conversion-delete"
  remove.disabled = true
  const actions = element("div", "ui-list-toolbar")
  actions.append(upload, remove)
  const label = element("label", "ui-field")
  const select = element("select", "ui-select")
  select.id = "layout-conversion-layout"
  select.disabled = true
  label.append(Object.assign(element("span"), { textContent: "布局" }), select)
  const summary = element("p", "ui-field-note")
  summary.setAttribute("aria-live", "polite")
  summary.textContent = ""
  const scope = element("p", "ui-field-note")
  scope.textContent = "仅替换当前布局，保留皮肤外观。"
  scope.title = "模板保存在本机，重启后仍可使用。横竖屏自动匹配，尺寸随当前布局适配。"
  const error = element("p", "ui-field-error")
  error.setAttribute("role", "alert")
  const footer = element("footer", "ui-dialog-footer")
  const cancel = element("button", "ui-button")
  cancel.type = "button"
  cancel.textContent = "取消"
  cancel.addEventListener("click", () => closeDialog(dialog, "cancel"))
  const apply = element("button", "ui-button")
  apply.id = "layout-conversion-apply"
  apply.type = "submit"
  apply.dataset.variant = "primary"
  apply.textContent = "更换布局"
  apply.disabled = true
  footer.append(cancel, apply)
  body.append(templateLabel, actions, file, label, summary, scope, error)
  form.append(header, body, footer)
  dialog.append(form)
  let template: SkinArchive | undefined
  let library: LayoutTemplate[] = []
  let request = 0
  const validTarget = () => archive === appState.archive && path === appState.layoutPath && isEditing() && !appState.fileOperationRunning
  const update = () => {
    apply.disabled = true
    error.textContent = ""
    if (!template || !select.value) return
    try {
      if (!validTarget()) throw new Error("当前布局已变化，请关闭后重新打开布局转换")
      const chosen = readConversionLayout(template, select.value)
      convertLayout(archive, path, template, select.value)
      const letters = chosen.keys.filter(key => /^[a-z]$/i.test(key.actions.CENTER)).length
      const count = chosen.keys.some(key => key.letters) ? `${letters} 个字母键 + ${chosen.keys.length - letters} 个功能键` : `${chosen.keys.length} 个按键`
      summary.textContent = `${label.hidden ? `${layoutName(select.value)} · ` : ""}${count}`
      apply.disabled = false
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : String(reason)
    }
  }
  select.addEventListener("change", update)
  const refreshLibrary = async (id = templates.value) => {
    library = await layoutTemplates()
    templates.replaceChildren(...library.map(item => new Option(`${item.name}${item.builtin ? "（内置）" : ""}`, item.id)))
    templates.value = library.some(item => item.id === id) ? id : library[0].id
    templates.disabled = false
  }
  const load = async () => {
    const ticket = ++request
    const item = library.find(item => item.id === templates.value)
    template = undefined
    apply.disabled = true
    select.disabled = true
    remove.disabled = true
    select.replaceChildren()
    summary.textContent = ""
    error.textContent = ""
    if (!item) return
    try {
      const opened = await loadLayoutTemplate(item.id)
      if (ticket !== request || !dialog.open) return
      template = opened
      for (const option of conversionLayoutPaths(opened, path)) select.add(new Option(layoutName(option), option))
      label.hidden = select.options.length <= 1
      const filename = (path: string) => {
        const pointer = sxiAddressPointer(path)
        return pointer ? boardFileName(pointer[3]) : path.split("/").pop()
      }
      const paths = [...select.options].map(option => option.value)
      const score = (candidate: string) => Number(filename(candidate) === filename(path)) * 4 + Number(layoutName(candidate) === layoutName(path)) * 2
      select.value = paths.includes(path) ? path : [...paths].sort((a, b) => score(b) - score(a))[0]
      select.disabled = false
      update()
    } catch (reason) {
      if (ticket === request && dialog.open) error.textContent = reason instanceof Error ? reason.message : String(reason)
    } finally {
      if (ticket === request) {
        remove.disabled = item.builtin
        remove.title = item.builtin ? "内置模板不可删除" : "删除模板"
      }
    }
  }
  templates.addEventListener("change", () => void load())
  remove.addEventListener("click", () => {
    const item = library.find(item => item.id === templates.value)
    if (!item || item.builtin) return
    void (async () => {
      const decision = await ask({ title: "删除布局模板？", detail: `“${item.name}”将从本机删除，已转换的布局不受影响。`, actions: [{ value: "cancel", label: "取消" }, { value: "delete", label: "删除", variant: "danger" }] })
      if (decision !== "delete") return
      remove.disabled = true
      try {
        await deleteLayoutTemplate(item.id)
        if (!dialog.open) return
        await refreshLibrary()
        await load()
      } catch (reason) {
        error.textContent = reason instanceof Error ? reason.message : String(reason)
        remove.disabled = false
      }
    })()
  })
  file.addEventListener("change", () => {
    const chosen = file.files?.[0]
    file.value = ""
    if (!chosen) return
    const ticket = ++request
    template = undefined
    apply.disabled = true
    select.disabled = true
    select.replaceChildren()
    error.textContent = ""
    upload.disabled = true
    templates.disabled = true
    remove.disabled = true
    summary.textContent = chosen.name
    void (async () => {
      try {
        if (chosen.size > MAX_ARCHIVE_BYTES) throw new Error("模板文件超过 64 MB")
        const item = await saveLayoutTemplate(chosen.name, new Uint8Array(await chosen.arrayBuffer()))
        if (ticket !== request || !dialog.open) return
        await refreshLibrary(item.id)
        await load()
        showStatus("布局模板已保存到本机")
      } catch (reason) {
        if (ticket === request && dialog.open) error.textContent = reason instanceof Error ? reason.message : String(reason)
      } finally {
        upload.disabled = false
        templates.disabled = false
      }
    })()
  })
  form.addEventListener("submit", event => {
    event.preventDefault()
    if (apply.disabled || !template) return
    apply.disabled = true
    try {
      if (!validTarget()) throw new Error("当前布局已变化，请关闭后重新打开布局转换")
      source.commit()
      const change = convertLayout(archive, path, template, select.value)
      appState.selectedKeySections = []
      if (archive.format === "sxi") {
        commitText(change.path, change.before, change.after)
        refreshSxiDocument()
      } else commitTextChanges([change, ...change.styles ? [change.styles] : []])
      showStatus(`已更换${layoutName(path)}的布局，可撤销`)
      closeDialog(dialog, "apply")
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : String(reason)
      apply.disabled = !validTarget()
    }
  })
  bindDialog(dialog)
  dialog.addEventListener("close", () => { request++; dialog.remove() }, { once: true })
  document.body.append(dialog)
  dialog.showModal()
  cancel.focus()
  const initialRequest = ++request
  void refreshLibrary().then(() => { if (initialRequest === request && dialog.open) return load() }).catch(reason => {
    error.textContent = reason instanceof Error ? reason.message : String(reason)
  })
}
