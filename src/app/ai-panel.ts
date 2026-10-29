import { SkinArchive } from "../skin.ts"
import { type AiSkinEditableFile, type AiSkinDraftChange } from "../ai-skin-workspace.ts"
import { bdaConfigPath } from "../bda.ts"
import { bdaDecodedSourceEditable, decodedBdaEditorSource, applyDecodedBdaSource } from "../bda-source.ts"
import { theme, orientation, previewCanvas, selectedKeyName, aiContextKey, aiContextPreview, aiDesignModel, aiDesignPanel, aiDesignStatus, documentName, layout, device, aiDesignThinking, aiDraftPanel, aiDesignChat, aiDraftFiles, aiDraftSummary, aiNewSession, aiDraftApply, aiDraftCancel, aiModelSettings, aiDesignIntensity, aiDesignScope, $ } from "./dom"
import { appState } from "./state"
import { preferredPath, refreshBdaLayout } from "./bda-documents"
import { genConfigPath, styleConfigPath, effectiveKeyValue } from "./config-context"
import { type AiSkinImageFile } from "../ai-skin-images.ts"
import { type Change } from "../history.ts"
import { type AiChatRunHooks, type AiChatRunResult, type AiChatController } from "../ai-chat.ts"
import { isTauri, source, currentDeviceValue, preview } from "./canvas-interaction"
import { isEditing, commitBatch, updateDirty } from "./edit-history"
import { type AiDraftVariant, type AiDraft } from "./types"
import { changedJsonSections, createDraftReview } from "../ai-draft-review"
import { IniDocument } from "../ini.ts"
import { renderFiles } from "./file-tree"
import { selectFile } from "./navigation"
import { keyboardSnapshot, refreshPreview } from "./preview-render"
import { populateKeyInspector } from "./key-inspector"
import { type ModelConfiguration, groupModelConfigurations, modelHost, modelConfigurationKey, initializeModelSettings } from "../model-settings.ts"
import { modelProviderPreset } from "../model-providers.ts"
import { symbolSpan } from "../icons"
import { ssfSelectedBindings, ssfSkinPath, ssfThemeFolder, SSF_SOUNDS_PATH } from "./ssf-documents"
import { SXI_SKIN_PATH, applySxiFragments, parseSkinJson, sxiAddressPointer, sxiFragment, sxiFragmentPath } from "../palm/sxi-json.ts"
import { sxiPartAddresses } from "../palm/sxi-panel-copy.ts"
import { palmOrientation, palmTheme, PALM_SHARED_BOARD, sxiBoardAddress, sxiPointer } from "./sxi-documents"
import { palmTileSlices } from "../palm/palm-style-edit.ts"
import { tileSlices } from "../tiles.ts"

/** Files a panel-scoped request may change: a Sogou look keeps every key class in its own folder. */
function aiPanelFiles(target: SkinArchive): Set<string | undefined> {
  if (target.format === "ssf") {
    const folder = ssfThemeFolder()
    return new Set([`${folder}phoneSkin.ini`, `${folder}keys.ini`, `${folder}anim.ini`, SSF_SOUNDS_PATH])
  }
  const panelConfig = target.format === "bda"
    ? bdaConfigPath(target, theme.value, orientation.value, "appearance")
    : appState.layoutPath || appState.selectedPath || preferredPath()
  // 面板范围同时授权它引用的全局配置与样式表：按键文字、字体、颜色都定义在样式表里。
  return new Set([panelConfig, ...target.format === "bda" ? [] : [genConfigPath(), styleConfigPath()]])
}

export function aiEditableProjectFiles(target: SkinArchive, scope: "panel" | "project" = "project"): AiSkinEditableFile[] {
  if (target.format === "sxi") return sxiEditableFragments(target, scope)
  const panelFiles = aiPanelFiles(target)
  return target.names().flatMap((path) => {
    if (scope === "panel" && !panelFiles.has(path)) return []
    if (target.format === "bda") {
      if (!target.isBdaConfig(path) || !bdaDecodedSourceEditable(path)) return []
      const bytes = target.getBytes(path)
      if (!bytes) return []
      try {
        return [{ path, syntax: "json" as const, text: decodedBdaEditorSource(path, bytes) }]
      } catch {
        return []
      }
    }
    if (!target.isText(path) || !/\.(?:ini|css|json)$/i.test(path)) return []
    return [{ path, syntax: /\.json$/i.test(path) ? "json" as const : "ini" as const, text: target.getText(path) }]
  })
}

// SXI is granted as skin.json parts (boards, bars, bubbles, style and animation tables, tile maps). The
// panel scope is the open board, the boards' shared settings and the style tables they draw with; the
// project scope stays within the current theme and orientation so it fits the workspace limits.
function sxiEditableFragments(target: SkinArchive, scope: "panel" | "project"): AiSkinEditableFile[] {
  const text = target.getText(SXI_SKIN_PATH)
  const skin = parseSkinJson(text)
  const themeKey = palmTheme()
  const tables = ["s_info", `s_${palmOrientation()}`]
  const board = sxiPointer(appState.layoutPath)
  const panel = new Set([board && sxiFragmentPath(board), sxiBoardAddress(PALM_SHARED_BOARD), ...tables.map((table) => sxiFragmentPath([themeKey, table, "ss_1"]))])
  return sxiPartAddresses(text).flatMap((path) => {
    const pointer = sxiAddressPointer(path)!
    const granted = scope === "panel" ? panel.has(path) : pointer[0] === themeKey && [`${palmOrientation()}_layout`, ...tables].includes(pointer[1])
    return granted ? [{ path, syntax: "json" as const, text: JSON.stringify(sxiFragment(skin, pointer), null, 2) }] : []
  })
}

/** A Palm package's skin.json, or nothing when it does not parse. */
function skinOf(target: SkinArchive) {
  try {
    return parseSkinJson(target.getText(SXI_SKIN_PATH))
  } catch {
    return undefined
  }
}

/** PNGs beside the panel's style sheet (or every PNG for project scope), with their slices. */
export function aiEditableProjectImages(target: SkinArchive, scope: "panel" | "project" = "project"): AiSkinImageFile[] {
  if (target.format === "bda") return []
  const folders = target.format === "ssf" ? [ssfThemeFolder() ?? ""]
    : target.format === "sxi" ? [`${theme.value}/skin/${orientation.value}/res/`, `${theme.value}/skin/res/`]
    : [styleConfigPath().replace(/[^/]*$/, ""), `${theme.value}/skin/res/`]
  const skin = target.format === "sxi" ? skinOf(target) : undefined
  return target.names().flatMap((path) => {
    if (!target.isImage(path) || !/\.png$/i.test(path) || scope === "panel" && !folders.some((folder) => path.startsWith(folder) && !path.slice(folder.length).includes("/"))) return []
    const tilPath = path.replace(/\.png$/i, ".til")
    const slices = skin ? palmTileSlices(skin, path)
      : target.isText(tilPath) ? tileSlices(IniDocument.parse(target.getText(tilPath))) : undefined
    return [{ path, bytes: target.getBytes(path)!, slices }]
  })
}

function aiWantsWholeProject(prompt: string): boolean {
  return /整个皮肤|全局|所有面板|全部面板|所有主题|全部主题|全项目|整个项目|全局修改/i.test(prompt)
}

function aiWantsVariants(prompt: string): boolean {
  return /多版|几版|几个方案|多个方案|多套方案|[三3]\s*个方案|不同方向|方案选择/i.test(prompt)
}

/** The scope chip: the current panel (default) or the whole skin. */
export function setAiDesignScope(project: boolean): void {
  aiDesignScope.setAttribute("aria-pressed", String(project))
  aiDesignScope.textContent = project ? "整个皮肤" : "当前面板"
  aiDesignScope.title = project ? "AI 可以修改整个皮肤的所有面板，点击改为只改当前面板" : "AI 只修改当前面板及其引用的样式，点击改为整个皮肤"
}

function aiPreviewImage(): { type: "image"; data: string; mimeType: string } | undefined {
  try {
    const url = keyboardSnapshot(theme.value === "dark" ? "#17191f" : "#f6f7f9")?.toDataURL("image/png")
    const comma = url?.indexOf(",") ?? -1
    if (!url || comma < 0) return
    return { type: "image", mimeType: "image/png", data: url.slice(comma + 1) }
  } catch {
    return
  }
}

function aiSelectedKeyContext(): { label: string; sections: string[]; values: Record<string, string> } {
  if (appState.archive?.format === "ssf") {
    // A Sogou key is styled by its classes; the canvas key sections belong to the skeleton board.
    const sections = ssfSelectedBindings().flatMap(({ binding }) => binding.sections)
    return { label: selectedKeyName.textContent?.trim() ?? "", sections: [...new Set(sections)], values: {} }
  }
  const sections = appState.selectedKeySections.slice()
  const keys = ["BACK_STYLE", "FORE_STYLE", "FONT_NAME", "FONT_SIZE", "NM_COLOR", "HL_COLOR", "CENTER", "CLICK", "LONG_CLICK", "SWIPE"]
  const values: Record<string, string> = {}
  for (const key of keys) {
    const value = sections.length ? effectiveKeyValue(sections[0], key) : undefined
    if (value !== undefined) values[key] = value
  }
  return { label: selectedKeyName.textContent?.trim() ?? "", sections, values }
}

export function syncAiDesignContext(): void {
  aiContextKey.hidden = appState.selectedKeySections.length === 0
  aiContextKey.textContent = appState.selectedKeySections.length > 1
    ? `${appState.selectedKeySections.length} 个按键`
    : `${selectedKeyName.textContent?.trim() || "按键"} · ${aiSelectedKeyContext().sections[0] ?? appState.selectedKeySections[0] ?? ""}`
  const available = Boolean(appState.archive && previewCanvas.width && previewCanvas.height)
  aiContextPreview.textContent = available ? "画布" : "暂无画布"
  aiContextPreview.dataset.off = String(!available)
  syncAiDesignControls()
}

export function validatedAiChanges(target: SkinArchive, drafts: readonly AiSkinDraftChange[]): Change[] {
  const allowed = new Map(aiEditableProjectFiles(target).map((file) => [file.path, file]))
  const images = new Set(aiEditableProjectImages(target).map((image) => image.path))
  const seen = new Set<string>()
  const fragments: Array<{ path: string; text: string }> = []
  const changes = drafts.flatMap<Change>((draft): Change[] => {
    if (seen.has(draft.path)) throw new Error(`AI 返回了重复修改：${draft.path}`)
    seen.add(draft.path)
    if (draft.syntax === "png") {
      if (!images.has(draft.path)) throw new Error(`AI 修改了未授权图片：${draft.path}`)
      const before = target.getBytes(draft.path)!
      if (!sameBytes(before, draft.before)) throw new Error(`AI 运行期间图片已变化：${draft.path}`)
      return [{ kind: "bytes" as const, path: draft.path, before: before.slice(), after: draft.after.slice() }]
    }
    const editable = allowed.get(draft.path)
    if (!editable || editable.syntax !== draft.syntax) throw new Error(`AI 修改了未授权文件：${draft.path}`)
    if (editable.text !== draft.before) throw new Error(`AI 运行期间文件已变化：${draft.path}`)
    if (draft.before === draft.after) return []
    if (target.format === "sxi") {
      fragments.push({ path: draft.path, text: draft.after })
      return []
    }
    if (target.format !== "bda") {
      return [{ kind: "text" as const, path: draft.path, before: draft.before, after: draft.after }]
    }
    const before = target.getBytes(draft.path)
    if (!before) throw new Error(`文件已不存在：${draft.path}`)
    const after = applyDecodedBdaSource(draft.path, before, draft.after)
    return [{ kind: "bytes" as const, path: draft.path, before: before.slice(), after }]
  })
  if (!fragments.length) return changes
  const before = target.getText(SXI_SKIN_PATH)
  return [...changes, { kind: "text", path: SXI_SKIN_PATH, before, after: applySxiFragments(before, fragments) }]
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

export function aiDesignErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const normalized = raw.toLowerCase()
  if (normalized.includes("connection error") || normalized.includes("failed to fetch") || normalized.includes("networkerror")) {
    return "无法连接模型服务。请在设置 > AI 模型中检查 API 地址、模型名称和密钥。"
  }
  if (normalized.includes("401") || normalized.includes("unauthorized") || normalized.includes("api key")) {
    return "模型服务拒绝了请求，请检查 API 密钥是否正确或已过期。"
  }
  if (normalized.includes("404") || normalized.includes("not found")) {
    return "找不到模型接口，请检查 API 地址和协议类型是否匹配。"
  }
  if (normalized.includes("server_error") || normalized.includes("overloaded")
    || normalized.includes("429") || normalized.includes("503") || normalized.includes("529")) {
    return "模型服务当前繁忙，请稍后重试。"
  }
  return `AI 设计失败：${raw}`
}

async function runAiDesignRequest(prompt: string, hooks: AiChatRunHooks, files: readonly File[]): Promise<AiChatRunResult> {
  if (!isTauri()) {
    throw new Error("AI 设计当前仅在桌面应用中可用。")
  }
  if (!appState.archive) {
    throw new Error("请先打开一个皮肤项目。")
  }
  if (!isEditing()) {
    throw new Error("请先切换到编辑模式。")
  }
  if (!prompt.trim()) throw new Error("请填写设计要求。")
  if (appState.aiDesignBusy) throw new Error("上一轮设计尚未结束，请稍候。")
  if (appState.aiDesignDraft) throw new Error("请先应用或丢弃待确认的草稿，再继续对话。")
  source.commit()
  const target = appState.archive
  const configuration = appState.savedModels[Number(aiDesignModel.value)]
  if (!configuration) {
    throw new Error("请先配置 AI 模型。")
  }
  if (appState.aiDesignConversationTarget !== target) {
    appState.aiDesignConversationTarget = target
    appState.aiDesignConversation = []
  }
  appState.aiDesignBusy = true
  // Progress lives in the conversation timeline; the status line only reports outcomes.
  aiDesignPanel.dataset.state = "running"
  aiDesignStatus.textContent = ""
  syncAiDesignControls()
  try {
    if (aiWantsWholeProject(prompt)) setAiDesignScope(true)
    const panelScope = aiDesignScope.getAttribute("aria-pressed") === "true" ? "project" as const : "panel" as const
    const mode = aiDesignIntensity.value
    const variantCount = mode === "variants" || aiWantsVariants(prompt) ? 3 : 1
    const sxiPanel = sxiPointer(appState.layoutPath)
    const panelPath = target.format === "bda"
      ? bdaConfigPath(target, theme.value, orientation.value, "appearance") ?? appState.layoutPath
      : target.format === "ssf" ? ssfSkinPath() ?? appState.selectedPath
        : sxiPanel ? sxiFragmentPath(sxiPanel) : appState.layoutPath || appState.selectedPath || preferredPath()
    const project = {
      format: target.format,
      skinName: documentName.textContent?.trim() ?? "",
      skinPath: appState.currentPath.split(/[\\/]/).pop() ?? "",
      theme: theme.value,
      orientation: orientation.value,
      layout: layout.value,
      keyboard: device.options[device.selectedIndex]?.textContent?.trim() || currentDeviceValue(),
      panelPath,
      panelScope,
      selectedKey: aiSelectedKeyContext(),
      preview: aiPreviewImage(),
      files: aiEditableProjectFiles(target, panelScope),
      images: aiEditableProjectImages(target, panelScope),
    }
    const { aiDesignAttachments, runAiSkinDesign } = await import("../ai-design.ts")
    const attachments = files.length ? await aiDesignAttachments(files) : undefined
    const result = await runAiSkinDesign(configuration, project, prompt, {
      imageModel: appState.savedImageModel,
      attachments,
      history: appState.aiDesignConversation,
      variantCount,
      intensity: mode === "refine" || mode === "bold" ? mode : "balanced",
      thinkingLevel: aiDesignThinking.value as "off" | "low" | "medium" | "high",
      signal: hooks.signal,
      onStatus: async (kind, text) => {
        if (hooks.signal.aborted || appState.archive !== target) return
        await hooks.onStatus?.(text, kind)
      },
      onTextDelta: hooks.onTextDelta,
      onThinking: hooks.onThinking,
    })
    if (hooks.signal.aborted) throw new DOMException("AI 设计已取消", "AbortError")
    if (appState.archive !== target) throw new Error("AI 运行期间已切换皮肤项目，本轮草稿未应用")
    if (!isEditing()) throw new Error("已退出编辑模式，本轮草稿未应用")
    if (result.variants?.length) {
      const variants = result.variants.flatMap<AiDraftVariant>((variant) => {
        try {
          const changes = validatedAiChanges(target, variant.changes)
          return [{
            id: variant.id,
            title: variant.title,
            changes,
            drafts: variant.changes,
            sections: aiDraftSections(variant.changes),
            conversation: variant.conversation,
            response: variant.response,
          }]
        } catch (error) {
          throw new Error(`${variant.title}：${aiDesignErrorMessage(error)}`)
        }
      })
      setAiDesignDraft({
        target,
        changes: [],
        drafts: [],
        sections: [],
        conversation: [],
        response: "",
        variants,
      })
      return {
        fallback: `已生成 ${variants.length} 个设计方向，请选择一个方案预览并应用。`,
        summary: "方案已就绪 · 选择后才会写入皮肤",
      }
    }
    const changes = validatedAiChanges(target, result.changes)
    if (!changes.length) {
      appState.aiDesignConversation = result.conversation
      aiDesignPanel.dataset.state = "done"
      aiDesignStatus.textContent = "分析完成 · 没有文件修改"
      return { fallback: result.response || "AI 分析完成，没有需要应用的修改。" }
    }
    // Keep the committed conversation unchanged until the user accepts the draft.
    setAiDesignDraft({
      target,
      changes,
      drafts: result.changes,
      sections: aiDraftSections(result.changes),
      conversation: result.conversation,
      response: result.response,
    })
    return {
      fallback: result.response,
      summary: `已生成 ${changes.length} 个文件的草稿，审阅后应用。`,
    }
  } catch (error) {
    if (appState.archive === target) {
      aiDesignPanel.dataset.state = hooks.signal.aborted ? "stopped" : "error"
      // The conversation already shows the error; repeating it above reads as a second failure.
      aiDesignStatus.textContent = hooks.signal.aborted ? "已停止 · 未应用任何修改" : ""
    }
    if (hooks.signal.aborted) throw error
    throw new Error(aiDesignErrorMessage(error))
  } finally {
    appState.aiDesignBusy = false
    syncAiDesignControls()
  }
}

/**
 * Derives the canvas sections an AI draft would touch, by comparing the INI
 * sections (or JSON keys) present before and after each proposed file change.
 */
function aiDraftSections(changes: readonly AiSkinDraftChange[]): string[] {
  const sections = new Set<string>()
  for (const change of changes) {
    if (change.syntax === "png") continue
    if (change.syntax === "json") {
      for (const key of changedJsonSections(change.before, change.after)) sections.add(key)
      continue
    }
    const before = new Map(iniSectionTexts(change.before))
    const after = new Map(iniSectionTexts(change.after))
    for (const [name, text] of after) {
      if (before.get(name) !== text) sections.add(name)
    }
    for (const name of before.keys()) if (!after.has(name)) sections.add(name)
  }
  return [...sections]
}

function iniSectionTexts(source: string): Array<[string, string]> {
  const headers = [...source.matchAll(/^\s*\[([^\]]+)]\s*$/gm)]
  return headers.map((header, index) => [
    header[1],
    source.slice(header.index ?? 0, headers[index + 1]?.index ?? source.length),
  ])
}

function createAiVariantReview(variant: AiDraftVariant, index: number): HTMLLIElement {
  const item = document.createElement("li")
  item.className = "ai-variant-card"
  const button = document.createElement("button")
  button.type = "button"
  button.className = "ai-variant-select"
  button.dataset.variantId = variant.id
  button.innerHTML = `<span class="ai-variant-index">${index + 1}</span><span class="ai-variant-copy"><strong></strong><small></small></span><span class="system-symbol" data-system-symbol="chevron.right" aria-hidden="true"></span>`
  button.querySelector("strong")!.textContent = variant.title
  button.querySelector("small")!.textContent = `${variant.changes.length} 个文件 · ${variant.sections.length} 个配置块`
  button.addEventListener("click", () => chooseAiVariant(variant.id))
  item.append(button)
  if (variant.response.trim()) {
    const note = document.createElement("p")
    note.className = "ai-variant-note"
    note.textContent = variant.response.trim().slice(0, 180)
    item.append(note)
  }
  return item
}

function chooseAiVariant(id: string): void {
  const draft = appState.aiDesignDraft
  const variant = draft?.variants?.find((item) => item.id === id)
  if (!draft || !variant) return
  draft.changes = variant.changes
  draft.drafts = variant.drafts
  draft.sections = variant.sections
  draft.conversation = variant.conversation
  draft.response = variant.response
  draft.variants = undefined
  setAiDesignDraft(draft)
  aiDesignStatus.textContent = `已选择「${variant.title}」· 请核对修改后应用`
}

export function setAiDesignDraft(draft: AiDraft | undefined): void {
  revertAiDraftPreview()
  appState.aiDesignDraft = draft
  aiDraftPanel.hidden = !draft
  // The draft card takes the composer's place until it is applied or discarded.
  aiDesignChat.toggleAttribute("data-draft", Boolean(draft))
  preview.setDraftSections(draft?.sections ?? [])
  syncAiDesignControls()
  if (draft) {
    aiDesignPanel.dataset.state = "review"
    aiDesignStatus.textContent = ""
  }
  if (!draft) {
    aiDraftFiles.replaceChildren()
    return
  }
  if (draft.variants?.length) {
    aiDraftSummary.textContent = `${draft.variants.length} 个设计方向 · 选择一个继续`
    aiDraftFiles.replaceChildren(...draft.variants.map((variant, index) => createAiVariantReview(variant, index)))
    return
  }
  aiDraftSummary.textContent = `涉及 ${draft.changes.length} 个文件` +
    (draft.sections.length ? ` · ${draft.sections.length} 个配置块` : "")
  aiDraftFiles.replaceChildren(...draft.drafts.map(createDraftReview))
  previewAiDraft(draft)
}

export function writeAiDraftChanges(target: SkinArchive, changes: readonly Change[], side: "before" | "after"): void {
  for (const change of side === "before" ? [...changes].reverse() : changes) {
    if (change.kind === "text") target.setText(change.path, change[side])
    else if (change.kind === "bytes") {
      const bytes = change[side]
      if (bytes) target.setBytes(change.path, bytes)
      else target.delete(change.path)
    }
  }
}

/** Shows a draft on the canvas by writing it into the archive without recording history. */
export function previewAiDraft(draft: AiDraft): void {
  if (appState.archive !== draft.target) return
  try {
    source.commit()
    // Revalidate before writing: never overwrite edits made since generation.
    draft.changes = validatedAiChanges(draft.target, draft.drafts)
  } catch (error) {
    aiDesignStatus.textContent = `${aiDesignErrorMessage(error)}。无法在画布预览，请丢弃后重新生成。`
    return
  }
  writeAiDraftChanges(draft.target, draft.changes, "after")
  appState.aiDraftPreview = { target: draft.target, changes: draft.changes }
  refreshAfterAiDraft(draft.target)
}

export function revertAiDraftPreview(): void {
  const current = appState.aiDraftPreview
  if (!current) return
  appState.aiDraftPreview = undefined
  writeAiDraftChanges(current.target, current.changes, "before")
  if (appState.archive === current.target) refreshAfterAiDraft(current.target)
}

/** Turns the previewed draft into a normal undoable edit; the archive already holds its content. */
export function acceptAiDraftPreview(): void {
  const current = appState.aiDraftPreview
  if (!current) return
  appState.aiDraftPreview = undefined
  commitBatch(current.changes)
  if (appState.aiDesignDraft) appState.aiDesignConversation = appState.aiDesignDraft.conversation
  setAiDesignDraft(undefined)
  aiDesignPanel.dataset.state = "done"
  aiDesignStatus.textContent = `已应用 ${current.changes.length} 个文件的修改，可使用撤销恢复。`
}

export function discardAiDesignDraft(message: string): void {
  if (!appState.aiDesignDraft) return
  setAiDesignDraft(undefined)
  aiDesignPanel.dataset.state = "idle"
  aiDesignStatus.textContent = message
}

export function refreshAfterAiDraft(target: SkinArchive): void {
  if (target.format === "bda") refreshBdaLayout(appState.layoutPath)
  else if (target.isText(appState.layoutPath)) appState.layoutDocument = IniDocument.parse(target.getText(appState.layoutPath))
  renderFiles()
  if (appState.selectedPath && target.getBytes(appState.selectedPath)) selectFile(appState.selectedPath, appState.sidebarView, "document", true)
  refreshPreview()
  populateKeyInspector()
  updateDirty()
}

export function applyAiDesignDraft(): void {
  const draft = appState.aiDesignDraft
  if (!draft) return
  if (appState.archive !== draft.target) {
    setAiDesignDraft(undefined)
    aiDesignStatus.textContent = "皮肤项目已切换，草稿已丢弃。"
    return
  }
  if (!isEditing() || appState.aiDesignBusy) {
    aiDesignStatus.textContent = "请在编辑模式下应用草稿，并等待生成结束。"
    return
  }
  if (!draft.changes.length || !draft.drafts.length) {
    aiDesignStatus.textContent = "请先选择一个设计方案。"
    return
  }
  if (!appState.aiDraftPreview) {
    aiDesignPanel.dataset.state = "error"
    aiDesignStatus.textContent = "草稿无法在画布预览，请丢弃后重新生成。"
    return
  }
  // A pending source edit is committed first and accepts the preview on its own.
  source.commit()
  acceptAiDraftPreview()
}

export function ensureAiChat(): Promise<AiChatController> {
  appState.aiChatInitialization ??= import("../ai-chat.ts")
    .then(({ connectAiChat }) => connectAiChat(aiDesignChat, runAiDesignRequest))
    .catch((error) => { appState.aiChatInitialization = undefined; throw error })
  return appState.aiChatInitialization.then((controller) => {
    appState.aiChatController = controller
    syncAiDesignControls()
    return controller
  })
}

export function syncAiDesignControls(): void {
  aiDesignModel.disabled = appState.aiDesignBusy || appState.savedModels.length === 0
  aiDesignThinking.disabled = aiDesignIntensity.disabled = aiDesignModel.disabled
  aiDesignScope.disabled = appState.aiDesignBusy
  aiNewSession.disabled = appState.aiDesignBusy || Boolean(appState.aiDesignDraft)
  // A pending draft must be applied or discarded first; deep-chat keeps its stop
  // button during a run, so only the idle submit state is affected.
  appState.aiChatController?.setEnabled(!appState.aiDesignDraft && appState.savedModels.length > 0)
  aiDraftApply.disabled = appState.aiDesignBusy || !isEditing() || Boolean(appState.aiDesignDraft?.variants?.length)
  aiDraftCancel.disabled = appState.aiDesignBusy
}

const AI_DESIGN_MODEL_KEY = "ai-design-model"

/** The chat stays on the model the user picked last, across restarts. */
export function rememberAiDesignModel(): void {
  const selected = appState.savedModels[Number(aiDesignModel.value)]
  try {
    if (selected) localStorage.setItem(AI_DESIGN_MODEL_KEY, modelConfigurationKey(selected))
  } catch {}
}

function syncModelProfiles(all: ModelConfiguration[]): void {
  const current = appState.savedModels[Number(aiDesignModel.value)]
  let remembered: string | null = null
  try { remembered = localStorage.getItem(AI_DESIGN_MODEL_KEY) } catch {}
  const models = all.filter((model) => model.kind !== "image")
  appState.savedImageModel = all.find((model) => model.kind === "image")
  appState.savedModels = models
  // One optgroup per provider account; option values stay indexes into the flat saved list.
  const groups = groupModelConfigurations(models)
  const labels = groups.map((group) => modelProviderPreset(group.provider).label)
  aiDesignModel.replaceChildren(...groups.map((group, index) => {
    const optgroup = document.createElement("optgroup")
    optgroup.label = labels.indexOf(labels[index]) === labels.lastIndexOf(labels[index]) ? labels[index] : `${labels[index]} · ${modelHost(group.apiUrl)}`
    optgroup.append(...group.models.map((model) => {
      const flat = models.findIndex((item) => item.provider === group.provider && item.apiUrl === group.apiUrl && item.apiKey === group.apiKey && item.model === model)
      return new Option(model, String(flat))
    }))
    return optgroup
  }))
  if (!models.length) aiDesignModel.replaceChildren(new Option("请先配置模型", ""))
  // Keep the chat on the same model when the list is reordered or shortened.
  const key = current ? modelConfigurationKey(current) : remembered
  const index = key ? models.findIndex((model) => modelConfigurationKey(model) === key) : -1
  if (models.length) aiDesignModel.value = String(Math.max(index, 0))
  aiDesignModel.hidden = models.length === 0
  aiDesignThinking.hidden = aiDesignIntensity.hidden = aiDesignModel.hidden
  aiModelSettings.hidden = models.length > 0
  syncAiDesignControls()
}

export const modelSettings = initializeModelSettings($("#settings-model-section"), {
  desktop: isTauri(),
  icon: symbolSpan,
  onSaved: syncModelProfiles,
})
