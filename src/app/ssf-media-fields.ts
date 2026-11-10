import { animationPlayer } from "../animation-player.ts"
import { emptyClip } from "../animation-preview-model.ts"
import { bindListboxKeys, element, emptyState } from "../dom-element.ts"
import { closeDialog } from "../motion.ts"
import { ssfFieldLabel } from "../ssf/ssf-labels.ts"
import { SsfMotion } from "../ssf/ssf-motion.ts"
import { SsfStyles } from "../ssf/ssf-scene.ts"
import { styleCard, styleKindIcon, styleReferenceAddButton, styleReferenceCard } from "../style-card.ts"
import { bindDialog } from "./ask"
import { preview } from "./canvas-interaction"
import { isEditing } from "./edit-history"
import { selectFile } from "./navigation"
import { fieldCaption } from "./property-rows"
import { ssfDocument, ssfPackage, ssfTheme } from "./ssf-documents"
import { keySoundSample } from "./style-card-preview"
import { appState } from "./state"

const ANIMATION_FIELDS = new Set(["ANIM_STYLE", "BG_ANIM", "FG_ANIM", "DECO_ANIM"])

function animationPath(path: string, key: string): string {
  return key === "ANIM_STYLE" ? path.replace(/[^/]+$/, "anim.ini") : path
}

function soundPath(value: string): string | undefined {
  const pkg = ssfPackage()
  return ["wav", "ogg", "mp3"].map(extension => pkg?.path(ssfTheme(), `${value}.${extension}`)).find(Boolean)
    ?? pkg?.path(ssfTheme(), value)
}

function options(path: string, key: string): string[] {
  if (key === "sound") return [...new Set((appState.archive?.names() ?? []).flatMap(path => {
    const match = path.match(/^default\/(?:res\/)?([^/]+)\.(?:wav|ogg|mp3)$/i)
    return match ? [match[1]] : []
  }))].sort()
  const document = ssfDocument(animationPath(path, key))
  return document.sections().filter(section => key === "ANIM_STYLE" ? /^Anim_Style(?:_|$)/i.test(section)
    : /^Animation(?:_|$)/i.test(section) || document.get(section, "DOWN_ANIM_OBJ") !== undefined)
}

/** 复用画布的搜狗采样与共享播放器，不经过百度格式转换。 */
function animationPreview(path: string, key: string, value: string): HTMLElement {
  const host = emptyState("image-off")
  const archive = appState.archive
  const pkg = ssfPackage()
  const document = ssfDocument(animationPath(path, key))
  if (!archive || !pkg || !document.sections().includes(value)) {
    host.title = `引用缺失：${value}`
    return host
  }
  const theme = animationPath(path, key).startsWith(pkg.folder("light")) ? "light" : "dark"
  const styles = new SsfStyles(archive, pkg, theme)
  return animationPlayer({ clip: emptyClip(), key: `${path}|${key}|${value}`, thumbnail: true, native: async () => {
    const scene = await preview.sceneForState()
    const target = scene?.keys.find(item => item.section === appState.selectedKeySections[0]) ?? scene?.keys[0]
    if (!target) return
    const motion = await SsfMotion.load(styles, { width: preview.panelWidth, height: preview.panelHeight }, document)
    const effects = motion?.effects([{ section: target.section, rect: target.rect, binding: { sections: [], defaults: [], keyClass: "char" } }], {
      section: value, field: key === "ANIM_STYLE" ? undefined : key,
    })
    return effects ? { key: target, effects } : undefined
  } })
}

function chooseMedia(path: string, key: string, current: string, commit: (value: string) => void): void {
  if (!isEditing()) return
  const archive = appState.archive
  const sound = key === "sound"
  const dialog = element("dialog", "ui-dialog")
  dialog.dataset.size = "lg"
  dialog.setAttribute("aria-label", sound ? "选择音效" : "全部样式")
  const header = element("header", "ui-dialog-header")
  header.append(Object.assign(element("h2"), { textContent: sound ? "选择音效" : "全部样式" }))
  const body = element("div", "ui-dialog-body")
  const list = element("div", "style-library-grid")
  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", ssfFieldLabel(key))
  let selected = current
  const select = (card: HTMLElement) => {
    selected = card.dataset.styleId!
    for (const item of list.children) item.setAttribute("aria-selected", String(item === card))
  }
  for (const value of options(path, key)) {
    const file = sound ? soundPath(value) : undefined
    const card = styleCard({ id: value, label: value, kind: sound ? "sound" : "anim",
      sound: sound ? () => keySoundSample(file?.split("/").pop() ?? value, file) : undefined,
      animation: sound ? undefined : () => [animationPreview(path, key, value)],
    })
    card.setAttribute("aria-selected", String(value === current))
    card.addEventListener("click", () => select(card))
    card.addEventListener("dblclick", () => { select(card); apply() })
    list.append(card)
  }
  if (!list.children.length) list.append(emptyState(sound ? "audio-lines" : "image-off"))
  const footer = element("footer", "ui-dialog-footer")
  const cancel = element("button", "ui-button")
  cancel.textContent = "取消"
  cancel.addEventListener("click", () => closeDialog(dialog, "cancel"))
  const confirm = element("button", "ui-button")
  confirm.textContent = "应用"
  confirm.dataset.variant = "primary"
  const apply = () => {
    if (!options(path, key).includes(selected)) return
    closeDialog(dialog)
    if (appState.archive === archive) commit(selected)
  }
  confirm.addEventListener("click", apply)
  bindListboxKeys(list, select)
  list.addEventListener("keydown", event => { if (event.key === "Enter" && (event.target as HTMLElement).getAttribute("role") === "option") { event.preventDefault(); apply() } })
  footer.append(cancel, confirm)
  body.append(list)
  dialog.append(header, body, footer)
  bindDialog(dialog)
  dialog.addEventListener("close", () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
  cancel.focus()
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
}

/** 动画和音效同百度共用引用卡；文件名输入与配置提交仍使用搜狗原始值。 */
export function ssfMediaField(path: string, key: string, value: string, commit: (value: string) => void): HTMLElement | undefined {
  if (key !== "sound" && !ANIMATION_FIELDS.has(key)) return
  const row = element("div", "ui-field style-reference-field")
  const label = ssfFieldLabel(key)
  fieldCaption(row, key, label)
  const choose = () => chooseMedia(path, key, value, commit)
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
    states: [{ label, content: key === "sound" ? keySoundSample(file?.split("/").pop() ?? value, file) : animationPreview(path, key, value),
      onClick: edit => {
        if (edit && key !== "sound") {
          selectFile(animationPath(path, key))
          const heading = [...document.querySelectorAll("#document-fields .document-section-code")].find(item => item.textContent === value)
          heading?.closest(".ui-section")?.scrollIntoView({ block: "start" })
        } else choose()
      },
    }],
    remove: { label: `移除${label}`, run: () => commit("") },
  }))
  return row
}
