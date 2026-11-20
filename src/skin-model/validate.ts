// 模型自检：转换前后的引用是否完整、几何是否自洽。
//
// 格式转换最容易出的错是悬空引用：样式指向不存在的图片、按键指向不存在的样式、
// 动效绑到已删除的对象。这些错误在导出时看不出来，只会在输入法里表现为空白块。
import { containerOf } from "@/skin-model/board.ts"
import type { LayoutNode } from "@/skin-model/layout.ts"
import type { SkinModel } from "@/skin-model/model.ts"

export type IssueSeverity = "error" | "warning"

export type Issue = {
  severity: IssueSeverity
  /** 机器可读的类别，便于界面按类聚合。 */
  code: IssueCode
  /** 出问题的对象：样式名、按键 id、板 id 等。 */
  subject: string
  message: string
}

export type IssueCode =
  | "missing-image"
  | "missing-style"
  | "missing-sound"
  | "missing-motion"
  | "duplicate-id"
  | "size-mismatch"
  | "empty-board"
  | "layout-key-mismatch"
  | "unknown-action"

export type ValidationReport = {
  issues: Issue[]
  /** 错误条数；warning 不计入，导出前只需拦错误。 */
  errors: number
  warnings: number
}

function collectNodes(root: LayoutNode): LayoutNode[] {
  const nodes: LayoutNode[] = [root]
  for (const child of root.children ?? []) nodes.push(...collectNodes(child))
  return nodes
}

/** 样式里的所有图层引用：图片资源与音效文件。 */
function styleReferences(model: SkinModel): { images: string[]; sounds: string[] } {
  const images: string[] = []
  const sounds: string[] = []
  for (const style of model.styles.values()) {
    for (const layer of [...style.normal, ...(style.pressed ?? []), ...(style.disabled ?? [])]) {
      if (layer.kind === "image" || layer.kind === "icon") images.push(layer.image)
      if (layer.kind === "sound") sounds.push(layer.binding.sound)
    }
  }
  return { images, sounds }
}

/**
 * 检查整个模型。
 * 只报告能确定的问题；推导结果是否最优不在检查范围。
 */
export function validateModel(model: SkinModel): ValidationReport {
  const issues: Issue[] = []
  const add = (severity: IssueSeverity, code: IssueCode, subject: string, message: string) => {
    issues.push({ severity, code, subject, message })
  }

  // 样式引用的图片与音效必须存在，否则导出后是空白块或静音。
  const refs = styleReferences(model)
  for (const image of new Set(refs.images)) {
    if (!model.images.has(image)) add("error", "missing-image", image, `样式引用的图片「${image}」不在资源表里`)
  }
  for (const sound of new Set(refs.sounds)) {
    if (!model.resources.has(sound)) add("warning", "missing-sound", sound, `音效「${sound}」没有登记为资源`)
  }

  const knownStyles = new Set(model.styles.keys())
  const knownKeys = new Set(model.boards.flatMap((board) => board.keys.map((key) => key.id)))

  for (const board of model.boards) {
    // 板必须有按键，否则导出后是一块空白键盘。
    if (!board.keys.length) add("error", "empty-board", board.id, "板里没有按键")

    const seen = new Set<string>()
    for (const key of board.keys) {
      if (seen.has(key.id)) add("error", "duplicate-id", `${board.id}/${key.id}`, "同一块板里键 id 重复")
      seen.add(key.id)
      for (const [slot, style] of [["back", key.container.back?.style], ["pressedBack", key.container.back?.pressed]] as const) {
        if (style !== undefined && !knownStyles.has(style)) {
          add("error", "missing-style", `${board.id}/${key.id}`, `${slot} 引用的样式「${style}」不存在`)
        }
      }
      for (const layer of key.container.fore) {
        if (layer.style && !knownStyles.has(layer.style)) add("error", "missing-style", `${board.id}/${key.id}`, `前景样式「${layer.style}」不存在`)
      }
      if (!Object.keys(key.actions).length) add("warning", "unknown-action", `${board.id}/${key.id}`, "按键没有任何动作")
    }

    // 布局树里的几何节点应当与按键一一对应；多出来的节点在导出时会变成空块。
    const nodes = collectNodes(board.layout)
    const layoutIds = new Set(nodes.map((node) => node.id))
    for (const key of board.keys) {
      // 没有 layoutId 的键是「有样式、无几何」的合法状态，不是缺失。
      if (key.layoutId === undefined) continue
      if (!layoutIds.has(key.layoutId)) {
        add("error", "layout-key-mismatch", `${board.id}/${key.id}`, "布局树里没有这个按键的节点")
      }
    }
  }

  // 动效绑定的目标必须还在，否则导出后动画不触发。
  for (const [id, motion] of model.motions) {
    for (const binding of motion.bindings ?? []) {
      if (binding.target.startsWith("style:")) {
        const style = binding.target.slice(6)
        if (!knownStyles.has(style)) add("warning", "missing-style", id, `动效绑定的样式「${style}」不存在`)
      } else if (!knownKeys.has(binding.target) && !model.boards.some((board) => board.id === binding.target)) {
        add("warning", "missing-motion", id, `动效绑定的目标「${binding.target}」不存在`)
      }
    }
  }

  // 主板的尺寸应当与模型记录的分辨率一致。
  const primary = model.boards.find((board) => board.kind === "main") ?? model.boards[0]
  const primarySize = primary ? containerOf(primary) : undefined
  if (primary && primarySize && model.meta.resolution) {
    const { width, height } = model.meta.resolution
    if (primarySize.width !== width || primarySize.height !== height) {
      add("warning", "size-mismatch", primary.id, `主板尺寸 ${primarySize.width}×${primarySize.height} 与分辨率 ${width}×${height} 不一致`)
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error").length
  return { issues, errors, warnings: issues.length - errors }
}

/** 报告是否可以继续导出：只有错误会拦住。 */
export function isExportable(report: ValidationReport): boolean {
  return report.errors === 0
}

/** 报告的一行摘要，便于状态栏展示。 */
export function summarize(report: ValidationReport): string {
  if (!report.issues.length) return "模型自检通过"
  return `模型自检：${report.errors} 个错误、${report.warnings} 个提示`
}
