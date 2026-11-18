// 百度系皮肤的路径规则：布局文件、方向、主题。
//
// 这些判断散在转换器各处（过滤布局、找方向、认主题），集中成工具函数，
// 导入与导出用同一套规则，避免两边对「什么算布局文件」理解不一致。

/** 百度布局路径：`<主题>/skin/<方向>/<名字>.ini`，且不是面板专用文件。 */
export function isBdsLayoutPath(path: string): boolean {
  return /^[^/]+\/skin\/(?:port|land)\/[^/]+\.ini$/i.test(path) && !/\/gen\.ini$/i.test(path)
}

/** 路径所属的方向；不是布局文件时返回 undefined。 */
export function orientationOf(path: string): "port" | "land" | undefined {
  const match = /\/(port|land)\//i.exec(path)
  return match ? match[1].toLowerCase() as "port" | "land" : undefined
}

/** 路径所属的主题；取不到时返回 undefined。 */
export function appearanceOf(path: string): "light" | "dark" | undefined {
  const match = /^(light|dark)\//i.exec(path)
  return match ? match[1].toLowerCase() as "light" | "dark" : undefined
}

/** 布局路径里的板名：`light/skin/port/py_26.ini` → `py_26`。 */
export function bdsBoardName(path: string): string | undefined {
  const match = /\/skin\/(?:port|land)\/([^/]+)\.ini$/i.exec(path)
  return match?.[1]
}

/** 主题方向下的目录，末尾带斜杠。 */
export function bdsDirectory(appearance: string, orientation: string): string {
  return `${appearance}/skin/${orientation}/`
}
