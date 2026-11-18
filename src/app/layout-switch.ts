// 画布工具栏的布局切换：列出当前文档里实际存在的布局。
//
// 下拉的值一直是布局文件名（`py_26.ini`），多处按
// `${theme}/skin/${orientation}/${layout.value}` 拼路径，所以这里只换选项与显隐，
// 不改值的形式；切换时用当前布局所在目录拼回完整路径。
//
// 全部是纯函数：归档与当前路径由调用方传入，界面只负责把结果画出来。
import { bdsBoardName, isBdsLayoutPath, orientationOf } from "@/skin-model/board-paths.ts"

/** 一个可切换的布局。 */
export type LayoutChoice = {
  /** 布局文件名，与下拉的既有取值一致。 */
  name: string
  label: string
}

/** 只读文件名列表，够用即可，避免把整个归档类型带进来。 */
export type LayoutSource = {
  names(): readonly string[]
}

const BOARD_LABELS: Readonly<Record<string, string>> = {
  py_9: "9 键",
  py_26: "26 键",
  py_31: "31 键",
  py_36: "36 键",
  sym: "符号",
  sel_ch: "候选",
}

/** 布局文件换成给人看的名字。 */
export function layoutLabel(name: string): string {
  return BOARD_LABELS[name] ?? name
}

/**
 * 当前文档里可以切换的布局。
 * 只认同方向的布局：横屏皮肤切到竖屏布局没有意义。
 */
export function layoutChoices(archive: LayoutSource | undefined, currentPath: string): LayoutChoice[] {
  if (!archive) return []
  const names = archive.names().filter(isBdsLayoutPath)
  const orientation = orientationOf(currentPath) ?? orientationOf(names[0] ?? "")
  const boards = new Set<string>()
  for (const path of names) {
    if (orientation !== undefined && orientationOf(path) !== orientation) continue
    const name = bdsBoardName(path)
    if (name) boards.add(name)
  }
  return [...boards].map((name) => ({ name: `${name}.ini`, label: layoutLabel(name) }))
}

/** 把文件名换成可切换的完整路径：沿用当前布局所在目录。 */
export function layoutPathOf(currentPath: string, name: string): string | undefined {
  if (!currentPath.includes("/")) return undefined
  return currentPath.replace(/[^/]+$/, name)
}

/**
 * 按当前文档刷新布局下拉。
 * 只有一份布局时不显示；选项内容没变就不重建，避免打断用户展开的下拉。
 */
export function syncLayoutChoices(select: HTMLSelectElement, archive: LayoutSource | undefined, currentPath: string): void {
  const choices = layoutChoices(archive, currentPath)
  if (!choices.length) {
    select.hidden = true
    return
  }
  const signature = choices.map((choice) => `${choice.name}:${choice.label}`).join("|")
  if (select.dataset.choiceSignature !== signature) {
    select.replaceChildren(...choices.map(({ name, label }) => {
      const option = document.createElement("option")
      option.value = name
      option.textContent = label
      return option
    }))
    select.dataset.choiceSignature = signature
  }
  // 当前布局不在选项里时保留原值，不悄悄换成别的布局。
  const current = currentPath.split("/").pop() ?? ""
  if (choices.some((choice) => choice.name === current)) select.value = current
  select.hidden = choices.length <= 1
}
