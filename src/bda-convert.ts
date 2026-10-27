import { strToU8, zipSync } from "fflate"
import { bdaAppearancePath, bdaConfigPath, bdaLayoutDocument, bdaStyleID, bdaPanelKeyName, type BdaAnimation, type BdaImageAtom, type BdaPanel, type BdaResource, type BdaStyleRef } from "./bda.ts"
import { bdaColorHex } from "./bda-resolver.ts"
import { decodeBdaAnimation, decodeBdaAppearance, decodeBdaSoundConfig } from "./bda-decode.ts"
import { buildLegacyMotion, legacyMotionIni, legacyStyleProp, type LegacyMotionBinding, type LegacyStyleProp } from "./bda-motion.ts"
import { IniDocument } from "./ini.ts"
import { SkinArchive } from "./skin.ts"
import { soundPathForFilename } from "./sounds.ts"

/** Sound styles sit above the image/color/text ranges used by bdaStyleID. */
const SOUND_STYLE_BASE = 4_000_000
/** 面板级动效目标在 BDA target 里的常见写法。 */
const PANEL_TARGETS = ["PANEL", "KEYBOARD", "KEYBOARD_BG", "BG", "SKIN"]
const CAND_TARGETS = ["CAND", "CANDIDATE", "CAND_BAR", "CANDIDATE_BAR", "CAND_BG"]
const HINT_TARGETS = ["HINT", "BUBBLE", "POPUP", "HINT_BG"]
const LIST_TARGETS = ["LIST", "CAND_LIST", "LIST_BG"]

type BdaConversion = { archive: SkinArchive; warnings: string[] }

function pngSize(bytes: Uint8Array): [number, number] {
  if (
    bytes.length < 24 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ||
    new TextDecoder().decode(bytes.slice(12, 16)) !== "IHDR"
  ) throw new Error("BDA 资源不是有效的 PNG")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return [view.getUint32(16), view.getUint32(20)]
}

function staticResourceID(resourceID: string, animation: BdaAnimation): string {
  return animation.sequences.get(resourceID)?.frames.find((frame) => frame.resourceID)?.resourceID ?? resourceID
}

function sourceImage(
  source: SkinArchive,
  theme: string,
  orientation: string,
  resourceID: string,
): { id: string; bytes: Uint8Array } | undefined {
  const id = resourceID.replace(/\.png$/i, "")
  const paths = [
    `${theme}/skin/${orientation}/res/${id}.png`,
    `${theme}/skin/res/${id}.png`,
  ]
  const path = paths.find((candidate) => source.isImage(candidate))
  const bytes = path && source.getBytes(path)
  return bytes ? { id, bytes } : undefined
}

function tile(width: number, height: number, inner?: BdaImageAtom["innerRect"]): Uint8Array {
  return strToU8([
    "[GLOBAL]",
    "TILE_NUM=1",
    "",
    "[IMG1]",
    `SOURCE_RECT=0,0,${width},${height}`,
    ...(inner ? [`INNER_RECT=${inner.x},${inner.y},${inner.width},${inner.height}`] : []),
    "",
  ].join("\n"))
}

function applyKeySounds(document: IniDocument, sounds: Map<string, string>, fallback: string | undefined): void {
  if (fallback) document.set("PANEL", "SOUND_STYLE", fallback)
  for (const section of document.sections().filter((name) => /^KEY\d+$/.test(name))) {
    const style = [document.get(section, "CENTER"), document.get(section, "DOWN")]
      .filter((value): value is string => Boolean(value))
      .map((action) => sounds.get(bdaPanelKeyName(action)))
      .find(Boolean)
    if (style && style !== fallback) document.set(section, "SOUND_STYLE", style)
  }
}

/** 面板级动效目标（面板、候选栏、气泡、列表）覆盖到的样式。 */
function panelMotionStyles(panelName: string, panel: BdaPanel | undefined, target: string): BdaStyleRef[] {
  if (!panel) return []
  const upper = target.toUpperCase()
  const styles: BdaStyleRef[] = []
  if (upper === panelName.toUpperCase() || PANEL_TARGETS.includes(upper)) {
    styles.push(panel.backStyle!, panel.wholeBackStyle!, panel.inputRegionBackStyle!)
  }
  if (CAND_TARGETS.includes(upper) && panel.cand) {
    styles.push(panel.cand.candBarStyle!, panel.cand.candOnBarStyle!, panel.cand.cellBackStyle!)
  }
  if (HINT_TARGETS.includes(upper)) {
    for (const hint of panel.hints.values()) styles.push(hint.backStyle!, hint.barStyle!, hint.cellStyle!)
  }
  if (LIST_TARGETS.includes(upper)) {
    for (const list of panel.lists.values()) styles.push(list.backStyle!, list.cellBackStyle!, list.cellForeStyle!)
  }
  return styles.filter((style): style is BdaStyleRef => Boolean(style))
}

/** 旧版 default.css 是主题共享的：同一样式被横竖屏写了不同动效时保留第一份并提示。 */
function appendMotionRefs(
  themeStyles: Map<string, string[]>,
  motionRefs: Map<string, Map<LegacyStyleProp, number>>,
  conflicts: Set<string>,
  theme: string,
  warnings: string[],
): void {
  for (const [styleID, refs] of motionRefs) {
    const lines = themeStyles.get(`[STYLE${styleID}]`)
    if (!lines) continue
    for (const [prop, animation] of refs) lines.push(`${prop}=${animation}`)
  }
  if (conflicts.size) warnings.push(`${theme} 的横竖屏有 ${conflicts.size} 个样式动效不同，横屏沿用竖屏动效`)
}

export function convertBdaArchive(source: SkinArchive, base: SkinArchive, format: "bdi" | "bds" = "bds"): BdaConversion {
  if (source.format !== "bda") throw new Error("只能转换 BDA 皮肤")
  const output = new Map<string, Uint8Array>()
  const warnings: string[] = []
  for (const path of ["Info.txt", "demo.png"]) {
    const bytes = source.getBytes(path)
    if (bytes) output.set(path, bytes)
  }

  for (const theme of ["light", "dark"] as const) {
    const soundStyles = new Map<string, string>()
    // Both orientations share the theme's default.css; BDA style keys are global, so they merge.
    const themeStyles = new Map<string, string[]>()
    // 旧版通过 CSS 样式的 PRESS_ANIM/SHOW_ANIM… 引用 anim.ini，样式在主题内共享。
    const motionRefs = new Map<string, Map<LegacyStyleProp, number>>()
    const motionConflicts = new Set<string>()
    const addMotionRef = (ref: BdaStyleRef | undefined, prop: LegacyStyleProp, animation: number) => {
      if (!ref) return
      const styleID = bdaStyleID(ref)
      const props = motionRefs.get(styleID) ?? new Map<LegacyStyleProp, number>()
      const existing = props.get(prop)
      if (existing === undefined) props.set(prop, animation)
      else if (existing !== animation) motionConflicts.add(`${styleID}:${prop}`)
      motionRefs.set(styleID, props)
    }
    let conflicts = 0
    for (const name of ["Info.txt", "demo.png"] as const) {
      const bytes = source.getBytes(`${theme}/skin/${name}`) ?? source.getBytes(name)
      if (bytes) output.set(`${theme}/skin/${name}`, bytes)
    }
    for (const orientation of ["port", "land"] as const) {
      const appearancePath = bdaAppearancePath(source, theme, orientation)
      const appearanceBytes = appearancePath && source.getBytes(appearancePath)
      if (!appearanceBytes) continue
      const appearance = decodeBdaAppearance(appearanceBytes)
      const animationPath = bdaConfigPath(source, theme, orientation, "animation")
      const animationBytes = animationPath && source.getBytes(animationPath)
      const animation = animationBytes
        ? decodeBdaAnimation(animationBytes)
        : { targets: [], sequences: new Map(), bindings: new Map(), targetBindings: new Map(), effects: new Map() }

      // Key name -> sound style ID; the target platform's own sound map wins, the other is a fallback.
      const keySounds = new Map<string, string>()
      const soundConfigPath = bdaConfigPath(source, theme, orientation, "sound")
        ?? bdaConfigPath(source, theme, orientation === "port" ? "land" : "port", "sound")
      const soundBytes = soundConfigPath && source.getBytes(soundConfigPath)
      if (soundBytes) {
        const config = decodeBdaSoundConfig(soundBytes)
        const sounds = (format === "bdi" ? [config.iosKeySounds, config.keySounds] : [config.keySounds, config.iosKeySounds])
          .find((map) => map.size) ?? new Map()
        for (const [key, resource] of sounds) {
          const path = resource.resourceID
            ? soundPathForFilename(source.names(), theme, orientation, resource.resourceID)
            : undefined
          const bytes = path && source.getBytes(path)
          if (!path || !bytes) {
            warnings.push(`${theme}/${orientation} 的按键音 ${resource.resourceID || key} 缺少音频文件，已跳过`)
            continue
          }
          const filename = path.split("/").pop()!
          let styleID = soundStyles.get(filename)
          if (!styleID) {
            styleID = String(SOUND_STYLE_BASE + soundStyles.size)
            soundStyles.set(filename, styleID)
          }
          output.set(`${theme}/skin/res/${filename}`, bytes)
          keySounds.set(key, styleID)
        }
      }
      const defaultSound = keySounds.get("default") ?? keySounds.values().next().value

      const basePrefix = `light/skin/${orientation}/`
      const targetPrefix = `${theme}/skin/${orientation}/`
      for (const path of base.names()) {
        if (!path.startsWith(basePrefix) || path.slice(basePrefix.length).includes("/")) continue
        const name = path.slice(basePrefix.length)
        if (name !== "gen.ini" && /\.ini$/i.test(name)) continue
        const bytes = base.getBytes(path)
        if (bytes) output.set(`${targetPrefix}${name}`, bytes)
      }
      // 动效目标要按导出后的布局段落解析，保留文档以便后面套用绑定。
      const layouts: Array<{ document: IniDocument; panelName: string }> = []
      for (const layout of appearance.panels.keys()) {
        const path = `${basePrefix}${layout}.ini`
        if (!base.isText(path)) {
          warnings.push(`${theme}/${orientation} 的 ${layout} 面板没有 BDS/BDI 基础布局，已跳过`)
          continue
        }
        const document = bdaLayoutDocument(IniDocument.parse(base.getText(path)), appearance, layout)
        if (keySounds.size) applyKeySounds(document, keySounds, defaultSound)
        output.set(`${targetPrefix}${layout}.ini`, strToU8(document.toString()))
        layouts.push({ document, panelName: layout })
      }

      const addStyle = (header: string, lines: string[]) => {
        const existing = themeStyles.get(header)
        if (!existing) themeStyles.set(header, lines)
        else if (existing.join("\n") !== lines.join("\n")) conflicts++
      }
      const copied = new Set<string>()
      const imageSpec = (atom: BdaImageAtom | undefined): string | undefined => {
        const original = atom?.resource?.resourceID
        if (!original) return
        const resourceID = staticResourceID(original, animation)
        const image = sourceImage(source, theme, orientation, resourceID)
        if (!image) return
        if (!copied.has(image.id)) {
          const [width, height] = pngSize(image.bytes)
          output.set(`${theme}/skin/res/${image.id}.png`, image.bytes)
          output.set(`${theme}/skin/res/${image.id}.til`, tile(width, height, atom?.innerRect))
          copied.add(image.id)
        }
        return `${image.id},1`
      }
      // 粒子动效的图片在旧版里必须指向 [STYLE*] 的 NM_IMG：优先复用外观里同图样式，否则新建样式。
      let nextParticleKey = Math.max(0, ...appearance.imageStyles.keys()) + 1
      const particleStyles = new Map<string, number>()
      const particleStyle = (resource: BdaResource): number | undefined => {
        const resourceID = resource.resourceID
        if (!resourceID) return
        const existing = [...appearance.imageStyles.entries()]
          .find(([, style]) => style.normalImage?.resource?.resourceID === resourceID)
        if (existing) return Number(bdaStyleID({ type: "image", key: existing[0] }))
        const cached = particleStyles.get(resourceID)
        if (cached !== undefined) return cached
        const spec = imageSpec({ resource })
        if (!spec) return
        const styleID = Number(bdaStyleID({ type: "image", key: nextParticleKey++ }))
        addStyle(`[STYLE${styleID}]`, [`NM_IMG=${spec}`])
        particleStyles.set(resourceID, styleID)
        return styleID
      }
      const animationFile = (resource: BdaResource): string | undefined => {
        const name = (resource.resourceID ?? "").split("/").pop() ?? ""
        if (!/\.gif$/i.test(name)) return
        const candidates = source.names().filter((path) => path.split("/").pop() === name)
        const path = candidates.find((candidate) => candidate.startsWith(`${theme}/skin/`)) ?? candidates[0]
        const bytes = path && source.getBytes(path)
        if (!bytes) return
        output.set(`${targetPrefix}res/${name}`, bytes)
        return name
      }

      for (const [key, style] of appearance.imageStyles) {
        const normal = imageSpec(style.normalImage)
        const highlighted = imageSpec(style.highlightImage) ?? normal
        addStyle(`[STYLE${bdaStyleID({ type: "image", key })}]`, [
          ...(normal ? [`NM_IMG=${normal}`] : []),
          ...(highlighted ? [`HL_IMG=${highlighted}`] : []),
        ])
      }
      for (const [key, style] of appearance.colorStyles) {
        addStyle(`[STYLE${bdaStyleID({ type: "color", key })}]`, [
          `NM_COLOR=${bdaColorHex(style.normalColor ?? 0)}`,
          `HL_COLOR=${bdaColorHex(style.highlightColor ?? style.normalColor ?? 0)}`,
        ])
      }
      for (const [key, style] of appearance.textStyles) {
        addStyle(`[STYLE${bdaStyleID({ type: "text", key })}]`, [
          ...(style.fontName ? [`FONT_NAME=${style.fontName}`] : []),
          ...(style.fontSize ? [`FONT_SIZE=${style.fontSize}`] : []),
          `NM_COLOR=${bdaColorHex(style.normalColor ?? 0)}`,
          `HL_COLOR=${bdaColorHex(style.highlightColor ?? style.normalColor ?? 0)}`,
        ])
      }

      const motion = buildLegacyMotion(animation, { imageStyle: particleStyle, animationPath: animationFile, randomize: format === "bds" })
      for (const warning of motion.warnings) warnings.push(`${theme}/${orientation}：${warning}`)
      const motionIni = legacyMotionIni(motion)
      if (motionIni) output.set(`${targetPrefix}res/anim.ini`, strToU8(motionIni))
      if (bdaConfigPath(source, theme, orientation, "lightAnimation")) {
        warnings.push(`${theme}/${orientation} 的轻量动画（lightAnimationConfig）旧版没有对应格式，已跳过`)
      }
      if (animation.sequences.size) {
        warnings.push(`${theme}/${orientation} 的 ${animation.sequences.size} 个序列帧动画已降级为首帧静态图`)
      }

      // 把 BDA 的目标/作用域绑定到旧版 CSS 用到的样式上。
      const applyBinding = (binding: LegacyMotionBinding): boolean => {
        const prop = legacyStyleProp(binding.event)
        if (!prop) return false
        const upper = binding.target.trim().toUpperCase()
        const semantic = upper === "MAIN_KEY" || upper === "FUNCTION_KEY"
        let matched = false
        for (const [panelName, panel] of appearance.panels) {
          const panelStyles = panelMotionStyles(panelName, panel, binding.target)
          if (panelStyles.length) matched = true
          for (const style of panelStyles) addMotionRef(style, prop, binding.animation)
        }
        for (const { document, panelName } of layouts) {
          const panel = appearance.panels.get(panelName)
          if (!panel) continue
          for (const section of document.sections()) {
            if (!/^(?:KEY|TIP)\d+$/.test(section)) continue
            const actions = [document.get(section, "CENTER"), document.get(section, "DOWN")]
              .filter((value): value is string => Boolean(value))
            const names = actions.map((action) => bdaPanelKeyName(action))
            const key = names.map((name) => panel.keys.get(name)).find(Boolean)
            if (!key) continue
            const candidates = new Set([section, ...actions, ...names].map((value) => value.toUpperCase()))
            const main = names.some((name) => /^KEY_[A-Z]$/.test(name))
            const hit = candidates.has(upper) || (semantic && (upper === "MAIN_KEY" ? main : !main))
            if (!hit) continue
            matched = true
            const styles = binding.scope === 0
              ? key.foreStyles
              : binding.scope === 1
                ? key.backStyle ? [key.backStyle] : []
                : [key.backStyle, ...key.foreStyles]
            for (const style of styles) addMotionRef(style, prop, binding.animation)
          }
        }
        return matched
      }
      const unmatched = new Set<string>()
      for (const binding of motion.bindings) {
        if (!applyBinding(binding)) unmatched.add(binding.target)
      }
      if (unmatched.size) {
        warnings.push(`${theme}/${orientation} 的动效目标 ${[...unmatched].join("、")} 在导出布局里找不到对应按键或样式，已跳过`)
      }
    }
    if (!themeStyles.size && !soundStyles.size) continue
    for (const [filename, styleID] of soundStyles) themeStyles.set(`[STYLE${styleID}]`, [`PRESS_SOUND_PATH=${filename}`])
    appendMotionRefs(themeStyles, motionRefs, motionConflicts, theme, warnings)
    const sections = [...themeStyles].flatMap(([header, lines]) => [header, ...lines, ""])
    output.set(`${theme}/skin/res/default.css`, strToU8(`[GLOBAL]\nSTYLE_NUM=${themeStyles.size}\n\n${sections.join("\n")}`))
    if (conflicts) warnings.push(`${theme} 的横竖屏有 ${conflicts} 个同号样式内容不同，横屏沿用竖屏样式`)
  }

  if (!output.size) throw new Error("BDA 中没有可转换的外观配置")
  return { archive: SkinArchive.open(zipSync(Object.fromEntries(output), { level: 6 })), warnings }
}
