import { bdaConfigPath } from "../bda.ts"
import { decodeBdaSoundConfig } from "../bda-decode.ts"
import { bdaSoundResourceType, updateBdaKeySound, rawFields, rawString, join } from "../bda-encode.ts"
import { bdaPlatform } from "../bda-platform.ts"
import { soundPathForFilename, soundResourcePaths } from "../sounds.ts"
import { appState } from "./state"
import { theme, orientation } from "./dom"
import { field, section } from "./property-rows"
import { keySoundSample } from "./style-card-preview"
import { commitBatch, commitBytes, isEditing, updateDirty } from "./edit-history"
import { populateKeyInspector } from "./key-inspector"
import { refreshSelectedBdaSource } from "./bda-documents"

export function bdaKeySoundSection(keys: string[]): HTMLElement | undefined {
  const archive = appState.archive
  if (!archive || !keys.length) return
  const path = bdaConfigPath(archive, theme.value, orientation.value, "sound") ?? `${theme.value}/skin/${orientation.value}/soundConfig`
  const bytes = archive.getBytes(path)
  const ios = bdaPlatform(archive) === "ios"
  const config = decodeBdaSoundConfig(bytes ?? new Uint8Array())
  const sounds = ios ? config.iosKeySounds : config.keySounds
  const values = keys.map(key => sounds.get(key)?.resourceID ?? sounds.get("default")?.resourceID ?? "")
  const entries = rawFields(bytes ?? new Uint8Array())
  const baseline = { existed: Boolean(bytes), entries: keys.map(key => {
    const index = entries.findIndex(item => item.number === (ios ? 3 : 1) && item.bytes && rawString(rawFields(item.bytes).find(field => field.number === 1)) === key)
    const entry = entries[index]
    return entry ? { index, bytes: [...bytes!.slice(entry.start, entry.end)] } : null
  }) }
  const value = values.every(value => value === values[0]) ? values[0] : ""
  const write = (next: string) => {
    if (!isEditing() || appState.archive !== archive) return
    let after = archive.getBytes(path) ?? new Uint8Array()
    for (const key of keys) after = updateBdaKeySound(after, key, next ? { type: bdaSoundResourceType(next), resourceID: next } : undefined, ios)
    commitBytes(path, archive.getBytes(path), after)
    refreshSelectedBdaSource()
    populateKeyInspector()
    updateDirty()
  }
  const row = field({ key: "keySounds", label: "文件", rowKey: [path, keys], hint: "未单独配置时跟随默认音效；移除后恢复默认音效", mixed: new Set(values).size > 1,
    editable: isEditing(), spec: { kind: "sound", value, files: soundResourcePaths(archive.names(), theme.value, orientation.value).filter(path => /\.(?:ogg|wav|aiff?)$/i.test(path)).map(path => path.split("/").pop()!),
      sample: keySoundSample(value || undefined, soundPathForFilename(archive.names(), theme.value, orientation.value, value)),
    }, commit: write,
    baseline,
    reset: baseline => {
      if (!isEditing() || appState.archive !== archive) return
      const before = archive.getBytes(path)
      let after = before ?? new Uint8Array()
      const saved = baseline as { existed: boolean; entries: Array<{ index: number; bytes: number[] } | null> }
      for (const key of keys) {
        after = updateBdaKeySound(after, key, undefined, ios)
      }
      const parts = rawFields(after).map(field => after.slice(field.start, field.end))
      for (const entry of saved.entries.filter(entry => entry !== null).sort((a, b) => a.index - b.index)) parts.splice(entry.index, 0, Uint8Array.from(entry.bytes))
      after = join(parts)
      if (!after.length && !saved.existed) {
        if (before) commitBatch([{ kind: "bytes", path, before, after: undefined }])
      } else commitBytes(path, before, after)
      refreshSelectedBdaSource()
      populateKeyInspector()
      updateDirty()
    },
  })
  return section("音效", [row])
}
