// 格式一致性检查：把一个皮肤经 IR 导出到目标格式，再读回来，比对关键计数。
//
// 旧转换器是一条条分支，替换成 IR 之后需要能回答「有没有丢东西」。
// 这里给出可重复的比对：板、按键、样式、图片、动效、音效，以及自检错误数。
import type { LossReport } from "./capability.ts"
import { convertModel, describeLoss } from "./convert.ts"
import type { SkinFormatId } from "./formats/index.ts"
import { openSession, type SkinHints } from "./session.ts"
import type { SkinModel } from "./model.ts"
import { validateModel } from "./validate.ts"

/** 一次往返的计数快照。 */
export type ModelCounts = {
  boards: number
  keys: number
  /** 主键盘的键数：换格式时键盘必须完整，其余板可能表达不了。 */
  mainKeys: number
  styles: number
  images: number
  motions: number
  sounds: number
  errors: number
}

export function countsOf(model: SkinModel): ModelCounts {
  const main = model.boards.find((board) => board.kind === "main") ?? model.boards[0]
  return {
    boards: model.boards.length,
    keys: model.boards.reduce((total, board) => total + board.keys.length, 0),
    mainKeys: main?.keys.length ?? 0,
    styles: model.styles.size,
    images: model.images.size,
    motions: model.motions.size,
    sounds: model.sounds.size,
    errors: validateModel(model).errors,
  }
}

/** 计数差异；正数表示目标格式多、负数表示少。 */
export type CountDelta = Partial<Record<keyof ModelCounts, number>>

export type RoundTripReport = {
  from: SkinFormatId
  to: SkinFormatId
  before: ModelCounts
  after: ModelCounts
  delta: CountDelta
  /** 目标格式表达不了的能力。 */
  loss: LossReport
  /** 必须修的问题；空数组表示这次往返没有丢关键内容。 */
  problems: string[]
  /** 目标格式表达不了的计数变化；如实告知，不影响 `ok`。 */
  notes: string[]
  /** 往返是否通过：只看 `problems`。 */
  ok: boolean
}

function deltaOf(before: ModelCounts, after: ModelCounts): CountDelta {
  const delta: CountDelta = {}
  for (const key of Object.keys(before) as Array<keyof ModelCounts>) {
    const value = after[key] - before[key]
    if (value !== 0) delta[key] = value
  }
  return delta
}

/** 这些计数减少就一定有问题：主键盘与样式必须保住。 */
const REQUIRED: ReadonlyArray<keyof ModelCounts> = ["mainKeys", "styles"]

/** 这些计数减少可能是格式限制：多板、动效、音效、图片。 */
const TOLERATED: ReadonlyArray<keyof ModelCounts> = ["boards", "keys", "motions", "sounds", "images"]

/**
 * 往返的问题分两类：
 * - `problems`：主键盘或样式丢了、源模型本来干净却出现自检错误——必须修；
 * - `notes`：多板、动效、音效这些目标格式表达不了的——如实告知，不算失败。
 * 源模型本身就有自检错误时（例如官方基础布局没有样式），不把错误数变化算成问题。
 */
function problemsOf(delta: CountDelta, before: ModelCounts, after: ModelCounts): { problems: string[]; notes: string[] } {
  const problems: string[] = []
  const notes: string[] = []
  for (const key of REQUIRED) {
    const value = delta[key]
    if (value !== undefined && value < 0) problems.push(`${key} 少了 ${-value}`)
  }
  for (const key of TOLERATED) {
    const value = delta[key]
    if (value !== undefined && value < 0) notes.push(`${key} 少了 ${-value}（目标格式表达不了）`)
  }
  if (before.errors === 0 && after.errors > 0) problems.push(`导出后自检有 ${after.errors} 个错误`)
  return { problems, notes }
}

/**
 * 走一次往返：读源包、写成目标格式、再读回来。
 * 目标格式读不回来时不算通过，原因写进 problems。
 */
export async function checkRoundTrip(
  archive: Parameters<typeof openSession>[0],
  target: SkinFormatId,
  hints: SkinHints = {},
): Promise<RoundTripReport | undefined> {
  const opened = await openSession(archive, hints)
  if (!opened.ok) return
  const before = countsOf(opened.model)

  let converted
  try {
    converted = await convertModel(opened.model, target, opened.format)
  } catch (error) {
    return {
      from: opened.format,
      to: target,
      before,
      after: before,
      delta: {},
      loss: { items: [] },
      problems: [`导出失败：${error instanceof Error ? error.message : String(error)}`],
      notes: [],
      ok: false,
    }
  }

  // 目标格式需要同样的外部输入才能读回（BDA 要布局骨架、搜狗要官方骨架）。
  const reopened = await openSession(converted.output, hints)
  if (!reopened.ok) {
    return {
      from: opened.format,
      to: target,
      before,
      after: before,
      delta: {},
      loss: converted.loss,
      problems: [`目标格式读不回来：${reopened.error.message}`],
      notes: [],
      ok: false,
    }
  }

  const after = countsOf(reopened.model)
  const delta = deltaOf(before, after)
  const { problems, notes } = problemsOf(delta, before, after)
  return {
    from: opened.format,
    to: target,
    before,
    after,
    delta,
    loss: converted.loss,
    problems,
    notes,
    ok: problems.length === 0,
  }
}

/** 一次往返的一句话结论。 */
export function summarizeRoundTrip(report: RoundTripReport): string {
  const head = `${report.from} → ${report.to}`
  if (!report.ok) return `${head}：${report.problems.join("；")}`
  const losses = describeLoss(report.loss)
  return losses.length ? `${head}：通过，损失 ${losses.length} 项` : `${head}：通过，无损`
}

/**
 * 对一个包跑一组目标格式。
 * 失败的目标不会中断后面的检查，便于一次看全。
 */
export async function checkTargets(
  archive: Parameters<typeof openSession>[0],
  targets: readonly SkinFormatId[],
  hints: SkinHints = {},
): Promise<RoundTripReport[]> {
  const reports: RoundTripReport[] = []
  for (const target of targets) {
    const report = await checkRoundTrip(archive, target, hints)
    if (report) reports.push(report)
  }
  return reports
}
