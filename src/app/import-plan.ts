// 导入计划：一个皮肤包打开后，还需要为它准备什么。
//
// 各格式的准备动作不同——BDA 要官方基础布局，搜狗要官方骨架模板，手心要解析自己的
// `skin.json`。这些以前散在打开流程里按格式分支，现在先算成一份计划，再按计划执行。
import type { ExportFormat } from "@/export.ts"
import type { SkinArchive } from "@/skin.ts"

/** 打开一个皮肤还需要的外部输入。 */
export type ImportBasis = "bda-base" | "ssf-templates" | "none"

export type ImportPlan = {
  format: ExportFormat
  /** 需要预加载的外部基础；没有就先加载再继续。 */
  basis: ImportBasis
  /** 打开后要重建的预览。 */
  preview: "ssf" | "none" | "sxi"
  /** 打开时就该提示的兼容性说明。 */
  notes: readonly string[]
  /** 这个格式是否需要在打开时解析原生文档（手心靠它画布）。 */
  needsNativeDocument: boolean
}

const PLANS: Record<string, Omit<ImportPlan, "format">> = {
  bda: {
    basis: "bda-base",
    preview: "none",
    notes: ["新版 BDA 使用官方面板布局，原皮肤的按键位置与自定义布局可能无法保留"],
    needsNativeDocument: false,
  },
  ssf: {
    basis: "ssf-templates",
    preview: "ssf",
    notes: [],
    needsNativeDocument: false,
  },
  sxi: {
    basis: "none",
    preview: "sxi",
    notes: [],
    needsNativeDocument: true,
  },
}

const DEFAULT_PLAN: Omit<ImportPlan, "format"> = {
  basis: "none",
  preview: "none",
  notes: [],
  needsNativeDocument: false,
}

/** 这个皮肤包打开时要做哪些准备。 */
export function planImport(archive: SkinArchive): ImportPlan {
  const format = archive.format ?? "bds"
  return { format, ...(PLANS[format] ?? DEFAULT_PLAN) }
}

/** 计划需要的外部资源是否已经就绪。 */
export type ImportAssets = {
  hasBdaBase: boolean
  hasSsfTemplates: boolean
}

export function missingAssets(plan: ImportPlan, assets: ImportAssets): ImportBasis[] {
  if (plan.basis === "bda-base" && !assets.hasBdaBase) return ["bda-base"]
  if (plan.basis === "ssf-templates" && !assets.hasSsfTemplates) return ["ssf-templates"]
  return []
}

/** 加载外部资源；由调用方注入实际加载方式，避免这里依赖应用状态。 */
export type ImportLoaders = {
  loadBdaBase: () => Promise<SkinArchive>
  loadSsfTemplates: () => Promise<void>
}

/**
 * 按计划补齐外部资源。
 * 返回加载失败的原因；成功时为空数组。
 */
export async function prepareImport(
  plan: ImportPlan,
  assets: ImportAssets,
  loaders: ImportLoaders,
): Promise<{ loaded: ImportBasis[]; errors: string[] }> {
  const loaded: ImportBasis[] = []
  const errors: string[] = []
  for (const missing of missingAssets(plan, assets)) {
    try {
      if (missing === "bda-base") await loaders.loadBdaBase()
      else await loaders.loadSsfTemplates()
      loaded.push(missing)
    } catch (error) {
      errors.push(`${missing}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { loaded, errors }
}
