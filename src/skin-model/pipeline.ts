// 导入导出管线的接口与驱动器。
//
// 四步：拆包 → 识别 → 解析 → 转换。每步的产物是下步的唯一输入，
// 转换阶段在类型上拿不到原始包，因此不存在「回源包补内容」这条路。
// 导出反向三步：从模型取文档 → 定角色 → 打包。
import type { IniDocument } from "@/ini.ts"
import type { Appearance, BoardKind, Orientation } from "./types.ts"
import type { SkinModel } from "./model.ts"
import type { SkinFormatId } from "./formats/index.ts"

/* —— 1. 拆包 —— */

/** 拆包产物：包里有哪几个文件、各是什么字节。不含任何格式解释。 */
export type SkinPackage = {
  readonly format: SkinFormatId
  readonly files: ReadonlyMap<string, Uint8Array>
}

/* —— 2. 识别 —— */

/**
 * 一个文件在格式里的角色。
 * `unknown` 是显式状态：识别不出来就说识别不出来，由导出方决定报损还是拒绝，
 * 不允许用它当兜底掩盖缺口。
 */
export type FileRole =
  | { kind: "layout"; board: BoardKind; theme: Appearance; orientation: Orientation }
  | { kind: "style"; theme: Appearance }
  | { kind: "info" }
  | { kind: "appearance" }
  | { kind: "motion" }
  | { kind: "sound-config" }
  | { kind: "atlas"; theme: Appearance; orientation: Orientation }
  | { kind: "image" }
  | { kind: "audio"; format?: string }
  | { kind: "font"; family?: string }
  | { kind: "candidate-window" }
  | { kind: "hint-window" }
  | { kind: "handwriting" }
  | { kind: "panel-config" }
  | { kind: "unknown"; reason: string }

/** 识别产物：每个文件的角色，以及包里出现的主题与方向。 */
export type SkinStructure = {
  readonly roles: ReadonlyMap<string, FileRole>
  readonly themes: readonly Appearance[]
  readonly orientations: readonly Orientation[]
}

/* —— 3. 解析 —— */

/** 解析产物：按角色分好桶的文档。解析阶段只拿到角色与字节，拿不到包。 */
export type SkinDocuments = {
  readonly roles: ReadonlyMap<string, FileRole>
  readonly texts: ReadonlyMap<string, IniDocument>
  readonly structs: ReadonlyMap<string, unknown>
  readonly binaries: ReadonlyMap<string, Uint8Array>
}

/* —— 4. 转换 —— */

/**
 * 导入所需的外部输入。
 * 骨架与基础布局是独立提供的基准，不属于任何一个包，因此允许跨阶段使用。
 */
export type ImportHints = {
  readonly skeleton?: Uint8Array
  readonly base?: Uint8Array
}

/** 一个格式的导入四步。 */
export type Importer = {
  unpack(bytes: Uint8Array, hints?: ImportHints): SkinPackage
  identify(pkg: SkinPackage): SkinStructure
  parse(pkg: SkinPackage, structure: SkinStructure): SkinDocuments
  /** 注意签名里没有 `SkinPackage`：转换阶段无法访问原始文件。 */
  toModel(documents: SkinDocuments, hints?: ImportHints): SkinModel | Promise<SkinModel>
}

/** 一个格式的导出三步。 */
export type Exporter = {
  fromModel(model: SkinModel): SkinDocuments
  structure(documents: SkinDocuments): SkinStructure
  pack(documents: SkinDocuments, structure: SkinStructure): SkinPackage
}

/* —— 驱动器 —— */

/**
 * 按顺序驱动四个阶段并返回模型。
 * 中间产物只在本函数栈内存在，返回后除模型外不留任何引用。
 */
export async function importSkin(
  bytes: Uint8Array,
  importer: Importer,
  hints?: ImportHints,
): Promise<SkinModel> {
  const pkg = importer.unpack(bytes, hints)
  const structure = importer.identify(pkg)
  const documents = importer.parse(pkg, structure)
  return await importer.toModel(documents, hints)
}

/** 导出方向同理：模型 → 文档 → 结构 → 包。 */
export function exportSkin(model: SkinModel, exporter: Exporter): SkinPackage {
  const documents = exporter.fromModel(model)
  const structure = exporter.structure(documents)
  return exporter.pack(documents, structure)
}

/** 识别不出来的文件；导出方据此决定报损还是拒绝。 */
export function unknownFiles(structure: SkinStructure): Array<{ path: string; reason: string }> {
  const result: Array<{ path: string; reason: string }> = []
  for (const [path, role] of structure.roles) {
    if (role.kind === "unknown") result.push({ path, reason: role.reason })
  }
  return result
}

/** 按角色统计，便于核对识别是否覆盖了整包。 */
export function roleCounts(structure: SkinStructure): Map<FileRole["kind"], number> {
  const counts = new Map<FileRole["kind"], number>()
  for (const role of structure.roles.values()) counts.set(role.kind, (counts.get(role.kind) ?? 0) + 1)
  return counts
}

/** 从包里取某个角色的所有文件路径。 */
export function pathsWith(structure: SkinStructure, kind: FileRole["kind"]): string[] {
  return [...structure.roles].filter(([, role]) => role.kind === kind).map(([path]) => path)
}
