// Property rows for Sogou INI sections: image pairs drawn as style cards, colours, four-part rectangles
// and plain values. Every row writes straight to its Sogou file and is one undo step.

import { drawVisualPreview, pngBitmap, retinaThumbnail, type Visual } from "../atlas.ts"
import { createIcon } from "../icons"
import { IniDocument } from "../ini.ts"
import { ssfFieldLabel, ssfSectionLabel } from "../ssf/ssf-labels.ts"
import { parseSsfImage, type SsfStretch } from "../ssf/ssf-package.ts"
import { mirrorSsfEdit, ssfResolutionOf, ssfResolutionTwins } from "../ssf/ssf-resolutions.ts"
import { setSourceValue } from "./config-context"
import { commitBatch, commitText, isEditing, updateDirty } from "./edit-history"
import { populateKeyInspector } from "./key-inspector"
import { refreshPreview } from "./preview-render"
import { openImageResourceChooser } from "./resource-inspector"
import { sourceEditPath, ssfDocument, ssfPackage, ssfTheme } from "./ssf-documents"
import { appState } from "./state"
import { styleKindBadge } from "./style-picker"
import { element } from "../dom-element.ts"
import { sanitizeFontFileName, skinFontFiles, uniqueFontFileName } from "../font-files.ts"
import { type Change } from "../history.ts"
import { showError, showStatus } from "./file-operations"
import { validateFont } from "./skin-fonts"
import { fieldCaption, numberParts } from "./property-rows"

type SsfEntry = { key: string; value: string }

/** State images that follow NORMAL / PRESSED when those are replaced and still show the same file. */
const LINKED_STATES: Record<string, string[]> = { NORMAL: ["DISABLED", "NORMAL_ON"], PRESSED: ["PRESSED_ON"] }
const IMAGE_STATES = ["NORMAL", "PRESSED", "DISABLED", "NORMAL_ON", "PRESSED_ON", "FOCUSED"]
const QUADS: Record<string, string[]> = {
  FG_RECT: ["←", "↑", "→", "↓"],
  ICON_RECT: ["←", "↑", "→", "↓"],
  LABEL_POSITION: ["←", "↑", "→", "↓"],
  MINOR_LABEL_POSITION: ["←", "↑", "→", "↓"],
  MARGINS: ["←", "↑", "→", "↓"],
  PADDINGS: ["←", "↑", "→", "↓"],
}
const COLOR_VALUE = /^(?:0x|#)?([0-9a-f]{6}|[0-9a-f]{8})$/i
const NUMERIC_FIELDS = new Set(["BG_STYLE", "TEXT_SIZE", "TYPEFACE", "TYPE", "LABEL_VISIBLE", "MINOR_LABEL_VISIBLE", "LABEL_ORIENTATION", "LABEL_HORIZONTAL_OFFSET", "MINOR_LABEL_HORIZONTAL_OFFSET", "POPUP_OFFSET_VERTICAL", "LOOP_TYPE", "START", "END", "loop_count"])

/**
 * Applies `change` to one Sogou file as a single undo step, then redraws the canvas from the edited
 * skin right away (the inspector is not typing, so it skips the preview's debounce).
 */
export function editSsfFile(path: string, change: (document: IniDocument) => void): void {
  editTargets([{ path, section: "" }], change)
}

type TextChange = Extract<Change, { kind: "text" }>

/** A section rows write to; `create` is what a missing section starts with (RootView needs BG_STYLE). */
type SsfLocation = { path: string; section: string; create?: SsfEntry[] }

function editTargets(targets: SsfLocation[], change: (document: IniDocument, target: SsfLocation) => void): void {
  const archive = appState.archive
  if (!archive || archive.format !== "ssf" || !isEditing()) return
  const changes = [...new Set(targets.map((target) => target.path))].flatMap((path) => {
    const before = archive.isText(path) ? archive.getText(path) : ""
    const document = IniDocument.parse(before)
    for (const target of targets.filter((target) => target.path === path)) change(document, target)
    const after = document.toString()
    return before === after ? [] : [{ kind: "text" as const, path, before, after }]
  })
  if (!changes.length) return
  const all: TextChange[] = [...changes, ...resolutionTwins(changes)]
  if (all.length === 1) commitText(all[0].path, all[0].before, all[0].after)
  else commitBatch(all)
  if (changes.some((change) => change.path === appState.selectedPath)) appState.selectedDocument = ssfDocument(appState.selectedPath)
  const source = changes.find((change) => change.path === sourceEditPath())
  if (source) setSourceValue(source.after)
  refreshPreview()
  populateKeyInspector()
  updateDirty()
}

function writeValue(targets: SsfLocation[], key: string, value: string): void {
  editTargets(targets, (document, target) => setSsfValue(document, target.section, key, value, target.create))
}

/** Sets a value, adding the section (with `create` first) at the end of the file when it does not exist yet. */
export function setSsfValue(document: IniDocument, section: string, key: string, value: string, create: readonly SsfEntry[] = []): void {
  if (document.sections().includes(section)) document.set(section, key, value)
  else document.appendSection(section, [...create.filter((entry) => entry.key !== key), { key, value }])
}

/** One value per key: duplicate sections are read like IniDocument.get, the first definition wins. */
export function ssfEntries(path: string, section: string): SsfEntry[] {
  const seen = new Set<string>()
  return ssfDocument(path).entries(section).flatMap(({ key, value }) => {
    if (seen.has(key)) return []
    seen.add(key)
    return [{ key, value }]
  })
}

// Thumbnails decode images; a file's whole phoneSkin.ini has hundreds, so only visible ones are drawn.
const pendingThumbnails = new WeakMap<HTMLCanvasElement, () => Promise<Visual | undefined>>()
const thumbnailObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    const canvas = entry.target as HTMLCanvasElement
    thumbnailObserver.unobserve(canvas)
    const load = pendingThumbnails.get(canvas)
    pendingThumbnails.delete(canvas)
    void load?.().then((visual) => {
      if (!canvas.isConnected) return
      retinaThumbnail(canvas, canvas.clientWidth || 76, canvas.clientHeight || 38)
      drawVisualPreview(canvas, [visual], false)
    })
  }
})

export function disconnectSsfThumbnails(): void {
  thumbnailObserver.disconnect()
}

/** The image a Sogou value names, fitted whole into a thumbnail. */
async function imageVisual(value: string | undefined): Promise<Visual | undefined> {
  const ref = parseSsfImage(value)
  const bytes = ref && ssfPackage()?.file(ssfTheme(), ref.file)
  const image = bytes && await pngBitmap(bytes)
  return image ? { image, source: [0, 0, image.width, image.height] } : undefined
}

function thumbnail(value: string | undefined): HTMLCanvasElement {
  const canvas = element("canvas")
  canvas.setAttribute("aria-hidden", "true")
  pendingThumbnails.set(canvas, () => imageVisual(value))
  thumbnailObserver.observe(canvas)
  return canvas
}

function caption(row: HTMLElement, key: string, label = ssfFieldLabel(key)): void {
  fieldCaption(row, key, label)
}

/** Replaces the file of an image value and keeps its stretch band. */
function withFile(value: string | undefined, file: string): string {
  const rest = value?.split(",").slice(1) ?? []
  return [file, ...rest].join(",")
}

/** A state image as Sogou draws it: a missing pressed image shows the normal one. */
function stateImage(document: IniDocument, section: string, key: string): string | undefined {
  return document.get(section, key) ?? document.get(section, key === "ICON_PRESSED" ? "ICON" : "NORMAL")
}

/** Replace one state's file while preserving each target's own stretch band and linked states. */
function replaceImage(targets: SsfLocation[], key: string, file: string): void {
  editTargets(targets, (document, { section }) => {
    const current = stateImage(document, section, key)
    for (const linked of [key, ...LINKED_STATES[key] ?? []]) {
      const old = document.get(section, linked)
      if (linked === key || old !== undefined && old === current) setSsfValue(document, section, linked, withFile(old ?? current, file))
    }
  })
}

function chooseImage(targets: SsfLocation[], key: string): void {
  if (!isEditing()) return
  openImageResourceChooser((resourceID) => replaceImage(targets, key, /\.\w+$/.test(resourceID) ? resourceID : `${resourceID}.png`))
}

type CardReference = { path: string; section: string; key: string }

/**
 * The style card (DESIGN.md §10): file names and type on the left, one preview per state on the right.
 * A section's normal and pressed images share one card, like Baidu's; a lone image gets a card of its own.
 * Each state's file name and preview edit that state independently.
 */
function imageCard(label: string, keys: readonly string[], targets: SsfLocation[]): HTMLElement {
  const { path, section } = targets[0]
  const document = ssfDocument(path)
  const row = element("div", "ui-field document-property-field style-reference-field")
  caption(row, keys.join(" "), label)
  const card = element("div", "style-reference-row ssf-image-card")
  const meta = element("span", "style-reference-meta")
  const states = element("span", "style-picker-states")
  for (const key of keys) {
    const own = document.get(section, key)
    const value = stateImage(document, section, key)
    const file = parseSsfImage(value)?.file
    const stateLabel = keys.length > 1 ? (/PRESSED/.test(key) ? "按下" : "正常") : ""
    // A pressed image the section leaves out is drawn from the normal one: its name stays empty.
    const inherited = stateLabel === "按下" && !own
    const name = element("input", "style-reference-number style-reference-name")
    name.value = inherited ? "" : file ?? ""
    name.placeholder = inherited && file ? "同正常" : "未设置"
    name.disabled = !isEditing()
    name.title = `${path} · [${section}] ${key}`
    name.setAttribute("aria-label", `${stateLabel}${label}文件名`)
    name.addEventListener("change", () => {
      const image = parseSsfImage(name.value.trim())
      if (image) replaceImage(targets, key, image.file)
      // Emptying the pressed name goes back to drawing the normal image.
      else if (!name.value.trim() && stateLabel === "按下") editTargets(targets, (document, target) => { document.remove(target.section, key) })
      else name.value = inherited ? "" : file ?? ""
    })
    meta.append(name)
    const state = element("button", "style-picker-state")
    state.type = "button"
    state.dataset.styleState = /PRESSED/.test(key) ? "highlighted" : "normal"
    state.title = `${stateLabel}${label}：${file ?? "未设置"}${own ? "" : "（沿用正常图片）"}，点击更换图片`
    state.setAttribute("aria-label", state.title)
    state.disabled = !isEditing()
    state.append(thumbnail(value))
    state.addEventListener("click", () => chooseImage(targets, key))
    states.append(state)
  }
  meta.append(styleKindBadge("image"))
  card.append(meta, states)
  row.append(card)
  return row
}

function ssfNumberParts(row: HTMLElement, key: string, affixes: string[], values: string[], onChange: (values: string[]) => void): void {
  numberParts(row, ssfFieldLabel(key), affixes, values, onChange, affixes.length === 4 && key !== "FG_RECT" ? 4 : undefined)
}

/** The stretch band shared by a section's state images: Sogou's order is left, right, top, bottom. */
function stretchField(path: string, section: string, targets = [{ path, section }]): HTMLElement | undefined {
  const document = ssfDocument(path)
  const stretch = parseSsfImage(document.get(section, "NORMAL"))?.stretch
  if (!stretch) return
  const row = element("div", "ui-field document-property-field")
  row.dataset.stack = ""
  caption(row, "STRETCH", "拉伸区域")
  row.title = "九宫格可拉伸的像素区间：左、右、上、下"
  ssfNumberParts(row, "STRETCH", ["左", "右", "上", "下"], stretch.map(String), (values) => {
    const bands = targets.map((target) => {
      const current = parseSsfImage(ssfDocument(target.path).get(target.section, "NORMAL"))?.stretch
      return values.map((value, index) => value === "" ? current?.[index] : Number(value)) as SsfStretch
    })
    if (bands.some((next) => next.some((value) => !Number.isInteger(value)) || next[0] >= next[1] || next[2] >= next[3])) return
    editTargets(targets, (target, { path, section }) => {
      const next = bands[targets.findIndex((item) => item.path === path && item.section === section)]
      for (const key of IMAGE_STATES) {
        const value = target.get(section, key)
        const file = value && parseSsfImage(value)?.file
        if (file) target.set(section, key, [file, ...next].join(","))
      }
    })
  })
  return row
}

/**
 * A colour as Sogou reads it: `Long.decode` on `0xAARRGGBB` (theme/parse/utils/f.java). Six digits or a
 * `#` would decode with alpha 0, so they are written out in full.
 */
function sogouColor(value: string): string {
  const hex = value.trim().match(COLOR_VALUE)![1].toUpperCase()
  return `0x${hex.length === 6 ? `FF${hex}` : hex}`
}

function colorField(key: string, value: string, targets: SsfLocation[]): HTMLElement {
  const row = element("div", "ui-field document-property-field")
  caption(row, key)
  const hex = value.trim().match(COLOR_VALUE)?.[1].toUpperCase() ?? "FF000000"
  const argb = hex.length === 6 ? `FF${hex}` : hex
  const control = element("span", "color-control ui-input ui-color")
  const picker = element("input")
  picker.type = "color"
  picker.value = `#${argb.slice(2)}`
  picker.setAttribute("aria-label", ssfFieldLabel(key))
  const text = element("input")
  text.value = value
  if (!value) text.placeholder = "未设置"
  text.setAttribute("aria-label", `${ssfFieldLabel(key)}值`)
  const alpha = element("input")
  alpha.type = "number"
  alpha.min = "0"
  alpha.max = "1"
  alpha.step = "0.01"
  alpha.value = String(Math.round(Number.parseInt(argb.slice(0, 2), 16) / 255 * 100) / 100)
  alpha.setAttribute("aria-label", `${ssfFieldLabel(key)}透明度`)
  for (const input of [picker, text, alpha]) input.disabled = !isEditing()
  const write = (next: string) => writeValue(targets, key, next)
  const fromControls = (component: "color" | "alpha") => editTargets(targets, (document, target) => {
    const current = document.get(target.section, key)?.trim().match(COLOR_VALUE)?.[1] ?? "FF000000"
    const argb = current.length === 6 ? `FF${current}` : current
    const alphaHex = component === "alpha" ? Math.round(Number(alpha.value) * 255).toString(16).padStart(2, "0") : argb.slice(0, 2)
    const rgb = component === "color" ? picker.value.slice(1) : argb.slice(2)
    setSsfValue(document, target.section, key, `0x${alphaHex}${rgb}`.toUpperCase().replace(/^0X/, "0x"), target.create)
  })
  picker.addEventListener("change", () => fromControls("color"))
  alpha.addEventListener("change", () => { if (alpha.value !== "" && alpha.checkValidity()) fromControls("alpha") })
  text.addEventListener("change", () => {
    const value = text.value.trim()
    if (!value) editTargets(targets, (document, target) => { document.remove(target.section, key) })
    else if (COLOR_VALUE.test(value)) write(sogouColor(value))
  })
  control.append(picker, text, alpha)
  row.append(control)
  return row
}

/** `BOLD=true` or no key at all (Sogou reads only "true"). */
function switchField(key: string, value: string, targets: SsfLocation[]): HTMLElement {
  const row = element("label", "document-property-field")
  row.classList.add("ui-field")
  caption(row, key)
  const input = element("input", "ui-switch")
  input.type = "checkbox"
  input.setAttribute("role", "switch")
  input.setAttribute("aria-label", ssfFieldLabel(key))
  input.checked = value.trim() === "true"
  input.disabled = !isEditing()
  input.addEventListener("change", () => editTargets(targets, (document, target) => {
    if (input.checked) setSsfValue(document, target.section, key, "true", target.create)
    else document.remove(target.section, key)
  }))
  row.append(input)
  return row
}

function valueInput(key: string, value: string, targets: SsfLocation[]): HTMLInputElement {
  const input = element("input", "document-property-input")
  input.value = value
  // 字号不带单位时是屏宽比例：完整说明放进提示，占位文字只留输入框放得下的长度。
  input.title = !value && key === "TEXT_SIZE" ? `${ssfFieldLabel(key)}：屏宽比例，如 0.045` : `${ssfFieldLabel(key)}：${value}`
  input.disabled = !isEditing()
  if (NUMERIC_FIELDS.has(key) && /^-?\d+(?:\.\d+)?$/.test(value) || !value && key === "TEXT_SIZE") {
    input.type = "number"
    // TEXT_SIZE up to 1 is a fraction of the screen width (0.045) and steps by 0.001; above 1 it is pixels.
    input.step = key === "TEXT_SIZE" ? (Number(value || 0) <= 1 ? "0.001" : "1") : value.includes(".") ? "any" : "1"
  }
  if (!value) input.placeholder = key === "TEXT_SIZE" ? "未设置（屏宽比例）" : "未设置"
  input.setAttribute("aria-label", ssfFieldLabel(key))
  input.addEventListener("change", () => {
    if (input.type !== "number" || input.value !== "" && Number.isFinite(input.valueAsNumber)) writeValue(targets, key, input.value)
  })
  return input
}

function textField(key: string, value: string, targets: SsfLocation[], options?: string[]): HTMLElement {
  const row = element("label", "document-property-field")
  row.classList.add("ui-field")
  caption(row, key)
  const input = valueInput(key, value, targets)
  if (options?.length) {
    const list = element("datalist")
    list.id = `ssf-options-${targets[0].section}-${key}`.replace(/[^\w-]/g, "_")
    list.append(...options.map((option) => Object.assign(element("option"), { value: option })))
    input.setAttribute("list", list.id)
    row.append(list)
  }
  row.append(input)
  return row
}

/** One row for any Sogou value, chosen by what the value is. `options` suggests values (sound names). */
function ssfField(entry: SsfEntry, targets: SsfLocation[], options?: string[]): HTMLElement {
  const { key, value } = entry
  const quad = QUADS[key]
  const parts = value.split(",").map((part) => part.trim())
  if (quad && parts.length === quad.length && parts.every((part) => part !== "" && Number.isFinite(Number(part)))) {
    const row = element("div", "ui-field document-property-field")
    row.dataset.stack = ""
    caption(row, key)
    ssfNumberParts(row, key, quad, parts, (values) => editTargets(targets, (document, target) => {
      const current = document.get(target.section, key)!.split(",")
      setSsfValue(document, target.section, key, values.map((value, index) => value || current[index]).join(","))
    }))
    return row
  }
  if (key === "BOLD") return switchField(key, value, targets)
  if (/COLOR/i.test(key) && (COLOR_VALUE.test(value.trim()) || !value)) return colorField(key, value, targets)
  if (parseSsfImage(value)) return imageCard(ssfFieldLabel(key), [key], targets)
  return textField(key, value, targets, options)
}

export type SsfBlock = {
  path: string
  section: string
  /** Subheading; defaults to the section's Chinese name. */
  title?: string
  /** Keys shown elsewhere (in a card above) and left out of the rows. */
  omit?: string[]
  /** When set, the only keys this block shows; the rest of the section belongs to another group. */
  only?: string[]
  /** Entries a missing section is created with by its "添加" button (none: the block shows its note and actions only); without a template a missing block is skipped. */
  template?: SsfEntry[]
  note?: string
  actions?: HTMLElement[]
  /** The field naming this block's image section, editable in its card. */
  reference?: CardReference
  options?: Record<string, string[]>
  /** Keys offered even when the section (or the key) is missing; the first write creates them. */
  expect?: string[]
  /** Entries a missing section starts with when one of its rows is first written. */
  create?: SsfEntry[]
  /** Matching sections of the other selected keys. */
  peers?: SsfLocation[]
}

/** Font files a TYPEFACE can name: Sogou installs `default/` and the theme folder into one directory. */
export function ssfFontOptions(): string[] {
  return [...new Set(skinFontFiles(appState.archive?.names() ?? []).map((path) => path.split("/").pop()!))]
}

/** Imports a .ttf / .otf into default/ and points every target's TYPEFACE at it, as one undo step. */
export function ssfFontImportButton(targets: SsfLocation[]): HTMLButtonElement {
  return ssfButton("导入字体", "upload", () => {
    const picker = element("input")
    picker.type = "file"
    picker.accept = ".ttf,.otf"
    picker.addEventListener("change", () => {
      const file = picker.files?.[0]
      if (file) void importSsfFont(file, targets)
    })
    picker.click()
  })
}

/**
 * The same edits in the skin's other resolution folders: the phone installs only the folder nearest
 * its screen width, so an edit made in the 1080 copy alone never reaches a 720 phone.
 */
function resolutionTwins(changes: readonly TextChange[]): TextChange[] {
  const archive = appState.archive!
  const names = archive.names()
  const present = new Set(names)
  const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1)
  const inLook = (path: string, file: string) => present.has(`${folderOf(path)}${file}`) || present.has(`${ssfResolutionOf(path)}/${file}`)
  const dayStatus = ssfPackage()?.folder("light").split("/")[1] || undefined
  const edited = new Set(changes.map((change) => change.path))
  const twins = new Map<string, { before: string; after: string }>()
  for (const change of changes) {
    for (const twin of ssfResolutionTwins(names, change.path, dayStatus)) {
      if (edited.has(twin)) continue
      const before = twins.get(twin)?.after ?? archive.getText(twin)
      const copy = {
        scale: ssfResolutionOf(twin)! / ssfResolutionOf(change.path)!,
        sharedImage: (file: string) => !inLook(change.path, file) && !inLook(twin, file),
      }
      twins.set(twin, { before: twins.get(twin)?.before ?? before, after: mirrorSsfEdit(change.before, change.after, before, copy) })
    }
  }
  return [...twins].flatMap(([path, { before, after }]) => before === after ? [] : [{ kind: "text" as const, path, before, after }])
}

async function importSsfFont(file: File, targets: SsfLocation[]): Promise<void> {
  const archive = appState.archive
  if (!archive || archive.format !== "ssf" || !isEditing()) return
  try {
    if (!/\.(?:ttf|otf)$/i.test(file.name)) throw new Error("搜狗皮肤只支持 .ttf / .otf 字体文件")
    const bytes = new Uint8Array(await file.arrayBuffer())
    await validateFont(bytes)
    if (appState.archive !== archive || !isEditing()) return
    const name = uniqueFontFileName(sanitizeFontFileName(file.name), archive.names())
    const changes: Change[] = [{ kind: "bytes", path: `default/${name}`, before: undefined, after: bytes }]
    for (const path of new Set(targets.map((target) => target.path))) {
      const before = archive.getText(path)
      const document = IniDocument.parse(before)
      for (const target of targets.filter((item) => item.path === path)) setSsfValue(document, target.section, "TYPEFACE", name)
      changes.push({ kind: "text", path, before, after: document.toString() })
    }
    commitBatch([...changes, ...resolutionTwins(changes.filter((change): change is TextChange => change.kind === "text"))])
    refreshPreview()
    populateKeyInspector()
    updateDirty()
    showStatus(`已导入字体 ${name}。`)
  } catch (error) {
    showError(error, "导入字体")
  }
}

export function ssfButton(label: string, icon: string, onClick: () => void): HTMLButtonElement {
  const button = element("button", "ui-button")
  button.type = "button"
  button.dataset.size = "sm"
  button.append(createIcon(icon, 14), label)
  button.disabled = !isEditing()
  button.addEventListener("click", onClick)
  return button
}

function blockHeading(block: SsfBlock): HTMLElement {
  const heading = element("h4", "inspector-block-heading")
  const title = element("span")
  title.textContent = block.title ?? ssfSectionLabel(block.section)
  heading.append(title)
  const code = element("code")
  code.textContent = `${block.path.split("/").pop()} · [${block.section}]`
  code.title = block.path
  heading.append(code)
  return heading
}

function markMixed(row: HTMLElement, targets: SsfLocation[], keys: string[]): void {
  const values = targets.map(({ path, section }) => ssfDocument(path).get(section, keys[0]) ?? "")
  if (row.classList.contains("style-reference-field")) {
    const names = row.querySelectorAll<HTMLInputElement>(".style-reference-name")
    const states = row.querySelectorAll<HTMLButtonElement>(".style-picker-state")
    for (const [index, key] of keys.entries()) {
      const files = targets.map(({ path, section }) => parseSsfImage(stateImage(ssfDocument(path), section, key))?.file)
      if (files.every((file) => file === files[0])) continue
      names[index].value = ""
      names[index].placeholder = "混合"
      states[index].replaceChildren("混合")
      states[index].title = `${ssfFieldLabel(key)}：混合（点击更换图片）`
      states[index].setAttribute("aria-label", states[index].title)
    }
    return
  }
  const inputs = Array.from(row.querySelectorAll<HTMLInputElement>("input:not([type=color])"))
  const quad = QUADS[keys[0]] ?? (keys.length === IMAGE_STATES.length ? ["左", "右", "上", "下"] : undefined)
  if (quad) {
    const parts = keys.length === IMAGE_STATES.length ? values.map((value) => parseSsfImage(value)?.stretch?.map(String) ?? []) : values.map((value) => value.split(",").map((part) => part.trim()))
    for (const [index, input] of inputs.entries()) {
      if (parts.some((value) => value[index] !== parts[0][index])) { input.value = ""; input.placeholder = "混合" }
    }
  } else if (values.some((value) => value !== values[0])) {
    for (const input of inputs) { input.value = ""; input.placeholder = "混合" }
    row.querySelector(".color-control")?.setAttribute("data-mixed", "")
  }
}

/** Rows of one section: its image pairs as cards, the stretch band, then every other value. */
function renderBlock(block: SsfBlock, showHeading: boolean): HTMLElement[] {
  const nodes: HTMLElement[] = []
  const exists = ssfDocument(block.path).sections().includes(block.section)
  if (!exists && !block.template && !block.expect) return nodes
  if (showHeading) nodes.push(blockHeading(block))
  if (block.note) {
    const note = element("p", "inspector-group-subtitle")
    note.textContent = block.note
    nodes.push(note)
  }
  const actions = [...block.actions ?? []]
  const template = block.template
  if (!exists && template?.length && !block.expect) {
    actions.unshift(ssfButton("添加", "plus", () => editSsfFile(block.path, (document) => document.appendSection(block.section, template))))
  }
  if (actions.length) {
    const row = element("div", "inspector-block-actions")
    row.append(...actions)
    nodes.push(row)
  }
  if (!exists && !block.expect) return nodes
  const entries = exists ? ssfEntries(block.path, block.section).filter((entry) => !block.only || block.only.includes(entry.key)) : []
  const keys = new Set(entries.map((entry) => entry.key))
  const grid = element("div", "document-property-grid")
  const targets = [{ path: block.path, section: block.section, create: block.create }, ...block.peers ?? []]
  const used = new Set(block.omit ?? [])
  const rowTargets = new Map<HTMLElement, SsfLocation[]>()
  if (block.reference) {
    const ref = block.reference
    const locations = [{ path: ref.path, section: ref.section }]
    const row = ssfField({ key: ref.key, value: ssfDocument(ref.path).get(ref.section, ref.key) ?? "" }, locations)
    rowTargets.set(row, locations)
    grid.append(row)
  }
  for (const [normal, pressed, label] of [["NORMAL", "PRESSED", "图片"], ["ICON", "ICON_PRESSED", "图标"]] as const) {
    if (used.has(normal) || !keys.has(normal) || !parseSsfImage(entries.find((entry) => entry.key === normal)?.value)) continue
    grid.append(imageCard(label, [normal, pressed], targets))
    used.add(normal).add(pressed)
    if (normal === "NORMAL") {
      const stretch = stretchField(block.path, block.section, targets)
      if (stretch) grid.append(stretch)
    }
  }
  for (const entry of entries) {
    if (used.has(entry.key)) continue
    grid.append(ssfField(entry, targets, block.options?.[entry.key]))
  }
  for (const key of block.expect ?? []) {
    if (!used.has(key) && !keys.has(key)) grid.append(ssfField({ key, value: "" }, targets, block.options?.[key]))
  }
  for (const row of Array.from(grid.children) as HTMLElement[]) {
    const band = row.dataset.documentKey === "STRETCH"
    const card = row.classList.contains("style-reference-field")
    const rowKeys = band ? IMAGE_STATES : row.dataset.documentKey!.split(" ")
    const savedKeys = rowKeys.flatMap((key) => [key, ...LINKED_STATES[key] ?? []])
    const locations = rowTargets.get(row) ?? targets
    const saved = locations.map((target) => ({ ...target, values: Object.fromEntries(savedKeys.map((key) => {
      const value = ssfDocument(target.path).get(target.section, key)
      return [key, value === undefined ? null : band ? value.split(",").slice(1).join(",") : card ? value.split(",")[0] : value]
    })) }))
    row.dataset.inspectorRowKey = JSON.stringify([locations, row.dataset.documentKey])
    row.dataset.inspectorValue = JSON.stringify(saved)
    row.addEventListener("inspector-reset", (event) => {
      event.preventDefault()
      const baseline = JSON.parse((event as CustomEvent<string>).detail) as typeof saved
      editTargets(baseline, (document, target) => {
        for (const item of baseline.filter((item) => item.path === target.path && item.section === target.section)) {
          for (const [key, value] of Object.entries(item.values)) {
            const current = document.get(target.section, key)
            if (band) {
              if (current) document.set(target.section, key, [current.split(",")[0], ...value ? value.split(",") : []].join(","))
            } else if (value === null) document.remove(target.section, key)
            else if (card && savedKeys.includes(key)) setSsfValue(document, target.section, key, withFile(current, value))
            else setSsfValue(document, target.section, key, value)
          }
        }
      })
    })
    if (block.peers?.length) markMixed(row, targets, rowKeys)
  }
  if (grid.childElementCount) nodes.push(grid)
  return nodes
}

/** One inspector group (a rail entry): several sections under one title, each with its own subheading. */
export function renderGroup(label: string, blocks: SsfBlock[], code?: string, key = label): HTMLElement | undefined {
  const shown = blocks.filter((block) => block.template || block.expect || ssfDocument(block.path).sections().includes(block.section))
  if (!shown.length) return
  const section = element("section", "ui-section document-property-section")
  section.dataset.inspectorGroupLabel = label
  const heading = element("h3", "document-section-heading")
  const title = element("span", "document-section-title")
  title.textContent = label
  heading.append(title)
  if (code) {
    const codeNode = element("span", "document-section-code")
    codeNode.textContent = code
    heading.append(codeNode)
  }
  section.append(heading)
  const many = shown.length > 1
  for (const [index, block] of shown.entries()) {
    const subsection = element("div", "ui-subsection")
    const references = shown.flatMap(({ reference }) => reference?.path === block.path && reference.section === block.section ? [reference.key] : [])
    subsection.append(...renderBlock({ ...block, omit: [...block.omit ?? [], ...references] }, many || Boolean(block.title && block.title !== label)))
    for (const row of Array.from(subsection.querySelectorAll<HTMLElement>("[data-inspector-row-key]"))) {
      row.dataset.inspectorRowKey = JSON.stringify([key, index, row.dataset.documentKey])
    }
    section.append(subsection)
  }
  return section
}
