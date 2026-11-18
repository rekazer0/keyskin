import { bindListboxKeys, element, emptyState } from "../dom-element"
import { releaseOnRemove } from "../dom-lifecycle"
import { retinaThumbnail } from "../atlas"
import { tilePreviewDestination } from "../tiles"
import { appState } from "./state"
import { imageResourceDetail, imageResourcePreview, imageResourcePreviewFrame, imageResourcePreviewNote, resourceDetail, resourceMeta, resourceName, soundResourceDetail, styleResourceDetail } from "./dom"
import { selectResourceImage } from "./resource-inspector"
import { drawAtlas, populateTileInspector, resourceImageSlices } from "./tile-editing"
import { section } from "./property-rows"

/** 单击只读预览；双击或 Enter 复用图集编辑器。 */
export function showImageBrowser(path: string): void {
  const count = appState.selectedResourceGalleryPaths.length
  resourceDetail.hidden = false
  imageResourceDetail.hidden = false
  styleResourceDetail.hidden = true
  soundResourceDetail.hidden = true
  imageResourcePreview.hidden = false
  imageResourcePreviewFrame.hidden = false
  imageResourcePreview.querySelector(".ui-empty")?.remove()
  delete imageResourcePreview.dataset.empty
  resourceName.textContent = count > 1 ? `已选 ${count}` : path.split("/").pop() ?? path
  resourceMeta.textContent = count > 1 ? "" : path
  const bytes = appState.archive?.getBytes(path)
  const slices = resourceImageSlices(path)
  const host = imageResourcePreview.querySelector<HTMLElement>("#image-resource-slices")!
  host.replaceChildren()
  imageResourcePreviewFrame.replaceChildren()
  imageResourcePreviewNote.textContent = ""
  if (!bytes) { imageResourcePreviewFrame.append(emptyState("image-off")); return }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }))
  const image = Object.assign(element("img"), { alt: path.split("/").pop() ?? path })
  image.addEventListener("load", () => {
    if (!image.isConnected) return
    imageResourcePreviewNote.textContent = `${image.naturalWidth} × ${image.naturalHeight} · ${slices.length ? `${slices.length} 个切片` : "整张图片"}`
    const list = element("div", "ui-resource-grid")
    list.setAttribute("role", "listbox")
    list.setAttribute("aria-label", "图片切片")
    const choose = (card: HTMLElement) => {
      for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
        option.setAttribute("aria-selected", String(option === card))
        option.tabIndex = option === card ? 0 : -1
      }
      card.focus({ preventScroll: true })
    }
    for (const slice of slices) {
      const card = element("div", "ui-image-card")
      card.setAttribute("role", "option")
      card.setAttribute("aria-selected", "false")
      card.tabIndex = list.childElementCount ? -1 : 0
      card.dataset.sliceIndex = String(slice.index)
      const preview = element("span", "ui-image-card-preview ui-checker")
      const canvas = retinaThumbnail(element("canvas"), 128, 128)
      const destination = tilePreviewDestination(slice.source[2], slice.source[3], canvas.width)
      canvas.getContext("2d")?.drawImage(image, ...slice.source, destination.x, destination.y, destination.width, destination.height)
      preview.append(canvas, Object.assign(element("span", "ui-image-card-size"), { textContent: `${slice.source[2]} × ${slice.source[3]}` }))
      const caption = element("span", "ui-image-card-caption")
      caption.append(Object.assign(element("strong"), { textContent: `IMG${slice.index}` }))
      card.title = `${slice.source.join(", ")}`
      card.append(preview, caption)
      const open = () => {
        selectResourceImage(path)
        appState.selectedTileIndex = slice.index
        populateTileInspector()
        drawAtlas()
      }
      card.addEventListener("click", () => choose(card))
      card.addEventListener("dblclick", open)
      card.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); open() }
        if (event.key === " ") { event.preventDefault(); choose(card) }
      })
      list.append(card)
    }
    bindListboxKeys(list, choose)
    if (slices.length) host.append(section("切片", [list], { count: String(slices.length) }))
  })
  image.addEventListener("error", () => {
    if (image.isConnected) imageResourcePreviewFrame.replaceChildren(emptyState("image-off"))
  })
  image.src = url
  imageResourcePreviewFrame.append(image)
  releaseOnRemove(image, () => URL.revokeObjectURL(url))
}

export function clearImageBrowser(): void {
  imageResourcePreview.dataset.empty = "true"
  imageResourcePreview.hidden = false
  imageResourceDetail.hidden = false
  styleResourceDetail.hidden = true
  soundResourceDetail.hidden = true
  resourceDetail.hidden = !document.body.classList.contains("resource-workspace")
  resourceName.textContent = "图片"
  resourceMeta.textContent = ""
  imageResourcePreviewFrame.replaceChildren()
  imageResourcePreviewFrame.hidden = true
  imageResourcePreviewNote.textContent = ""
  imageResourcePreview.querySelector("#image-resource-slices")!.replaceChildren()
  if (!imageResourcePreview.querySelector(".ui-empty")) imageResourcePreview.prepend(emptyState("image"))
}
