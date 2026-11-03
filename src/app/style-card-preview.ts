import { element, iconButton } from "../dom-element"
import { createIcon } from "../icons"
import { playSoundPath, releaseKeySound } from "./canvas-interaction"
import { appState } from "./state"


export function soundStyleSample(filename: string | undefined, path: string | undefined): HTMLElement {
  const root = element("div", "ui-style-sound")
  root.title = filename ?? "未配置音效"
  const play = iconButton("play", "试听音效")
  play.disabled = !path
  const text = element("span", "ui-style-sound-info")
  const name = element("strong")
  name.textContent = filename ?? "未配置音效"
  name.title = filename ?? "未配置音效"
  const meta = element("small")
  meta.textContent = path ? "" : "声音文件不存在"
  text.append(name, meta)
  const update = () => {
    const playing = Boolean(path && appState.keySoundPath === path)
    play.replaceChildren(createIcon(playing ? "square" : "play", 14))
    play.setAttribute("aria-label", playing ? "停止试听" : "试听音效")
    root.dataset.playing = String(playing)
  }
  play.addEventListener("click", event => {
    event.stopPropagation()
    if (!path) return
    const stopping = appState.keySoundPath === path
    releaseKeySound()
    if (!stopping) playSoundPath(path, error => {
      if (!root.isConnected) return
      meta.textContent = error ?? ""
      update()
    })
    update()
  })
  root.append(play, text)
  return root
}
