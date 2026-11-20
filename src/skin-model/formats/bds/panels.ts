// BDS 面板组件：候选栏、气泡、列表、工具栏与面板背景。
//
// 这些面板的字段在 `gen.ini` 里声明，具体布局在独立的 `.cnd` / `.pop` 文件里。
// 读侧把它们整理成板的面板组件；写侧重新生成这几份文件。
import { IniDocument, blocksOf, numbersOf } from "@/ini.ts"
import type { DocumentAccess } from "@/skin-model/formats/public/access.ts"
import type { Board } from "@/skin-model/board.ts"
import type { BoardPanels, CandidateBar, HintBubble, InputBar, ListPanel, MoreMenu, Offsets, PanelBackdrop, ScanPanel, Toolbar, ToolbarAnchor, ToolbarItem } from "@/skin-model/panel.ts"
import { boardPanels } from "@/skin-model/panel.ts"
import type { KeyAction } from "@/skin-model/types.ts"

export type { BoardPanels }

/** 面板文件的原路径；导出时沿用，避免重建把文件名换掉。`gen` 只在原包有它时才记。 */
export type PanelPaths = { candidate?: string; hint?: string; more?: string; gen?: string }

export type ParsedPanels = { panels: BoardPanels; paths: PanelPaths }

type ActionReader = (value: string | undefined) => KeyAction | undefined
type ActionWriter = (action: KeyAction | undefined) => string | undefined

/** 面板文件与 `gen.ini` 在同一目录，用段里的 `LAYOUT_NAME` 找。 */
function panelPath(access: DocumentAccess, directory: string, name: string | undefined, extension: string): string | undefined {
  if (!name) return
  return access.paths().find((path) => path === `${directory}${name}${extension}`)
}

function numbers(value: string | undefined): number[] {
  return value?.split(",").map((part) => Number(part.trim())).filter(Number.isFinite) ?? []
}

/** `PERSIST` 的四态：0 隐藏、1 空档、2 输入中、3 始终；没写按空档（`persistVisible` 的落空分支）。 */
function persistOf(value: string | undefined): ToolbarItem["persist"] | undefined {
  switch (value?.trim()) {
    case "0": return "hidden"
    case "1": return "idle"
    case "2": return "composing"
    case "3": return "always"
    default: return value === undefined ? "idle" : undefined
  }
}

/** `ANCHOR_TYPE` 的九宫格（1 左上、2 上中、3 右上、4 左中、5 中中、6 右中、7 左下、8 下中、9 右下）。 */
function anchorOf(value: number): ToolbarAnchor | undefined {
  if (!Number.isInteger(value) || value < 1 || value > 9) return
  const x = (["left", "center", "right"] as const)[(value - 1) % 3]
  const y = (["top", "middle", "bottom"] as const)[Math.ceil(value / 3) - 1]
  return { x, y }
}

/** `[ICON1] POS=0,0 SIZE=10,10 KEY=F31` 这类工具栏项。 */
function toolbarItems(document: IniDocument, actionOf: ActionReader): ToolbarItem[] {
  return document.sections().flatMap((section) => {
    const match = /^ICON(\d+)$/i.exec(section)
    if (!match) return []
    const read = (name: string): string | undefined => document.get(section, name)?.trim() || undefined
    const position = numbers(read("POS"))
    const size = numbers(read("SIZE"))
    const action = actionOf(read("KEY"))
    // BDS 的图标图片来自样式（`FORE_STYLE`），`IMG` 只是直接给图片 id 的另一种写法。
    const foreStyle = read("FORE_STYLE")?.split(",")[0]?.trim() || undefined
    const backStyle = read("BACK_STYLE")?.split(",")[0]?.trim() || undefined
    const icon = read("IMG")
    const anchor = anchorOf(Number(read("ANCHOR_TYPE")))
    // 候选词显示区：候选区动作、没有图、矩形占满中间。
    const role = /^F14$/i.test(read("KEY") ?? "") && !foreStyle && !backStyle && !icon ? "candidates" as const : "icon" as const
    const persist = persistOf(read("PERSIST"))
    return [{
      id: `icon${match[1]}`,
      ...(foreStyle ? { foreStyle } : {}),
      ...(backStyle ? { backStyle } : {}),
      ...(icon ? { icon } : {}),
      ...(action ? { action } : {}),
      ...(read("VISIBLE") === "0" ? { visible: false } : {}),
      // `POS` 与 `SIZE` 各自独立：缺一个不影响另一个。
      ...(position.length === 2 ? { offset: { x: position[0], y: position[1] } } : {}),
      ...(size.length === 2 ? { size: { width: size[0], height: size[1] } } : {}),
      ...(anchor ? { anchor } : {}),
      role,
      ...(persist ? { persist } : {}),
    }]
  })
}

/** `gen.ini` 里按结构化字段读出的字段名；没列出的字段（含重复键）保留原始行。 */
const GEN_MODELED: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["PANEL", new Set(["BACK_STYLE", "FORE_STYLE", "SIZE", "OFFSET_NUM", "HAS_PAD_INI", "NO_BLUR"])],
  ["SCAND", new Set(["BACK_STYLE", "FORE_STYLE", "INPUT_STYLE", "SCAND_STYLE", "PADDING"])],
  ["CAND", new Set(["LAYOUT_NAME", "VIEW_RECT", "TYPE"])],
  ["HINT", new Set(["LAYOUT_NAME", "TYPE"])],
  ["MORE", new Set(["GRID", "LAYOUT_NAME", "CELL_STYLE", "FORE_STYLE"])],
  ["LIST", new Set(["BACK_STYLE", "FORE_STYLE", "CELL_STYLE", "CELL_SIZE", "PADDING", "POS", "NAMES"])],
  ["TOOLBAR", new Set(["HEIGHT"])],
  ["LOGO", new Set(["ICON"])],
  ["EMOJI", new Set(["ICON"])],
  ["INPUT", new Set(["BACK_STYLE", "FORE_STYLE", "HEIGHT"])],
])

function genModeledField(section: string, field: string): boolean {
  const name = field.toUpperCase()
  if (/^OFFSET\d+$/i.test(section)) return name === "POS" || name === "R_POS"
  if (/^ICON\d+$/i.test(section)) return ["POS", "SIZE", "IMG", "KEY", "VISIBLE", "FORE_STYLE", "BACK_STYLE", "ANCHOR_TYPE", "PERSIST"].includes(name)
  const modeled = GEN_MODELED.get(section.toUpperCase())
  if (!modeled) return false
  return modeled.has(name) || (section.toUpperCase() === "MORE" && /_LAYOUT$/.test(name))
}

/** `gen.ini` 里各段的未建模行；写回时追加到对应段，不猜语义、不丢字段。 */
function genUnmodeledFields(gen: IniDocument): ReadonlyMap<string, readonly string[]> {
  const extra = new Map<string, readonly string[]>()
  for (const section of gen.sections()) {
    const seen = new Set<string>()
    const lines: string[] = []
    for (const entry of gen.entries(section)) {
      const name = entry.key.toUpperCase()
      const duplicated = seen.has(name)
      seen.add(name)
      if (!duplicated && genModeledField(section, entry.key)) continue
      lines.push(`${entry.key}=${entry.value}`)
    }
    if (lines.length) extra.set(section, lines)
  }
  return extra
}

/** 从 `gen.ini` 与它引用的面板文件里读出面板组件。 */
export function panelsOf(access: DocumentAccess, directory: string, gen: IniDocument, actionOf: ActionReader): ParsedPanels {
  const backdropStyle = gen.get("PANEL", "BACK_STYLE")?.trim()
  const backdropFore = gen.get("PANEL", "FORE_STYLE")?.trim()
  const noBlur = gen.get("PANEL", "NO_BLUR")?.trim() === "1"
  const panelSize = numbersOf(gen.get("PANEL", "SIZE"))
  const offsetCount = Number(gen.get("PANEL", "OFFSET_NUM")?.trim())
  const hasPadIni = gen.get("PANEL", "HAS_PAD_INI")?.trim() === "1"
  const backdrop: PanelBackdrop | undefined = backdropStyle || backdropFore || noBlur || panelSize.length === 2 || Number.isFinite(offsetCount) || hasPadIni
    ? {
      ...(backdropStyle ? { style: backdropStyle } : {}),
      ...(backdropFore ? { foreStyle: backdropFore } : {}),
      ...(panelSize.length === 2 ? { size: { width: panelSize[0], height: panelSize[1] } } : {}),
      ...(noBlur ? { blur: false } : {}),
      ...(Number.isFinite(offsetCount) ? { offsetCount } : {}),
      ...(hasPadIni ? { hasPadIni: true } : {}),
    }
    : undefined

  // `[SCAND]` 是候选栏上方的扫描面板，字段与别的面板同级。
  const scanStyle = gen.get("SCAND", "BACK_STYLE")?.trim()
  const scanFore = gen.get("SCAND", "FORE_STYLE")?.trim()
  const scanInput = gen.get("SCAND", "INPUT_STYLE")?.trim()
  const scanSelf = gen.get("SCAND", "SCAND_STYLE")?.trim()
  const scanPadding = numbersOf(gen.get("SCAND", "PADDING"))
  const scan: ScanPanel | undefined = scanStyle || scanFore || scanInput || scanSelf || scanPadding.length === 4
    ? {
      ...(scanStyle ? { style: scanStyle } : {}),
      ...(scanFore ? { foreStyle: scanFore } : {}),
      ...(scanInput ? { inputStyle: scanInput } : {}),
      ...(scanSelf ? { scanStyle: scanSelf } : {}),
      ...(scanPadding.length === 4
        ? { padding: { left: scanPadding[0], top: scanPadding[1], right: scanPadding[2], bottom: scanPadding[3] } }
        : {}),
    }
    : undefined

  // `[OFFSET1..n]` 是工具栏图标各自的偏移，段号就是图标序号。
  // 空段也要留下：段头存在说明这个序号在原文件里出现过。
  const offsets = new Map<number, Offsets>()
  for (const section of gen.sections()) {
    const match = /^OFFSET(\d+)$/i.exec(section)
    if (!match) continue
    const pos = numbersOf(gen.get(section, "POS"))
    const rPos = numbersOf(gen.get(section, "R_POS"))
    offsets.set(Number(match[1]), {
      ...(pos.length === 2 ? { pos: { x: pos[0], y: pos[1] } } : {}),
      ...(rPos.length === 2 ? { rPos: { x: rPos[0], y: rPos[1] } } : {}),
    })
  }

  // `[CAND]` 在 gen.ini 里描述候选栏自己的位置与类型；同一文件可以有多个 `[CAND]` 段，
  // 每一段各引用一个 `.cnd`，样式在那边。
  let firstCandidatePath: string | undefined
  const candidates: CandidateBar[] = blocksOf(gen, "CAND").flatMap((fields) => {
    const candidateName = fields.get("LAYOUT_NAME")?.trim()
    const candidateRect = numbersOf(fields.get("VIEW_RECT"))
    const candidateType = Number(fields.get("TYPE")?.trim())
    const candidatePath = panelPath(access, directory, candidateName, ".cnd")
    if (candidatePath && firstCandidatePath === undefined) firstCandidatePath = candidatePath
    const candidateDocument = candidatePath ? access.text(candidatePath) : undefined
    if (!candidateDocument && candidateRect.length !== 4 && !Number.isFinite(candidateType)) return []
    const candidateStyle = candidateDocument?.get("CAND", "BACK_STYLE")?.trim()
    const candidateCell = candidateDocument?.get("CAND", "CELL_STYLE")?.trim()
    const candidateSections = candidateDocument ? toolbarItems(candidateDocument, actionOf) : []
    return [{
      ...(candidateStyle ? { style: candidateStyle } : {}),
      ...(candidateCell ? { cellStyle: candidateCell } : {}),
      ...(candidateDocument?.get("CAND", "FORE_STYLE")?.trim() ? { inputStyle: candidateDocument.get("CAND", "FORE_STYLE")!.trim() } : {}),
      ...(candidateSections.length ? { icons: candidateSections } : {}),
      ...(candidateRect.length === 4
        ? { viewRect: { position: { x: candidateRect[0], y: candidateRect[1] }, size: { width: candidateRect[2], height: candidateRect[3] } } }
        : {}),
      ...(Number.isFinite(candidateType) ? { type: candidateType } : {}),
      ...(candidateName ? { layoutName: candidateName } : {}),
    }]
  })

  const hintName = gen.get("HINT", "LAYOUT_NAME")?.trim()
  // gen.ini 的 `[HINT]` 声明用哪个气泡与类型，`.pop` 里才是它的内容。
  const hintType = Number(gen.get("HINT", "TYPE")?.trim())
  const hintPath = panelPath(access, directory, hintName, ".pop")
  const hintDocument = hintPath ? access.text(hintPath) : undefined
  const hintIcon = hintDocument?.get("HINT", "BACK_ICON")?.trim()
  // 气泡位置写在它引用的图标段里（`[ICON0] POS=x,y`），`[HINT]` 只有背景与角标。
  const hintIconSection = hintDocument?.sections().find((section) => /^ICON\d+$/i.test(section))
  const hintOffset = numbers(hintIconSection && hintDocument ? hintDocument.get(hintIconSection, "POS") : undefined)
  const hint: HintBubble | undefined = hintDocument || hintName || Number.isFinite(hintType)
    ? {
      ...(hintIcon ? { style: hintIcon } : {}),
      ...(hintOffset.length === 2 ? { offset: { x: hintOffset[0], y: hintOffset[1] } } : {}),
      ...(hintDocument?.get("HINT", "CORNER") ? { corner: Number(hintDocument.get("HINT", "CORNER")) } : {}),
      ...(hintName ? { layoutName: hintName } : {}),
      ...(Number.isFinite(hintType) ? { type: hintType } : {}),
    }
    : undefined

  // gen.ini 的 `[MORE]` 是符号键盘菜单：各类别指向的布局、网格与样式。
  const moreLayouts = new Map<string, string>()
  for (const entry of gen.entries("MORE")) {
    if (!/_LAYOUT$/i.test(entry.key)) continue
    const value = entry.value.trim()
    if (value) moreLayouts.set(entry.key.toUpperCase(), value)
  }
  const moreCell = gen.get("MORE", "CELL_STYLE")?.trim()
  const moreFore = gen.get("MORE", "FORE_STYLE")?.trim()
  const moreGrid = numbersOf(gen.get("MORE", "GRID"))
  const moreName = gen.get("MORE", "LAYOUT_NAME")?.trim()
  const more: MoreMenu | undefined = moreLayouts.size || moreCell || moreFore || moreGrid.length === 2 || moreName
    ? {
      layouts: moreLayouts,
      ...(moreCell ? { cellStyle: moreCell } : {}),
      ...(moreFore ? { foreStyle: moreFore } : {}),
      ...(moreGrid.length === 2 ? { grid: { width: moreGrid[0], height: moreGrid[1] } } : {}),
      ...(moreName ? { layoutName: moreName } : {}),
    }
    : undefined

  const listStyle = gen.get("LIST", "BACK_STYLE")?.trim()
  const listFore = gen.get("LIST", "FORE_STYLE")?.trim()
  const listCell = gen.get("LIST", "CELL_STYLE")?.trim()
  const cellSize = numbers(gen.get("LIST", "CELL_SIZE"))
  const listPadding = numbersOf(gen.get("LIST", "PADDING"))
  const listPos = numbersOf(gen.get("LIST", "POS"))
  const listNames = gen.get("LIST", "NAMES")?.split(/\s+/).filter(Boolean)
  // gen.ini 只给几何与样式；内容池在布局文件里，所以这一层不填。
  const listAppearance = {
    ...(listStyle ? { style: listStyle } : {}),
    ...(listFore ? { foreStyle: listFore } : {}),
    ...(listCell ? { cellStyle: listCell } : {}),
  }
  const listLayout = {
    ...(cellSize.length === 2 ? { cellSize: { width: cellSize[0], height: cellSize[1] } } : {}),
    ...(listPadding.length === 4
      ? { padding: { left: listPadding[0], top: listPadding[1], right: listPadding[2], bottom: listPadding[3] } }
      : {}),
    ...(listPos.length === 2 ? { offset: { x: listPos[0], y: listPos[1] } } : {}),
    ...(listNames?.length ? { count: listNames.length } : {}),
  }
  const list: ListPanel | undefined = Object.keys(listAppearance).length || Object.keys(listLayout).length
    ? {
      ...(Object.keys(listAppearance).length ? { appearance: listAppearance } : {}),
      ...(Object.keys(listLayout).length ? { layout: listLayout } : {}),
    }
    : undefined

  const morePath = panelPath(access, directory, moreName, ".ini")
  const moreDocument = morePath ? access.text(morePath) : undefined
  const items: ToolbarItem[] = []
  if (gen.get("LOGO", "ICON")?.trim()) items.push({ id: "logo", icon: gen.get("LOGO", "ICON")!.trim() })
  if (gen.get("EMOJI", "ICON")?.trim()) items.push({ id: "emoji", icon: gen.get("EMOJI", "ICON")!.trim() })
  if (moreDocument) items.push(...toolbarItems(moreDocument, actionOf))
  const height = Number(gen.get("TOOLBAR", "HEIGHT"))
  const toolbar: Toolbar | undefined = items.length || Number.isFinite(height)
    ? { items, ...(Number.isFinite(height) && height > 0 ? { height } : {}) }
    : undefined

  const inputStyle = gen.get("INPUT", "BACK_STYLE")?.trim()
  const inputFore = gen.get("INPUT", "FORE_STYLE")?.trim()
  const inputHeight = Number(gen.get("INPUT", "HEIGHT"))
  const input: InputBar | undefined = inputStyle || inputFore || Number.isFinite(inputHeight)
    ? {
      ...(inputStyle ? { style: inputStyle } : {}),
      ...(inputFore ? { foreStyle: inputFore } : {}),
      ...(Number.isFinite(inputHeight) && inputHeight > 0 ? { height: inputHeight } : {}),
    }
    : undefined

  const genExtra = genUnmodeledFields(gen)
  return {
    panels: {
      ...(backdrop ? { backdrop } : {}),
      ...(candidates.length ? { candidates } : {}),
      ...(hint ? { hint } : {}),
      ...(list ? { list } : {}),
      ...(toolbar ? { toolbar } : {}),
      ...(input ? { input } : {}),
      ...(scan ? { scan } : {}),
      ...(more ? { more } : {}),
      ...(offsets.size ? { offsets } : {}),
      ...(genExtra.size ? { genExtraFields: genExtra } : {}),
    },
    paths: {
      gen: `${directory}gen.ini`,
      ...(firstCandidatePath ? { candidate: firstCandidatePath } : {}),
      ...(hintPath ? { hint: hintPath } : {}),
      ...(morePath ? { more: morePath } : {}),
    },
  }
}

/** 锚点的九宫格编号：1 左上 … 9 右下。 */
function anchorValue(anchor: ToolbarAnchor): number {
  const x = { left: 1, center: 2, right: 3 }[anchor.x]
  const y = { top: 1, middle: 2, bottom: 3 }[anchor.y]
  return (y - 1) * 3 + x
}

function persistValue(persist: NonNullable<ToolbarItem["persist"]>): number {
  return { hidden: 0, idle: 1, composing: 2, always: 3 }[persist]
}

function iconSection(items: readonly ToolbarItem[], actionValue: ActionWriter): string[] {
  const lines: string[] = []
  items.forEach((item, index) => {
    const action = actionValue(item.action)
    lines.push(`[ICON${index + 1}]`)
    if (item.backStyle) lines.push(`BACK_STYLE=${item.backStyle}`)
    if (item.foreStyle) lines.push(`FORE_STYLE=${item.foreStyle}`)
    if (item.size) lines.push(`SIZE=${item.size.width},${item.size.height}`)
    if (item.anchor) lines.push(`ANCHOR_TYPE=${anchorValue(item.anchor)}`)
    // 位置来自面板定义；没有时退回原点，保持旧行为。
    lines.push(`POS=${item.offset ? `${item.offset.x},${item.offset.y}` : "0,0"}`)
    if (item.icon) lines.push(`IMG=${item.icon}`)
    if (action) lines.push(`KEY=${action}`)
    if (item.visible === false) lines.push("VISIBLE=0")
    if (item.persist) lines.push(`PERSIST=${persistValue(item.persist)}`)
    lines.push("")
  })
  return lines
}

/** 重新生成面板文件：`gen.ini`、候选栏 `.cnd`、气泡 `.pop`；`paths` 给了就沿用原文件名。 */
export function panelFiles(
  board: Board,
  directory: string,
  size: { width: number; height: number },
  actionValue: ActionWriter,
  paths: PanelPaths = {},
  genPanels: ReadonlyMap<string, ReadonlyArray<ReadonlyMap<string, string>>> = new Map(),
): Array<{ path: string; data: Uint8Array }> {
  const text = (value: string) => new TextEncoder().encode(value)
  const files: Array<{ path: string; data: Uint8Array }> = []
  const background: string[] = []
  const panels = boardPanels(board) ?? {}
  // 布局文件与 `gen.ini` 各自的面板声明分开存：`gen.ini` 只写它自己有的，
  // 否则会把布局文件的 `[LIST]`/`[HINT]`/`[MORE]` 复制进 `gen.ini`。跨格式转来的板没有这个区分，用合并值。
  const fromBdsLayout = panels.layoutSections !== undefined
  const hint = fromBdsLayout ? panels.genHint : panels.hint
  const list = fromBdsLayout ? panels.genList : panels.list
  const menu = fromBdsLayout ? panels.genMore : panels.more
  const items = panels.toolbar?.items ?? []
  const iconItems = items.filter((item) => item.icon)
  const nameOf = (path: string | undefined, fallback: string) => (path ?? `${directory}${fallback}`).split("/").pop()!.replace(/\.[^.]+$/, "")
  const genExtraOf = (section: string): string[] => [...(panels.genExtraFields?.get(section) ?? [])]
  // `[CAND]`/`[INPUT]` 是方向级声明：布局文件里的空段只关闭该布局的面板，不能把 gen.ini 的声明抹掉。
  // 同名段可以出现多次，按块逐段写回。
  const rawBlocksOf = (section: string): Array<Array<string>> | undefined => {
    const blocks = genPanels.get(section)
    return blocks?.map((fields) => [...fields].map(([key, value]) => `${key}=${value}`))
  }

  // 候选栏与气泡各自一个文件，`gen.ini` 用 LAYOUT_NAME 指向它们。
  // 原包已有 `.cnd` 时它由窗口原样写回，面板生成不覆盖它自己的 VIEW_RECT。
  for (const candidate of panels.candidates ?? []) {
    if (paths.candidate) continue
    const lines = [
      "[CAND]",
      ...(candidate.style ? [`BACK_STYLE=${candidate.style}`] : []),
      ...(candidate.cellStyle ? [`CELL_STYLE=${candidate.cellStyle}`] : []),
      ...(candidate.inputStyle ? [`FORE_STYLE=${candidate.inputStyle}`] : []),
      `VIEW_RECT=0,0,${size.width},120`,
      "",
      ...iconSection(candidate.icons ?? [], actionValue),
    ]
    files.push({ path: `${directory}cand.cnd`, data: text(lines.join("\n")) })
  }
  // 候选栏的位置与类型写在 gen.ini 的 `[CAND]` 里，与 `.cnd` 是否存在无关；每段各写一份。
  // 布局文件里的空 `[CAND]` 只是关闭该布局的候选栏，gen.ini 的方向级声明仍要按原文写回。
  const rawCandidate = rawBlocksOf("CAND")
  if (rawCandidate) {
    for (const block of rawCandidate) background.push("[CAND]", ...block, "")
  } else {
    for (const candidate of panels.candidates ?? []) {
      background.push(
        "[CAND]",
        `LAYOUT_NAME=${candidate.layoutName ?? nameOf(paths.candidate, "cand.cnd")}`,
        ...(candidate.viewRect
          ? [`VIEW_RECT=${candidate.viewRect.position.x},${candidate.viewRect.position.y},${candidate.viewRect.size.width},${candidate.viewRect.size.height}`]
          : []),
        ...(candidate.type !== undefined ? [`TYPE=${candidate.type}`] : []),
        "",
      )
    }
  }
  if (hint) {
    const lines = [
      "[HINT]",
      ...(hint.style ? [`BACK_ICON=${hint.style}`] : []),
      ...(hint.offset ? [`OFFSET=${hint.offset.x},${hint.offset.y}`] : []),
      ...(hint.corner !== undefined ? [`CORNER=${hint.corner}`] : []),
      "",
    ]
    files.push({ path: paths.hint ?? `${directory}hint.pop`, data: text(lines.join("\n")) })
    background.push(
      "[HINT]",
      `LAYOUT_NAME=${hint.layoutName ?? nameOf(paths.hint, "hint.pop")}`,
      ...(hint.type !== undefined ? [`TYPE=${hint.type}`] : []),
      ...genExtraOf("HINT"),
      "",
    )
  }
  if (iconItems.length) {
    const lines = ["[PANEL]", `SIZE=${size.width},${size.height}`, "", ...iconSection(iconItems, actionValue)]
    files.push({ path: paths.more ?? `${directory}more.ini`, data: text(lines.join("\n")) })
    background.push("[MORE]", `LAYOUT_NAME=${menu?.layoutName ?? nameOf(paths.more, "more.ini")}`, "")
  }
  // gen.ini 的 `[MORE]` 是符号键盘菜单，除了被引用的面板文件还有网格与各类别布局。
  if (menu && (menu.layouts.size || menu.grid || menu.cellStyle || menu.foreStyle)) {
    const section: string[] = ["[MORE]"]
    if (menu.grid) section.push(`GRID=${menu.grid.width},${menu.grid.height}`)
    if (menu.layoutName) section.push(`LAYOUT_NAME=${menu.layoutName}`)
    if (menu.cellStyle) section.push(`CELL_STYLE=${menu.cellStyle}`)
    if (menu.foreStyle) section.push(`FORE_STYLE=${menu.foreStyle}`)
    for (const [key, value] of [...menu.layouts].sort(([left], [right]) => left.localeCompare(right))) {
      section.push(`${key}=${value}`)
    }
    section.push(...genExtraOf("MORE"), "")
    background.push(...section)
  }

  const panel: string[] = [
    "[PANEL]",
    // 面板尺寸与键盘板尺寸是两个概念，带了面板尺寸就写它自己的。
    `SIZE=${panels.backdrop?.size?.width ?? size.width},${panels.backdrop?.size?.height ?? size.height}`,
    ...(panels.backdrop?.style ? [`BACK_STYLE=${panels.backdrop.style}`] : []),
    ...(panels.backdrop?.foreStyle ? [`FORE_STYLE=${panels.backdrop.foreStyle}`] : []),
    ...(panels.backdrop?.offsetCount !== undefined ? [`OFFSET_NUM=${panels.backdrop.offsetCount}`] : []),
    ...(panels.backdrop?.hasPadIni ? ["HAS_PAD_INI=1"] : []),
    ...(panels.backdrop?.blur === false ? ["NO_BLUR=1"] : []),
    ...genExtraOf("PANEL"),
    "",
    ...(panels.scan
      ? [
        "[SCAND]",
        ...(panels.scan.style ? [`BACK_STYLE=${panels.scan.style}`] : []),
        ...(panels.scan.foreStyle ? [`FORE_STYLE=${panels.scan.foreStyle}`] : []),
        ...(panels.scan.inputStyle ? [`INPUT_STYLE=${panels.scan.inputStyle}`] : []),
        ...(panels.scan.scanStyle ? [`SCAND_STYLE=${panels.scan.scanStyle}`] : []),
        ...(panels.scan.padding
          ? [`PADDING=${panels.scan.padding.left},${panels.scan.padding.top},${panels.scan.padding.right},${panels.scan.padding.bottom}`]
          : []),
        ...genExtraOf("SCAND"),
        "",
      ]
      : []),
    ...(list
      ? [
        "[LIST]",
        ...(list.appearance?.style ? [`BACK_STYLE=${list.appearance.style}`] : []),
        ...(list.appearance?.foreStyle ? [`FORE_STYLE=${list.appearance.foreStyle}`] : []),
        ...(list.appearance?.cellStyle ? [`CELL_STYLE=${list.appearance.cellStyle}`] : []),
        ...(list.layout?.cellSize ? [`CELL_SIZE=${list.layout.cellSize.width},${list.layout.cellSize.height}`] : []),
        ...(list.layout?.padding
          ? [`PADDING=${list.layout.padding.left},${list.layout.padding.top},${list.layout.padding.right},${list.layout.padding.bottom}`]
          : []),
        ...(list.layout?.offset ? [`POS=${list.layout.offset.x},${list.layout.offset.y}`] : []),
        ...genExtraOf("LIST"),
        "",
      ]
      : []),
    ...(rawBlocksOf("INPUT")
      ? rawBlocksOf("INPUT")!.flatMap((block) => ["[INPUT]", ...block, ""])
      : panels.input
        ? [
          "[INPUT]",
          ...(panels.input.style ? [`BACK_STYLE=${panels.input.style}`] : []),
          ...(panels.input.foreStyle ? [`FORE_STYLE=${panels.input.foreStyle}`] : []),
          ...(panels.input.height !== undefined ? [`HEIGHT=${panels.input.height}`] : []),
          ...genExtraOf("INPUT"),
          "",
        ]
        : []),
    // 图标偏移表：段号就是图标序号。只写原文件里真有的段；`OFFSET_NUM` 只是槽位声明，
    // 按它补空段会凭空造出原文件没有的段。
    ...[...(panels.offsets ?? [])]
      .sort(([left], [right]) => left - right)
      .flatMap(([index, offset]) => [
        `[OFFSET${index}]`,
        ...(offset.pos ? [`POS=${offset.pos.x},${offset.pos.y}`] : []),
        ...(offset.rPos ? [`R_POS=${offset.rPos.x},${offset.rPos.y}`] : []),
        ...genExtraOf(`OFFSET${index}`),
        "",
      ]),
    ...background,
  ]
  files.push({ path: paths.gen ?? `${directory}gen.ini`, data: text(panel.join("\n")) })
  return files
}
