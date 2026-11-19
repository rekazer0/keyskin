// 百度皮肤的识别阶段：给包里每个文件定角色。
//
// 这一层只回答「这个文件是什么」，不解析内容、不构造模型。
// 它存在的理由：识别逻辑原先散在各处路径谓词里，用完就丢，写出时只能回源包补。
import { appearanceOf, bdsBoardName, orientationOf } from "@/skin-model/board-paths.ts"
import type { FileRole, SkinPackage, SkinStructure } from "@/skin-model/pipeline.ts"
import type { Appearance, BoardKind, Orientation } from "@/skin-model/types.ts"

/** 布局文件名里能看出板种类的特征名。 */
function boardKindOf(path: string): BoardKind {
  const name = (bdsBoardName(path) ?? "").toLowerCase()
  if (/symbol|^zy|^bq|emoji|^sel|_ch$/.test(name)) return "symbol"
  if (/^cand|^hy/.test(name)) return "candidate"
  // 九宫格带 `_9`，要在 py/en 之前判断，否则会被当成 26 键主板。
  if (/(?:^|_)(?:9)$|^num|^bh/.test(name)) return "number"
  if (/^(?:py|en|def|hw|big)/.test(name)) return "main"
  if (/toolbar/.test(name)) return "toolbar"
  if (/list|more/.test(name)) return "list"
  return "other"
}

/** 与布局同目录、但不是按键布局的面板文件。 */
function panelRole(path: string): FileRole | undefined {
  const leaf = (path.split("/").pop() ?? "").toLowerCase()
  if (leaf === "gen.ini" || leaf === "more.ini" || leaf === "toolbar.ini") return { kind: "panel-config" }
  if (leaf === "bh.ini") return { kind: "handwriting" }
  return undefined
}

/** 按路径与内容判断一个文件的角色；判不出来时返回带原因的 unknown。 */
function roleOf(path: string, files: ReadonlyMap<string, Uint8Array>): FileRole {
  const lower = path.toLowerCase()
  const leaf = lower.split("/").pop() ?? lower
  const theme: Appearance = appearanceOf(path) ?? "light"
  const orientation: Orientation | undefined = orientationOf(path)

  if (lower.endsWith(".png")) return { kind: "image" }
  if (lower.endsWith(".til")) return orientation ? { kind: "atlas", theme, orientation } : { kind: "atlas", theme, orientation: "port" }
  if (lower.endsWith(".css")) return { kind: "style", theme }
  if (lower.endsWith(".cnd")) return { kind: "candidate-window" }
  if (lower.endsWith(".pop")) return { kind: "hint-window" }
  if (/\.(?:wav|mp3|ogg|m4a)$/.test(lower)) return { kind: "audio" }
  if (/\.(?:ttf|otf|ttc)$/.test(lower)) return { kind: "font" }
  if (leaf === "info.txt") return { kind: "info" }
  if (leaf === "anim.ini") return { kind: "motion" }

  const panel = panelRole(path)
  if (panel) return panel

  if (lower.endsWith(".ini")) {
    if (!orientation) {
      return { kind: "unknown", reason: "ini 不在主题方向目录下，无法判断用途" }
    }
    const text = new TextDecoder().decode(files.get(path) ?? new Uint8Array())
    if (/\[KEY/i.test(text)) return { kind: "layout", board: boardKindOf(path), theme, orientation }
    // 有方向目录但没有按键段：属于面板或模板，不在按键布局里。
    return { kind: "panel-config" }
  }
  return { kind: "unknown", reason: `没有对应规则的后缀 ${leaf.includes(".") ? leaf.slice(leaf.lastIndexOf(".")) : leaf}` }
}

/** 识别整个包：每个文件一个角色，并汇总出现过的主题与方向。 */
export function identifyBds(pkg: SkinPackage): SkinStructure {
  const roles = new Map<string, FileRole>()
  const themes = new Set<Appearance>()
  const orientations = new Set<Orientation>()
  for (const path of pkg.files.keys()) {
    const role = roleOf(path, pkg.files)
    roles.set(path, role)
    if ("theme" in role) themes.add(role.theme)
    if ("orientation" in role) orientations.add(role.orientation)
  }
  return {
    roles,
    themes: [...themes].sort(),
    orientations: [...orientations].sort(),
  }
}
