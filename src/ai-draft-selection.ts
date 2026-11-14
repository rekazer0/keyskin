import { IniDocument } from "./ini.ts"
import type { AiSkinDraftChange } from "./ai-skin-workspace.ts"

type DraftEdit = { id: string; label: string; path: string[]; before: unknown; after: unknown }

/** 数组和新建对象作为一项；已有对象按字段对比，保留格式自己的验证入口。 */
export function draftEdits(change: AiSkinDraftChange): DraftEdit[] {
  if (change.syntax === "png") return []
  const edits: DraftEdit[] = []
  const add = (path: string[], before: unknown, after: unknown) => {
    if (JSON.stringify(before) !== JSON.stringify(after)) edits.push({ id: JSON.stringify(path), label: path.join(" · "), path, before, after })
  }
  if (change.syntax === "ini") {
    const before = IniDocument.parse(change.before), after = IniDocument.parse(change.after)
    for (const section of new Set([...before.sections(), ...after.sections()])) {
      if (!before.hasSection(section) || !after.hasSection(section)) {
        add([section], before.hasSection(section) ? before.entries(section) : undefined, after.hasSection(section) ? after.entries(section) : undefined)
        continue
      }
      for (const key of new Set([...before.entries(section), ...after.entries(section)].map(entry => entry.key))) add([section, key], before.get(section, key), after.get(section, key))
    }
  } else {
    const visit = (before: unknown, after: unknown, path: string[]) => {
      const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value))
      if (object(before) && object(after) && path.length < 20) {
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) visit(Object.hasOwn(before, key) ? before[key] : undefined, Object.hasOwn(after, key) ? after[key] : undefined, [...path, key])
      } else add(path, before, after)
    }
    visit(JSON.parse(change.before), JSON.parse(change.after), [])
  }
  return edits
}

export function selectedDraftChanges(drafts: readonly AiSkinDraftChange[], excludedPaths?: Set<string>, excludedEdits?: Map<string, Set<string>>): AiSkinDraftChange[] {
  return drafts.flatMap(change => {
    if (excludedPaths?.has(change.path)) return []
    const excluded = excludedEdits?.get(change.path)
    if (change.syntax === "png" || !excluded?.size) return [change]
    const edits = draftEdits(change)
    const selected = edits.filter(edit => !excluded.has(edit.id))
    if (!selected.length) return []
    if (selected.length === edits.length) return [change]
    if (change.syntax === "ini") {
      const result = IniDocument.parse(change.before)
      for (const edit of selected) {
        const [section, key] = edit.path
        if (key === undefined) {
          result.removeSections([section])
          if (edit.after) result.appendSection(section, edit.after as { key: string; value: string }[])
        } else if (edit.after === undefined) result.remove(section, key)
        else result.set(section, key, String(edit.after))
      }
      return [{ ...change, after: result.toString() }]
    }
    const result = JSON.parse(change.before)
    for (const edit of selected) {
      let parent = result
      for (const key of edit.path.slice(0, -1)) parent = parent[key]
      const key = edit.path.at(-1)!
      if (edit.after === undefined) delete parent[key]
      else Object.defineProperty(parent, key, { value: edit.after, enumerable: true, configurable: true, writable: true })
    }
    return [{ ...change, after: JSON.stringify(result, null, 2) }]
  })
}
