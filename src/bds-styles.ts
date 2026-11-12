import { IniDocument } from "./ini.ts"
import { SkinArchive } from "./skin.ts"
import { skinStylePaths } from "./font-files.ts"

/** 安卓样式索引用 short 保存；BDA 的分类型预览编号必须在写出 BDS 时压成连续编号。 */
export function normalizeBdsStyles(archive: SkinArchive): boolean {
  let changed = false
  for (const theme of ["light", "dark"]) {
    const paths = skinStylePaths(archive.names()).filter((path) => path.startsWith(`${theme}/`))
    const ids = [...new Set(paths.flatMap((path) => IniDocument.parse(archive.getText(path)).sections()
      .flatMap((section) => /^STYLE\d+$/.test(section) ? [Number(section.slice(5))] : [])))].sort((a, b) => a - b)
    const compact = (ids.at(-1) ?? 0) > 32767
    const mapping = new Map(ids.map((id, index) => [String(id), String(id === 0 ? 0 : index + (ids[0] === 0 ? 0 : 1))]))
    const reference = (value: string) => value.split(",").map((token) => {
      const id = token.trim()
      if (!/^\d+$/.test(id)) return token
      const direct = mapping.get(id)
      const textStyle = mapping.get(String(Math.floor(Number(id) / 100)))
      return direct ?? (textStyle ? String(Number(textStyle) * 100 + Number(id) % 100) : token)
    }).join(",")
    for (const path of archive.names()) {
      if (!path.startsWith(`${theme}/skin/`) || !/\.(?:css|ini|cnd|pop)$/i.test(path)) continue
      const before = archive.getText(path)
      const document = IniDocument.parse(compact ? before.replace(/^\[STYLE(\d+)\]/gm,
        (header, id: string) => mapping.has(id) ? `[STYLE${mapping.get(id)}]` : header) : before)
      if (compact) {
        for (const { section, key, value } of document.entries()) {
          if (/(?:^|_)STYLE$|^FIRST_(?:BACK|FORE)$|^PARTICLE_IMAGE$/.test(key)) document.set(section, key, reference(value))
        }
      }
      if (paths.includes(path)) {
        const max = Math.max(0, ...document.sections().flatMap((section) => /^STYLE\d+$/.test(section) ? [Number(section.slice(5))] : []))
        if (!document.sections().includes("GLOBAL")) document.appendSection("GLOBAL", [])
        document.set("GLOBAL", "STYLE_NUM", String(max))
      }
      const after = document.toString()
      if (after !== before) { archive.setText(path, after); changed = true }
    }
  }
  return changed
}
