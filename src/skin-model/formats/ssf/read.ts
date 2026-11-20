// 搜狗皮肤 → IR。
//
// 只拿解析产物（文档与字节），拿不到包；骨架是外部输入，提供容器尺寸与键清单。
// 一个时段就是一套外观：`status1`/`status2` 各自有 phoneSkin/keys/anim，各自一块键盘板。
// 包里没有按键坐标，布局树由骨架的相邻关系推出（见 `layout.ts`），不往模型里写矩形。
import type { Size } from "taffy-layout"
import { decodePng } from "@/raster.ts"
import { IniDocument } from "@/ini.ts"
import type { AppearanceSet, Activation } from "@/skin-model/activation.ts"
import type { Board } from "@/skin-model/board.ts"
import { knownContainer } from "@/skin-model/board.ts"
import type { Key, KeyContainer, KeyStateStyle } from "@/skin-model/key.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import { computeLayout, type LayoutBoard } from "@/skin-model/layout.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import { emptyModel } from "@/skin-model/model.ts"
import type { SkinDocuments } from "@/skin-model/pipeline.ts"
import type { SkinLayer, SkinStyle, Stretch } from "@/skin-model/style.ts"
import type { SoundBinding } from "@/skin-model/sound.ts"
import type { Orientation, Theme } from "@/skin-model/types.ts"
import { actionOf } from "@/skin-model/formats/bds/index.ts"
import { ssfKeyBinding } from "@/ssf/ssf-keymap.ts"
import type { SsfImageRef } from "@/ssf/ssf-package.ts"
import { flexBoardOf, layoutFit, type SkeletonKey } from "@/skin-model/formats/ssf/layout.ts"
import { ssfMotions, ssfMotionId } from "@/skin-model/formats/ssf/motion.ts"
import {
  compositeStyleName,
  fieldStyleName,
  imageOf,
  readSection,
  referenceOf,
  sectionStyleName,
  stateStyleName,
  type SsfSection,
  type SsfState,
} from "@/skin-model/formats/ssf/style.ts"

/** 一个时段目录对应的外观与它的生效条件。 */
export type SsfLook = {
  /** 目录名（`status1`、`status2`）；老包没有时段层时为空。 */
  folder: string
  /** 样式名里用的时段标识；没有时段层时是 `day`。 */
  name: string
  theme: Theme
  activation: Activation
}

export type SsfReadHints = {
  resolution: number
  theme: Theme
  orientation: Orientation
  landscape: boolean
  /** 骨架给出的容器尺寸与键清单。 */
  container: Size<number>
  keys: SkeletonKey[]
  /** 骨架主布局在骨架里的路径名，用于按布局选按键类。 */
  layout: string
  looks: SsfLook[]
}

/** 一个时段要读的三份文档。 */
type LookDocuments = { look: SsfLook; skin: IniDocument; keys: IniDocument; anim?: IniDocument }

function pathOf(documents: SkinDocuments, resolution: number, folder: string, leaf: string): string | undefined {
  const direct = `${resolution}/${folder ? `${folder}/` : ""}${leaf}`
  if (documents.texts.has(direct)) return direct
  const flat = `${resolution}/${leaf}`
  return documents.texts.has(flat) ? flat : undefined
}

function documentOf(documents: SkinDocuments, resolution: number, folder: string, leaf: string): IniDocument | undefined {
  const path = pathOf(documents, resolution, folder, leaf)
  return path ? documents.texts.get(path) : undefined
}

/** 图片在包里的完整路径：先找本时段的目录，再找共享目录。 */
function imagePath(documents: SkinDocuments, folder: string, file: string): string | undefined {
  const leaf = file.split("/").pop() ?? file
  const candidates = [...documents.binaries.keys()].filter((path) => (path.split("/").pop() ?? "") === leaf)
  return candidates.find((path) => path.startsWith(folder)) ?? candidates.find((path) => path.startsWith("default/"))
}

/**
 * 图片的数字参数 → IR 的拉伸描述。
 * 六个数语义未定，原样保留成 `unknown-six`；四个数是像素边界，换成四条固定边宽。
 */
function stretchOf(ref: SsfImageRef, size: { width: number; height: number } | undefined): Stretch | undefined {
  const numbers = ref.numbers
  if (!numbers?.length) return undefined
  if (numbers.length === 6) return { kind: "unknown-six", values: numbers }
  if (!ref.stretch || !size) return undefined
  const [left, right, top, bottom] = ref.stretch
  return { kind: "nine-slice", edges: { left, top, right: size.width - right, bottom: size.height - bottom } }
}

type ImageContext = {
  documents: SkinDocuments
  images: Map<string, SkinImage>
  folder: string
  /** 本时段的段表；`phoneSkin.ini` 与 `keys.ini` 合起来查。 */
  read: (section: string) => SsfSection | undefined
}

function imageLayerOf(context: ImageContext, ref: SsfImageRef | undefined): SkinLayer | undefined {
  if (!ref) return
  const path = imagePath(context.documents, context.folder, ref.file)
  if (!path) return
  if (!context.images.has(path)) {
    const bytes = context.documents.binaries.get(path)
    if (!bytes) return
    try {
      context.images.set(path, decodePng(bytes))
    } catch {
      // 有文件但不能解成像素（搜狗包里的 webp）：引用仍然真实，照实留下图层；
      // 像素进不了 `images`，字节进 `resources`，写回时原样带走。
    }
  }
  const image = context.images.get(path)
  const stretch = stretchOf(ref, image)
  return { kind: "image", image: path, ...(stretch ? { stretch } : {}) }
}

/**
 * 一个段实际画哪张图：段自己有 `NORMAL` 就用自己；否则看它的背景引用指向哪个段或文件。
 * `BG_IMAGE`/`BG_IMAGES` 的值两种写法都存在，这里按段表存在性判定。
 */
function backgroundSection(context: ImageContext, section: SsfSection | undefined): SsfSection | undefined {
  if (!section?.background) return section
  const reference = referenceOf(section.background)
  return reference?.section ? context.read(reference.section) : section
}

function backgroundFileLayer(context: ImageContext, section: SsfSection | undefined, state: SsfState): SkinLayer | undefined {
  const reference = referenceOf(section?.background)
  if (reference?.file) return imageLayerOf(context, { file: reference.file })
  return imageLayerOf(context, imageOf(backgroundSection(context, section), state))
}

function textLayer(section: SsfSection | undefined, pressed = false): SkinLayer | undefined {
  // 按下态只有原段真的写了 `TEXT_COLOR_PRESSED` 才算；没写就是没有按下色，不回退常态色。
  const color = pressed ? section?.textColorPressed : section?.textColor
  if (!color) return
  const size = section?.textSize
  const font = section?.typeface
  return { kind: "text", style: { color, ...(size !== undefined ? { fontSize: size } : {}), ...(font ? { font } : {}) } }
}

/** 一个段写成 IR 样式：背景图/颜色 + 字。 */
function styleOfSection(context: ImageContext, section: SsfSection | undefined, pressed = false): SkinStyle | undefined {
  if (!section) return
  // 按下态的图来自被引用的段；引用方不重复写一份 `PRESSED=`。
  const ref = section.background ? referenceOf(section.background) : undefined
  if (pressed && (ref?.file || (ref?.section && ref.section !== section.section))) return
  const normal: SkinLayer[] = []
  const image = backgroundFileLayer(context, section, pressed ? "PRESSED" : "NORMAL")
  if (image) normal.push(image)
  else if (!pressed && section.backgroundStyle && section.color) normal.push({ kind: "color", value: section.color })
  const text = textLayer(section, pressed)
  if (text) normal.push(text)
  return normal.length ? { normal } : undefined
}

/**
 * 一个图片段某个状态的图写成样式；非 `NORMAL` 状态只保留图。
 *
 * 有背景引用的段，各状态的图由被引用的段提供，写回时只写引用字段；
 * 这里不再为它生成状态样式，否则写回会在引用方多写一遍 `PRESSED=…`。
 */
function stateStyleOfSection(context: ImageContext, section: SsfSection | undefined, state: SsfState): SkinStyle | undefined {
  const ref = section?.background ? referenceOf(section.background) : undefined
  const referenced = ref?.section ? ref.section !== section?.section : Boolean(ref?.file)
  if (referenced) return undefined
  const image = backgroundFileLayer(context, section, state)
  return image ? { normal: [image] } : undefined
}

/** 按键段解析出的引用：两个文件各自的按键段、背景段或背景文件、前景段、文字样式段。 */
type KeySections = {
  key: string
  /** `keys.ini` 里承载前景的按键段；与 `phoneSkin.ini` 的段名可以不同（`Key_G` / `Key_G_L`）。 */
  keyForeground?: string
  background?: string
  backgroundFile?: string
  foreground?: string
  text?: string
}

/**
 * 一个骨架键对应皮肤里的哪些段。
 *
 * 搜狗只给按键类写样式，键名到段的对应由官方骨架的 `SSF_SECTION`/`SSF_BG` 给出；
 * 皮肤没写某个段时，按客户端自己的回退类取默认背景段。候选必须真实存在于包里。
 */
function sectionsOf(look: LookDocuments, hints: SsfReadHints, skeletonKey: SkeletonKey): KeySections | undefined {
  const binding = ssfKeyBinding(hints.layout, skeletonKey.action, hints.landscape, skeletonKey.section, skeletonKey.background, skeletonKey.foreground)
  const present = (name: string | undefined): string | undefined =>
    name && (look.skin.hasSection(name) || look.keys.hasSection(name)) ? name : undefined
  const keySection = binding.sections.map(present).find(Boolean)
  const keyForeground = binding.sections.find((name) => look.keys.hasSection(name))
  const defaults = binding.defaults.map(present).find(Boolean)
  if (!keySection && !defaults && !keyForeground) return
  const key = keySection ? readSection([look.skin, look.keys], keySection) : undefined
  // `BG_IMAGE` 的值可能是段名也可能是文件名；是文件名时不能拿回退段顶替，那是另一张图。
  const reference = referenceOf(key?.background)
  const background = reference?.section ?? (reference?.file ? undefined : defaults)
  const backgroundFile = reference?.file
  return {
    ...(keySection ? { key: keySection } : { key: "" }),
    ...(keyForeground ? { keyForeground } : {}),
    ...(background ? { background } : {}),
    ...(backgroundFile ? { backgroundFile } : {}),
    ...(key?.foreground ? { foreground: key.foreground } : {}),
    ...(key?.labelStyle ? { text: key.labelStyle } : {}),
  }
}

/** 样式表只写一次；同一个段被多个键引用时共享同一份样式。 */
function putStyle(styles: Map<string, SkinStyle>, name: string, style: SkinStyle | undefined): string | undefined {
  if (!style) return undefined
  if (!styles.has(name)) styles.set(name, style)
  return name
}

/** 按键某个状态合成一层的样式：背景与前景一起换。 */
function putComposite(
  context: ImageContext,
  styles: Map<string, SkinStyle>,
  look: SsfLook,
  background: SsfSection | undefined,
  foreground: SsfSection | undefined,
  state: SsfState,
): string | undefined {
  const layers: SkinLayer[] = []
  const back = backgroundFileLayer(context, background, state)
  if (back) layers.push(back)
  const fore = backgroundFileLayer(context, foreground, state)
  if (fore) layers.push(fore)
  if (!layers.length) return
  return putStyle(styles, compositeStyleName(look.name, background!.section, foreground?.section, state), { normal: layers })
}

/** 一个骨架键 → IR 按键；同时带回它用到的皮肤段，样式表据此跳过这些段。 */
function keyOf(
  look: LookDocuments,
  hints: SsfReadHints,
  skeletonKey: SkeletonKey,
  context: ImageContext,
  styles: Map<string, SkinStyle>,
): { key: Key; sections: string[] } | undefined {
  const binding = sectionsOf(look, hints, skeletonKey)
  if (!binding) return
  const keySection = binding.key ? context.read(binding.key) : undefined
  const background = binding.background ? context.read(binding.background) : undefined
  const foreground = binding.foreground ? context.read(binding.foreground) : undefined
  const textStyle = binding.text ? context.read(binding.text) : undefined

  const back: { style?: string; pressed?: string } = {}
  // 按键的背景引用也可能直接写图片文件；那样没有背景段，样式挂在按键段的一个字段样式上。
  const backgroundFileStyle = binding.backgroundFile
    ? putStyle(styles, fieldStyleName(look.look.name, binding.key, "BG_FILE"), (() => {
      const layer = imageLayerOf(context, { file: binding.backgroundFile! })
      return layer ? { normal: [layer] } : undefined
    })())
    : undefined
  const normalBack = backgroundFileStyle
    ?? putStyle(styles, stateStyleName(look.look.name, background?.section ?? "", "NORMAL"), stateStyleOfSection(context, background, "NORMAL"))
  if (normalBack) back.style = normalBack
  if (background && imageOf(background, "PRESSED")) {
    const pressed = putStyle(styles, stateStyleName(look.look.name, background.section, "PRESSED"), stateStyleOfSection(context, background, "PRESSED"))
    if (pressed) back.pressed = pressed
  }
  const fore: KeyContainer["fore"] = []
  if (foreground) {
    const normal = putStyle(styles, stateStyleName(look.look.name, foreground.section, "NORMAL"), stateStyleOfSection(context, foreground, "NORMAL"))
    if (normal) {
      const pressed = imageOf(foreground, "PRESSED")
        ? putStyle(styles, stateStyleName(look.look.name, foreground.section, "PRESSED"), stateStyleOfSection(context, foreground, "PRESSED"))
        : undefined
      fore.push({ style: normal, ...(pressed ? { pressed } : {}) })
    }
  }
  const icon = keySection?.icon
    ? putStyle(styles, fieldStyleName(look.look.name, keySection.section, "ICON"), (() => {
      const layer = imageLayerOf(context, keySection.icon)
      return layer ? { normal: [layer] } : undefined
    })())
    : undefined
  if (keySection?.iconPressed) {
    const layer = imageLayerOf(context, keySection.iconPressed)
    if (layer) putStyle(styles, fieldStyleName(look.look.name, keySection.section, "ICON_PRESSED"), { normal: [layer] })
  }
  const textStyleName = textStyle
    ? putStyle(styles, sectionStyleName(look.look.name, textStyle.section), styleOfSection(context, textStyle))
    : undefined
  const container: KeyContainer = {
    ...(back.style ? { back } : {}),
    fore,
    ...(keySection?.label ? { text: { content: keySection.label, ...(textStyleName ? { style: textStyleName } : {}) } } : {}),
    ...(icon ? { icon } : {}),
  }
  const action = actionOf(skeletonKey.action)
  const key: Key = {
    id: skeletonKey.id,
    layoutId: skeletonKey.id,
    actions: action ? { press: action } : {},
    container,
    ...(keySection?.foregroundRect ? { foreground: keySection.foregroundRect } : {}),
    ...(keySection?.labelPosition ? { labelPosition: keySection.labelPosition } : {}),
    ...(keySection?.longPress ? { holdSymbol: keySection.longPress } : {}),
    ...(keySection?.anim ? { motions: { press: ssfMotionId(look.look.name, keySection.anim) } } : {}),
    ...(binding.key || binding.keyForeground
      ? { sections: [...new Set([binding.key, binding.keyForeground].filter((name): name is string => Boolean(name)))] }
      : {}),
  }
  const states = keyStatesOf(context, styles, look.look, background, foreground)
  return {
    key: states ? { ...key, states } : key,
    sections: [binding.key, binding.keyForeground, binding.background, binding.foreground, binding.text].filter((name): name is string => Boolean(name)),
  }
}

/** 禁用、开、开且按下：三态各自合成一层，键上只存引用。 */
function keyStatesOf(
  context: ImageContext,
  styles: Map<string, SkinStyle>,
  look: SsfLook,
  background: SsfSection | undefined,
  foreground: SsfSection | undefined,
): Map<string, KeyStateStyle> | undefined {
  if (!background) return
  const states = new Map<string, KeyStateStyle>()
  const axes: Array<[string, SsfState]> = [
    ["*|0|*", "DISABLED"],
    ["0|1|1", "NORMAL_ON"],
    ["1|1|1", "PRESSED_ON"],
  ]
  for (const [axesName, state] of axes) {
    const style = putComposite(context, styles, look, background, foreground, state)
    if (style) states.set(axesName, { style })
  }
  return states.size ? states : undefined
}

/** 皮肤里没被键引用的段也进样式表：面板、气泡、文字样式都在其中，写回要从样式表重建。 */
function addSectionStyles(
  context: ImageContext,
  look: LookDocuments,
  styles: Map<string, SkinStyle>,
  used: ReadonlySet<string>,
): void {
  for (const document of [look.skin, look.keys]) {
    for (const section of document.sections()) {
      if (used.has(section)) continue
      const facts = context.read(section)
      if (!facts) continue
      putStyle(styles, sectionStyleName(look.look.name, section), styleOfSection(context, facts))
      putStyle(styles, stateStyleName(look.look.name, section, "PRESSED"), styleOfSection(context, facts, true))
      for (const state of ["DISABLED", "NORMAL_ON", "PRESSED_ON"] as const) {
        putStyle(styles, stateStyleName(look.look.name, section, state), stateStyleOfSection(context, facts, state))
      }
    }
  }
}

/** 音效：段名是触发主体，`sound=` 是资源名，文件名本身标明平台。 */
function soundsOf(documents: SkinDocuments): SoundBinding[] {
  const document = documents.texts.get("default/sound_android.ini")
  if (!document) return []
  return document.sections().flatMap((section) => {
    const sound = document.get(section, "sound")?.trim()
    return sound ? [{ subject: section, sound, platform: "android" as const }] : []
  })
}

/** 一个文档的所有段与字段；没有解释空间的部分原样带走。 */
/** 只有按键段才建模的字段；非按键段里出现同名字段时按未建模内容原样保留。 */
const KEY_ONLY_FIELDS = ["LABEL", "LABEL_POSITION", "LABEL_STYLE", "L_KEY"]

function sectionSnapshot(document: IniDocument): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  for (const section of document.sections()) sections.set(section, new Map(document.entries(section).map((entry) => [entry.key, entry.value])))
  return sections
}

/**
 * `time.ini` 里不随时间外观建模的部分：`[General]` 与每个分辨率段的 `LOOP_TYPE`。
 * `START`/`END` 由 `appearances[].activation` 重建，`STATUS_LIST` 由外观顺序重建。
 */
function timeSnapshot(document: IniDocument): { general: Map<string, string>; screens: Map<string, Map<string, string>> } {
  const general = new Map(document.entries("General").map((entry) => [entry.key, entry.value]))
  const screens = new Map<string, Map<string, string>>()
  for (const section of document.sections()) {
    if (!/^\d+$/.test(section)) continue
    screens.set(section, new Map(document.entries(section).map((entry) => [entry.key, entry.value])))
  }
  return { general, screens }
}

/** `phoneTheme.ini` 的 `[General]` 字段；缺就是缺，不填默认值。 */
function themeMeta(documents: SkinDocuments, field: string): string | undefined {
  const document = documents.texts.get("phoneTheme.ini")
  if (!document) return
  const value = document.get("General", field)
  return value === undefined ? undefined : value.trim()
}

/** 读模型：一个分辨率、每个时段一块键盘板。 */
export async function ssfToModel(documents: SkinDocuments, hints: SsfReadHints): Promise<SkinModel> {
  const model = emptyModel({
    theme: hints.theme,
    orientation: hints.orientation,
    resolution: hints.container,
    designWidth: hints.resolution,
  })
  const images = new Map<string, SkinImage>(model.images)
  const styles = new Map(model.styles)
  const motions = new Map(model.motions)
  const opaque = new Map(model.opaque)
  /** 段里没建模的字段，按「时段|段」原样保留；写回时字面回填。 */
  const looseFields = new Map<string, Map<string, string>>()
  /**
   * 组件段的背景引用：原字段名与原值（段名或文件名）。
   * 引用是段与段之间的结构事实，展平成一张图会丢掉它；写回优先按引用还原。
   */
  const backgroundRefs = new Map<string, Array<{ field: string; value: string }>>()
  /** 每个段原来写在哪个文件里；写回要把字段放回同一个文件。 */
  const sectionFiles = new Map<string, "skin" | "keys">()
  /** `BG_STYLE` 的原值；有没有这个开关本身是格式事实。 */
  const backgroundStyles = new Map<string, string>()
  /**
   * 主键盘之外（9 键、横屏变体等）的按键段：它们的按键不在模型里，
   * 但段与字段是包里的真实内容，按「时段|段|文件」整段原样保留，写回原样放回。
   */
  const otherKeySections = new Map<string, Map<string, string>>()
  const boards: Board[] = []
  const appearances: AppearanceSet[] = []
  const layout: LayoutBoard = flexBoardOf(hints.keys, hints.container)
  const fit = layoutFit(await computeLayout(layout, hints.container), hints.keys)
  for (const look of hints.looks) {
    const skin = documentOf(documents, hints.resolution, look.folder, "phoneSkin.ini")
    const keyDocument = documentOf(documents, hints.resolution, look.folder, "keys.ini")
    if (!skin && !keyDocument) continue
    const lookDocuments: LookDocuments = {
      look,
      skin: skin ?? IniDocument.parse(""),
      keys: keyDocument ?? IniDocument.parse(""),
      ...(documentOf(documents, hints.resolution, look.folder, "anim.ini")
        ? { anim: documentOf(documents, hints.resolution, look.folder, "anim.ini") }
        : {}),
    }
    const context: ImageContext = {
      documents,
      images,
      folder: look.folder ? `${hints.resolution}/${look.folder}/` : `${hints.resolution}/`,
      read: (section) => readSection([lookDocuments.skin, lookDocuments.keys], section),
    }
    const boardId = `${hints.layout.replace(/^.*\//, "").replace(/\.ini$/i, "")}@${look.name}`
    const keys: Key[] = []
    const used = new Set<string>()
    for (const skeletonKey of hints.keys) {
      const built = keyOf(lookDocuments, hints, skeletonKey, context, styles)
      if (!built) continue
      keys.push(built.key)
      for (const section of built.sections) used.add(section)
    }
    boards.push({
      id: boardId,
      kind: "main",
      theme: look.theme,
      orientation: hints.orientation,
      geometry: { kind: "client", basis: "sogou" },
      container: knownContainer(hints.container),
      layout,
      keys,
      extra: new Map<string, unknown>([
        ["look", look.name],
        ["layoutFit", fit],
        // 骨架给每个键指定的背景类：皮肤没写按键段时，客户端按它画默认背景。
        // 写回要靠它判断「背景是皮肤显式写的还是客户端默认的」。
        ["skeletonBackgrounds", new Map(hints.keys.flatMap((key) => (key.background ? [[key.id, key.background] as [string, string]] : [])))],
      ]),
      ...(context.read("RootView") ? { backdrop: sectionStyleName(look.name, "RootView") } : {}),
    })
    appearances.push({
      theme: look.theme,
      orientation: hints.orientation,
      activation: look.activation,
      ...(look.folder ? { name: look.folder } : {}),
      boards: [boardId],
    })
    addSectionStyles(context, lookDocuments, styles, used)
    for (const document of [lookDocuments.skin, lookDocuments.keys]) {
      for (const section of document.sections()) {
        const facts = context.read(section)
        if (!facts) continue
        const refs = [facts.backgroundField, ...(document.get(section, "BG_IMAGE") && document.get(section, "BG_IMAGES") ? [facts.backgroundField === "BG_IMAGE" ? "BG_IMAGES" : "BG_IMAGE"] : [])]
          .flatMap((field) => {
            if (!field) return []
            const value = document.get(section, field)?.trim()
            return value ? [{ field, value }] : []
          })
        if (refs.length) backgroundRefs.set(`${look.name}|${section}`, refs)
        if (document.hasSection(section) && !sectionFiles.has(`${look.name}|${section}`)) {
          sectionFiles.set(`${look.name}|${section}`, document === lookDocuments.skin ? "skin" : "keys")
        }
        const style = document.get(section, "BG_STYLE")?.trim()
        if (style) backgroundStyles.set(`${look.name}|${section}`, style)
        // 段名是按键类的段不在模型里（其它布局的按键），整段字段原样保留。
        const looksLikeKey = /^Key_/i.test(section)
        const file = document === lookDocuments.skin ? "skin" : "keys"
        if (!used.has(section) && looksLikeKey) {
          otherKeySections.set(`${look.name}|${section}|${file}`, new Map(document.entries(section).map((entry) => [entry.key, entry.value])))
        } else if (!used.has(section)) {
          // 这些字段只有按键段才建模（按键的位置与文字）；非按键段里的同名值是别的语义，原样保留。
          const loose = new Map(facts.extra)
          for (const field of KEY_ONLY_FIELDS) {
            const value = document.get(section, field)?.trim()
            if (value) loose.set(field, value)
          }
          // 有背景图的段同时写 `BG_COLOR` 时，图为先；颜色字段仍是原文事实，原样保留。
          const color = facts.background ? document.get(section, "BG_COLOR")?.trim() : undefined
          if (color) loose.set("BG_COLOR", color)
          if (loose.size) looseFields.set(`${look.name}|${section}`, loose)
        } else if (facts.extra.size) {
          looseFields.set(`${look.name}|${section}`, new Map(facts.extra))
        }
      }
    }
    if (lookDocuments.anim) {
      for (const [id, node] of ssfMotions(look, lookDocuments.anim)) motions.set(id, node)
    }
  }
  model.boards = boards
  model.appearances = appearances
  // 样式表是池，键是名字；按名字排序让读出的顺序不再取决于文件里的段顺序，往返才可比较。
  model.styles = new Map([...styles].sort(([left], [right]) => left.localeCompare(right)))
  model.images = images
  model.motions = motions
  model.sounds = soundsOf(documents)
  const resources = new Map(model.resources)
  for (const [path, bytes] of documents.binaries) {
    if (/\.(?:mp3|ogg|wav|m4a|aiff|caf)$/i.test(path)) resources.set(path, { kind: "audio", path, data: bytes })
    else if (/\.(?:ttf|otf|ttc)$/i.test(path)) resources.set(path, { kind: "font", path, data: bytes })
    else if (/\.(?:png|webp|jpe?g|gif)$/i.test(path) && !images.has(path)) {
      const format = path.split(".").pop()?.toLowerCase()
      resources.set(path, { kind: "image", path, ...(format ? { format } : {}), data: bytes })
    }
  }
  model.resources = resources
  model.meta.name = themeMeta(documents, "skin_name")
  model.meta.author = themeMeta(documents, "skin_author")
  model.meta.version = themeMeta(documents, "skin_version")
  if (backgroundRefs.size) opaque.set("ssf:backgroundRefs", backgroundRefs)
  if (sectionFiles.size) opaque.set("ssf:sectionFiles", sectionFiles)
  if (backgroundStyles.size) opaque.set("ssf:backgroundStyles", backgroundStyles)
  if (otherKeySections.size) opaque.set("ssf:otherKeySections", otherKeySections)
  const soundDocument = documents.texts.get("default/sound_android.ini")
  if (soundDocument) opaque.set("ssf:soundSections", sectionSnapshot(soundDocument))
  if (looseFields.size) opaque.set("ssf:looseFields", looseFields)
  const startScreen = documents.texts.get("time.ini")
  if (startScreen) opaque.set("ssf:time", timeSnapshot(startScreen))
  const opening = documents.texts.get("op.ini")
  if (opening) opaque.set("ssf:op", sectionSnapshot(opening))
  const info = documents.texts.get("phoneTheme.ini")
  if (info) {
    const extra = new Map<string, string>()
    for (const entry of info.entries("General")) {
      if (!["skin_name", "skin_author", "skin_version"].includes(entry.key)) extra.set(entry.key, entry.value)
    }
    opaque.set("ssf:phoneTheme", extra)
  }
  model.opaque = opaque
  return model
}
