import { element } from "../dom-element"
import { animationPlayer } from "../animation-player"
import { iniPreviewClip } from "../animation-preview-model"
import { IniDocument } from "../ini"
import { legacyAnimationKindLabel, parseLegacyAnimationFile, writeLegacyAnimationFields } from "../legacy-animation"
import { releaseOnRemove } from "../dom-lifecycle"
import { createIcon } from "../icons"
import { appState } from "./state"
import { mobilePortraitQuery, preview } from "./canvas-interaction"
import { quickInspector } from "./dom"
import { cachedIniDocument } from "./style-document"
import { styleConfigDocument } from "./style-picker"
import { legacyAnimationConfigPath, setSourceValue } from "./config-context"
import { visualResolver } from "./bda-documents"
import { commitText, isEditing, updateDirty } from "./edit-history"
import { populateKeyInspector } from "./key-inspector"
import { refreshPreview } from "./preview-render"
import { styleAnimationSources } from "./legacy-animation-inspector"
import { styleUsages } from "./style-references"
import { field } from "./property-rows"
import { openAnimation } from "./animation-resource"

/** 选键的时间轴复用原动画采样与提交；拖动只改预览时间。 */
export function syncMobileKeyAnimation(): void {
  const group = quickInspector.querySelector<HTMLElement>(".key-animation-fields")!
  const current = group.querySelector<HTMLElement>(".mobile-key-animation")
  if (!mobilePortraitQuery.matches || appState.mobileInspectorCategory !== "animation" || group.hidden) {
    current?.remove()
    return
  }
  const path = legacyAnimationConfigPath()
  const document = path && cachedIniDocument(path)
  const styles = styleConfigDocument()
  if (!path || !document || !styles) { current?.remove(); return }
  const key = preview.keys.find(key => key.sections.includes(appState.selectedKeySections[0]))
  if (!key) { current?.remove(); return }
  const ids = [...new Set([key.animStyle, key.backAnimStyle, ...key.foreAnimStyles, key.pressStyle].filter((id): id is string => Boolean(id && id !== "0")))]
  const entries = parseLegacyAnimationFile(document.toString()).entries
  const sources = ids.flatMap(id => (styleAnimationSources(id, styles)?.sections ?? []).map(section => ({ id, section })))
  const unique = [...new Map(sources.map(source => [source.section, source])).values()]
  const root = element("div", "mobile-key-animation")
  current?.remove()
  group.querySelector("h3")!.after(root)
  for (const { id, section } of unique) {
    const entry = entries.find(entry => entry.section === section)
    if (!entry) continue
    const heading = element("button", "ui-property-link")
    heading.type = "button"
    heading.append(createIcon("film"), `动画 ${entry.index} · ${legacyAnimationKindLabel(entry.kind)}`, createIcon("chevron-right"))
    heading.addEventListener("click", () => openAnimation(path, entry.kind === "particle", section))
    const player = animationPlayer({
      clip: iniPreviewClip(document, section, { fillBefore: true }), key: `${path}|${section}`,
      resolver: visualResolver(),
      readFile: name => appState.archive?.getBytes(`${path.replace(/[^/]*$/, "")}${name}`),
      keyboard: {
        play() {},
        frame(elapsed) { preview.setPlayerParticles({ particles: [], elapsed, key, motion: true }) },
        particles(particles, elapsed) { preview.setPlayerParticles({ particles, elapsed, key, motion: true }) },
      },
    })
    releaseOnRemove(player, () => {
      if (preview.playerParticles?.key === key) preview.setPlayerParticles()
    })
    root.append(heading, player)
    const write = (name: string, value: string) => {
      if (!isEditing() || !appState.archive?.isText(path)) return
      const before = appState.archive.getText(path)
      const after = writeLegacyAnimationFields(before, section, { [name]: value })
      if (before === after) return
      commitText(path, before, after)
      if (appState.selectedPath === path) { appState.selectedDocument = IniDocument.parse(after); setSourceValue(after) }
      refreshPreview()
      updateDirty()
      populateKeyInspector()
    }
    const params = element("div", "mobile-animation-parameters")
    if (entry.kind !== "combination") params.append(field({ key: "DURATION", label: "时长", rowKey: [path, section, "DURATION"],
      spec: { kind: "number", value: document.get(section, "DURATION") ?? "", min: 0, unit: "ms", step: 1 },
      commit: value => write("DURATION", String(value)),
    }))
    const repeat = document.get(section, "REPEAT_CNT") || "1"
    const options: [string, string][] = [["1", "1 次"], ["2", "2 次"], ["3", "3 次"], ["inf", "无限循环"]]
    if (!options.some(([value]) => value === repeat)) options.push([repeat, repeat])
    params.append(field({ key: "REPEAT_CNT", label: "循环", rowKey: [path, section, "REPEAT_CNT"],
      spec: { kind: "choice", value: repeat, options, layout: "select" }, commit: value => write("REPEAT_CNT", String(value)),
    }))
    const scope = element("small", "ui-field-note")
    scope.textContent = `共享动效 · 样式 ${id} 被 ${styleUsages(id).length} 处引用`
    root.append(params, scope)
  }
  if (!root.childElementCount) root.remove()
}
