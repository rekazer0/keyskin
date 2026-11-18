// BDS 面板组件：候选栏、气泡、列表、工具栏与面板背景。
//
// 这些面板的字段在 `gen.ini` 里声明，具体布局在独立的 `.cnd` / `.pop` 文件里。
// 读侧把它们整理成板的面板组件；写侧重新生成这几份文件。
import { IniDocument } from "@/ini.ts"
import type { SkinArchive } from "@/skin.ts"
import type { CandidateBar, HintBubble, InputBar, ListPanel, PanelBackdrop, SkinBoard, Toolbar, ToolbarItem } from "@/skin-model/board.ts"
import type { SkinAction } from "@/skin-model/types.ts"

export type BoardPanels = Pick<SkinBoard, "backdrop" | "candidate" | "hint" | "list" | "toolbar" | "input">

/** 面板文件的原路径；导出时沿用，避免重建把文件名换掉。 */
export type PanelPaths = { candidate?: string; hint?: string; more?: string }

export type ParsedPanels = { panels: BoardPanels; paths: PanelPaths }

type ActionReader = (value: string | undefined) => SkinAction | undefined
type ActionWriter = (action: SkinAction | undefined) => string | undefined

/** 面板文件与 `gen.ini` 在同一目录，用段里的 `LAYOUT_NAME` 找。 */
function panelPath(archive: SkinArchive, directory: string, name: string | undefined, extension: string): string | undefined {
  if (!name) return
  return archive.names().find((path) => path === `${directory}${name}${extension}`)
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
export function panelsOf(archive: SkinArchive, directory: string, gen: IniDocument, actionOf: ActionReader): ParsedPanels {
  const backdropStyle = gen.get("PANEL", "BACK_STYLE")?.trim()
  const noBlur = gen.get("PANEL", "NO_BLUR")?.trim() === "1"
  const backdrop: PanelBackdrop | undefined = backdropStyle || noBlur
    ? { ...(backdropStyle ? { style: backdropStyle } : {}), ...(noBlur ? { blur: false } : {}) }
    : undefined

  const candidateName = gen.get("CAND", "LAYOUT_NAME")?.trim()
  const candidatePath = panelPath(archive, directory, candidateName, ".cnd")
  const candidateDocument = candidatePath ? IniDocument.parse(archive.getText(candidatePath)) : undefined
  const candidateStyle = candidateDocument?.get("CAND", "BACK_STYLE")?.trim()
  const candidateCell = candidateDocument?.get("CAND", "CELL_STYLE")?.trim()
  const candidateSections = candidateDocument ? toolbarItems(candidateDocument, actionOf) : []
  const candidate: CandidateBar | undefined = candidateDocument
    ? {
      ...(candidateStyle ? { style: candidateStyle } : {}),
      ...(candidateCell ? { cellStyle: candidateCell } : {}),
      ...(candidateDocument.get("CAND", "FORE_STYLE")?.trim() ? { inputStyle: candidateDocument.get("CAND", "FORE_STYLE")!.trim() } : {}),
      ...(candidateSections.length ? { icons: candidateSections } : {}),
    }
    : undefined

  const hintName = gen.get("HINT", "LAYOUT_NAME")?.trim()
  const hintPath = panelPath(archive, directory, hintName, ".pop")
  const hintDocument = hintPath ? IniDocument.parse(archive.getText(hintPath)) : undefined
  const hintIcon = hintDocument?.get("HINT", "BACK_ICON")?.trim()
  // 气泡位置写在它引用的图标段里（`[ICON0] POS=x,y`），`[HINT]` 只有背景与角标。
  const hintIconSection = hintDocument?.sections().find((section) => /^ICON\d+$/i.test(section))
  const hintOffset = numbers(hintIconSection && hintDocument ? hintDocument.get(hintIconSection, "POS") : undefined)
  const hint: HintBubble | undefined = hintDocument
    ? {
      ...(hintIcon ? { style: hintIcon } : {}),
      ...(hintOffset.length === 2 ? { offset: { x: hintOffset[0], y: hintOffset[1] } } : {}),
      ...(hintDocument.get("HINT", "CORNER") ? { corner: Number(hintDocument.get("HINT", "CORNER")) } : {}),
    }
    : undefined

  const listStyle = gen.get("LIST", "BACK_STYLE")?.trim()
  const listCell = gen.get("LIST", "CELL_STYLE")?.trim()
  const cellSize = numbers(gen.get("LIST", "CELL_SIZE"))
  const listNames = gen.get("LIST", "NAMES")?.split(/\s+/).filter(Boolean)
  const list: ListPanel | undefined = listStyle || listCell || cellSize.length === 2
    ? {
      ...(listStyle ? { style: listStyle } : {}),
      ...(listCell ? { cellStyle: listCell } : {}),
      ...(cellSize.length === 2 ? { cellSize: { width: cellSize[0], height: cellSize[1] } } : {}),
      ...(listNames?.length ? { count: listNames.length } : {}),
    }
    : undefined

  const moreName = gen.get("MORE", "LAYOUT_NAME")?.trim()
  const morePath = panelPath(archive, directory, moreName, ".ini")
  const moreDocument = morePath ? IniDocument.parse(archive.getText(morePath)) : undefined
  const items: ToolbarItem[] = []
  if (gen.get("LOGO", "ICON")?.trim()) items.push({ id: "logo", icon: gen.get("LOGO", "ICON")!.trim() })
  if (gen.get("EMOJI", "ICON")?.trim()) items.push({ id: "emoji", icon: gen.get("EMOJI", "ICON")!.trim() })
  if (moreDocument) items.push(...toolbarItems(moreDocument, actionOf))
  const height = Number(gen.get("TOOLBAR", "HEIGHT"))
  const toolbar: Toolbar | undefined = items.length || Number.isFinite(height)
    ? { items, ...(Number.isFinite(height) && height > 0 ? { height } : {}) }
    : undefined

  const inputStyle = gen.get("INPUT", "BACK_STYLE")?.trim()
  const inputHeight = Number(gen.get("INPUT", "HEIGHT"))
  const input: InputBar | undefined = inputStyle || Number.isFinite(inputHeight)
    ? { ...(inputStyle ? { style: inputStyle } : {}), ...(Number.isFinite(inputHeight) && inputHeight > 0 ? { height: inputHeight } : {}) }
    : undefined

  return {
    panels: {
      ...(backdrop ? { backdrop } : {}),
      ...(candidate ? { candidate } : {}),
      ...(hint ? { hint } : {}),
      ...(list ? { list } : {}),
      ...(toolbar ? { toolbar } : {}),
      ...(input ? { input } : {}),
    },
    paths: {
      ...(candidatePath ? { candidate: candidatePath } : {}),
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
  if (board.candidate) {
    const lines = [
      "[CAND]",
      ...(board.candidate.style ? [`BACK_STYLE=${board.candidate.style}`] : []),
      ...(board.candidate.cellStyle ? [`CELL_STYLE=${board.candidate.cellStyle}`] : []),
      ...(board.candidate.inputStyle ? [`FORE_STYLE=${board.candidate.inputStyle}`] : []),
      `VIEW_RECT=0,0,${size.width},120`,
      "",
      ...iconSection(board.candidate.icons ?? [], actionValue),
    ]
    files.push({ path: paths.candidate ?? `${directory}cand.cnd`, data: text(lines.join("\n")) })
    background.push("[CAND]", `LAYOUT_NAME=${nameOf(paths.candidate, "cand.cnd")}`, "")
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
    background.push("[HINT]", `LAYOUT_NAME=${nameOf(paths.hint, "hint.pop")}`, "")
  }
  if (iconItems.length) {
    const lines = ["[PANEL]", `SIZE=${size.width},${size.height}`, "", ...iconSection(iconItems, actionValue)]
    files.push({ path: paths.more ?? `${directory}more.ini`, data: text(lines.join("\n")) })
    background.push("[MORE]", `LAYOUT_NAME=${nameOf(paths.more, "more.ini")}`, "")
  }

  const panel: string[] = [
    "[PANEL]",
    `SIZE=${size.width},${size.height}`,
    ...(board.backdrop?.style ? [`BACK_STYLE=${board.backdrop.style}`] : []),
    ...(board.backdrop?.blur === false ? ["NO_BLUR=1"] : []),
    "",
    ...(board.list
      ? [
        "[LIST]",
        ...(board.list.style ? [`BACK_STYLE=${board.list.style}`] : []),
        ...(board.list.cellStyle ? [`CELL_STYLE=${board.list.cellStyle}`] : []),
        ...(board.list.cellSize ? [`CELL_SIZE=${board.list.cellSize.width},${board.list.cellSize.height}`] : []),
        "",
      ]
      : []),
    ...(board.input
      ? [
        "[INPUT]",
        ...(board.input.style ? [`BACK_STYLE=${board.input.style}`] : []),
        ...(board.input.height !== undefined ? [`HEIGHT=${board.input.height}`] : []),
        "",
      ]
      : []),
    ...background,
  ]
  files.push({ path: `${directory}gen.ini`, data: text(panel.join("\n")) })
  return files
}
