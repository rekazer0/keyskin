// Property rows for Sogou INI sections: image pairs drawn as style cards, colours, four-part rectangles
// and plain values. Every row writes straight to its Sogou file and is one undo step.

import { drawVisualPreview, pngBitmap, type Visual } from "../atlas.ts"
import { createIcon } from "../icons"
import { initDisclosureReveal } from "../motion"
import { IniDocument } from "../ini.ts"
import { ssfFieldLabel, ssfSectionLabel } from "../ssf/ssf-labels.ts"
import { parseSsfImage, SsfPackage, type SsfStretch } from "../ssf/ssf-package.ts"
import { strToU8 } from "fflate"
import { mirrorSsfEdit, ssfResolutionOf, ssfResolutionTwins } from "../ssf/ssf-resolutions.ts"
import { setSourceValue } from "./config-context"
import { commitBatch, commitText, isEditing, updateDirty } from "./edit-history"
import { populateKeyInspector } from "./key-inspector"
import { refreshPreview } from "./preview-render"
import { openImageResourceChooser } from "./resource-inspector"
import { sourceEditPath, ssfDocument, ssfPackage, ssfTheme } from "./ssf-documents"
import { appState } from "./state"
import { styleKindIcon, styleReferenceAddButton, styleReferenceCard } from "../style-card"
import { element } from "../dom-element.ts"
import { sanitizeFontFileName, skinFontFiles, uniqueFontFileName } from "../font-files.ts"
import { type Change } from "../history.ts"
import { showError, showStatus } from "./file-operations"
import { validateFont } from "./skin-fonts"
import { fieldCaption, fieldControl, numberParts, section } from "./property-rows"
import { ssfMediaField } from "./ssf-media-fields"
import { openSsfImageEditor } from "./ssf-image-editor"
import { refreshNativeScenes } from "./native-preview"
import { preview, previewScreenWidth } from "./canvas-interaction"

type SsfEntry = { key: string; value: string }

/** State images follow NORMAL / PRESSED only when the whole image value, including its band, matches. */
const LINKED_STATES: Record<string, string[]> = { NORMAL: ["DISABLED", "NORMAL_ON"], PRESSED: ["PRESSED_ON"] }
const IMAGE_STATES = ["NORMAL", "PRESSED", "DISABLED", "NORMAL_ON", "PRESSED_ON", "FOCUSED"]
const IMAGE_FIELDS = new Set([...IMAGE_STATES, "BG_IMAGE", "ICON", "ICON_PRESSED", "pic_path", "keyboard_bg", "preview_square", "preview_comp"])
const QUADS: Record<string, string[]> = {
  FG_RECT: ["←", "↑", "→", "↓"],
  ICON_RECT: ["←", "↑", "→", "↓"],
  LABEL_POSITION: ["←", "↑", "→", "↓"],
  MINOR_LABEL_POSITION: ["←", "↑", "→", "↓"],
  MARGINS: ["←", "↑", "→", "↓"],
  PADDINGS: ["←", "↑", "→", "↓"],
}
const COLOR_VALUE = /^(?:0x|#)?([0-9a-f]{6}|[0-9a-f]{8})$/i
const NUMERIC_FIELDS = new Set(["TEXT_SIZE", "TYPEFACE", "TYPE", "LABEL_HORIZONTAL_OFFSET", "MINOR_LABEL_HORIZONTAL_OFFSET", "POPUP_OFFSET_VERTICAL", "LOOP_TYPE", "START", "END", "loop_count", "DECO_ANIM_NUMBER"])

/**
 * Applies `change` to one Sogou file as a single undo step, then redraws the canvas from the edited
 * skin right away (the inspector is not typing, so it skips the preview's debounce).
 */
export function editSsfFile(path: string, change: (document: IniDocument) => void): void {
  editTargets([{ path, section: "" }], change)
}

type TextChange = Extract<Change, { kind: "text" }>

/** A section rows write to; `create` is what a missing section starts with (RootView needs BG_STYLE). */
type SsfLocation = { path: string; section: string; create?: SsfEntry[]; bind?: { section: string; key: string } }

function editTargets(targets: SsfLocation[], change: (document: IniDocument, target: SsfLocation) => void, refreshInspector = true, previewOnly = false): void {
  const archive = appState.archive
  if (!archive || archive.format !== "ssf" || !isEditing()) return
  const changes = [...new Set(targets.map((target) => target.path))].flatMap((path) => {
    const before = archive.isText(path) ? archive.getText(path) : ""
    const document = IniDocument.parse(before)
    for (const target of targets.filter((target) => target.path === path)) {
      const previous = document.toString()
      change(document, target)
      if (target.bind && document.toString() !== previous && document.entries(target.section).length) {
        setSsfValue(document, target.bind.section, target.bind.key, withFile(document.get(target.bind.section, target.bind.key), target.section))
      }
    }
    const after = document.toString()
    return before === after ? [] : [{ kind: "text" as const, path, before, after }]
  })
  if (previewOnly) {
    const pkg = ssfPackage()
    if (pkg) refreshNativeScenes(SsfPackage.fromFiles(new Map([...pkg.files, ...changes.map(({ path, after }) => [path, strToU8(after)] as const)])))
    return
  }
  if (!changes.length) return
  const all: TextChange[] = [...changes, ...resolutionTwins(changes)]
  if (all.length === 1) commitText(all[0].path, all[0].before, all[0].after)
  else commitBatch(all)
  if (changes.some((change) => change.path === appState.selectedPath)) appState.selectedDocument = ssfDocument(appState.selectedPath)
  const source = changes.find((change) => change.path === sourceEditPath())
  if (source) setSourceValue(source.after)
  refreshPreview()
  if (refreshInspector) populateKeyInspector()
  updateDirty()
}

function writeValue(targets: SsfLocation[], key: string, value: string): void {
  editTargets(targets, (document, target) => setSsfValue(document, target.section, key, value, target.create))
}

/** Sets a value, adding the section (with `create` first) at the end of the file when it does not exist yet. */
export function setSsfValue(document: IniDocument, section: string, key: string, value: string, create: readonly SsfEntry[] = []): void {
  if (document.sections().includes(section)) {
    // A sparse view section still needs the parser's required defaults on its first edit.
    for (const entry of create) if (entry.key !== key && document.get(section, entry.key) === undefined) document.set(section, entry.key, entry.value)
    document.set(section, key, value)
  } else document.appendSection(section, [...create.filter((entry) => entry.key !== key), { key, value }])
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

/** The image a Sogou value names, fitted whole into a thumbnail. */
async function imageVisual(value: string | undefined): Promise<Visual | undefined> {
  const ref = parseSsfImage(value)
  const bytes = ref && ssfPackage()?.file(ssfTheme(), ref.file)
  const image = bytes && await pngBitmap(bytes)
  return image ? { image, source: [0, 0, image.width, image.height] } : undefined
}

function caption(row: HTMLElement, key: string, label = ssfFieldLabel(key)): void {
  fieldCaption(row, key, label, key === "POPUP_OFFSET_VERTICAL" ? `气泡垂直偏移（${key}）` : undefined)
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
  editTargets(targets, (document, { section, create }) => {
    const current = stateImage(document, section, key)
    for (const linked of [key, ...LINKED_STATES[key] ?? []]) {
      const old = document.get(section, linked)
      if (linked === key || old !== undefined && old === current) setSsfValue(document, section, linked, withFile(old ?? current, file), create)
    }
  })
}

function chooseImage(targets: SsfLocation[], key: string): void {
  if (!isEditing()) return
  openImageResourceChooser((resourceID) => replaceImage(targets, key, /\.\w+$/.test(resourceID) ? resourceID : `${resourceID}.png`))
}

function editImage(targets: SsfLocation[], key: string): void {
  if (!isEditing()) return
  const { path, section } = targets[0]
  openSsfImageEditor({
    label: ssfFieldLabel(key),
    value: () => stateImage(ssfDocument(path), section, key),
    load: () => imageVisual(stateImage(ssfDocument(path), section, key)),
    stretch: () => stretchField(targets, key),
    size: () => preview.keys.find((item) => appState.selectedKeySections.includes(item.section))?.rect ?? { width: preview.panelWidth, height: preview.surfaceHeight },
    pixelScale: () => previewScreenWidth() / preview.panelWidth,
    replace: (refresh) => openImageResourceChooser((resourceID) => {
      replaceImage(targets, key, /\.\w+$/.test(resourceID) ? resourceID : `${resourceID}.png`)
      refresh()
    }),
    close: () => { refreshNativeScenes(); populateKeyInspector() },
  })
}

type CardReference = { path: string; section: string; key: string }

/** A Sogou field that names another image section: show the reference as a card, not a text input. */
function referenceCard(label: string, reference: CardReference, target: SsfLocation): HTMLElement {
  const owner = ssfDocument(reference.path)
  const section = owner.get(reference.section, reference.key)?.split(",")[0] ?? ""
  const name = element("input", "ui-style-ref-name")
  name.value = section
  name.placeholder = "未设置"
  name.disabled = !isEditing()
  name.spellcheck = false
  name.setAttribute("aria-label", label)
  name.addEventListener("change", () => editTargets([{ path: reference.path, section: reference.section }], (document, target) => {
    const next = name.value.trim()
    if (next) setSsfValue(document, target.section, reference.key, withFile(document.get(target.section, reference.key), next))
    else document.remove(target.section, reference.key)
  }))
  const image = ssfDocument(target.path)
  const states = ["NORMAL", "PRESSED"].map((key) => ({
    label: `${key === "PRESSED" ? "按下" : "正常"}${label}`,
    draw: async (canvas: HTMLCanvasElement) => drawVisualPreview(canvas, [await imageVisual(stateImage(image, target.section, key))], false),
    onClick: isEditing() ? () => editImage([target], key) : undefined,
  }))
  const row = element("div", "ui-field style-reference-field")
  caption(row, reference.key, label)
  row.append(styleReferenceCard({ name, kind: styleKindIcon("image"), states, disabled: !isEditing(), remove: {
    label: `移除${label}`,
    run: () => editTargets([{ path: reference.path, section: reference.section }], (document, target) => document.remove(target.section, reference.key)),
  } }))
  return row
}

/**
 * The style card (DESIGN.md §10): file names and type on the left, one preview per state on the right.
 * A section's normal and pressed images share one card, like Baidu's; a lone image gets a card of its own.
 * Each state's file name and preview edit that state independently.
 */
function imageCard(label: string, keys: readonly string[], targets: SsfLocation[]): HTMLElement {
  const { path, section } = targets[0]
  const document = ssfDocument(path)
  const row = element("div", "ui-field style-reference-field")
  caption(row, keys.join(" "), label)
  const names: HTMLInputElement[] = []
  const states = keys.map((key) => {
    const own = document.get(section, key)
    const value = stateImage(document, section, key)
    const file = parseSsfImage(value)?.file
    const stateLabel = keys.length > 1 ? (/PRESSED/.test(key) ? "按下" : "正常") : ""
    // A pressed image the section leaves out is drawn from the normal one: its name stays empty.
    const inherited = stateLabel === "按下" && !own
    const name = element("input", "ui-style-ref-name")
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
    names.push(name)
    return {
      label: `${stateLabel}${label}：${file ?? "未设置"}${own ? "" : "（沿用正常图片）"}`,
      // Thumbnails decode images; a whole phoneSkin.ini has hundreds, so only visible ones are drawn.
      draw: async (canvas: HTMLCanvasElement) => drawVisualPreview(canvas, [await imageVisual(value)], false),
      onClick: isEditing() ? () => editImage(targets, key) : undefined,
    }
  })
  const configured = targets.some(target => keys.some(key => parseSsfImage(stateImage(ssfDocument(target.path), target.section, key))?.file))
  if (configured) row.append(styleReferenceCard({ name: names, kind: styleKindIcon("image"), states, disabled: !isEditing() }))
  else row.firstElementChild?.append(styleReferenceAddButton(`添加${label}`, () => chooseImage(targets, keys[0]), !isEditing()))
  return row
}

function ssfNumberParts(row: HTMLElement, key: string, affixes: string[], values: string[], onChange: (values: string[]) => void): void {
  numberParts(row, ssfFieldLabel(key), affixes, values, onChange, affixes.length === 4 && key !== "FG_RECT" ? 4 : undefined)
}

/** One state's stretch band in the image editor: Sogou's order is left, right, top, bottom. */
function stretchField(targets: SsfLocation[], key: string): HTMLElement {
  const { path, section } = targets[0]
  const stretch = parseSsfImage(stateImage(ssfDocument(path), section, key))?.stretch
  const row = element("div", "ui-field")
  row.dataset.stack = ""
  caption(row, "STRETCH", "拉伸区域")
  row.title = "原图中的像素坐标：0 ≤ 左 < 右 ≤ 图片宽度，0 ≤ 上 < 下 ≤ 图片高度"
  let width = Infinity
  let height = Infinity
  const bands = () => targets.map((target) => parseSsfImage(stateImage(ssfDocument(target.path), target.section, key))?.stretch ?? [0, width, 0, height])
  const updateBounds = () => {
    const current = bands()
    const minimum = [0, Math.min(width, Math.max(...current.map((band) => band[0] + 1))), 0, Math.min(height, Math.max(...current.map((band) => band[2] + 1)))]
    const maximum = [Math.min(width - 1, ...current.map((band) => band[1] - 1)), width, Math.min(height - 1, ...current.map((band) => band[3] - 1)), height]
    for (const [index, input] of inputs.entries()) {
      input.min = String(minimum[index])
      input.max = Number.isFinite(maximum[index]) ? String(maximum[index]) : ""
      input.step = "1"
    }
  }
  const update = (values: string[], previewOnly = false) => {
    const next = bands().map((current) => {
      const band = values.map((value, index) => value === "" ? current[index] : Number(value)) as SsfStretch
      band[1] = Math.max(1, Math.min(width, band[1]))
      band[3] = Math.max(1, Math.min(height, band[3]))
      band[0] = Math.max(0, Math.min(band[1] - 1, band[0]))
      band[2] = Math.max(0, Math.min(band[3] - 1, band[2]))
      return band
    })
    if (next.some((band) => band.some((value) => !Number.isInteger(value)))) return
    editTargets(targets, (document, target) => {
      const band = next[targets.findIndex((item) => item.path === target.path && item.section === target.section)]
      const current = stateImage(document, target.section, key)
      const linked = (LINKED_STATES[key] ?? []).filter((state) => document.get(target.section, state) === current)
      for (const state of [key, ...linked]) {
        const file = parseSsfImage(stateImage(document, target.section, state))?.file
        if (file) setSsfValue(document, target.section, state, [file, ...band].join(","), target.create)
      }
    }, false, previewOnly)
    if (previewOnly) return
    updateBounds()
    row.dispatchEvent(new Event("input", { bubbles: true }))
  }
  ssfNumberParts(row, "STRETCH", ["左", "右", "上", "下"], stretch?.map(String) ?? ["", "", "", ""], (values) => update(values))
  const inputs = [...row.querySelectorAll("input")]
  row.addEventListener("ssf-stretch-preview", () => update(inputs.map((input) => input.value), true))
  for (const input of inputs) input.disabled = true
  // Decode before editing, so commits stay synchronous and retain the numeric gesture's undo token.
  void Promise.all(targets.map((target) => imageVisual(stateImage(ssfDocument(target.path), target.section, key)))).then((images) => {
    if (!row.isConnected) return
    for (const image of images) if (image?.source) {
      width = Math.min(width, image.source[2])
      height = Math.min(height, image.source[3])
    }
    updateBounds()
    const currentBands = bands()
    for (const [index, input] of inputs.entries()) {
      if (Number.isFinite(width) && Number.isFinite(height)) {
        const mixed = currentBands.some((band) => band[index] !== currentBands[0][index])
        input.value = mixed ? "" : String(currentBands[0][index])
        if (mixed) input.placeholder = "混合"
      }
      input.disabled = !isEditing() || !Number.isFinite(width) || !Number.isFinite(height)
    }
  })
  const constrain = (event: Event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement) || input.type === "range" || !input.value.trim()) return
    const value = Number(input.value)
    if (!Number.isFinite(value)) return
    // A leading digit can be below min while the user is still typing a valid multi-digit value.
    if (event.type === "input" && value >= 0 && value < Number(input.min)) return
    input.value = String(Math.min(input.max === "" ? Infinity : Number(input.max), Math.max(Number(input.min), Math.round(value))))
    if (event.type === "input") {
      // Reuse the normal commit on every keystroke without replacing the focused control.
      input.dispatchEvent(new Event("change", { bubbles: true }))
    }
  }
  row.addEventListener("input", constrain, true)
  row.addEventListener("change", constrain, true)
  return row
}

/**
 * A colour as Sogou reads it: `Long.decode` on `0xAARRGGBB` (theme/parse/utils/f.java). Six digits or a
 * `#` would decode with alpha 0, so the colour field always writes all eight digits; each target keeps
 * the part of its own colour that was not edited.
 */
function colorField(key: string, value: string, targets: SsfLocation[]): HTMLElement {
  const values = targets.map(({ path, section }) => ssfDocument(path).get(section, key) ?? "")
  // The block tracks and resets its rows itself (renderBlock), so this builds the row around the bare control.
  const row = element("div", "ui-field")
  caption(row, key)
  row.append(fieldControl({ kind: "color", value, codec: "0xargb" }, ssfFieldLabel(key), (next, { merge }) => editTargets(targets, (document, target) => {
    if (!next) document.remove(target.section, key)
    else setSsfValue(document, target.section, key, merge ? merge(document.get(target.section, key) ?? "") : next, target.create)
  }), { editable: isEditing(), mixed: values.some((item) => item !== values[0]) }))
  return row
}

/** BOLD uses true / absence; SET_PRESSED uses 1 / 0. */
function switchField(key: string, value: string, targets: SsfLocation[]): HTMLElement {
  const row = element("label", "ui-field")
  caption(row, key)
  const on = key === "BOLD" ? "true" : "1"
  row.append(fieldControl({ kind: "switch", checked: value.trim() === on }, ssfFieldLabel(key), (checked) => editTargets(targets, (document, target) => {
    if (checked || key === "SET_PRESSED") setSsfValue(document, target.section, key, checked ? on : "0", target.create)
    else document.remove(target.section, key)
  }), { editable: isEditing() }))
  return row
}

function textField(key: string, value: string, targets: SsfLocation[], options?: string[]): HTMLElement {
  const row = element("label", "ui-field")
  caption(row, key)
  const write = (next: string) => writeValue(targets, key, next)
  // TEXT_SIZE up to 1 is a fraction of the screen width (0.045) and steps by 0.001; above 1 it is pixels.
  const numeric = NUMERIC_FIELDS.has(key) && (/^-?\d+(?:\.\d+)?$/.test(value) || !value && key !== "TYPEFACE")
  const step = key === "TEXT_SIZE" ? (Number(value || 0) <= 1 ? 0.001 : 1) : value.includes(".") ? undefined : 1
  row.append(numeric
    ? fieldControl({ kind: "number", value, step }, ssfFieldLabel(key), write, { editable: isEditing() })
    : fieldControl({ kind: "text", value, suggestions: options }, ssfFieldLabel(key), write, { editable: isEditing() }))
  // 字号不带单位时是屏宽比例：说明放进提示。
  if (key === "TEXT_SIZE") row.title = "屏宽比例，如 0.045；大于 1 时是像素"
  return row
}

/** 按配置含义选共享控件；未知值保留为自定义选项或原始文本，查看时不补写默认值。 */
function ssfConfigField(key: string, value: string, targets: SsfLocation[]): HTMLElement | undefined {
  const values = targets.map(({ path, section }) => ssfDocument(path).get(section, key) ?? "")
  const mixed = values.some(item => item !== values[0])
  const row = element("div", "ui-field")
  caption(row, key)
  if (["LABEL_VISIBLE", "MINOR_LABEL_VISIBLE"].includes(key) && values.every(item => ["", "0", "1"].includes(item.trim()))) {
    row.append(fieldControl({ kind: "switch", checked: value.trim() !== "0" }, ssfFieldLabel(key),
      checked => writeValue(targets, key, checked ? "1" : "0"), { editable: isEditing(), mixed }))
    return row
  }
  const choices = key === "BG_STYLE" ? [["1", "图片"], ["2", "纯色"]] as const
    : key === "LABEL_ORIENTATION" ? [["0", "竖排"], ["1", "横排"]] as const : undefined
  const reference = ["LABEL_STYLE", "MINOR_LABEL_STYLE", "TEXT_STYLE", "TEXT_HIGHLIGHT_STYLE"].includes(key)
  if (!choices && !reference) return
  const document = ssfDocument(targets[0].path)
  const styles = [...document.sections(), ...targets.flatMap(target => target.create?.map(entry => entry.value) ?? [])]
  const options = choices ?? [...new Set(styles)].filter(section => /^TextStyle(?:_|$)/.test(section)
    || document.entries(section).some(entry => ["TEXT_COLOR", "TEXT_SIZE", "TYPEFACE", "BOLD"].includes(entry.key))).map(section => [section, ssfSectionLabel(section)] as const)
  row.append(fieldControl({ kind: "choice", value, options, layout: reference ? "select" : undefined, unset: reference }, ssfFieldLabel(key),
    next => {
      if (next) writeValue(targets, key, next)
      else editTargets(targets, (document, target) => document.remove(target.section, key))
    }, { editable: isEditing(), mixed }))
  return row
}

/** One row for any Sogou value, chosen by its definition before falling back to raw text. */
function ssfField(entry: SsfEntry, targets: SsfLocation[], options?: string[]): HTMLElement {
  const { key, value } = entry
  const media = ssfMediaField(targets[0].path, key, value || targets.slice(1).map(target => ssfDocument(target.path).get(target.section, key)).find(Boolean) || "", next => editTargets(targets, (document, target) => {
    if (next) setSsfValue(document, target.section, key, next, target.create)
    else document.remove(target.section, key)
  }))
  if (media) return media
  const quad = QUADS[key]
  const parts = value.split(",").map((part) => part.trim())
  if (quad && (!value || parts.length === quad.length && parts.every((part) => part !== "" && Number.isFinite(Number(part))))) {
    const row = element("div", "ui-field")
    row.dataset.stack = ""
    caption(row, key)
    ssfNumberParts(row, key, quad, value ? parts : quad.map(() => ""), (values) => editTargets(targets, (document, target) => {
      const current = document.get(target.section, key)?.split(",") ?? (/POSITION|RECT/.test(key) ? ["0", "0", "1", "1"] : ["0", "0", "0", "0"])
      setSsfValue(document, target.section, key, values.map((value, index) => value || current[index]).join(","), target.create)
    }))
    return row
  }
  if (key === "BOLD" || key === "SET_PRESSED") return switchField(key, value, targets)
  const config = ssfConfigField(key, value, targets)
  if (config) return config
  if (/COLOR/i.test(key) && (COLOR_VALUE.test(value.trim()) || !value)) return colorField(key, value, targets)
  if (parseSsfImage(value) || !value && IMAGE_FIELDS.has(key)) return imageCard(ssfFieldLabel(key), [key], targets)
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
  /** A missing style is bound to its key only when a field is first edited. */
  bind?: SsfLocation["bind"]
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
    showStatus(`已导入字体 ${name}`)
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
  heading.title = `${block.path} · [${block.section}]`
  return heading
}

function markMixed(row: HTMLElement, targets: SsfLocation[], keys: string[]): void {
  const values = targets.map(({ path, section }) => ssfDocument(path).get(section, keys[0]) ?? "")
  if (row.classList.contains("style-reference-field")) {
    const names = row.querySelectorAll<HTMLInputElement>(".ui-style-ref-name")
    const states = row.querySelectorAll<HTMLElement>(".ui-style-ref .ui-style-state")
    if (["sound", "ANIM_STYLE", "BG_ANIM", "FG_ANIM", "DECO_ANIM"].includes(keys[0])) {
      if (values.some(value => value !== values[0])) {
        if (names[0]) { names[0].value = ""; names[0].placeholder = "混合" }
        for (const state of states) state.replaceChildren("混合")
      }
      return
    }
    for (const [index, key] of keys.entries()) {
      const files = targets.map(({ path, section }) => parseSsfImage(stateImage(ssfDocument(path), section, key))?.file)
      if (files.every((file) => file === files[0])) continue
      names[index].value = ""
      names[index].placeholder = "混合"
      states[index].replaceChildren("混合")
      states[index].title = `${ssfFieldLabel(key)}：混合`
      states[index].setAttribute("aria-label", states[index].title)
    }
    return
  }
  const inputs = Array.from(row.querySelectorAll<HTMLInputElement>("input:not([type=color])"))
  const quad = QUADS[keys[0]]
  if (quad) {
    const parts = values.map((value) => value.split(",").map((part) => part.trim()))
    for (const [index, input] of inputs.entries()) {
      if (parts.some((value) => value[index] !== parts[0][index])) { input.value = ""; input.placeholder = "混合" }
    }
  } else if (values.some((value) => value !== values[0]) && !row.querySelector(".ui-color-field")) {
    for (const input of inputs) {
      if (input.type === "checkbox") input.indeterminate = true
      else { input.value = ""; input.placeholder = "混合" }
    }
  }
}

/** Rows of one section: its image pairs as cards, then every other value. */
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
  const keys = new Set([...entries.map((entry) => entry.key), ...block.expect ?? []])
  const grid = element("div")
  const targets = [{ path: block.path, section: block.section, create: block.create, bind: block.bind }, ...block.peers ?? []]
  const used = new Set(block.omit ?? [])
  const rowTargets = new Map<HTMLElement, SsfLocation[]>()
  if (block.reference) {
    const ref = block.reference
    const locations = [{ path: ref.path, section: ref.section }]
    const row = referenceCard(ssfFieldLabel(ref.key), ref, block)
    rowTargets.set(row, locations)
    grid.append(row)
    used.add("NORMAL").add("PRESSED")
  }
  for (const [normal, pressed, label] of [["NORMAL", "PRESSED", "图片"], ["ICON", "ICON_PRESSED", "图标"]] as const) {
    const value = entries.find((entry) => entry.key === normal)?.value
    if (used.has(normal) || !keys.has(normal) || value && !parseSsfImage(value)) continue
    grid.append(imageCard(label, [normal, pressed], targets))
    used.add(normal).add(pressed)
  }
  for (const entry of entries) {
    if (used.has(entry.key)) continue
    grid.append(ssfField(entry, targets, block.options?.[entry.key]))
  }
  for (const key of block.expect ?? []) {
    if (!used.has(key) && !entries.some((entry) => entry.key === key)) grid.append(ssfField({ key, value: "" }, targets, block.options?.[key]))
  }
  for (const row of Array.from(grid.children) as HTMLElement[]) {
    const card = row.classList.contains("style-reference-field")
    const rowKeys = row.dataset.documentKey!.split(" ")
    const savedKeys = rowKeys.flatMap((key) => [key, ...LINKED_STATES[key] ?? []])
    const locations = rowTargets.get(row) ?? targets
    const sources = locations.map((target) => ({ target, keys: [...new Set([...savedKeys, ...target.create?.map(({ key }) => key) ?? []])] }))
    if (rowTargets.has(row)) sources.push(...targets.map((target) => ({ target, keys: IMAGE_STATES })))
    for (const target of targets) if (target.bind) sources.push({ target: { path: target.path, section: target.bind.section }, keys: [target.bind.key] })
    const saved = sources.map(({ target, keys }) => ({ path: target.path, section: target.section, exists: ssfDocument(target.path).sections().includes(target.section), values: Object.fromEntries(keys.map((key) => {
      const value = ssfDocument(target.path).get(target.section, key)
      return [key, value === undefined ? null : card ? value.split(",")[0] : value]
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
            if (value === null) document.remove(target.section, key)
            else if (card) setSsfValue(document, target.section, key, withFile(current, value))
            else setSsfValue(document, target.section, key, value)
          }
          if (!item.exists && !document.entries(target.section).length) document.removeSections([target.section])
        }
      })
    })
    if (block.peers?.length) markMixed(row, targets, rowKeys)
  }
  const extended = Array.from(grid.children).filter((row) => ["DISABLED", "NORMAL_ON", "PRESSED_ON"].includes((row as HTMLElement).dataset.documentKey ?? ""))
  if (extended.length) {
    const disclosure = element("details", "ui-disclosure")
    disclosure.dataset.ssfStates = JSON.stringify([block.path, block.section])
    const summary = element("summary", "ui-button")
    summary.dataset.variant = "quiet"
    summary.dataset.size = "sm"
    summary.append(createIcon("chevron-right", 14), "扩展配置")
    const content = element("div", "ui-subsection")
    content.append(...extended)
    disclosure.append(summary, content)
    initDisclosureReveal(disclosure)
    grid.append(disclosure)
  }
  nodes.push(...Array.from(grid.children) as HTMLElement[])
  return nodes
}

/** One inspector group; subheadings only distinguish content the group or card does not already name. */
export function renderGroup(label: string, blocks: SsfBlock[], code?: string, key = label): HTMLElement | undefined {
  const shown = blocks.filter((block) => block.template || block.expect || ssfDocument(block.path).sections().includes(block.section))
  if (!shown.length) return
  const group = section(label, [], { code })
  const many = shown.length > 1
  for (const [index, block] of shown.entries()) {
    const subsection = element("div", "ui-subsection")
    const references = shown.flatMap(({ reference }) => reference?.path === block.path && reference.section === block.section ? [reference.key] : [])
    const title = block.title ?? ssfSectionLabel(block.section)
    const showHeading = title !== label && !block.reference && block.only?.length !== 0 && (many || Boolean(block.title))
    subsection.append(...renderBlock({ ...block, omit: [...block.omit ?? [], ...references] }, showHeading))
    for (const row of Array.from(subsection.querySelectorAll<HTMLElement>("[data-inspector-row-key]"))) {
      row.dataset.inspectorRowKey = JSON.stringify([key, index, row.dataset.documentKey])
    }
    group.append(subsection)
  }
  return group
}
