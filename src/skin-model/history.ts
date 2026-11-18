// 模型历史：撤销与重做。
//
// 编辑器现在的撤销栈存文件内容快照。模型是不可变的，每次编辑返回新模型，
// 直接留引用即可，既能做细粒度撤销，也能给出这一版改了什么。
import { diffModels, describeDiff, diffSize, isEmptyDiff } from "./compare.ts"
import type { SkinModel } from "./model.ts"

/** 历史里的一版。 */
export type HistoryEntry = {
  model: SkinModel
  /** 相对上一版的改动描述；第一个版本没有上一版。 */
  label: string
  /** 改动数量，用于列表角标。 */
  size: number
}

export type HistoryOptions = {
  /** 最多保留多少版；超出后丢弃最早的。 */
  limit?: number
}

const DEFAULT_LIMIT = 200

export class ModelHistory {
  private entries: HistoryEntry[] = []
  private index = -1
  private readonly limit: number

  constructor(model: SkinModel, options: HistoryOptions = {}) {
    this.limit = options.limit ?? DEFAULT_LIMIT
    this.entries = [{ model, label: "打开", size: 0 }]
    this.index = 0
  }

  /** 当前模型。 */
  get current(): SkinModel {
    return this.entries[this.index].model
  }

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1
  }

  /** 全部版本的摘要，新的在前。 */
  get list(): ReadonlyArray<{ label: string; size: number; active: boolean }> {
    return this.entries.map((entry, position) => ({
      label: entry.label,
      size: entry.size,
      active: position === this.index,
    })).reverse()
  }

  /**
   * 记录一版。
   * 与当前模型没有差别时不记录，返回 false——避免空改动占满历史。
   */
  push(model: SkinModel): boolean {
    if (model === this.current) return false
    const diff = diffModels(this.current, model)
    if (isEmptyDiff(diff)) return false
    // 在中间位置编辑会丢掉后面的重做分支，这与编辑器的常见行为一致。
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push({ model, label: describeDiff(diff), size: diffSize(diff) })
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit)
    this.index = this.entries.length - 1
    return true
  }

  /** 回到上一版；没有可回退的返回 undefined。 */
  undo(): SkinModel | undefined {
    if (!this.canUndo) return
    this.index -= 1
    return this.current
  }

  /** 前进一版；没有可重做的返回 undefined。 */
  redo(): SkinModel | undefined {
    if (!this.canRedo) return
    this.index += 1
    return this.current
  }

  /**
   * 跳到指定版本（按列表顺序，0 是最新）。
   * 越界时不动，返回当前模型。
   */
  jump(position: number): SkinModel {
    const target = this.entries.length - 1 - position
    if (target < 0 || target >= this.entries.length) return this.current
    this.index = target
    return this.current
  }

  /** 换成另一份文档：清空历史，只留一个起点。 */
  reset(model: SkinModel): void {
    this.entries = [{ model, label: "打开", size: 0 }]
    this.index = 0
  }
}
