import { section } from "./property-rows"

/** 各格式只提供自己的字段；皮肤信息共用设计中的分组顺序。 */
export function skinMetadataSections(rows: HTMLElement[]): HTMLElement[] {
  const keys = [
    ["基本", "name description author versioncode version skin_name skin_author skin_tip skin_version skin_version_self skin_contact skin_id tool_version"],
    ["兼容", "minimecode supportplatform style supportdarkmode skintype skinflags dark_mode platform core_ability skin_type supports-screens"],
    ["能力", "abilities supportpatch layoutsupport splitimage"],
  ] as const
  const groups = new Map<string, HTMLElement[]>([...keys.map(([label]) => [label, []] as [string, HTMLElement[]]), ["其他", []]])
  for (const row of rows) {
    const key = (row.dataset.documentKey ?? row.querySelector<HTMLElement>("[data-skin-field]")?.dataset.skinField ?? "").split(".").at(-1)!.toLowerCase()
    const label = keys.find(([, names]) => names.split(" ").includes(key))?.[0] ?? "其他"
    groups.get(label)!.push(row)
  }
  return [...groups].flatMap(([label, fields]) => fields.length ? [section(label, fields)] : [])
}
