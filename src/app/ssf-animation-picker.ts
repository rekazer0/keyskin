import { animationPlayer } from "../animation-player"
import { emptyClip } from "../animation-preview-model"
import type { Visual } from "../atlas"
import { element, emptyState } from "../dom-element"
import type { SceneLayer } from "../native-scene"
import type { StyleLibraryPayload, StyleLibraryVisual, SsfLibraryAnimation } from "../picker-window"
import { SsfMotion } from "../ssf/ssf-motion"
import { firstValue } from "../ssf/ssf-parts"
import { SsfStyles } from "../ssf/ssf-scene"
import { preview, previewScreenWidth } from "./canvas-interaction"
import { isEditing } from "./edit-history"
import { selectFile } from "./navigation"
import { ssfDocument, ssfPackage } from "./ssf-documents"
import { appState } from "./state"
import { openStylePicker } from "./style-picker"

function animationPath(path: string, key: string): string {
  return key === "ANIM_STYLE" ? path.replace(/[^/]+$/, "anim.ini") : path
}

function animationOptions(path: string, key: string): string[] {
  const document = ssfDocument(animationPath(path, key))
  return document.sections().filter(section => key === "ANIM_STYLE" ? /^Anim_Style(?:_|$)/i.test(section)
    : /^Animation(?:_|$)/i.test(section) || document.get(section, "DOWN_ANIM_OBJ") !== undefined)
}

function animationStyles(path: string, key: string): SsfStyles | undefined {
  const archive = appState.archive
  const pkg = ssfPackage()
  if (!archive || !pkg) return
  const theme = animationPath(path, key).startsWith(pkg.folder("light")) ? "light" : "dark"
  return new SsfStyles(archive, pkg, theme)
}

export function editSsfAnimation(path: string, key: string, value: string): void {
  selectFile(animationPath(path, key))
  const heading = [...document.querySelectorAll("#document-fields .document-section-code")].find(item => item.textContent === value)
  heading?.closest(".ui-section")?.scrollIntoView({ block: "start" })
}

/** 引用卡和共用窗口都使用搜狗原始动画与真实按键，不经过百度格式转换。 */
export function ssfAnimationPreview(path: string, key: string, value: string): HTMLElement {
  const document = ssfDocument(animationPath(path, key))
  const styles = animationStyles(path, key)
  if (!styles || !document.sections().includes(value)) {
    const host = emptyState("image-off")
    host.title = `引用缺失：${value}`
    return host
  }
  return animationPlayer({ clip: emptyClip(), key: `${path}|${key}|${value}`, thumbnail: true, native: async () => {
    const scene = await preview.sceneForState()
    const target = scene?.keys.find(item => item.section === appState.selectedKeySections[0]) ?? scene?.keys[0]
    if (!target) return
    const motion = await SsfMotion.load(styles, { width: preview.panelWidth, height: preview.panelHeight }, document, previewScreenWidth())
    const effects = motion?.effects([{ section: target.section, rect: target.rect, binding: { sections: [], defaults: [], keyClass: "char" } }], {
      section: value, field: key === "ANIM_STYLE" ? undefined : key,
    })
    return effects ? { key: target, effects } : undefined
  } })
}

export function openSsfAnimationPicker(path: string, key: string, current: string, commit: (value: string) => void): void {
  if (!isEditing()) return
  const archive = appState.archive
  const input = element("input")
  input.value = current
  input.dataset.ssfAnimationPath = path
  input.dataset.ssfAnimationField = key
  input.addEventListener("change", () => {
    if (appState.archive === archive && isEditing() && animationOptions(path, key).includes(input.value)) commit(input.value)
  })
  openStylePicker(input)
}

export async function ssfAnimationLibraryPayload(input: HTMLInputElement): Promise<StyleLibraryPayload | undefined> {
  const path = input.dataset.ssfAnimationPath!, key = input.dataset.ssfAnimationField!
  const archive = appState.archive
  const revision = archive?.revision
  const styles = animationStyles(path, key)
  if (!styles) return
  const animation = ssfDocument(animationPath(path, key))
  const bitmaps: Record<string, string> = {}
  const images = new Map<ImageBitmap, string>()
  const visual = ({ image, ...rest }: Visual): StyleLibraryVisual => {
    if (!image) return rest
    let imageKey = images.get(image)
    if (!imageKey) {
      imageKey = `ssf:${images.size}`
      images.set(image, imageKey)
      const canvas = document.createElement("canvas")
      canvas.width = image.width
      canvas.height = image.height
      canvas.getContext("2d")?.drawImage(image, 0, 0)
      bitmaps[imageKey] = canvas.toDataURL()
    }
    return { ...rest, imageKey }
  }
  const data: SsfLibraryAnimation = {
    text: animation.toString(), skin: styles.skin.toString(), keys: styles.keys.toString(),
    sogouWidth: styles.sogouWidth, screenWidth: previewScreenWidth(),
    board: { width: preview.panelWidth, height: preview.panelHeight },
    field: key === "ANIM_STYLE" ? undefined : key, images: {},
  }
  const scene = await preview.sceneForState()
  const target = scene?.keys.find(item => item.section === appState.selectedKeySections[0]) ?? scene?.keys[0]
  if (target) {
    const layer = (item: SceneLayer) => item.kind === "image" ? { ...item, visual: visual(item.visual) } : item
    data.key = { section: target.section, rect: target.rect, layers: [false, true].map(pressed => {
      const layers = target.layers(pressed)
      return { ...layers, back: layers.back.map(layer), fore: layers.fore.map(layer) }
    }) }
  }
  const files = new Set(animation.sections().map(section => firstValue(animation.get(section, "IMG"))).filter((file): file is string => Boolean(file)))
  await Promise.all([...files].map(async file => {
    const image = await styles.file(file)
    if (image) data.images[file] = visual(image)
  }))
  if (appState.archive !== archive || archive?.revision !== revision || appState.stylePickerTarget !== input) return
  return {
    ssfAnimation: data, sliceBack: false, editable: isEditing() && !input.disabled, canAdd: false,
    soundOnly: false, foreground: key !== "BG_ANIM", bda: false, kind: "anim", currentID: input.value,
    imagesCompatible: false, bitmaps, animationText: "", animationFiles: {}, particleVisuals: {},
    styles: animationOptions(path, key).map(styleID => ({ styleID, label: styleID, kind: "anim", categories: ["key"], compatible: true, imagePaths: [], visuals: [] })),
    images: [], sounds: [],
  }
}
