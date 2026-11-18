// 手心输入法皮肤（SXI）转换器。
//
// 手心皮肤是一包文件：`skin.json` 描述键盘与面板，`info.json` 描述元信息，图片散在图集目录里。
// 键盘几何是文档自带的，所以不需要外部骨架；样式用数字索引引用原生样式表。
import type { CandidateBar, HintBubble, ListPanel, PanelBackdrop, SkinBoard, ToolbarItem } from "@/skin-model/board.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import { deriveBoard } from "@/skin-model/derive/layout.ts"
import type { SkinKey } from "@/skin-model/key.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import { emptyModel } from "@/skin-model/model.ts"
import type { SkinAction, KeyEvent } from "@/skin-model/types.ts"
import { asObject, rectParts, type Json, type JsonObject } from "@/palm/sxi-ini.ts"
import { parseSkinJson, SXI_INFO_PATH, SXI_SKIN_PATH } from "@/palm/sxi-json.ts"
import { motionsOfSkin, skinAnimationsOf } from "@/skin-model/formats/sxi-motion.ts"

export type SxiSource = {
  /** 皮肤包内的全部文件。 */
  files: Map<string, Uint8Array>
  /** 主键盘板的类型名，决定布局文件与板种类。 */
  boardType: string
}

/** 手心 `values` 列表里的按钮序号；偶数位是按钮，奇数位是动作。 */
const BUTTONS: ReadonlyArray<{ event: KeyEvent } | undefined> = [
  { event: "swipe-up" },
  { event: "swipe-down" },
  { event: "swipe-left" },
  { event: "swipe-right" },
  { event: "press" },
  { event: "press" },
  { event: "long-press" },
  { event: "long-press" },
]

function textOf(files: Map<string, Uint8Array>, path: string): string | undefined {
  const bytes = files.get(path)
  return bytes ? new TextDecoder().decode(bytes) : undefined
}

/** 手心动作是字符串：`F31` 这类型码当系统动作，其余当直出文本。原样保留，写回时不必反查。 */
function actionOf(value: Json | undefined): SkinAction | undefined {
  if (typeof value !== "string") return
  const text = value.trim()
  if (!text) return
  if (/^F\d+$/i.test(text)) return { kind: "system", code: text.toUpperCase() }
  return { kind: "text", value: text }
}

/** `values` 是 `[按钮, 动作, 按钮, 动作, …]` 的扁平表。 */
function actionsOf(record: JsonObject): SkinKey["actions"] {
  const values = Array.isArray(record.values) ? record.values : []
  const actions: SkinKey["actions"] = {}
  for (let index = 0; index + 1 < values.length; index += 2) {
    const button = typeof values[index] === "number" ? BUTTONS[values[index] as number] : undefined
    const action = actionOf(values[index + 1])
    if (button && action && !actions[button.event]) actions[button.event] = action
  }
  return actions
}

function boxOf(value: Json): SkinKey["rect"] | undefined {
  const parts = rectParts(value)
  if (!parts) return
  return { position: { x: parts[0], y: parts[1] }, size: { width: parts[2], height: parts[3] } }
}

function numberField(record: JsonObject, field: string): string | undefined {
  const value = record[field]
  return typeof value === "number" ? String(value) : undefined
}

/** 手心按键的样式是数字索引，IR 里直接用索引的字符串形式引用。 */
function keyStyle(record: JsonObject): SkinKey["style"] {
  return {
    ...(numberField(record, "i_b") ? { back: numberField(record, "i_b") } : {}),
    ...(numberField(record, "i_hb") ? { pressedBack: numberField(record, "i_hb") } : {}),
    fore: [numberField(record, "i_f")].filter((value): value is string => Boolean(value)),
  }
}

function keysOf(keyboard: JsonObject): SkinKey[] {
  return (Array.isArray(keyboard.keys) ? keyboard.keys : []).flatMap((entry) => {
    const record = asObject(entry)
    if (!record) return []
    const rect = boxOf(record.rect)
    if (!rect) return []
    const id = `KEY${record.id ?? ""}`
    const hit = boxOf(record.hit_rect)
    return [{
      id,
      rect,
      ...(hit ? { touchRect: hit } : {}),
      actions: actionsOf(record),
      style: keyStyle(record),
      ...(typeof record.fix_a === "string" ? { label: record.fix_a } : {}),
    }]
  })
}

function panelsOf(keyboard: JsonObject): Pick<SkinBoard, "backdrop" | "candidate" | "hint" | "list" | "toolbar"> {
  const boardPart = asObject(keyboard.board)
  const backdrop: PanelBackdrop | undefined = boardPart
    ? {
      ...(numberField(boardPart, "i_b") ? { style: numberField(boardPart, "i_b") } : {}),
      ...(boardPart.exact === true ? { blur: false } : {}),
    }
    : undefined

  const candPart = asObject(keyboard.cand)
  const candidate: CandidateBar | undefined = candPart
    ? {
      ...(numberField(candPart, "i_cand") ? { style: numberField(candPart, "i_cand") } : {}),
      ...(numberField(candPart, "i_cell") ? { cellStyle: numberField(candPart, "i_cell") } : {}),
    }
    : undefined

  const hintPart = asObject(keyboard.hint)
  const hintRect = hintPart ? boxOf(hintPart.rect) : undefined
  const hint: HintBubble | undefined = hintPart
    ? {
      ...(numberField(hintPart, "i_b") ? { style: numberField(hintPart, "i_b") } : {}),
      ...(hintRect ? { offset: { x: hintRect.position.x, y: hintRect.position.y } } : {}),
    }
    : undefined

  const listPart = asObject(keyboard.list)
  const listSize = listPart ? boxOf(listPart.size) : undefined
  const list: ListPanel | undefined = listPart
    ? {
      ...(numberField(listPart, "i_cell") ? { cellStyle: numberField(listPart, "i_cell") } : {}),
      ...(listSize ? { cellSize: listSize.size } : {}),
      ...(typeof listPart.count === "number" ? { count: listPart.count } : {}),
    }
    : undefined

  const logo = asObject(keyboard.logo)
  const emoji = asObject(keyboard.emoji)
  const items: ToolbarItem[] = [
    ...(logo ? [{ id: "logo", ...(typeof logo.file === "string" ? { icon: logo.file } : {}) }] : []),
    ...(emoji ? [{ id: "emoji", ...(typeof emoji.file === "string" ? { icon: emoji.file } : {}) }] : []),
  ]
  const toolbar = items.length ? { items } : undefined

  return {
    ...(backdrop ? { backdrop } : {}),
    ...(candidate ? { candidate } : {}),
    ...(hint ? { hint } : {}),
    ...(list ? { list } : {}),
    ...(toolbar ? { toolbar } : {}),
  }
}

function capabilities(): ReadonlyMap<Capability, CapabilityLevel> {
  return new Map<Capability, CapabilityLevel>([
    ["board.geometry", "full"],
    ["board.keys", "full"],
    ["board.add-remove", "full"],
    ["key.actions", "full"],
    ["key.states", "partial"],
    ["key.touch", "full"],
    ["style.image", "partial"],
    ["style.color", "partial"],
    ["style.nine-slice", "partial"],
    ["panel.backdrop", "partial"],
    ["panel.candidate", "partial"],
    ["panel.hint", "partial"],
    ["panel.list", "partial"],
    ["panel.toolbar", "partial"],
    ["motion.track", "none"],
    ["motion.binding", "none"],
    ["sound", "partial"],
  ])
}

/** 手心把键盘板放在顶层 `default.keyboard` 下；没有这个字段就不是手心皮肤。 */
function keyboardOf(skin: JsonObject): JsonObject | undefined {
  return asObject(asObject(skin.default)?.keyboard)
}

export function sxiSource(files: Map<string, Uint8Array>, boardType = "py_26"): SxiSource | undefined {
  const text = textOf(files, SXI_SKIN_PATH)
  if (!text) return
  try {
    if (!keyboardOf(parseSkinJson(text))) return
  } catch {
    return
  }
  return { files, boardType }
}

/** 手心板种类由类型名推断，与 BDS 的命名习惯一致。 */
function boardKindOfType(type: string): SkinBoard["kind"] {
  const name = type.toLowerCase()
  if (/symbol|^zy|^bq|emoji/.test(name)) return "symbol"
  if (/^cand/.test(name)) return "candidate"
  if (/(?:^|_)(?:9|num|bh)/.test(name)) return "number"
  if (/^(?:py|en|def|hw|big)/.test(name)) return "main"
  return "other"
}

export const sxiFormat = {
  name: "sxi",
  capabilities: capabilities(),
  derive: { tolerance: 1 },
  async read(source: SxiSource): Promise<SkinModel> {
    const skin = parseSkinJson(textOf(source.files, SXI_SKIN_PATH) ?? "")
    const keyboard = keyboardOf(skin)
    if (!keyboard) throw new Error("手心皮肤缺少 keyboard 段")
    const info = asObject(parseSkinJson(textOf(source.files, SXI_INFO_PATH) ?? "{}"))
    const model = emptyModel({
      ...(typeof info?.name === "string" ? { name: info.name } : {}),
      ...(typeof info?.author === "string" ? { author: info.author } : {}),
      ...(typeof info?.version === "string" ? { version: info.version } : {}),
      appearance: "light",
      orientation: "port",
    }, "sxi")
    const boardPart = asObject(keyboard.board)
    const sizeBox = boardPart ? boxOf(boardPart.size) : undefined
    const size = sizeBox?.size ?? { width: 1080, height: 600 }
    model.meta.resolution = size
    const keys = keysOf(keyboard)
    const derived = await deriveBoard("board", keys.map((key) => ({ id: key.id, ...key.rect })), size)
    model.boards.push({
      ...panelsOf(keyboard),
      id: `${source.boardType}.ini`,
      kind: boardKindOfType(source.boardType),
      geometry: "document",
      orientation: "port",
      size,
      layout: derived.layout,
      keys,
    })
    // 动画在 `ss_2`，样式绑定在 `ss_1` 的 `s_5`；没有动画配置时留空。
    model.motions = motionsOfSkin(skin, "light", "port")
    model.provenance = { format: "sxi", nodes: new Map(keys.map((key) => [key.id, { path: SXI_SKIN_PATH }])) }
    return model
  },
  write(model: SkinModel, source?: SxiSource): SxiSource {
    const board = model.boards.find((each) => each.kind === "main") ?? model.boards[0]
    if (!board) throw new Error("模型里没有板")
    const files = new Map(source?.files ?? [])
    const skin = parseSkinJson(textOf(files, SXI_SKIN_PATH) ?? "{}")
    const root = asObject(skin.default) ?? {}
    const keyboard = keyboardOf(skin) ?? {}
    keyboard.board = { ...(asObject(keyboard.board) ?? {}), size: [0, 0, board.size.width, board.size.height] }
    keyboard.keys = board.keys.map((key) => ({
      id: Number(key.id.replace(/^KEY/i, "")) || 0,
      // 手心的矩形是「原点对 + 尺寸对」，不是扁平四元组。
      rect: [[key.rect.position.x, key.rect.position.y], [key.rect.size.width, key.rect.size.height]],
      ...(key.touchRect ? { hit_rect: [[key.touchRect.position.x, key.touchRect.position.y], [key.touchRect.size.width, key.touchRect.size.height]] } : {}),
      ...(valuesOf(key).length ? { values: valuesOf(key) } : {}),
    }))
    root.keyboard = keyboard
    // 动效写回 `ss_2`，样式绑定写回 `ss_1` 的 `s_5`。
    if (model.motions.size) {
      const struct = asObject(root.light) ?? {}
      const port = asObject(struct.s_port) ?? {}
      const built = skinAnimationsOf(model.motions)
      port.ss_2 = { ...asObject(port.ss_2), ...built.animations }
      const styles = asObject(port.ss_1) ?? {}
      for (const [styleId, events] of built.bindings) {
        styles[styleId] = { ...asObject(styles[styleId]), s_5: { ...asObject(asObject(styles[styleId])?.s_5), ...events } }
      }
      port.ss_1 = styles
      root.light = { ...struct, s_port: port }
    }
    skin.default = root
    files.set(SXI_SKIN_PATH, new TextEncoder().encode(JSON.stringify(skin)))
    files.set(SXI_INFO_PATH, new TextEncoder().encode(JSON.stringify({
      name: model.meta.name ?? "",
      author: model.meta.author ?? "",
      version: model.meta.version ?? "",
    })))
    return { files, boardType: source?.boardType ?? board.id.replace(/\.ini$/i, "") }
  },
}

/** 按键动作写回成 `values` 扁平表；顺序与 `BUTTONS` 一致（按钮序号与动作交替）。 */
function valuesOf(key: SkinKey): Array<number | string> {
  const order: KeyEvent[] = ["swipe-up", "swipe-down", "swipe-left", "swipe-right", "press", "long-press"]
  const values: Array<number | string> = []
  for (const event of order) {
    const action = key.actions[event]
    if (!action) continue
    const button = BUTTONS.findIndex((entry) => entry?.event === event)
    if (button < 0) continue
    const text = action.kind === "text" ? action.value : action.kind === "system" ? action.code : undefined
    if (text) values.push(button, text)
  }
  return values
}
