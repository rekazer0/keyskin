import { setSoundSamplePlaying, soundStyleSample } from "../style-card"
import { animationPlayer } from "../animation-player.ts"
import { createIcon } from "../icons.ts"
import { element } from "../dom-element.ts"
import { asObject } from "../palm/sxi-ini.ts"
import { sxiFragmentPath } from "../palm/sxi-json.ts"
import { palmPreviewClip } from "../palm/palm-preview-clip.ts"
import { PalmStyles } from "../palm/palm-styles.ts"
import { playSoundPath, releaseKeySound } from "./canvas-interaction"
import { visualResolver } from "./bda-documents"
import { openPalmSkin, palmOrientation, palmTheme } from "./sxi-documents"
import { palmStyle } from "./sxi-styles"
import { openAnimation } from "./animation-resource"
import { appState } from "./state"

/** 主窗口的音效试听：再点一次停止，同一时间只响一个音效。 */
export function keySoundSample(filename: string | undefined, path: string | undefined): HTMLElement {
  const sample = soundStyleSample(filename, path ? (root) => {
    const stopping = appState.keySoundPath === path
    releaseKeySound()
    if (!stopping) playSoundPath(path, error => {
      if (root.isConnected) setSoundSamplePlaying(root, appState.keySoundPath === path, error)
    })
    setSoundSamplePlaying(root, !stopping)
  } : undefined)
  setSoundSamplePlaying(sample, Boolean(path && appState.keySoundPath === path))
  return sample
}

/** Palm animation references share the style gallery's real clip sampler, including local overrides. */
export function palmStyleAnimationStates(id: string, choose: () => void) {
  const themed = asObject(openPalmSkin()?.[palmTheme()])
  const localName = `s_${palmOrientation()}`
  const local = asObject(asObject(themed?.[localName])?.ss_2) ?? {}
  const table = { ...asObject(asObject(themed?.s_info)?.ss_2), ...local }
  const animations = [...new Set(Object.values(asObject(palmStyle(id)?.s_5) ?? {}).map(String))]
  const resolver = visualResolver()
  if (!animations.length) {
    const content = element("span")
    content.append(createIcon("image-off", 16))
    return [{ label: "未设置", content, onClick: choose }]
  }
  return animations.map((animation) => {
    const path = sxiFragmentPath([palmTheme(), animation in local ? localName : "s_info", "ss_2"])
    return {
      label: `动画 ${animation}`,
      content: animationPlayer({
        clip: palmPreviewClip(table, animation), key: `${path}|${animation}`, resolver, thumbnail: true,
        readFile: resolver instanceof PalmStyles ? file => resolver.bytes(file) : undefined,
      }),
      onClick: (edit: boolean) => edit ? openAnimation(path, Boolean(asObject(table[animation])?.a4), animation) : choose(),
    }
  })
}
