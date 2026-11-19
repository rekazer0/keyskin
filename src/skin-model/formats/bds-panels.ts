// BDS 面板组件：候选栏、气泡、列表、工具栏与面板背景。
//
// 这些面板的字段在 `gen.ini` 里声明，具体布局在独立的 `.cnd` / `.pop` 文件里。
// 读侧把它们整理成板的面板组件；写侧重新生成这几份文件。
import { IniDocument, blocksOf, numbersOf } from "@/ini.ts"
import type { DocumentAccess } from "@/skin-model/formats/bds-access.ts"
import type { CandidateBar, HintBubble, InputBar, ListPanel, MoreMenu, PanelBackdrop, ScanPanel, SkinBoard, Toolbar, ToolbarItem } from "@/skin-model/board.ts"
import type { Offsets } from "@/skin-model/board.ts"
import type { SkinAction } from "@/skin-model/types.ts"

export type BoardPanels = Pick<SkinBoard, "backdrop" | "candidates" | "hint" | "list" | "toolbar" | "input" | "scan" | "more" | "offsets">

/** 面板文件的原路径；导出时沿用，避免重建把文件名换掉。 */
export type PanelPaths = { candidate?: string; hint?: string; more?: string }

export type ParsedPanels = { panels: BoardPanels; paths: PanelPaths }

type ActionReader = (value: string | undefined) => SkinAction | undefined
type ActionWriter = (action: SkinAction | undefined) => string | undefined

/** 面板文件与 `gen.ini` 在同一目录，用段里的 `LAYOUT_NAME` 找。 */
function panelPath(access: DocumentAccess, directory: string, name: string | undefined, extension: string): string | undefined {
  if (!name) return
  return access.paths().find((path) => path === `${directory}${name}${extension}`)
}

function numbers(value: string | undefined): number[] {
  return value?.split(",").map((part) => Number(part.trim())).filter(Number.isFinite) ?? []
}

/** `[ICON1] POS=0,0 SIZE=10,10 KEY=F31` 这类工具栏项。 */
function toolbarItems(document: IniDocument, actionOf: ActionReader): ToolbarItem[] {
  return document.sections().flatMap((section) => {
    const match = /^ICON(\d+)$/i.exec(section)
    if (!match) return []
    const position = numbers(document.get(section, "POS"))
    const size = numbers(document.get(section, "SIZE"))
    const action = actionOf(document.get(section, "KEY"))
    return [{
      id: `icon${match[1]}`,
      ...(document.get(section, "IMG") ? { icon: document.get(section, "IMG")!.trim() } : {}),
      ...(action ? { action } : {}),
      ...(document.get(section, "VISIBLE") === "0" ? { visible: false } : {}),
      ...(position.length === 2 && size.length === 2 ? { offset: { x: position[0], y: position[1] }, size: { width: size[0], height: size[1] } } : {}),
    }]
  })
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
  const offsets = new Map<number, Offsets>()
  for (const section of gen.sections()) {
    const match = /^OFFSET(\d+)$/i.exec(section)
    if (!match) continue
    const pos = numbersOf(gen.get(section, "POS"))
    const rPos = numbersOf(gen.get(section, "R_POS"))
    if (pos.length !== 2 && rPos.length !== 2) continue
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
  const list: ListPanel | undefined = listStyle || listFore || listCell || cellSize.length === 2 || listPadding.length === 4 || listPos.length === 2
    ? {
      ...(listStyle ? { style: listStyle } : {}),
      ...(listFore ? { foreStyle: listFore } : {}),
      ...(listCell ? { cellStyle: listCell } : {}),
      ...(cellSize.length === 2 ? { cellSize: { width: cellSize[0], height: cellSize[1] } } : {}),
      ...(listPadding.length === 4
        ? { padding: { left: listPadding[0], top: listPadding[1], right: listPadding[2], bottom: listPadding[3] } }
        : {}),
      ...(listPos.length === 2 ? { offset: { x: listPos[0], y: listPos[1] } } : {}),
      ...(listNames?.length ? { count: listNames.length } : {}),
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
    },
    paths: {
      ...(firstCandidatePath ? { candidate: firstCandidatePath } : {}),
      ...(hintPath ? { hint: hintPath } : {}),
      ...(morePath ? { more: morePath } : {}),
    },
  }
}

function iconSection(items: readonly ToolbarItem[], actionValue: ActionWriter): string[] {
  const lines: string[] = []
  items.forEach((item, index) => {
    const action = actionValue(item.action)
    lines.push(`[ICON${index + 1}]`)
    // 位置与尺寸来自面板定义；没有时退回原点，保持旧行为。
    lines.push(`POS=${item.offset ? `${item.offset.x},${item.offset.y}` : "0,0"}`)
    if (item.size) lines.push(`SIZE=${item.size.width},${item.size.height}`)
    if (item.icon) lines.push(`IMG=${item.icon}`)
    if (action) lines.push(`KEY=${action}`)
    if (item.visible === false) lines.push("VISIBLE=0")
    lines.push("")
  })
  return lines
}

/** 重新生成面板文件：`gen.ini`、候选栏 `.cnd`、气泡 `.pop`；`paths` 给了就沿用原文件名。 */
export function panelFiles(
  board: SkinBoard,
  directory: string,
  size: { width: number; height: number },
  actionValue: ActionWriter,
  paths: PanelPaths = {},
): Array<{ path: string; data: Uint8Array }> {
  const text = (value: string) => new TextEncoder().encode(value)
  const files: Array<{ path: string; data: Uint8Array }> = []
  const background: string[] = []
  const items = board.toolbar?.items ?? []
  const iconItems = items.filter((item) => item.icon)
  const nameOf = (path: string | undefined, fallback: string) => (path ?? `${directory}${fallback}`).split("/").pop()!.replace(/\.[^.]+$/, "")

  // 候选栏与气泡各自一个文件，`gen.ini` 用 LAYOUT_NAME 指向它们。
  // 原包已有 `.cnd` 时它由窗口原样写回，面板生成不覆盖它自己的 VIEW_RECT。
  for (const candidate of board.candidates ?? []) {
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
  for (const candidate of board.candidates ?? []) {
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
  if (board.hint) {
    const lines = [
      "[HINT]",
      ...(board.hint.style ? [`BACK_ICON=${board.hint.style}`] : []),
      ...(board.hint.offset ? [`OFFSET=${board.hint.offset.x},${board.hint.offset.y}`] : []),
      ...(board.hint.corner !== undefined ? [`CORNER=${board.hint.corner}`] : []),
      "",
    ]
    files.push({ path: paths.hint ?? `${directory}hint.pop`, data: text(lines.join("\n")) })
    background.push(
      "[HINT]",
      `LAYOUT_NAME=${board.hint.layoutName ?? nameOf(paths.hint, "hint.pop")}`,
      ...(board.hint.type !== undefined ? [`TYPE=${board.hint.type}`] : []),
      "",
    )
  }
  if (iconItems.length) {
    const lines = ["[PANEL]", `SIZE=${size.width},${size.height}`, "", ...iconSection(iconItems, actionValue)]
    files.push({ path: paths.more ?? `${directory}more.ini`, data: text(lines.join("\n")) })
    background.push("[MORE]", `LAYOUT_NAME=${board.more?.layoutName ?? nameOf(paths.more, "more.ini")}`, "")
  }
  // gen.ini 的 `[MORE]` 是符号键盘菜单，除了被引用的面板文件还有网格与各类别布局。
  if (board.more && (board.more.layouts.size || board.more.grid || board.more.cellStyle || board.more.foreStyle)) {
    const menu = board.more
    const section: string[] = ["[MORE]"]
    if (menu.grid) section.push(`GRID=${menu.grid.width},${menu.grid.height}`)
    if (menu.layoutName) section.push(`LAYOUT_NAME=${menu.layoutName}`)
    if (menu.cellStyle) section.push(`CELL_STYLE=${menu.cellStyle}`)
    if (menu.foreStyle) section.push(`FORE_STYLE=${menu.foreStyle}`)
    for (const [key, value] of [...menu.layouts].sort(([left], [right]) => left.localeCompare(right))) {
      section.push(`${key}=${value}`)
    }
    section.push("")
    background.push(...section)
  }

  const panel: string[] = [
    "[PANEL]",
    // 面板尺寸与键盘板尺寸是两个概念，带了面板尺寸就写它自己的。
    `SIZE=${board.backdrop?.size?.width ?? size.width},${board.backdrop?.size?.height ?? size.height}`,
    ...(board.backdrop?.style ? [`BACK_STYLE=${board.backdrop.style}`] : []),
    ...(board.backdrop?.foreStyle ? [`FORE_STYLE=${board.backdrop.foreStyle}`] : []),
    ...(board.backdrop?.offsetCount !== undefined ? [`OFFSET_NUM=${board.backdrop.offsetCount}`] : []),
    ...(board.backdrop?.hasPadIni ? ["HAS_PAD_INI=1"] : []),
    ...(board.backdrop?.blur === false ? ["NO_BLUR=1"] : []),
    "",
    ...(board.scan
      ? [
        "[SCAND]",
        ...(board.scan.style ? [`BACK_STYLE=${board.scan.style}`] : []),
        ...(board.scan.foreStyle ? [`FORE_STYLE=${board.scan.foreStyle}`] : []),
        ...(board.scan.inputStyle ? [`INPUT_STYLE=${board.scan.inputStyle}`] : []),
        ...(board.scan.scanStyle ? [`SCAND_STYLE=${board.scan.scanStyle}`] : []),
        ...(board.scan.padding
          ? [`PADDING=${board.scan.padding.left},${board.scan.padding.top},${board.scan.padding.right},${board.scan.padding.bottom}`]
          : []),
        "",
      ]
      : []),
    ...(board.list
      ? [
        "[LIST]",
        ...(board.list.style ? [`BACK_STYLE=${board.list.style}`] : []),
        ...(board.list.foreStyle ? [`FORE_STYLE=${board.list.foreStyle}`] : []),
        ...(board.list.cellStyle ? [`CELL_STYLE=${board.list.cellStyle}`] : []),
        ...(board.list.cellSize ? [`CELL_SIZE=${board.list.cellSize.width},${board.list.cellSize.height}`] : []),
        ...(board.list.padding
          ? [`PADDING=${board.list.padding.left},${board.list.padding.top},${board.list.padding.right},${board.list.padding.bottom}`]
          : []),
        ...(board.list.offset ? [`POS=${board.list.offset.x},${board.list.offset.y}`] : []),
        "",
      ]
      : []),
    ...(board.input
      ? [
        "[INPUT]",
        ...(board.input.style ? [`BACK_STYLE=${board.input.style}`] : []),
        ...(board.input.foreStyle ? [`FORE_STYLE=${board.input.foreStyle}`] : []),
        ...(board.input.height !== undefined ? [`HEIGHT=${board.input.height}`] : []),
        "",
      ]
      : []),
    // 图标偏移表：段号就是图标序号；声明了总数就逐个写，没有偏移的写成空段。
    ...Array.from({ length: board.backdrop?.offsetCount ?? 0 }, (_, index) => index + 1)
      .flatMap((each) => {
        const offset = board.offsets?.get(each)
        return [
          `[OFFSET${each}]`,
          ...(offset?.pos ? [`POS=${offset.pos.x},${offset.pos.y}`] : []),
          ...(offset?.rPos ? [`R_POS=${offset.rPos.x},${offset.rPos.y}`] : []),
          "",
        ]
      }),
    ...(board.backdrop?.offsetCount ? [] : [...(board.offsets ?? [])]
      .sort(([left], [right]) => left - right)
      .flatMap(([index, offset]) => [
        `[OFFSET${index}]`,
        ...(offset.pos ? [`POS=${offset.pos.x},${offset.pos.y}`] : []),
        ...(offset.rPos ? [`R_POS=${offset.rPos.x},${offset.rPos.y}`] : []),
        "",
      ])),
    ...background,
  ]
  files.push({ path: `${directory}gen.ini`, data: text(panel.join("\n")) })
  return files
}
