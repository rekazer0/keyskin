/*
 * 旧版百度（BDI/BDS）anim.ini 的结构化模型。语义取自《百度手机输入法皮肤教程 V6》第 169–185 页：
 * [GLOBAL] ANIM_NUM 声明动效数量；每个 [ANIM*] 是基础动效 / 组合动效 / 帧动效 / 粒子动效之一，
 * 组合动效只由 BUILD_NUM / BUILD_LIST / BUILD_METHOD 描述，基础动效按 TYPE 复用 FROM、TO、PIVOT。
 * 这里只做纯数据：解析、按类型清理字段的写回、时间轴与 default.css / 布局的引用关系；播放预览见 animation-preview-model.ts。
 */
import { IniDocument } from "./ini.ts"

export type LegacyAnimationKind = "basic" | "combination" | "frame" | "particle"

export type LegacyAnimationEntry = {
  /** 段名原样（如 `ANIM41`）。 */
  section: string
  /** 段名末尾的序号；非法段名时为 undefined。 */
  index: number | undefined
  kind: LegacyAnimationKind
  /** 基础动效的 TYPE（0–5），或粒子的 TYPE（0 简单 / 1 复杂）；组合与帧动效为 undefined。 */
  type: number | undefined
  /** 解析到的 CATEGORY 原值（缺省时 undefined，类型改由内容推断）。 */
  category: number | undefined
  /** 按文件顺序排列的 `键=值`，未知键原样保留。 */
  fields: ReadonlyArray<readonly [string, string]>
}

export type LegacyAnimationDocument = {
  /** [GLOBAL] ANIM_NUM 声明值。 */
  animNum: number | undefined
  entries: LegacyAnimationEntry[]
  /** [ANIM*] 与 [GLOBAL] 之外的段（粒子的 [PATH1] 等），写回时原样保留。 */
  extraSections: string[]
}

export const LEGACY_ANIMATION_KINDS: ReadonlyArray<{ kind: LegacyAnimationKind; label: string }> = [
  { kind: "basic", label: "基础动效" },
  { kind: "combination", label: "组合动效" },
  { kind: "frame", label: "帧动效" },
  { kind: "particle", label: "粒子动效" },
]

const BASIC_TYPE_LABELS: ReadonlyArray<readonly [number, string]> = [
  [0, "透明度"],
  [1, "旋转"],
  [2, "平移"],
  [3, "缩放（目标区域）"],
  [4, "缩放（整体）"],
  [5, "3D 旋转"],
]

const PARTICLE_TYPE_LABELS: ReadonlyArray<readonly [number, string]> = [
  [0, "简单粒子"],
  [1, "复杂粒子"],
]

export function legacyAnimationKindLabel(kind: LegacyAnimationKind): string {
  return LEGACY_ANIMATION_KINDS.find((item) => item.kind === kind)?.label ?? kind
}

/** 基础动效 / 粒子动效的 TYPE 选项；组合与帧动效没有 TYPE。 */
export function legacyAnimationTypeOptions(kind: LegacyAnimationKind): ReadonlyArray<readonly [number, string]> {
  if (kind === "basic") return BASIC_TYPE_LABELS
  if (kind === "particle") return PARTICLE_TYPE_LABELS
  return []
}

export function legacyAnimationTypeLabel(kind: LegacyAnimationKind, type: number | undefined): string {
  if (type === undefined) return "未设置"
  return legacyAnimationTypeOptions(kind).find(([value]) => value === type)?.[1] ?? `TYPE=${type}`
}

export const LEGACY_ANIMATION_INTPOL_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["0", "匀速"], ["1", "加速"], ["2", "减速"], ["3", "加速减速"], ["4", "弹跳"],
]

export type LegacyAnimationFieldSpec = {
  label: string
  kind: "number" | "text" | "pair" | "quad" | "triple" | "select" | "switch"
  unit?: string
  step?: string
  options?: ReadonlyArray<readonly [string, string]>
  optional?: boolean
}

export const LEGACY_ANIMATION_FIELDS: Record<string, LegacyAnimationFieldSpec> = {
  PIVOT: { label: "锚点", kind: "pair", unit: "%" },
  PIVOT_PX: { label: "锚点（像素）", kind: "pair", unit: "px" },
  FROM_PX: { label: "起始位置（像素）", kind: "pair", unit: "px" },
  TO_PX: { label: "终止位置（像素）", kind: "pair", unit: "px" },
  DELAY: { label: "延迟", kind: "number", unit: "ms", step: "1" },
  DURATION: { label: "时长", kind: "number", unit: "ms", step: "1" },
  REPEAT_CNT: { label: "重复次数", kind: "text" },
  REPEAT_MODE: { label: "自动往返", kind: "select", options: [["0", "否"], ["1", "是"]] },
  REMOVE: { label: "结束移除", kind: "select", optional: true, options: [["0", "保持"], ["1", "移除"]] },
  BUILD_LIST: { label: "子动效列表", kind: "text" },
  BUILD_NUM: { label: "子动效数量", kind: "number", step: "1" },
  BUILD_METHOD: { label: "组合方式", kind: "select", options: [["0", "同时播放"], ["1", "接续播放"]] },
  ANIM_PATH: { label: "gif 路径", kind: "text" },
  PARTICLE_IMAGE: { label: "粒子图片", kind: "text" },
  LIFE: { label: "生命周期", kind: "pair", unit: "ms" },
  EMIT_REGION: { label: "发射区域", kind: "quad" },
  TOTAL_NUMBER: { label: "粒子总数", kind: "number", step: "1" },
  BIRTH_RATE: { label: "发射速率", kind: "number", unit: "个/s", step: "0.1" },
  EMIT_TYPE: { label: "发射方式", kind: "select", options: [["0", "依次"], ["1", "同时"]] },
  VELOCITY: { label: "初始速度", kind: "pair", unit: "px/s" },
  VELOCITY_DIRECTION: { label: "速度方向", kind: "pair", unit: "°" },
  ACCELERATION: { label: "加速度", kind: "pair", unit: "px/s²" },
  ACCELERATION_DIRECTION: { label: "加速度方向", kind: "pair", unit: "°" },
  INIT_SCALE: { label: "初始缩放", kind: "pair" },
  SCALE_SPEED: { label: "缩放速度", kind: "pair", unit: "倍/s" },
  INIT_ROTATE: { label: "初始角度", kind: "pair", unit: "°" },
  ROTATE_SPEED: { label: "旋转速度", kind: "pair", unit: "°/s" },
  INIT_ALPHA: { label: "初始透明度", kind: "pair", unit: "0–255" },
  ALPHA_SPEED: { label: "透明度速度", kind: "pair", unit: "/s" },
  FINISH_AFTER_PRACTICES: { label: "以粒子消失为结束", kind: "switch" },
  REMOVE_INCLUDE_PRACTICES: { label: "移除时带走粒子", kind: "switch" },
  MIRROR_UP: { label: "父层级镜像次数", kind: "number", step: "1" },
  PARTICLE_PATH: { label: "粒子路径", kind: "text" },
}

/* —— 解析 —— */
const ANIM_SECTION = /^ANIM(\d+)$/i

function sectionIndex(section: string): number | undefined {
  const match = section.match(ANIM_SECTION)
  return match ? Number(match[1]) : undefined
}

/** 手册第 173 页：定义了任一 BUILD_* 属性就不再按基础动效解析；ANIM_PATH 标记帧动效；CATEGORY=3 标记粒子。 */
function detectKind(document: IniDocument, section: string): LegacyAnimationKind {
  const has = (key: string) => document.get(section, key) !== undefined
  if (has("BUILD_NUM") || has("BUILD_LIST") || has("BUILD_METHOD")) return "combination"
  if (has("ANIM_PATH")) return "frame"
  const category = Number(document.get(section, "CATEGORY")?.trim())
  if (category === 3 || has("PARTICLE_IMAGE")) return "particle"
  if (category === 1) return "combination"
  if (category === 2) return "frame"
  return "basic"
}

function detectType(document: IniDocument, section: string, kind: LegacyAnimationKind): number | undefined {
  if (kind !== "basic" && kind !== "particle") return undefined
  const type = Number(document.get(section, "TYPE")?.trim())
  if (!Number.isFinite(type)) return undefined
  return kind === "basic" ? (type >= 0 && type <= 5 ? type : undefined) : (type === 0 || type === 1 ? type : undefined)
}

export function parseLegacyAnimationFile(text: string): LegacyAnimationDocument {
  const document = IniDocument.parse(text)
  const sections = document.sections()
  const entries = sections.filter((section) => sectionIndex(section) !== undefined).map((section): LegacyAnimationEntry => {
    const kind = detectKind(document, section)
    const category = Number(document.get(section, "CATEGORY")?.trim())
    return {
      section,
      index: sectionIndex(section),
      kind,
      type: detectType(document, section, kind),
      category: Number.isFinite(category) ? category : undefined,
      fields: document.entries(section).map(({ key, value }) => [key, value] as const),
    }
  })
  const animNum = Number(document.get("GLOBAL", "ANIM_NUM")?.trim())
  return {
    animNum: Number.isFinite(animNum) ? animNum : undefined,
    entries,
    extraSections: sections.filter((section) => section !== "GLOBAL" && sectionIndex(section) === undefined),
  }
}

/* —— 字段分组：检查器按它渲染，写回按它清理 —— */
export type LegacyAnimationFieldGroup = { title: string; keys: readonly string[] }

const BASIC_BASE_KEYS = ["CATEGORY", "TYPE", "FROM", "TO", "DURATION", "DELAY", "REPEAT_CNT", "REPEAT_MODE", "REMOVE", "INTPOL"]

/** 手册第 176–178 页：PIVOT 只属于旋转与缩放，平移用 FROM_PX/TO_PX，3D 旋转不支持 PIVOT_PX。 */
const BASIC_TYPE_KEYS: Record<number, readonly string[]> = {
  0: [],
  1: ["PIVOT", "PIVOT_PX"],
  2: ["FROM_PX", "TO_PX"],
  3: ["PIVOT", "PIVOT_PX"],
  4: ["PIVOT", "PIVOT_PX"],
  5: ["PIVOT"],
}

const PARTICLE_GROUPS: ReadonlyArray<LegacyAnimationFieldGroup> = [
  { title: "发射", keys: ["TYPE", "PARTICLE_IMAGE", "TOTAL_NUMBER", "BIRTH_RATE", "EMIT_TYPE", "EMIT_REGION"] },
  { title: "运动", keys: ["LIFE", "VELOCITY", "VELOCITY_DIRECTION", "ACCELERATION", "ACCELERATION_DIRECTION"] },
  { title: "外观", keys: ["INIT_SCALE", "SCALE_SPEED", "INIT_ROTATE", "ROTATE_SPEED", "INIT_ALPHA", "ALPHA_SPEED"] },
  { title: "时间与循环", keys: ["DURATION", "REPEAT_CNT", "FINISH_AFTER_PRACTICES", "REMOVE_INCLUDE_PRACTICES", "MIRROR_UP", "PARTICLE_PATH"] },
]

const KIND_KEYS: Record<LegacyAnimationKind, readonly string[]> = {
  basic: [...BASIC_BASE_KEYS, ...Object.values(BASIC_TYPE_KEYS).flat()],
  combination: ["CATEGORY", "BUILD_NUM", "BUILD_LIST", "BUILD_METHOD", "DELAY", "REPEAT_CNT", "REPEAT_MODE", "REMOVE"],
  frame: ["CATEGORY", "ANIM_PATH"],
  particle: ["CATEGORY", ...PARTICLE_GROUPS.flatMap((group) => group.keys)],
}

/** 与具体类型无关的已知键；切换类型时只清理这些，未知键保持原样。 */
const KNOWN_KEYS = new Set(Object.values(KIND_KEYS).flat())
const STRUCTURAL_KEYS = new Set(["CATEGORY", "TYPE", "BUILD_NUM", "BUILD_LIST", "BUILD_METHOD", "ANIM_PATH"])
const TYPE_REQUIRED_KEYS = new Set(["CATEGORY", "TYPE"])

function advancedKeys(entry: LegacyAnimationEntry, known: ReadonlySet<string>): string[] {
  return entry.fields.map(([key]) => key).filter((key) =>
    !known.has(key) && !STRUCTURAL_KEYS.has(key) && !TYPE_REQUIRED_KEYS.has(key))
}

/**
 * 检查器的参数分组（DESIGN.md §10）：先是变化或组合本身，再是时间与循环，最后是变换中心；
 * 粒子按发射、运动、外观、时间与循环。CATEGORY 由「动效类型」管理，未知键收进「其他参数」。
 */
export function legacyAnimationFieldGroups(entry: LegacyAnimationEntry): LegacyAnimationFieldGroup[] {
  const groups: LegacyAnimationFieldGroup[] = []
  const known = new Set<string>()
  const push = (title: string, keys: readonly string[]) => {
    groups.push({ title, keys })
    for (const key of keys) known.add(key)
  }
  if (entry.kind === "basic") {
    const type = entry.type ?? 0
    const pivot = (BASIC_TYPE_KEYS[type] ?? []).filter((key) => key.startsWith("PIVOT"))
    push("变化", ["TYPE", "FROM", "TO", ...(BASIC_TYPE_KEYS[type] ?? []).filter((key) => !key.startsWith("PIVOT"))])
    push("时间与循环", ["DURATION", "DELAY", "INTPOL", "REPEAT_CNT", "REPEAT_MODE", "REMOVE"])
    if (pivot.length) push("变换中心", pivot)
  } else if (entry.kind === "combination") {
    push("组合", ["BUILD_METHOD", "BUILD_LIST", "BUILD_NUM"])
    push("时间与循环", ["DELAY", "REPEAT_CNT", "REPEAT_MODE", "REMOVE"])
  } else if (entry.kind === "frame") {
    push("帧动效", ["ANIM_PATH"])
  } else {
    for (const group of PARTICLE_GROUPS) push(group.title, group.keys)
  }
  const advanced = advancedKeys(entry, known)
  if (advanced.length) groups.push({ title: "其他参数", keys: advanced })
  return groups
}

/* —— 写回 —— */
function updateAnimNum(document: IniDocument): void {
  const count = document.sections().filter((section) => sectionIndex(section) !== undefined).length
  if (document.sections().includes("GLOBAL")) {
    if (document.get("GLOBAL", "ANIM_NUM") !== String(count)) document.set("GLOBAL", "ANIM_NUM", String(count))
  } else {
    document.appendSection("GLOBAL", [{ key: "ANIM_NUM", value: String(count) }])
  }
}

function applicableKeys(kind: LegacyAnimationKind, type: number | undefined): ReadonlySet<string> {
  if (kind !== "basic") return new Set(KIND_KEYS[kind])
  const basicType = type !== undefined && BASIC_TYPE_KEYS[type] ? type : 0
  return new Set([...BASIC_BASE_KEYS, ...BASIC_TYPE_KEYS[basicType]])
}

function kindDefaults(kind: LegacyAnimationKind): ReadonlyArray<readonly [string, string]> {
  if (kind === "basic") return [["CATEGORY", "0"], ["TYPE", "0"], ["FROM", "0"], ["TO", "255"], ["DURATION", "300"], ["INTPOL", "0"]]
  if (kind === "combination") return [["CATEGORY", "1"], ["BUILD_LIST", ""], ["BUILD_NUM", "0"], ["BUILD_METHOD", "1"]]
  if (kind === "frame") return [["CATEGORY", "2"], ["ANIM_PATH", ""]]
  return [
    ["CATEGORY", "3"], ["TYPE", "0"], ["LIFE", "1000,1500"], ["EMIT_REGION", "0,0,1,1"],
    ["TOTAL_NUMBER", "10"], ["BIRTH_RATE", "5"], ["EMIT_TYPE", "0"], ["PARTICLE_IMAGE", ""],
    ["VELOCITY", "0,100"], ["VELOCITY_DIRECTION", "0,90"], ["INIT_SCALE", "1,1"],
    ["INIT_ALPHA", "255,255"], ["DURATION", "500"],
  ]
}

function readKind(document: IniDocument, section: string): LegacyAnimationKind {
  return detectKind(document, section)
}

/** 改一个或多个字段；`undefined` 表示删掉该键。段顺序、未知键与注释原样保留，并同步 ANIM_NUM。 */
export function writeLegacyAnimationFields(
  text: string,
  section: string,
  fields: Readonly<Record<string, string | undefined>>,
): string {
  const document = IniDocument.parse(text)
  if (!document.sections().includes(section)) return text
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      if (document.get(section, key) !== undefined) document.remove(section, key)
      continue
    }
    if (document.get(section, key) !== value) document.set(section, key, value)
  }
  updateAnimNum(document)
  return document.toString()
}

/** 切换动效家族：删除新家族不适用的已知字段、写入该家族默认值，未知字段与段顺序不变。 */
export function writeLegacyAnimationKind(text: string, section: string, kind: LegacyAnimationKind): string {
  const document = IniDocument.parse(text)
  if (!document.sections().includes(section)) return text
  if (readKind(document, section) === kind) return text
  const nextType = kind === "basic" ? 0 : kind === "particle" ? 0 : undefined
  const keep = applicableKeys(kind, nextType)
  for (const key of document.entries(section).map((entry) => entry.key)) {
    if (KNOWN_KEYS.has(key) && !keep.has(key)) document.remove(section, key)
  }
  for (const [key, value] of kindDefaults(kind)) document.set(section, key, value)
  updateAnimNum(document)
  return document.toString()
}

/** 切换基础动效 TYPE（0–5）或粒子 TYPE（0–1）；FROM / TO 的写法随类型重置，不适用的字段被清理。 */
export function writeLegacyAnimationType(text: string, section: string, type: number): string {
  const document = IniDocument.parse(text)
  if (!document.sections().includes(section)) return text
  const kind = readKind(document, section)
  if (kind !== "basic" && kind !== "particle") return text
  if (kind === "particle") {
    if (type !== 0 && type !== 1) return text
    document.set(section, "TYPE", String(type))
    updateAnimNum(document)
    return document.toString()
  }
  if (!Number.isInteger(type) || !BASIC_TYPE_KEYS[type]) return text
  const keep = applicableKeys("basic", type)
  for (const key of document.entries(section).map((entry) => entry.key)) {
    if (KNOWN_KEYS.has(key) && !keep.has(key)) document.remove(section, key)
  }
  const [from, to] = basicTypeDefaults(type)
  document.set(section, "TYPE", String(type))
  document.set(section, "FROM", from)
  document.set(section, "TO", to)
  updateAnimNum(document)
  return document.toString()
}

function basicTypeDefaults(type: number): readonly [string, string] {
  if (type === 0) return ["0", "255"]
  if (type === 1) return ["0", "360"]
  if (type === 2) return ["0,0", "0,0"]
  if (type === 5) return ["0,0,0", "0,0,0"]
  return ["100,100", "100,100"]
}

/** 在末尾追加 [ANIM n+1]：新建时写入该家族的默认字段，复制时照抄 `copyOf` 的全部键；同步 ANIM_NUM。 */
export function appendLegacyAnimation(text: string, kind: LegacyAnimationKind, copyOf?: string): { text: string; section: string } {
  const document = IniDocument.parse(text)
  const next = Math.max(0, ...document.sections().map((section) => sectionIndex(section) ?? 0)) + 1
  const section = `ANIM${next}`
  const entries = copyOf && document.sections().includes(copyOf)
    ? document.entries(copyOf).map(({ key, value }) => ({ key, value }))
    : kindDefaults(kind).map(([key, value]) => ({ key, value }))
  document.appendSection(section, entries)
  updateAnimNum(document)
  return { text: document.toString(), section }
}

/* —— 时间轴 —— */
export type LegacyAnimationTimeline = {
  delay: number
  /** 一个播放周期的时长；组合动效为子动效的接续总和或同时最大值。 */
  duration: number
  /** 重复次数；0 表示无限（`REPEAT_CNT=inf`）。 */
  repeat: number
  reverse: boolean
  remove: boolean | undefined
  /** 从开始到播完的总时长（含延迟与往返）；无限重复时是 Infinity。 */
  total: number
}

function numberField(value: string | undefined): number | undefined {
  const number = Number(value?.trim())
  return Number.isFinite(number) ? number : undefined
}

function repeatField(value: string | undefined): number {
  if (value?.trim().toLowerCase() === "inf") return 0
  return Math.max(1, Math.floor(numberField(value) ?? 1))
}

/** BUILD_LIST 指向的 [ANIM*] 序号列表。 */
function buildList(entry: LegacyAnimationEntry): string[] {
  return (entry.fields.find(([key]) => key === "BUILD_LIST")?.[1] ?? "")
    .split(",").map((part) => part.trim()).filter(Boolean)
}

function childrenOf(entry: LegacyAnimationEntry, entries: ReadonlyMap<string, LegacyAnimationEntry>): LegacyAnimationEntry[] {
  return buildList(entry).flatMap((id) => {
    const child = entries.get(String(Number(id)))
    return child && child.kind === "basic" ? [child] : []
  })
}

export function legacyAnimationTimeline(
  entry: LegacyAnimationEntry,
  entries: ReadonlyMap<string, LegacyAnimationEntry>,
): LegacyAnimationTimeline {
  const delay = entry.kind === "basic" || entry.kind === "combination" ? Math.max(0, numberField(fieldValue(entry, "DELAY")) ?? 0) : 0
  const repeat = repeatField(fieldValue(entry, "REPEAT_CNT"))
  const reverse = fieldValue(entry, "REPEAT_MODE")?.trim() === "1"
  const removeValue = fieldValue(entry, "REMOVE")?.trim()
  const remove = removeValue === undefined ? undefined : removeValue === "1"
  let duration = 0
  if (entry.kind === "basic") {
    duration = Math.max(0, numberField(fieldValue(entry, "DURATION")) ?? 0)
  } else if (entry.kind === "combination") {
    duration = combinationDuration(entry, entries)
  } else if (entry.kind === "particle") {
    const configured = Math.max(0, numberField(fieldValue(entry, "DURATION")) ?? 0)
    if (configured) duration = configured
    else {
      const total = Math.max(1, numberField(fieldValue(entry, "TOTAL_NUMBER")) ?? 1)
      const rate = Math.max(0.1, numberField(fieldValue(entry, "BIRTH_RATE")) ?? 1)
      duration = Math.round(total / rate * 1000)
    }
  }
  const active = repeat === 0 ? Infinity : duration * repeat * (reverse ? 2 : 1)
  return { delay, duration, repeat, reverse, remove, total: delay + active }
}

function combinationDuration(entry: LegacyAnimationEntry, entries: ReadonlyMap<string, LegacyAnimationEntry>): number {
  const children = childrenOf(entry, entries)
  if (!children.length) return 0
  const times = children.map((child) => legacyAnimationTimeline(child, entries))
  if (fieldValue(entry, "BUILD_METHOD")?.trim() === "0") {
    return Math.max(...times.map((child) => (child.repeat === 0 ? Infinity : child.total)))
  }
  return times.reduce((sum, child) => sum + (child.repeat === 0 ? Infinity : child.total), 0)
}

function fieldValue(entry: LegacyAnimationEntry, key: string): string | undefined {
  return entry.fields.find(([name]) => name === key)?.[1]
}

/** 顶层逗号切分，`rand(-5,5)` 里的逗号不拆开。 */
export function legacyAnimationValueParts(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === "(") depth += 1
    else if (char === ")") depth = Math.max(0, depth - 1)
    else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts
}

/* —— default.css / 布局对动效序号的引用 —— */
export type LegacyAnimationReference = {
  /** 最终指向的 [ANIM*] 序号。 */
  animation: number
  /** default.css 里承载动效指针的 [STYLE*] 段。 */
  styleSection: string
  /** 动效指针字段，如 PRESS_ANIM。 */
  field: string
  /** 布局 INI 里通过 ANIM_STYLE 系列字段指向该样式的段与字段。 */
  layoutSection?: string
  layoutField?: string
}

const STYLE_ANIM_FIELDS = ["PRESS_ANIM", "RELEASE_ANIM", "SHOW_ANIM", "HIDE_ANIM", "FIRST_PRESS_PANEL_ANIM"] as const
const LAYOUT_ANIM_STYLE_FIELDS = ["ANIM_STYLE", "FORE_ANIM_STYLE", "BACK_ANIM_STYLE"] as const

function referenceIDs(value: string | undefined): number[] {
  return (value ?? "")
    .split(",").map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0)
}

/** 手册第 165/179–182 页：default.css 的 [STYLE*] 指针直接指向动效序号，布局的 ANIM_STYLE 先指向样式。 */
export function legacyAnimationReferences(
  styles: IniDocument | undefined,
  layout: IniDocument | undefined,
): LegacyAnimationReference[] {
  if (!styles) return []
  const references: LegacyAnimationReference[] = []
  for (const section of styles.sections()) {
    if (!/^STYLE\d+$/i.test(section)) continue
    for (const field of STYLE_ANIM_FIELDS) {
      for (const animation of referenceIDs(styles.get(section, field))) {
        references.push({ animation, styleSection: section, field })
      }
    }
  }
  if (!layout) return references
  for (const section of layout.sections()) {
    if (section === "GLOBAL" || sectionIndex(section) !== undefined) continue
    for (const field of LAYOUT_ANIM_STYLE_FIELDS) {
      for (const styleID of referenceIDs(layout.get(section, field))) {
        const styleSection = `STYLE${styleID}`
        for (const animField of STYLE_ANIM_FIELDS) {
          for (const animation of referenceIDs(styles.get(styleSection, animField))) {
            references.push({ animation, styleSection, field: animField, layoutSection: section, layoutField: field })
          }
        }
      }
    }
  }
  return references
}
