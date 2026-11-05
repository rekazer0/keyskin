// Legacy Baidu anim.ini/CSS/layout → BDA animationConfig, independent of static appearance conversion.
// The editing helpers require an existing map entry; seed only that entry, then reuse their validation
// and range encoders. Structural fields (bindings, groups and resource lists) have no editor writer.
import { bdaPanelKeyName } from "./bda.ts"
import { decodeBdaAppearanceUncached } from "./bda-decode.ts"
import { encodedField, encodeVarint, join, rawFields, updateBdaAnimationEffect } from "./bda-encode.ts"
import { IniDocument } from "./ini.ts"
import { legacyAnimationReferences, legacyAnimationValueParts, parseLegacyAnimationFile, type LegacyAnimationEntry, type LegacyAnimationReference } from "./legacy-animation.ts"
import { SkinArchive } from "./skin.ts"
import { cropImage, decodePng, encodePng } from "./ssf/ssf-png.ts"

const SIMPLE = ["group", "alpha", "scale", "shift", "rotate"] as const
const COMPLEX = ["frame", "image", "emitter", "lottie", "video"] as const
const EFFECT_FIELD = { group: 3, alpha: 4, scale: 5, shift: 6, rotate: 7, frame: 8, emitter: 10 } as const
const EVENTS: Record<string, number> = { PRESS_ANIM: 1, RELEASE_ANIM: 2, SHOW_ANIM: 3, HIDE_ANIM: 4, HOLD_ANIM: 7 }
type Effect = { kind: keyof typeof EFFECT_FIELD; key: string; bytes: Uint8Array }
const integer = (field: number, value: number) => encodedField(field, 0, encodeVarint(value))
const string = (field: number, value: string) => encodedField(field, 2, new TextEncoder().encode(value))
const message = (field: number, bytes: Uint8Array) => encodedField(field, 2, bytes)
const mapEntry = (key: string, bytes: Uint8Array) => join([string(1, key), message(2, bytes)])
const resource = (id: string, type: number) => join([integer(1, type), string(2, id)])

function numeric(value: string): number {
  if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(`不支持的数值 ${value}`)
  return Number(value)
}

function range(value: string): [number, number] {
  const random = value.match(/^rand\(\s*([^,]+),\s*([^,]+)\)$/i)
  const values: [number, number] = random ? [numeric(random[1]), numeric(random[2])] : [numeric(value), numeric(value)]
  if (values[0] > values[1]) throw new Error(`随机范围倒置 ${value}`)
  return values
}

function references(styles: IniDocument, layout: IniDocument): LegacyAnimationReference[] {
  const result = legacyAnimationReferences(styles, layout).filter((ref) => ref.layoutSection)
  // The shared parser predates Palm's HOLD_ANIM and the optional whole-key PRESS_STYLE slot.
  for (const { section, key, value } of layout.entries()) {
    if (!["ANIM_STYLE", "BACK_ANIM_STYLE", "FORE_ANIM_STYLE", "PRESS_STYLE"].includes(key)) continue
    for (const style of value.split(",").map((part) => part.trim()).filter((part) => /^\d+$/.test(part) && Number(part) > 0)) {
      for (const field of key === "PRESS_STYLE" ? [...Object.keys(EVENTS), "FIRST_PRESS_PANEL_ANIM"] : ["HOLD_ANIM"]) {
        for (const id of (styles.get(`STYLE${style}`, field) ?? "").split(",")) {
          if (!/^\d+$/.test(id.trim()) || Number(id) <= 0) continue
          result.push({ animation: Number(id), styleSection: `STYLE${style}`, field, layoutSection: section, layoutField: key })
        }
      }
    }
  }
  return result
}

/** Converts one orientation, with its own resources/CSS overrides and namespaced effects. */
class MotionWriter {
  private readonly roots: string[]
  private readonly styles: IniDocument
  private readonly entries: Map<number, LegacyAnimationEntry>
  private readonly effects = new Map<number, Effect | undefined>()
  private readonly visiting = new Set<number>()
  private readonly resources = new Map<string, string>()
  private readonly targets = new Map<string, Uint8Array[]>()
  private readonly signatures = new Map<string, string>()
  private nextResource = 1

  private readonly source: SkinArchive
  private readonly output: SkinArchive
  private readonly theme: string
  private readonly orientation: string
  private readonly warn: (text: string) => void

  constructor(source: SkinArchive, output: SkinArchive, theme: string,
    orientation: string, warn: (text: string) => void) {
    this.source = source
    this.output = output
    this.theme = theme
    this.orientation = orientation
    this.warn = warn
    this.roots = [`${theme}/skin/${orientation}/res`, `${theme}/skin/res`]
    this.styles = this.document("default.css")
    const parsed = parseLegacyAnimationFile(this.document("anim.ini").toString())
    this.entries = new Map(parsed.entries.map((entry) => [entry.index!, entry]))
    if (parsed.extraSections.length) warn(`${theme}/${orientation} 动画附加段 ${parsed.extraSections.join("、")} 未映射（包括粒子路径）`)
  }

  private document(name: string): IniDocument {
    // 逐条 set 插入新键在 5000+ 段的 default.css 上会退化成平方级（导出 BDA 长时间卡住的原因），
    // 这里按「段首次出现顺序 + 键首次出现顺序 + 后写的值覆盖」拼成文本再解析一次。
    const sections = new Map<string, Map<string, string>>()
    for (const root of [...this.roots].reverse()) {
      const path = `${root}/${name}`
      if (!this.source.isText(path)) continue
      const document = IniDocument.parse(this.source.getText(path))
      for (const section of document.sections()) {
        let entries = sections.get(section)
        if (!entries) sections.set(section, entries = new Map())
        for (const { key, value } of document.entries(section)) entries.set(key, value)
      }
    }
    return IniDocument.parse([...sections].map(([section, entries]) =>
      `[${section}]\n${[...entries].map(([key, value]) => `${key}=${value}\n`).join("")}`).join(""))
  }

  private find(name: string): string | undefined {
    return this.roots.map((root) => `${root}/${name.replace(/^res\//, "")}`).find((path) => this.source.getBytes(path))
  }

  private copy(name: string, gif = false): string {
    const path = this.find(name)
    if (!path) throw new Error(`缺少资源 ${name}`)
    const cache = `${path}|${gif}`
    const existing = this.resources.get(cache)
    if (existing) return existing
    const bytes = this.source.getBytes(path)!
    if (gif && !/^GIF8[79]a/.test(new TextDecoder().decode(bytes.subarray(0, 6)))) throw new Error(`${name} 不是 GIF`)
    const id = this.store(bytes, gif ? "gif" : "png")
    this.resources.set(cache, id)
    return id
  }

  private store(bytes: Uint8Array, extension: string): string {
    let id: string
    do { id = `legacy_motion_${this.orientation}_${this.nextResource++}.${extension}` }
    while (this.output.getBytes(`${this.theme}/skin/res/${id}`))
    this.output.setBytes(`${this.theme}/skin/res/${id}`, bytes)
    return id
  }

  private particleImage(style: string): string {
    const value = this.styles.get(`STYLE${style}`, "NM_IMG")
    if (!value) throw new Error(`粒子样式 STYLE${style} 缺少 NM_IMG`)
    const cache = `slice:${value}`
    const existing = this.resources.get(cache)
    if (existing) return existing
    const [name, tile = "1"] = value.split(",").map((part) => part.trim())
    const path = this.find(`${name.replace(/\.png$/i, "")}.png`)
    if (!path) throw new Error(`缺少粒子图片 ${name}`)
    const atlas = decodePng(this.source.getBytes(path)!)
    const til = this.find(`${name.replace(/\.png$/i, "")}.til`)
    const rect = til && IniDocument.parse(this.source.getText(til)).get(`IMG${tile}`, "SOURCE_RECT")
    if (!rect) throw new Error(`粒子图片 ${name},${tile} 缺少 SOURCE_RECT`)
    const parts = rect.split(",").map(numeric)
    const [x, y, width, height] = parts
    if (parts.length !== 4 || !parts.every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > atlas.width || y + height > atlas.height) {
      throw new Error(`粒子切片超出图片 ${name},${tile}`)
    }
    const id = this.store(encodePng(cropImage(atlas, x, y, width, height)), "png")
    this.resources.set(cache, id)
    return id
  }

  private convert(id: number): Effect | undefined {
    if (this.visiting.has(id)) throw new Error(`组合动画循环引用 ANIM${id}`)
    if (this.effects.has(id)) return this.effects.get(id)
    const entry = this.entries.get(id)
    if (!entry) { this.warn(`缺少 ANIM${id} 定义，未绑定`); return }
    this.visiting.add(id)
    const used = new Set(["CATEGORY"])
    const get = (field: string) => {
      used.add(field)
      return entry.fields.find(([key]) => key === field)?.[1]
    }
    const num = (field: string, fallback = 0) => {
      const value = get(field)
      return value === undefined ? fallback : numeric(value)
    }
    let effect: Effect | undefined
    try {
      if (entry.category !== undefined && ![0, 1, 2, 3].includes(entry.category)) throw new Error(`不支持 CATEGORY=${entry.category}`)
      let kind: Effect["kind"]
      if (entry.kind === "basic") {
        get("TYPE")
        if (entry.type === 5 || entry.type === undefined) throw new Error(`不支持基础 TYPE=${entry.type ?? "未知"}（3D 旋转不能用二维动画替代）`)
        kind = entry.type === 0 ? "alpha" : entry.type === 1 ? "rotate" : entry.type === 2 ? "shift" : "scale"
        if (entry.type === 3) this.warn(`ANIM${id} TYPE=3 目标区域缩放映射为 BDA 整体缩放，裁剪语义不保留`)
      } else kind = entry.kind === "combination" ? "group" : entry.kind === "particle" ? "emitter" : "frame"
      const key = `legacy_${id}`
      // updateBdaAnimationEffect cannot create maps from empty protobuf: seed an empty value first.
      let config = message(EFFECT_FIELD[kind], mapEntry(key, new Uint8Array()))
      const set = (property: string, value: string | number | boolean) => {
        config = updateBdaAnimationEffect(config, `${kind}:${key}`, property, value)
      }
      const repeat = get("REPEAT_CNT")
      set("repeatCount", repeat?.trim().toLowerCase() === "inf" ? 0x7fffffff : repeat === undefined ? 1 : Math.max(1, numeric(repeat)))
      set("removeOnFinish", get("REMOVE") === "1")
      if (kind !== "frame") {
        const repeatMode = num("REPEAT_MODE")
        if (repeatMode !== 0 && repeatMode !== 1) throw new Error(`不支持 REPEAT_MODE=${repeatMode}`)
        set("repeatMode", repeatMode)
      }
      if (kind === "group" || SIMPLE.includes(kind as typeof SIMPLE[number])) set("delay", num("DELAY"))
      if (kind === "group") {
        const buildMode = num("BUILD_METHOD", 1)
        if (buildMode !== 0 && buildMode !== 1) throw new Error(`不支持 BUILD_METHOD=${buildMode}（随机组合）`)
        set("buildMode", buildMode)
        const list = get("BUILD_LIST")?.split(",").map((value) => numeric(value.trim())) ?? []
        const declared = num("BUILD_NUM", list.length)
        if (declared !== list.length) this.warn(`ANIM${id} BUILD_NUM 与 BUILD_LIST 不一致，按列表转换`)
        const children = list.map((child) => this.convert(child))
        if (!children.length || children.some((child) => !child || !SIMPLE.includes(child.kind as typeof SIMPLE[number]))) {
          throw new Error("组合含缺失/不支持的子动画或粒子/GIF；BDA 组合只接受基础/组合动画，未输出残缺组合")
        }
        const value = rawFields(rawFields(config)[0].bytes!).find((field) => field.number === 2)!.bytes!
        const items = children.map((child) => message(6, join([integer(1, SIMPLE.indexOf(child!.kind as typeof SIMPLE[number])), string(2, child!.key)])))
        config = message(3, mapEntry(key, join([value, ...items])))
      } else if (kind === "frame") {
        const path = get("ANIM_PATH") ?? get("SOURCE_FILE")
        if (!path) throw new Error("GIF 缺少 ANIM_PATH/SOURCE_FILE")
        const image = this.copy(path, true)
        // ResourceType: PNG=0, GIF=1 (the media editor only patches resourceID, not type).
        const value = rawFields(rawFields(config)[0].bytes!).find((field) => field.number === 2)!.bytes!
        config = message(8, mapEntry(key, join([value, message(3, resource(image, 1))])))
      } else if (kind === "emitter") {
        const emitterType = num("TYPE")
        if (emitterType !== 0 && emitterType !== 1) throw new Error(`不支持粒子 TYPE=${emitterType}`)
        set("emitterType", emitterType)
        set("duration", num("DURATION") / 1000)
        for (const [field, property] of [["BIRTH_RATE", "birthRate"], ["TOTAL_NUMBER", "totalNumber"], ["FINISH_AFTER_PRACTICES", "finishAfterPractices"], ["REMOVE_INCLUDE_PRACTICES", "keepParticlesOnRemove"], ["MIRROR_UP", "mirrorUp"]]) {
          set(property, num(field, field === "BIRTH_RATE" || field === "TOTAL_NUMBER" ? 1 : 0))
        }
        const region = (get("EMIT_REGION") ?? "0,0,1,1").split(",").map(numeric)
        if (region.length !== 4) throw new Error("EMIT_REGION 必须有四项")
        for (const [index, edge] of ["Left", "Top", "Right", "Bottom"].entries()) set(`emitRegion${edge}`, region[index])
        for (const [field, property, fallback] of [
          ["LIFE", "life", "1000,1000"], ["INIT_ROTATE", "rotation", "0,0"], ["ROTATE_SPEED", "spin", "0,0"],
          ["INIT_SCALE", "scale", "1,1"], ["SCALE_SPEED", "scaleSpeed", "0,0"], ["INIT_ALPHA", "alpha", "255,255"],
          ["ALPHA_SPEED", "alphaSpeed", "0,0"], ["VELOCITY", "velocity", "0,0"], ["VELOCITY_DIRECTION", "velocityDirection", "0,0"],
          ["ACCELERATION", "acceleration", "0,0"], ["ACCELERATION_DIRECTION", "accelerationDirection", "0,0"],
        ]) {
          const pair = (get(field) ?? fallback).split(",").map(numeric)
          if (pair.length !== 2 || pair[0] > pair[1]) throw new Error(`${field} 不是有效范围`)
          set(`${property}Min`, pair[0]); set(`${property}Max`, pair[1])
        }
        if (get("EMIT_TYPE") !== undefined) this.warn(`ANIM${id} EMIT_TYPE（同时/依次发射）BDA 无对应字段，按 BIRTH_RATE 发射`)
        const images = get("PARTICLE_IMAGE")?.split(",").map((style) => this.particleImage(style.trim())) ?? []
        if (!images.length) throw new Error("粒子缺少 PARTICLE_IMAGE")
        const value = rawFields(rawFields(config)[0].bytes!).find((field) => field.number === 2)!.bytes!
        config = message(10, mapEntry(key, join([value, ...images.map((image) => message(13, resource(image, 0)))])))
      } else {
        set("duration", num("DURATION"))
        const curves = (get("INTPOL") ?? "0").split(",").map(numeric)
        if (curves.length > 2 || curves.some((curve) => !Number.isInteger(curve) || curve < 0 || curve > 4)) throw new Error("不支持的 INTPOL")
        set("interpolation", curves[0])
        if (curves.length === 2 && (kind === "scale" || kind === "shift")) {
          set("interpolationXYX", curves[0]); set("interpolationXYY", curves[1])
        } else if (curves.length === 2 && curves[0] !== curves[1]) throw new Error("标量动画不能使用不同的 X/Y 插值器")
        const pixels = kind === "shift" && (get("FROM_PX") !== undefined || get("TO_PX") !== undefined)
        const scalar = kind === "alpha" || kind === "rotate"
        for (const end of ["FROM", "TO"]) {
          const fallback = kind === "scale" ? "100,100" : kind === "alpha" ? "255" : scalar ? "0" : "0,0"
          const values = legacyAnimationValueParts(get(pixels ? `${end}_PX` : end) ?? fallback).map(range)
          if (values.length !== (scalar ? 1 : 2)) throw new Error(`${end} 维数不匹配`)
          values.forEach((pair, axis) => {
            const property = `${end.toLowerCase()}${scalar ? "" : axis === 0 ? "X" : "Y"}`
            set(`${property}Min`, pair[0]); set(`${property}Max`, pair[1])
          })
        }
        if (pixels) {
          // Editor ranges use fields 5/6 until pixel fields 9/10 already exist.
          const entryBytes = rawFields(config)[0].bytes!
          let value = rawFields(entryBytes).find((field) => field.number === 2)!.bytes!
          const fields = rawFields(value)
          value = join(fields.map((field) => field.number === 5 || field.number === 6
            ? message(field.number + 4, field.bytes!) : value.slice(field.start, field.end)))
          config = message(EFFECT_FIELD[kind], mapEntry(key, value))
        }
        if (kind === "scale" || kind === "rotate") for (const [field, prefix] of [["PIVOT", "pivot"], ["PIVOT_PX", "pivotPx"]]) {
          const text = get(field)
          if (text === undefined) continue
          const pair = text.split(",").map(numeric)
          if (pair.length !== 2) throw new Error(`${field} 必须有两项`)
          set(`${prefix}X`, pair[0]); set(`${prefix}Y`, pair[1])
        }
      }
      effect = { kind, key, bytes: config }
    } catch (error) {
      this.warn(`ANIM${id} 未转换：${error instanceof Error ? error.message : error}`)
    }
    for (const [field] of entry.fields) if (!used.has(field)) this.warn(`ANIM${id} 字段 ${field} 未映射到 BDA`)
    this.visiting.delete(id)
    this.effects.set(id, effect)
    return effect
  }

  private bind(target: string, id: number, event: number, scope: number, origin: string, active = new Set<number>(), lane = ""): void {
    if (active.has(id) || active.size >= 32) return
    const entry = this.entries.get(id)
    const field = (key: string) => entry?.fields.find(([name]) => name === key)?.[1]
    if (entry?.kind === "combination" && field("BUILD_METHOD") === "0") {
      const children = (field("BUILD_LIST") ?? "").split(",").map(Number)
      if (children.some(child => ["particle", "frame"].includes(this.entries.get(child)?.kind ?? ""))) {
        this.warn(`${origin} 同时播放的粒子/GIF 与基础动画已拆成独立 BDA 绑定；组合级时序不保留`)
        const next = new Set(active).add(id)
        children.forEach((child, index) => this.bind(target, child, event, scope, origin, next, `${lane}/${index}`))
        return
      }
    }
    const effect = this.convert(id)
    if (!effect) return
    const signatureKey = `${target}|${event}|${scope}|${lane}`
    const prior = this.signatures.get(signatureKey)
    if (prior && prior !== `${id}`) {
      this.warn(`${origin} 与其他布局的 ${target} 动画冲突；BDA 目标跨面板共享，保留先遇到的绑定`)
      return
    }
    if (prior) return
    this.signatures.set(signatureKey, `${id}`)
    const simple = SIMPLE.indexOf(effect.kind as typeof SIMPLE[number])
    const complex = COMPLEX.indexOf(effect.kind as typeof COMPLEX[number])
    const binding = join([integer(1, scope), integer(simple >= 0 ? 2 : 3, simple >= 0 ? simple : complex), string(4, effect.key), integer(5, event)])
    this.targets.set(target, [...this.targets.get(target) ?? [], message(1, binding)])
  }

  write(): void {
    // Preserve unbound definitions too; malformed/cyclic groups never acquire a binding.
    for (const id of this.entries.keys()) this.convert(id)
    const appearanceBytes = this.output.getBytes(`${this.theme}/skin/${this.orientation}/appearanceConfig`)
    if (!appearanceBytes) {
      if (this.entries.size) this.warn(`${this.theme}/${this.orientation} 缺少 BDA appearanceConfig，动画无法绑定`)
      return
    }
    const appearance = decodeBdaAppearanceUncached(appearanceBytes)
    const prefix = `${this.theme}/skin/${this.orientation}/`
    for (const path of this.source.names().filter((path) => path.startsWith(prefix) && /\.(ini|cnd|pop)$/.test(path) && !path.slice(prefix.length).includes("/"))) {
      const layout = IniDocument.parse(this.source.getText(path))
      const panelName = path.slice(prefix.length).replace(/\.ini$/, "")
      const panel = appearance.panels.get(panelName)
      for (const ref of references(this.styles, layout)) {
        const section = ref.layoutSection!
        const event = EVENTS[ref.field]
        const origin = `${path} [${section}]`
        if (event === undefined) { this.warn(`${origin} ${ref.field} 无 BDA 等价事件，未绑定`); continue }
        let target: string | undefined
        if (/^KEY\d+$/.test(section)) {
          const action = layout.get(section, "CENTER") ?? layout.get(section, "DOWN")
          const name = action && bdaPanelKeyName(action)
          if (name && panel?.keys.has(name)) target = name
        } else if (section === "PANEL" && panel) target = panelName
        if (!target) { this.warn(`${origin} 在 BDA 模板中没有可映射的目标（状态/候选栏/气泡等不猜测绑定），未绑定`); continue }
        const scope = ref.layoutField === "FORE_ANIM_STYLE" ? 0 : ref.layoutField === "BACK_ANIM_STYLE" ? 1 : 2
        if (ref.layoutField === "FORE_ANIM_STYLE" && (layout.get(section, "FORE_ANIM_STYLE") ?? "").includes(",")) {
          this.warn(`${origin} 多前景动画槽位 BDA 只能绑定全部前景，已合并到 scope=0`)
        }
        this.bind(target, ref.animation, event, scope, origin)
      }
    }
    if (!this.entries.size && !this.targets.size) return
    const path = `${prefix}animationConfig`
    if (this.output.getBytes(path)?.length) this.warn(`${path} 模板动效已替换为源皮肤动效`)
    const effects = [...this.effects.values()].flatMap((effect) => effect ? [effect.bytes] : [])
    const bindings = [...this.targets].map(([target, values]) => message(1, mapEntry(target, join(values))))
    const gen = `${prefix}gen.ini`
    const width = this.source.isText(gen) ? Number(IniDocument.parse(this.source.getText(gen)).get("PANEL", "SIZE")?.split(",")[0]) : 0
    this.output.setBytes(path, join([integer(12, width > 0 ? width : appearance.designWidth ?? 1080), ...effects, ...bindings]))
    if ([...this.targets.keys()].some((target) => target.startsWith("KEY_"))) {
      this.warn(`${this.theme}/${this.orientation} BDA 按键动效按动作名跨面板共享，源布局的单面板限定不能保留`)
    }
  }
}

/** Mutates only the converted BDA, never the source BDS/SXI or the caller's template. */
export function applyLegacyBaiduMotion(source: SkinArchive, output: SkinArchive): string[] {
  const warnings = new Set<string>()
  for (const theme of ["light", "dark"]) for (const orientation of ["port", "land"]) {
    const roots = [`${theme}/skin/${orientation}/res/anim.ini`, `${theme}/skin/res/anim.ini`]
    if (!roots.some((path) => source.getBytes(path))) continue
    new MotionWriter(source, output, theme, orientation, (warning) => warnings.add(warning)).write()
  }
  return [...warnings]
}
