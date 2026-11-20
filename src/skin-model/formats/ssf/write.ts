// IR → 搜狗皮肤。
//
// 写回只拿模型，不回源包：段、键、时段、音效、图片都从模型重建。
// 每个时段一套 `phoneSkin.ini`/`keys.ini`/`anim.ini`，目录名用外观标识（`status1`…），
// 没有时段的皮肤用分辨率目录直放（`1080/`）。
import type { IniDocument } from "@/ini.ts"
import { IniDocument as Ini } from "@/ini.ts"
import { encodePng } from "@/raster.ts"
import type { Board } from "@/skin-model/board.ts"
import type { Key } from "@/skin-model/key.ts"
import type { MotionNode } from "@/skin-model/motion.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import type { FileRole, SkinDocuments, SkinStructure } from "@/skin-model/pipeline.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import type { SkinLayer, Stretch } from "@/skin-model/style.ts"
import type { Orientation, Theme } from "@/skin-model/types.ts"
import type { SsfSource } from "@/skin-model/formats/ssf/index.ts"
import { ssfKeyBinding } from "@/ssf/ssf-keymap.ts"
import { actionValue } from "@/skin-model/formats/bds/index.ts"
import { parseSsfMotionId, ssfMotionText } from "@/skin-model/formats/ssf/motion.ts"
import { ssfBaiduAnimationOf } from "@/skin-model/formats/ssf/baidu-motion.ts"
import { parseStyleName, type SsfState } from "@/skin-model/formats/ssf/style.ts"

/** 一个外观要写的目录与板。 */
export type SsfPlan = {
  /** 样式名里的外观标识（`status1`、`day`）。 */
  name: string
  /** 目录名；`day` 表示没有时段层。 */
  folder: string
  theme: Theme
  boards: Board[]
}

/**
 * 写哪些外观。
 *
 * 目录名来自 `AppearanceSet.name`（源格式的 `status1`/`status2`）。模型没有这个名字、
 * 又带时段条件时，按外观顺序生成 `status<n>`——这是搜狗目录的命名规则，不是从内容猜出来的身份。
 * 没有时段的皮肤直放在分辨率目录下。
 */
export function plansOf(model: SkinModel): SsfPlan[] {
  if (!model.boards.length) throw new Error("模型里没有板，写不出搜狗键盘")
  const byId = new Map(model.boards.map((board) => [board.id, board]))
  const plans: SsfPlan[] = []
  let index = 0
  for (const appearance of model.appearances) {
    const boards = appearance.boards.flatMap((id) => {
      const board = byId.get(id)
      return board ? [board] : []
    })
    if (!boards.length) continue
    index += 1
    const name = appearance.name ?? (appearance.activation.kind === "time" ? `status${index}` : "day")
    plans.push({ name, folder: name === "day" ? "" : name, theme: appearance.theme, boards })
  }
  if (!plans.length) plans.push({ name: "day", folder: "", theme: model.meta.theme, boards: model.boards })
  return plans
}

/** 目录名就是屏幕宽度；模型没给分辨率时无法落目录，明确失败而不是猜一个宽度。 */
function resolutionOf(model: SkinModel): number {
  const width = model.meta.resolution?.width ?? model.meta.designWidth
  if (!width) throw new Error("模型没有分辨率，搜狗皮肤按分辨率分目录，无法确定目录名")
  return Math.round(width)
}

/** 一个外观在两个文件里的段字段；最后按字段归属拆成两份 INI。 */
type LookFields = { skin: Map<string, Map<string, string>>; keys: Map<string, Map<string, string>> }

/** 写一个段字段。`file` 缺省时按字段与段名推断文件；已知来源时由调用方指定。 */
function put(fields: LookFields, section: string, field: string, value: string, file?: "skin" | "keys"): void {
  const target = (file ?? (KEYS_FIELDS.has(field) || KEYS_SECTION.test(section) ? "keys" : "skin")) === "keys" ? fields.keys : fields.skin
  const entries = target.get(section) ?? new Map<string, string>()
  entries.set(field, value)
  target.set(section, entries)
}

function fileOfSection(sectionFiles: ReadonlyMap<string, string>, look: string, section: string): "skin" | "keys" {
  return sectionFiles.get(`${look}|${section}`) === "keys" ? "keys" : "skin"
}

/** 写在 `keys.ini` 里的字段；其余字段属于 `phoneSkin.ini`。 */
const KEYS_FIELDS = new Set(["FG_IMAGES", "FG_RECT", "ANIM_STYLE"])
const KEYS_SECTION = /^(foground|foreground)/i

/** 模型里的图片路径 → 段里写的文件名；每个副本用自己的文件，写文件名。 */
function imageName(image: string): string {
  return image.split("/").pop() ?? image
}

/**
 * 图片图层 → `NORMAL=file,1,97,1,141` 的写法。
 * 九宫格是四条固定边宽，写成左右、上下两对像素边界；图片尺寸不知道时只写文件名。
 */
function imageValue(layer: Extract<SkinLayer, { kind: "image" }>, images: ReadonlyMap<string, SkinImage>): string {
  const file = imageName(layer.image)
  const numbers = numbersOf(layer.stretch, images.get(layer.image))
  return numbers ? [file, ...numbers].join(",") : file
}

function numbersOf(stretch: Stretch | undefined, image: SkinImage | undefined): number[] | undefined {
  if (!stretch || stretch.kind === "none") return undefined
  if (stretch.kind === "unknown-six") return [...stretch.values]
  if (stretch.kind !== "nine-slice") return undefined
  if (!image) return undefined
  const { left, top, right, bottom } = stretch.edges
  const numbers = [left, image.width - right, top, image.height - bottom]
  if (!(numbers[0] < numbers[1] && numbers[2] < numbers[3])) return undefined
  return numbers.map((value) => Math.round(value))
}

/** 一个样式的一组图层 → 段字段；状态决定写哪个图片字段。 */
function writeLayers(
  fields: LookFields,
  section: string,
  layers: readonly SkinLayer[],
  state: SsfState,
  images: ReadonlyMap<string, SkinImage>,
  file: "skin" | "keys",
): void {
  for (const layer of layers) {
    if (layer.kind === "image") {
      put(fields, section, state, imageValue(layer, images), file)
      continue
    }
    if (layer.kind === "color" && state === "NORMAL") {
      put(fields, section, "BG_STYLE", "2", file)
      put(fields, section, "BG_COLOR", layer.value, file)
      continue
    }
    if (layer.kind === "text") {
      if (state === "NORMAL") {
        if (layer.style.color) put(fields, section, "TEXT_COLOR", layer.style.color, file)
        if (layer.style.fontSize !== undefined) put(fields, section, "TEXT_SIZE", String(layer.style.fontSize), file)
        if (layer.style.font) put(fields, section, "TYPEFACE", layer.style.font, file)
      } else if (state === "PRESSED" && layer.style.color) {
        // 按下态只有颜色有独立字段；字号与字体沿用常态。
        put(fields, section, "TEXT_COLOR_PRESSED", layer.style.color, file)
      }
    }
    if (layer.kind === "icon" && state === "NORMAL") put(fields, section, "ICON", imageName(layer.image), file)
  }
}

type BackgroundRef = { field: string; value: string }
type BackgroundRefs = ReadonlyMap<string, readonly BackgroundRef[]>

/** 模型里的段样式 → 段字段。 */
function writeStyles(
  model: SkinModel,
  plan: SsfPlan,
  fields: LookFields,
  refs: BackgroundRefs,
  sectionFiles: ReadonlyMap<string, string>,
  backgroundStyles: ReadonlyMap<string, string>,
): void {
  for (const [name, style] of model.styles) {
    const parsed = parseStyleName(name)
    if (!parsed || parsed.status !== plan.name) continue
    const file = fileOfSection(sectionFiles, plan.name, parsed.section)
    if (parsed.field) {
      // 字段样式只承载一个字段；字段名原样写回，不从图层种类反推。
      const layer = style.normal.find((each) => each.kind === "image" || each.kind === "icon")
      if (!layer || (layer.kind !== "image" && layer.kind !== "icon")) continue
      const field = parsed.field === "BG_FILE" ? refs.get(`${plan.name}|${parsed.section}`)?.[0]?.field ?? "BG_IMAGE" : parsed.field
      put(fields, parsed.section, field, imageName(layer.image), file)
      continue
    }
    if (parsed.foreground !== undefined) {
      // 合成样式：第一层是背景段，第二层是前景段，各自写自己的状态字段。
      const [back, fore] = style.normal
      if (back) writeLayers(fields, parsed.section, [back], parsed.state ?? "NORMAL", model.images, file)
      if (fore && parsed.foreground) {
        const foreFile = fileOfSection(sectionFiles, plan.name, parsed.foreground)
        writeLayers(fields, parsed.foreground, [fore], parsed.state ?? "NORMAL", model.images, foreFile)
      }
      continue
    }
    const state = parsed.state ?? "NORMAL"
    const refsHere = state === "NORMAL" ? refs.get(`${plan.name}|${parsed.section}`) ?? [] : []
    const ref = refsHere[0]
    if (ref) {
      for (const each of refsHere) put(fields, parsed.section, each.field, each.value, file)
      // 自引用（`BG_IMAGES=同上段名`）不改变图片来源，段自己的图片字段照写；
      // 指向别的段时只写引用，图由被引用的段提供。
      const selfReference = refsHere.some((each) => each.value === parsed.section)
      const layers = selfReference ? style.normal : style.normal.filter((layer) => layer.kind !== "image")
      writeLayers(fields, parsed.section, layers, state, model.images, file)
    } else {
      writeLayers(fields, parsed.section, style.normal, state, model.images, file)
    }
    // `BG_STYLE` 是原段自己的开关：有颜色时由图层写成 2，否则沿用原值。
    const styleValue = state === "NORMAL" ? backgroundStyles.get(`${plan.name}|${parsed.section}`) : undefined
    if (styleValue && !style.normal.some((layer) => layer.kind === "color")) put(fields, parsed.section, "BG_STYLE", styleValue, file)
  }
}

/** 键 → 按键段（背景引用、前景引用、前景区域、动画、长按）。 */
function writeKeys(plan: SsfPlan, fields: LookFields, refs: BackgroundRefs, bindings: ReadonlyMap<string, string>): void {
  const layout = plan.boards[0]?.id.split("@")[0] ?? ""
  for (const board of plan.boards) {
    const skeletonBackgrounds = board.extra?.get("skeletonBackgrounds") as ReadonlyMap<string, string> | undefined
    for (const key of board.keys) writeKey(plan, layout, key, fields, refs, skeletonBackgrounds ?? new Map(), bindings)
  }
}

function writeKey(
  plan: SsfPlan,
  layout: string,
  key: Key,
  fields: LookFields,
  refs: BackgroundRefs,
  skeletonBackgrounds: ReadonlyMap<string, string>,
  bindings: ReadonlyMap<string, string>,
): void {
  // 按键段在 `phoneSkin.ini` 写背景、在 `keys.ini` 写前景；两个文件里的段名可以不同
  // （`Key_G` 与 `Key_G_L`），读时都记进了 `sections`。没有皮肤段的键不写字段。
  const skinSection = key.sections?.[0]
  const keysSection = key.sections?.[1] ?? skinSection
  if (!skinSection && !keysSection) return
  const background = key.container.back?.style ? parseStyleName(key.container.back.style) : undefined
  if (background && skinSection && background.section !== skinSection) {
    // 皮肤没给这个键写背景时，客户端用默认背景类；那不是这个键的段字段，写回不能凭空造一条。
    const binding = ssfKeyBinding(layout, actionValue(key.actions?.press) ?? "", false)
    const defaults = [...binding.defaults, ...(skeletonBackgrounds.has(key.id) ? [skeletonBackgrounds.get(key.id)!] : [])]
    if (!defaults.includes(background.section)) {
      const field = refs.get(`${plan.name}|${skinSection}`)?.[0]?.field ?? "BG_IMAGES"
      put(fields, skinSection, field, background.section, "skin")
    }
  }
  if (keysSection) {
    for (const layer of key.container.fore) {
      const parsed = layer.style ? parseStyleName(layer.style) : undefined
      if (parsed) put(fields, keysSection, "FG_IMAGES", parsed.section, "keys")
    }
    if (key.foreground) {
      const { left, top, right, bottom } = key.foreground
      put(fields, keysSection, "FG_RECT", [left, top, right, bottom].join(","), "keys")
    }
    // 本格式的动效按段名写回；其它格式的动效由转换器生成 `Anim_Style_*`，绑定在转换结果里。
    const bound = bindings.get(key.id)
    const motion = key.motions?.press ? parseSsfMotionId(key.motions.press) : undefined
    if (bound) put(fields, keysSection, "ANIM_STYLE", bound, "keys")
    else if (motion) put(fields, keysSection, "ANIM_STYLE", motion.section, "keys")
  }
  if (skinSection) {
    if (key.labelPosition?.length) put(fields, skinSection, "LABEL_POSITION", key.labelPosition.join(","), "skin")
    if (key.container.text?.content) put(fields, skinSection, "LABEL", key.container.text.content, "skin")
    if (key.holdSymbol) put(fields, skinSection, "L_KEY", key.holdSymbol, "skin")
  }
}

function writeMissingRefs(
  plan: SsfPlan,
  fields: LookFields,
  refs: BackgroundRefs,
  sectionFiles: ReadonlyMap<string, string>,
): void {
  for (const [id, entries] of refs) {
    const separator = id.indexOf("|")
    const look = id.slice(0, separator)
    const section = id.slice(separator + 1)
    if (look !== plan.name || !section) continue
    const file = fileOfSection(sectionFiles, plan.name, section)
    for (const each of entries) {
      const written = fields.skin.get(section)?.get(each.field) ?? fields.keys.get(section)?.get(each.field)
      if (written === undefined) put(fields, section, each.field, each.value, file)
    }
  }
}

/** 主键盘之外的按键段：模型没有它们的按键，整段原样写回。 */
function writeOtherKeySections(
  fields: LookFields,
  others: ReadonlyMap<string, Map<string, string>>,
  plan: SsfPlan,
): void {
  for (const [id, entries] of others) {
    const [look, section, file] = id.split("|")
    if (look !== plan.name || !section || (file !== "skin" && file !== "keys")) continue
    for (const [field, value] of entries) put(fields, section, field, value, file)
  }
}

/** 未建模的段字段：字面回填，已建模字段以模型为准。 */
function mergeLooseFields(
  fields: LookFields,
  loose: ReadonlyMap<string, Map<string, string>>,
  plan: SsfPlan,
  sectionFiles: ReadonlyMap<string, string>,
): void {
  for (const [id, entries] of loose) {
    const separator = id.indexOf("|")
    const look = id.slice(0, separator)
    const section = id.slice(separator + 1)
    if (look !== plan.name || !section) continue
    const file = fileOfSection(sectionFiles, plan.name, section)
    for (const [field, value] of entries) put(fields, section, field, value, file)
  }
}

function documentOfFields(fields: ReadonlyMap<string, Map<string, string>>): IniDocument {
  const lines: string[] = []
  for (const [section, entries] of fields) {
    lines.push(`[${section}]`)
    for (const [field, value] of entries) lines.push(`${field}=${value}`)
    lines.push("")
  }
  return Ini.parse(lines.join("\n"))
}

/** `phoneTheme.ini`：已建模字段以 `meta` 为准，其余字段原样。 */
function phoneThemeText(model: SkinModel): string {
  const loose = model.opaque.get("ssf:phoneTheme") as ReadonlyMap<string, string> | undefined
  const entries = new Map<string, string>(loose ? [...loose] : [])
  if (model.meta.name !== undefined) entries.set("skin_name", model.meta.name)
  if (model.meta.author !== undefined) entries.set("skin_author", model.meta.author)
  if (model.meta.version !== undefined) entries.set("skin_version", model.meta.version)
  const lines = ["[General]"]
  for (const [field, value] of entries) lines.push(`${field}=${value}`)
  return `${lines.join("\n")}\n`
}

/**
 * `time.ini`：时段从 `appearances[].activation` 重建；`START`/`END` 用逗号分段。
 * `[General]` 与各分辨率段的其它字段来自读取时的快照。
 */
function timeText(model: SkinModel, plans: readonly SsfPlan[], resolution: number): string {
  const snapshot = model.opaque.get("ssf:time") as { general: Map<string, string>; screens: Map<string, Map<string, string>> } | undefined
  const general = new Map<string, string>(snapshot ? snapshot.general : [])
  general.set("SUPPORT_SCREEN", general.get("SUPPORT_SCREEN") ?? String(resolution))
  const lines = ["[General]"]
  for (const [field, value] of general) lines.push(`${field}=${value}`)
  const screens = new Map(snapshot ? snapshot.screens : [])
  // 其它分辨率段也是 time.ini 的真实内容（多分辨率副本的声明），原样保留。
  for (const [width, entries] of screens) {
    if (width === String(resolution)) continue
    lines.push(`[${width}]`)
    for (const [field, value] of entries) lines.push(`${field}=${value}`)
  }
  const known = screens.get(String(resolution)) ?? new Map<string, string>()
  lines.push(`[${resolution}]`)
  for (const [field, value] of known) if (field !== "STATUS_LIST") lines.push(`${field}=${value}`)
  const timed = plans.filter((plan) => plan.folder)
  if (timed.length) lines.push(`STATUS_LIST=${timed.map((plan) => plan.folder).join(",")}`)
  for (const plan of timed) {
    const appearance = model.appearances.find((each) => each.boards.some((id) => plan.boards.some((board) => board.id === id)))
    const ranges = appearance?.activation.kind === "time" ? appearance.activation.ranges : []
    if (!ranges.length) continue
    lines.push(`[${plan.folder}]`)
    lines.push(`START=${ranges.map((range) => range.startHour).join(",")}`)
    lines.push(`END=${ranges.map((range) => range.endHour).join(",")}`)
  }
  return `${lines.join("\n")}\n`
}

/** `sound_android.ini`：触发主体 → 音效名。同名主体只写一条。 */
function soundText(model: SkinModel): string | undefined {
  const snapshot = model.opaque.get("ssf:soundSections") as ReadonlyMap<string, Map<string, string>> | undefined
  const sections = new Map<string, Map<string, string>>(
    snapshot ? [...snapshot].map(([section, entries]) => [section, new Map(entries)]) : [],
  )
  for (const binding of model.sounds) {
    const entries = sections.get(binding.subject) ?? new Map<string, string>()
    entries.set("sound", binding.sound)
    sections.set(binding.subject, entries)
  }
  if (!sections.size) return
  const lines: string[] = []
  for (const [section, entries] of sections) {
    lines.push(`[${section}]`)
    for (const [field, value] of entries) lines.push(`${field}=${value}`)
    lines.push("")
  }
  return lines.join("\n")
}

function opText(model: SkinModel): string | undefined {
  const snapshot = model.opaque.get("ssf:op") as ReadonlyMap<string, Map<string, string>> | undefined
  if (!snapshot?.size) return
  const lines: string[] = []
  for (const [section, entries] of snapshot) {
    lines.push(`[${section}]`)
    for (const [field, value] of entries) lines.push(`${field}=${value}`)
    lines.push("")
  }
  return lines.join("\n")
}

/** `smafilelist.ini` 是包内清单，按实际写出的文件重生成。 */
function manifestText(paths: readonly string[]): string {
  const folders = [...new Set(paths.filter((path) => path.includes("/")).map((path) => path.slice(0, path.indexOf("/"))))].sort()
  const lines = ["[set]"]
  folders.forEach((folder, index) => lines.push(`forder${index}=${folder}`))
  lines.push(`fordercount=${folders.length}`)
  paths.forEach((path, index) => lines.push(`file${index}=${path}`))
  lines.push(`filecount=${paths.length}`)
  return `${lines.join("\n")}\n`
}

/** 模型 → 文档。 */
export async function ssfFromModel(model: SkinModel): Promise<SkinDocuments> {
  const texts = new Map<string, IniDocument>()
  const binaries = new Map<string, Uint8Array>()
  const roles = new Map<string, FileRole>()
  const putText = (path: string, text: string, role: FileRole): void => {
    texts.set(path, Ini.parse(text))
    roles.set(path, role)
  }
  const putBytes = (path: string, data: Uint8Array, role: FileRole): void => {
    binaries.set(path, data)
    roles.set(path, role)
  }
  const resolution = resolutionOf(model)
  const plans = plansOf(model)
  const refs = model.opaque.get("ssf:backgroundRefs") as BackgroundRefs | undefined
  const loose = model.opaque.get("ssf:looseFields") as ReadonlyMap<string, Map<string, string>> | undefined
  const sectionFiles = model.opaque.get("ssf:sectionFiles") as ReadonlyMap<string, string> | undefined
  const backgroundStyles = model.opaque.get("ssf:backgroundStyles") as ReadonlyMap<string, string> | undefined
  for (const plan of plans) {
    const fields: LookFields = { skin: new Map(), keys: new Map() }
    writeStyles(model, plan, fields, refs ?? new Map(), sectionFiles ?? new Map(), backgroundStyles ?? new Map())
    const own = filterMotions(model.motions, plan.name)
    let animationText = ssfMotionText(own)
    let bindings = new Map<string, string>()
    if (!own.size && model.motions.size && plan.boards[0]) {
      // 来自其它格式的动效：交给百度动画转换器生成搜狗的 `Anim_Style_*`，并拿回按键绑定。
      const converted = await ssfBaiduAnimationOf(model, plan.boards[0], model.images)
      if (converted.animation) animationText = converted.animation.toString()
      bindings = converted.bindings
    }
    writeKeys(plan, fields, refs ?? new Map(), bindings)
    writeMissingRefs(plan, fields, refs ?? new Map(), sectionFiles ?? new Map())
    mergeLooseFields(fields, loose ?? new Map(), plan, sectionFiles ?? new Map())
    writeOtherKeySections(fields, model.opaque.get("ssf:otherKeySections") as ReadonlyMap<string, Map<string, string>> | undefined ?? new Map(), plan)
    const folder = plan.folder ? `${plan.folder}/` : ""
    putText(`${resolution}/${folder}phoneSkin.ini`, documentOfFields(fields.skin).toString(), { kind: "style", theme: plan.theme })
    // 皮肤没有前景段时原包就没有 keys.ini，写一个空文件等于凭空多出一个文件。
    if (fields.keys.size) putText(`${resolution}/${folder}keys.ini`, documentOfFields(fields.keys).toString(), { kind: "style", theme: plan.theme })
    if (animationText.trim()) putText(`${resolution}/${folder}anim.ini`, animationText, { kind: "motion" })
  }
  putText("phoneTheme.ini", phoneThemeText(model), { kind: "info" })
  if (plans.some((plan) => plan.folder)) putText("time.ini", timeText(model, plans, resolution), { kind: "appearance" })
  const sounds = soundText(model)
  if (sounds) putText("default/sound_android.ini", sounds, { kind: "sound-config" })
  const opening = opText(model)
  if (opening) putText("op.ini", opening, { kind: "panel-config" })
  for (const [path, image] of model.images) {
    try {
      putBytes(path, encodePng(image), { kind: "image" })
    } catch {
      // 模型里的像素与尺寸不一致时无法编码；这是模型损坏，不是可以静默跳过的缺失。
      throw new Error(`图片 ${path} 的像素与尺寸不一致，无法写成 PNG`)
    }
  }
  for (const resource of model.resources.values()) {
    if (!resource.data) continue
    const kind: FileRole["kind"] = resource.kind === "font" ? "font" : resource.kind === "image" ? "image" : "audio"
    putBytes(resource.path, resource.data, { kind })
  }
  const manifest = manifestText([...texts.keys(), ...binaries.keys()].sort())
  putText("smafilelist.ini", manifest, { kind: "manifest" })
  return { roles, texts, structs: new Map(), binaries }
}

/** 只留下这个外观的动效节点。 */
function filterMotions(motions: ReadonlyMap<string, MotionNode>, look: string): ReadonlyMap<string, MotionNode> {
  const filtered = new Map<string, MotionNode>()
  for (const [id, node] of motions) {
    if (parseSsfMotionId(id)?.look === look) filtered.set(id, node)
  }
  return filtered
}

/**
 * 文档 → 结构：角色在写出时就登记好了，这里只汇总主题与方向。
 *
 * 客户端默认展示白天外观，主题身份以 `light` 为主；只有夜间一套时才用 `dark`。
 * `SsfSource.theme` 决定再次打开时用哪套外观作主，写成 `dark` 会让往返后的 `meta.theme` 变性。
 */
export function ssfStructureOf(documents: SkinDocuments): SkinStructure {
  const themes = new Set<Theme>()
  for (const role of documents.roles.values()) if (role.kind === "style") themes.add(role.theme)
  const ordered = [...themes].sort((left, right) => (left === "light" ? -1 : right === "light" ? 1 : 0))
  return { roles: documents.roles, themes: ordered, orientations: [] }
}

/**
 * 搜狗包没有方向维度：皮肤文件对所有方向通用，骨架按竖屏打开。
 * 这是格式契约里写死的一点，不是从内容推断出来的。
 */
const SSF_ORIENTATION: Orientation = "port"

/** 文档 → 包。 */
export function ssfPackOf(documents: SkinDocuments, structure: SkinStructure): SsfSource {
  const theme = structure.themes[0]
  if (!theme) throw new Error("文档里没有外观文件，写不出搜狗包")
  const encoder = new TextEncoder()
  const files = new Map<string, Uint8Array>()
  for (const [path, document] of documents.texts) files.set(path, encoder.encode(document.toString()))
  for (const [path, data] of documents.binaries) files.set(path, data)
  return { files, theme, orientation: SSF_ORIENTATION }
}
