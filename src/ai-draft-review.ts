import type { AiSkinDraftChange } from "./ai-skin-workspace"
/** Compare parsed JSON, including compact BDA sources; never parse bare property names. */
export function changedJsonSections(before: string, after: string): string[] {
  const left = JSON.parse(before) as Record<string, unknown>
  const right = JSON.parse(after) as Record<string, unknown>
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return []
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
}

export function draftExcerpt(before: string, after: string, limit = 24): { text: string; omitted: boolean } {
  const left = before.split(/\r?\n/)
  const right = after.split(/\r?\n/)
  let first = 0
  while (first < Math.min(left.length, right.length) && left[first] === right[first]) first++
  let tail = 0
  while (tail < Math.min(left.length, right.length) - first && left.at(-1 - tail) === right.at(-1 - tail)) tail++
  const removed = left.slice(first, left.length - tail)
  const added = right.slice(first, right.length - tail)
  const omitted = removed.length > limit || added.length > limit || [...removed, ...added].some((line) => line.length > 500)
  const lines = [`@@ 第 ${first + 1} 行起 · 变更区域 @@`,
    ...removed.slice(0, limit).map((line) => `− ${line.slice(0, 500)}${line.length > 500 ? "…" : ""}`),
    ...added.slice(0, limit).map((line) => `+ ${line.slice(0, 500)}${line.length > 500 ? "…" : ""}`)]
  if (omitted) lines.push("… 摘要已折叠，请展开完整内容核对全部修改。")
  return { text: lines.join("\n"), omitted }
}

/** All model-provided paths and text are rendered literally, not as HTML. */
export function createDraftReview(change: AiSkinDraftChange): HTMLLIElement {
  const item = document.createElement("li")
  const details = document.createElement("details")
  details.open = true
  const head = document.createElement("summary")
  head.className = "ai-draft-file-head"
  const name = document.createElement("span")
  name.textContent = change.path
  name.title = change.path
  const meta = document.createElement("em")
  meta.textContent = change.syntax.toUpperCase()
  head.append(name, meta)
  if (change.syntax === "png") {
    const pair = document.createElement("div")
    pair.className = "ai-draft-images"
    
    for (const [title, bytes] of [["修改前", change.before], ["修改后", change.after]] as const) {
      const figure = document.createElement("figure")
      const image = document.createElement("img")
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }))
      image.src = url
      image.addEventListener("load", () => URL.revokeObjectURL(url), { once: true })
      image.alt = `${change.path} ${title}`
      const caption = document.createElement("figcaption")
      caption.textContent = title
      figure.append(image, caption)
      pair.append(figure)
    }
    details.append(head, pair)
    item.append(details)
    return item
  }
  const diff = document.createElement("pre")
  diff.className = "ai-draft-diff"
  const excerpt = draftExcerpt(change.before, change.after)
  for (const line of excerpt.text.split("\n")) {
    const row = document.createElement(line.startsWith("+ ") ? "ins" : line.startsWith("− ") ? "del" : "span")
    row.textContent = line + "\n"
    diff.append(row)
  }
  const full = document.createElement("details")
  full.className = "ai-draft-full"
  const toggle = document.createElement("summary")
  toggle.textContent = excerpt.omitted ? "查看完整内容（摘要有省略）" : "对照完整修改前 / 修改后"
  full.append(toggle)
  full.addEventListener("toggle", () => {
    if (!full.open || full.childElementCount > 1) return
    for (const [title, text] of [["修改前", change.before], ["修改后", change.after]]) {
      const label = document.createElement("h4")
      label.textContent = title
      const code = document.createElement("pre")
      code.textContent = text
      code.tabIndex = 0
      code.setAttribute("aria-label", `${change.path} ${title}`)
      full.append(label, code)
    }
  })
  details.append(head, diff, full)
  item.append(details)
  return item
}
