// 检查器与模型之间的桥接：取值、自检提示，以及把界面改动换算成模型改动。
//
// 这里承担两件事：界面字段名到模型字段名的对照（外部表示与内部模型的边界转换），
// 以及「算不出模型改动就交回调用方作废重建」的约定。检查器本身只管渲染。
import type { SkinModel } from "@/skin-model/model.ts"
import type { SkinMeta } from "@/skin-model/types.ts"
import { applyFieldChange } from "@/skin-model/edit-binding.ts"
import { patchKey, setBoardBackdrop, setMeta } from "@/skin-model/edit.ts"
import { validateModel } from "@/skin-model/validate.ts"
import type { BoardTraits } from "./board-traits"
import { boardTraits } from "./board-traits"
import { skinModel } from "./skin-model-state"
import { appState } from "./state"

/** 每个按键的自检问题，按模型缓存；模型换了一份就重算。 */
const issueCache = new WeakMap<object, Map<string, string>>()

/** 选中按键的第一个自检问题；没有问题时返回 undefined。 */
export function keyIssue(keyId: string | undefined): string | undefined {
  const model = skinModel.model
  if (!model || keyId === undefined) return
  let map = issueCache.get(model)
  if (!map) {
    map = new Map()
    for (const issue of validateModel(model).issues) {
      if (!map.has(issue.subject)) map.set(issue.subject, issue.message)
    }
    issueCache.set(model, map)
  }
  return map.get(keyId)
}

/** 当前板的可编辑能力；模型没建好时按格式保守判断。 */
export function currentTraits(): BoardTraits {
  return boardTraits(appState.layoutPath, undefined, appState.archive?.format)
}

/** 当前布局里每个按键的几何，来自模型；模型还没建好时为空，调用方退回读文档。 */
export function modelRectMap(): Map<string, number[]> {
  const rects = new Map<string, number[]>()
  const model = skinModel.model
  if (!model) return rects
  const board = model.boards.find((item) => item.id === appState.layoutPath)
  for (const key of board?.keys ?? []) {
    rects.set(key.id, [key.rect.position.x, key.rect.position.y, key.rect.size.width, key.rect.size.height])
  }
  return rects
}

/** 面板背景样式改动后的模型；模型里没有这块板时返回 undefined，让提交入口作废重建。 */
export function modelAfterBackdrop(style: string): SkinModel | undefined {
  const current = skinModel.model
  if (!current || !current.boards.some((board) => board.id === appState.layoutPath)) return
  return setBoardBackdrop(current, appState.layoutPath, style.trim() || null)
}

/** 皮肤信息字段到模型元信息的对照。 */
const META_FIELDS: Readonly<Record<string, keyof SkinMeta>> = {
  Name: "name",
  Author: "author",
  Version: "version",
  Description: "description",
}

/** 皮肤信息改动后的模型；不认识的字段返回 undefined，让提交入口作废重建。 */
export function modelAfterSkinInfo(name: string, value: string): SkinModel | undefined {
  const field = META_FIELDS[name]
  const current = skinModel.model
  if (!current || field === undefined) return
  return setMeta(current, { [field]: value })
}

/** 文档字段名到模型字段名的对照：只有这些字段能从文本改动推出模型改动。 */
const MODEL_FIELDS: Readonly<Record<string, string>> = {
  CENTER: "action.press",
  HOLD: "action.long-press",
  UP: "action.swipe-up",
  DOWN: "action.swipe-down",
  LEFT: "action.swipe-left",
  RIGHT: "action.swipe-right",
  BACK_STYLE: "style.back",
  HL_BACK_STYLE: "style.pressedBack",
}

/**
 * 字段改动后的模型。
 * 只处理能一一对应的字段；其余（文字、状态样式）返回 undefined，让提交入口作废重建。
 */
export function modelAfterFieldEdit(sections: readonly string[], name: string, value: string): SkinModel | undefined {
  const current = skinModel.model
  if (!current) return
  let next = current
  if (name.startsWith("PADDING.")) {
    // 内边距按分量写：左、上、右、下，缺省补零。
    const index = Number(name.split(".")[1])
    const number = Number(value)
    if (!Number.isFinite(number) || index < 0 || index > 3) return
    for (const section of sections) {
      const key = current.boards.find((board) => board.id === appState.layoutPath)?.keys.find((item) => item.id === section)
      const parts: [number, number, number, number] = [
        key?.padding?.left ?? 0, key?.padding?.top ?? 0, key?.padding?.right ?? 0, key?.padding?.bottom ?? 0,
      ]
      parts[index] = number
      next = patchKey(next, appState.layoutPath, section, {
        padding: { left: parts[0], top: parts[1], right: parts[2], bottom: parts[3] },
      })
    }
    return next === current ? undefined : next
  }
  const field = MODEL_FIELDS[name]
  if (field === undefined) return
  for (const section of sections) {
    next = applyFieldChange(next, { boardId: appState.layoutPath, keyId: section, field, value })
  }
  return next === current ? undefined : next
}
