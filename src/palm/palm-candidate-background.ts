import { strFromU8, strToU8 } from "fflate"
import { IniDocument } from "../ini.ts"
import { appendStyle } from "../ios-toolbar.ts"

/** Android Baidu reads HL_IMG first; Palm draws the candidate bar with NM_IMG. */
export function adaptBaiduCandidateBackgrounds(files: Map<string, Uint8Array>): void {
  const read = (path: string) => {
    const bytes = files.get(path)
    return bytes && IniDocument.parse(strFromU8(bytes))
  }
  const tables = new Map<string, { css: IniDocument; derived: Map<string, string> }>()
  for (const path of files.keys()) {
    const match = path.match(/^(.*?)(port|land)\/[^/]+\.(?:cnd|ini)$/i)
    if (!match) continue
    const [, root, orientation] = match
    const layout = read(path)
    const id = layout && layout.get("CAND", "BACK_STYLE")?.split(",")[0].trim()
    if (!id) continue
    const local = `${root}${orientation}/res/default.css`
    const cssPath = files.has(local) ? local : `${root}res/default.css`
    let table = tables.get(cssPath)
    if (!table) {
      const css = read(cssPath)
      if (!css) continue
      tables.set(cssPath, table = { css, derived: new Map() })
    }
    const { css, derived } = table
    const section = `STYLE${id}`
    const normal = css.get(section, "NM_IMG")?.trim()
    const highlight = css.get(section, "HL_IMG")?.trim()
    if (!highlight || highlight === normal) continue
    if (!derived.has(id)) derived.set(id, appendStyle(css, css.entries(section).filter(({ key }) => key !== "HL_IMG")))
    layout.set("CAND", "BACK_STYLE", derived.get(id)!)
    files.set(path, strToU8(layout.toString()))
  }
  for (const [path, { css, derived }] of tables) if (derived.size) files.set(path, strToU8(css.toString()))
}
