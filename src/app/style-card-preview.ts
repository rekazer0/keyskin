import { setSoundSamplePlaying, soundStyleSample } from "../style-card"
import { playSoundPath, releaseKeySound } from "./canvas-interaction"
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
