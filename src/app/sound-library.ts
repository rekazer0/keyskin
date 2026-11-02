import { element, iconButton } from "../dom-element"
import { createIcon } from "../icons"
import { SOUND_ACCEPT } from "../sounds"
import { appState } from "./state"
import { resourceCount, resourceGallery, resourceSearch, resourceDownloadButton } from "./dom"
import { playSoundPath, releaseKeySound } from "./canvas-interaction"
import { isEditing } from "./edit-history"
import { runFileOperation } from "./file-operations"
import { uploadKeySound } from "./resource-inspector"
import type { SoundEntry } from "./types"

export function renderSoundLibrary(entries: SoundEntry[], onSelect: () => void): void {
  if (appState.keySoundFinished) releaseKeySound()
  resourceGallery.dataset.kind = "sound"
  const query = resourceSearch.value.trim().toLowerCase()
  const visible = entries.filter(entry => `${entry.filename} ${entry.usage}`.toLowerCase().includes(query))
  resourceCount.textContent = query ? `${visible.length} / ${entries.length} 个音效` : `${entries.length} 个音效`
  const library = element("div", "ui-sound-library")
  const toolbar = element("div", "ui-sound-toolbar")
  const support = element("small")
  support.textContent = "OGG / WAV / AIFF"
  const add = element("button", "ui-button")
  add.type = "button"
  add.append(createIcon("plus"), "添加音效")
  add.disabled = !isEditing()
  const chooseFile = (entry?: SoundEntry) => {
    const input = element("input")
    input.type = "file"
    input.accept = entry ? `.${entry.filename.split(".").pop()}` : SOUND_ACCEPT
    input.hidden = true
    library.append(input)
    const archive = appState.archive
    input.addEventListener("change", () => {
      const file = input.files?.[0]
      input.remove()
      if (file && appState.archive === archive && library.isConnected) {
        void runFileOperation(entry ? "替换按键音效" : "添加按键音效", () => uploadKeySound(file, entry?.path))
      }
    }, { once: true })
    input.addEventListener("cancel", () => input.remove(), { once: true })
    input.click()
  }
  add.addEventListener("click", () => chooseFile())
  toolbar.append(support, add)
  const list = element("div", "ui-sound-list")
  list.setAttribute("role", "group")
  list.setAttribute("aria-label", "音效文件")
  const detail = element("section", "ui-sound-preview")
  detail.setAttribute("aria-label", "音效试听")
  const status = element("p", "ui-field-note")
  status.setAttribute("role", "status")
  const rows: { entry: SoundEntry; row: HTMLElement; select: HTMLButtonElement; play: HTMLButtonElement }[] = []
  const fileSize = (entry: SoundEntry) => {
    const bytes = appState.archive?.getBytes(entry.path)?.byteLength ?? 0
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
  }
  const selectEntry = (entry: SoundEntry) => {
    if (appState.selectedSoundID !== entry.id) releaseKeySound()
    appState.selectedSoundID = entry.id
    appState.selectedResourceGalleryPath = entry.id
    onSelect()
    updateSelection()
  }
  const audition = (entry: SoundEntry) => {
    const stopping = appState.keySoundPath === entry.path
    if (appState.selectedSoundID !== entry.id) selectEntry(entry)
    if (stopping) { releaseKeySound(); return }
    releaseKeySound()
    status.dataset.error = "false"
    status.textContent = `正在试听 ${entry.filename}`
    playSoundPath(entry.path, error => {
      if (!library.isConnected) return
      status.textContent = error ?? "试听结束"
      status.dataset.error = String(Boolean(error))
      updatePlaying()
    })
    updatePlaying()
  }
  const updatePlaying = () => {
    for (const { entry, row, play } of rows) {
      const playing = appState.keySoundPath === entry.path
      row.dataset.playing = String(playing)
      play.replaceChildren(createIcon(playing ? "square" : "play"))
      play.title = `${playing ? "停止" : "试听"} ${entry.filename}`
      play.setAttribute("aria-label", play.title)
    }
    const selected = entries.find(entry => entry.id === appState.selectedSoundID)
    const button = detail.querySelector<HTMLButtonElement>("[data-audition]")
    if (button && selected) {
      const playing = appState.keySoundPath === selected.path
      button.replaceChildren(createIcon(playing ? "square" : "play"), playing ? "停止试听" : "试听音效")
    }
  }
  const updateSelection = () => {
    for (const { entry, select } of rows) select.setAttribute("aria-current", String(entry.id === appState.selectedSoundID))
    detail.replaceChildren()
    const selected = entries.find(entry => entry.id === appState.selectedSoundID)
    if (!selected) {
      const title = element("strong")
      title.textContent = "选择一个音效"
      status.textContent = "点击播放按钮试听，选择文件后可替换或下载。"
      detail.append(createIcon("audio-lines", 20), title, status)
      return
    }
    const heading = element("small")
    heading.textContent = "当前音效"
    const name = element("strong")
    name.textContent = selected.filename
    name.title = selected.filename
    const path = element("small", "ui-sound-path")
    path.textContent = selected.path
    path.title = selected.path
    const actions = element("div", "ui-sound-actions")
    const play = element("button", "ui-button")
    play.type = "button"
    play.dataset.audition = ""
    play.addEventListener("click", () => audition(selected))
    const replace = element("button", "ui-button")
    replace.type = "button"
    replace.append(createIcon("upload"), "替换文件")
    replace.disabled = !isEditing()
    replace.title = "替换音频内容，保留原文件名和引用"
    replace.addEventListener("click", () => chooseFile(selected))
    const download = iconButton("download", "下载选中按键音效", () => resourceDownloadButton.click())
    actions.append(play, replace, download)
    status.textContent = "仅试听，不修改按键的音效绑定。"
    status.dataset.error = "false"
    detail.append(heading, name, path, actions, status)
    updatePlaying()
  }
  for (const entry of visible) {
    const row = element("div", "ui-sound-row")
    const select = element("button", "ui-list-item")
    select.type = "button"
    select.dataset.soundId = entry.id
    select.title = entry.path
    const text = element("span", "ui-list-item-text")
    const name = element("strong")
    name.textContent = entry.filename
    const path = element("small")
    path.textContent = entry.usage
    text.append(name, path)
    const format = element("span", "ui-badge")
    format.textContent = entry.filename.split(".").pop()?.toUpperCase() ?? ""
    const size = element("small", "ui-sound-size")
    size.textContent = fileSize(entry)
    select.append(createIcon("audio-lines", 16), text, format, size)
    select.addEventListener("click", () => selectEntry(entry))
    const play = iconButton("play", `试听 ${entry.filename}`, () => audition(entry))
    row.append(select, play)
    list.append(row)
    rows.push({ entry, row, select, play })
  }
  list.addEventListener("keydown", event => {
    if (!(event.target instanceof Element)) return
    const index = rows.findIndex(({ row }) => row.contains(event.target as Node))
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1
      : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : undefined
    if (next === undefined || !rows.length) return
    event.preventDefault()
    const target = rows[Math.max(0, Math.min(rows.length - 1, next))]!
    selectEntry(target.entry)
    target.select.focus()
  })
  if (!visible.length) {
    const empty = element("div", "ui-sound-empty")
    const title = element("strong")
    title.textContent = query ? "没有找到匹配的音效" : "还没有按键音效"
    const hint = element("p", "ui-field-note")
    hint.textContent = query ? "试试文件名、格式或所在路径。" : "添加 OGG、WAV 或 AIFF 文件，随后可在样式中配置。"
    empty.append(createIcon(query ? "search" : "audio-lines", 20), title, hint)
    if (query) {
      const clear = element("button", "ui-button")
      clear.type = "button"
      clear.textContent = "清除搜索"
      clear.addEventListener("click", () => {
        resourceSearch.value = ""
        resourceSearch.dispatchEvent(new Event("input", { bubbles: true }))
        resourceSearch.focus()
      })
      empty.append(clear)
    }
    list.append(empty)
  }
  library.append(toolbar, list, detail)
  resourceGallery.append(library)
  updateSelection()
  updatePlaying()
  onSelect()
}
