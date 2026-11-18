// 当前文档的 IR 模型：打开时构建，改动后按需重建。
//
// 模型是只读快照——它描述「这个皮肤包现在是什么样」，不承载用户编辑。
// 编辑仍然改归档里的 INI；改完把档案标记为过期，下次读模型时重建。
// 这样编辑路径不必一次迁移完，而读模型的地方（自检、导出、AI 设计）已经能用上。
import type { SkinArchive } from "@/skin.ts"
import type { SkinFormatId } from "@/skin-model/formats/index.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import { openSession, type SessionError, type SkinHints } from "@/skin-model/session.ts"
import { validateModel, type ValidationReport } from "@/skin-model/validate.ts"

export type ModelStatus =
  | { state: "empty" }
  | { state: "loading" }
  | { state: "ready"; model: SkinModel; format: SkinFormatId; report: ValidationReport }
  | { state: "unavailable"; error: SessionError }

export type ModelSnapshot = {
  /** 快照对应的归档实例；归档换了就是另一份文档。 */
  archive: SkinArchive
  /** 归档的修订号，用来判断快照是否过期。 */
  revision: number
  model: SkinModel
  format: SkinFormatId
  report: ValidationReport
}

/** 归档每次改写都会加一；没有修订号的实现返回 0，此时只按实例判断。 */
export function revisionOf(archive: SkinArchive): number {
  const value = (archive as unknown as { revision?: unknown }).revision
  return typeof value === "number" ? value : 0
}

export class SkinModelState {
  private status: ModelStatus = { state: "empty" }
  private snapshot: ModelSnapshot | undefined
  private pending: Promise<void> | undefined

  /** 当前状态；只读。 */
  get current(): ModelStatus {
    return this.status
  }

  /** 当前可用的模型；没构建好时返回 undefined。 */
  get model(): SkinModel | undefined {
    return this.snapshot?.model
  }

  /** 打开新文档时清空，避免拿到上一份皮肤的模型。 */
  reset(): void {
    this.snapshot = undefined
    this.pending = undefined
    this.status = { state: "empty" }
  }

  /** 归档被改写后调用：快照作废，下次读取时重建。 */
  invalidate(): void {
    if (this.status.state === "empty") return
    this.snapshot = undefined
    this.status = { state: "empty" }
  }

  /** 快照是否仍然对应当前归档与修订。 */
  private fresh(archive: SkinArchive): boolean {
    return this.snapshot !== undefined
      && this.snapshot.archive === archive
      && this.snapshot.revision === revisionOf(archive)
  }

  /**
   * 取模型：已经是最新就直接返回，否则重建。
   * 并发调用共享同一次构建，不重复解析。
   */
  async load(archive: SkinArchive, hints: SkinHints = {}): Promise<ModelStatus> {
    if (this.fresh(archive)) return this.status
    if (this.pending) {
      await this.pending
      return this.status
    }
    this.status = { state: "loading" }
    this.pending = this.build(archive, hints)
    try {
      await this.pending
    } finally {
      this.pending = undefined
    }
    return this.status
  }

  private async build(archive: SkinArchive, hints: SkinHints): Promise<void> {
    const opened = await openSession(archive, hints)
    if (!opened.ok) {
      this.snapshot = undefined
      this.status = { state: "unavailable", error: opened.error }
      return
    }
    const report = validateModel(opened.model)
    this.snapshot = { archive, revision: revisionOf(archive), model: opened.model, format: opened.format, report }
    this.status = { state: "ready", model: opened.model, format: opened.format, report }
  }

  /** 模型自检的报告；没有模型时返回 undefined。 */
  get report(): ValidationReport | undefined {
    return this.snapshot?.report
  }

  /** 这份文档能不能无损导出到目标格式；没有模型时返回 undefined。 */
  canExportTo(target: SkinFormatId): boolean | undefined {
    if (!this.snapshot) return
    return this.snapshot.format === target
  }
}

/** 整个应用共用一份；测试里可以各自新建。 */
export const skinModel = new SkinModelState()
