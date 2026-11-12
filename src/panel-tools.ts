import { IniDocument } from "./ini.ts"
import { knownSkinStates } from "./actions.ts"

const pairKeys = new Set(["SIZE", "POS", "CELL_SIZE", "FIX_SIZE"])
const rectKeys = new Set(["VIEW_RECT", "TOUCH_RECT", "SOURCE_RECT", "INNER_RECT"])

function scaled(value: string, xRatio: number, yRatio: number): string {
  return value.split(",").map((token, index) => {
    const number = Number(token)
    if (!Number.isFinite(number)) return token
    const ratio = index % 2 ? yRatio : xRatio
    return String(Math.round(number * ratio))
  }).join(",")
}

export function availableSkinStates(...documents: IniDocument[]): number[] {
  const states = documents.flatMap((document) => document.entries()).flatMap(({ key, value }) => {
    const styleStates = key === "STAT_STYLE"
      ? [...value.matchAll(/(?:^|\|)S(\d+)_/g)].map((match) => Number(match[1]))
      : []
    const actionState = value.trim().match(/^S(\d+)(?:_\d+)?$/)
    return [...styleStates, ...(actionState ? [Number(actionState[1])] : [])]
  })
  return [...new Set([...knownSkinStates, ...states].filter((state) => state >= 0 && state <= 122))]
    .sort((a, b) => a - b)
}

export function stateStyleValue(value: string | undefined, state: number): number | undefined {
  if (state === 0) return
  const match = value?.match(new RegExp(`(?:^|\\|)S${state}_(\\d+)(?:\\||$)`))
  return match ? Number(match[1]) : undefined
}

// 官方 Android（KeyParam.J）按 STAT_STYLE 的书写顺序取第一个"状态成立"的 S<状态>_<TIP>，只换这一层，
// TIP 自己的 STAT_STYLE 不再生效。预览默认模拟官方 APK 的普通手机初始设置：
// - 长按语音 / 国际化语言 S34、S36、S37 三者互斥（InputEventHandler），默认开着空格语音、没装其他语言，即 S36；
// - S67：SkinLayoutManagerKt.a/e 的 fusion 布局；S35（仓颉速成）默认关闭，S99 未找到启用来源，不自动加上。
const VOICE_LANGUAGE_STATES = [34, 36, 37]
const DEFAULT_VOICE_LANGUAGE_STATE = 36
const DEFAULT_LAYOUT_STATE = 67

function activeStates(state: number): Set<number> {
  const voiceLanguage = VOICE_LANGUAGE_STATES.includes(state) ? state : DEFAULT_VOICE_LANGUAGE_STATE
  // S0 是用于叠层的空状态，不成立、不触发 TIP 替换。
  return new Set([state, voiceLanguage, DEFAULT_LAYOUT_STATE].filter((id) => id !== 0))
}

export function stateTipSection(
  value: string | undefined,
  state: number | undefined,
): number | undefined {
  const effectiveState = state ?? 0
  if (effectiveState < 0 || effectiveState > 122) return
  const active = activeStates(effectiveState)
  for (const match of value?.matchAll(/(?:^|\|)\s*S(\d+)_(\d+)\s*(?=\||$)/g) ?? []) {
    if (active.has(Number(match[1]))) return Number(match[2])
  }
}

export function effectivePanelSection(
  document: IniDocument,
  section: string,
  state: number | undefined,
): string {
  const tip = stateTipSection(document.get(section, "STAT_STYLE"), state)
  const target = tip === undefined ? undefined : `TIP${tip}`
  return target && document.sections().includes(target) ? target : section
}

export function previewScalePercent(
  renderedWidth: number,
  renderedHeight: number,
  panelWidth: number,
  panelHeight: number,
): number {
  if (![renderedWidth, renderedHeight, panelWidth, panelHeight].every((value) => value > 0)) return 0
  return Math.round(Math.min(renderedWidth / panelWidth, renderedHeight / panelHeight) * 100)
}

export function canvasFitWidth(
  availableWidth: number,
  availableHeight: number,
  logicalWidth: number,
  logicalHeight: number,
): number {
  if (![availableWidth, availableHeight, logicalWidth, logicalHeight].every((value) => value > 0)) return 0
  return logicalWidth * Math.min(1, availableWidth / logicalWidth, availableHeight / logicalHeight)
}

export function scaleIniDocument(
  source: IniDocument,
  xRatio: number,
  yRatio: number,
): IniDocument {
  const output = IniDocument.parse(source.toString())
  for (const { section, key, value } of output.entries()) {
    if (rectKeys.has(key) && value.split(",").length === 4) {
      output.set(section, key, scaled(value, xRatio, yRatio))
    } else if ((pairKeys.has(key) || key === "PADDING") && value.split(",").length % 2 === 0) {
      output.set(section, key, scaled(value, xRatio, yRatio))
    } else if (key === "FORE_OFFSET") {
      output.set(section, key, value.split(";").map((part) => scaled(part, xRatio, yRatio)).join(";"))
    }
  }
  return output
}

export function variantCopyPaths(
  names: readonly string[],
  sourceTheme: string,
  sourceOrientation: string,
  targetTheme: string,
  targetOrientation: string,
): Array<{ source: string; target: string }> {
  const existing = new Set(names)
  const themeChange = sourceTheme !== targetTheme
  const sourcePrefix = themeChange
    ? `${sourceTheme}/skin/`
    : `${sourceTheme}/skin/${sourceOrientation}/`
  const targetPrefix = themeChange
    ? `${targetTheme}/skin/`
    : `${targetTheme}/skin/${targetOrientation}/`
  return names.flatMap((source) => {
    if (!source.startsWith(sourcePrefix) || source.endsWith("/")) return []
    const target = `${targetPrefix}${source.slice(sourcePrefix.length)}`
    return existing.has(target) ? [] : [{ source, target }]
  }).sort((a, b) => a.source.localeCompare(b.source))
}

function archivePath(value: string): { path: string; directory: boolean } {
  const input = value.trim().replace(/\\/g, "/")
  const directory = input.endsWith("/")
  const path = input.replace(/\/+$/, "")
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").some((part) => !part || part === "." || part === ".." || part.includes("\0"))) {
    throw new Error(`无效归档路径：${value}`)
  }
  return { path, directory }
}

export function archivePathOptions(names: readonly string[]): string[] {
  const paths = new Set<string>()
  for (const name of names) {
    const path = name.replace(/\/+$/, "")
    if (!path) continue
    if (!name.endsWith("/")) paths.add(path)
    const parts = path.split("/")
    for (let index = 1; index < parts.length; index++) paths.add(`${parts.slice(0, index).join("/")}/`)
  }
  return [...paths].sort((a, b) => a.localeCompare(b))
}

export function archiveCopyPaths(
  names: readonly string[],
  sourceValue: string,
  targetValue: string,
): Array<{ source: string; target: string }> {
  const sourceInput = archivePath(sourceValue)
  const targetInput = archivePath(targetValue)
  const files = names.filter((name) => !name.endsWith("/"))
  const sourceIsFile = files.includes(sourceInput.path)
  const sources = sourceIsFile
    ? [sourceInput.path]
    : files.filter((name) => name.startsWith(`${sourceInput.path}/`))
  if (!sources.length) throw new Error(`源目录或文件不存在：${sourceInput.path}`)
  if (!sourceIsFile && files.includes(targetInput.path)) throw new Error(`目标路径是文件：${targetInput.path}`)

  const directories = new Set(archivePathOptions(names).filter((path) => path.endsWith("/")).map((path) => path.slice(0, -1)))
  const targetLeaf = targetInput.path.split("/").pop() ?? ""
  const sourceLeaf = sourceInput.path.split("/").pop() ?? ""
  const targetIsDirectory = !sourceIsFile || targetInput.directory || directories.has(targetInput.path) ||
    !files.includes(targetInput.path) && sourceLeaf.includes(".") && !targetLeaf.includes(".")
  const copies = sources.map((source) => ({
    source,
    target: targetIsDirectory
      ? `${targetInput.path}/${sourceIsFile ? source.split("/").pop() : source.slice(sourceInput.path.length + 1)}`
      : targetInput.path,
  }))
  if (copies.some(({ source, target }) => source === target)) throw new Error("源目录或文件和目标不能相同")
  return copies
}

