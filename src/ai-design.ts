import { Agent, type AgentEvent, type AgentMessage, type AgentTool, type ThinkingLevel } from "@earendil-works/pi-agent-core"
import {
  Type,
  createModels,
  createProvider,
  envApiKeyAuth,
  type Api,
  type ImageContent,
  type Model,
  type ProviderStreams,
} from "@earendil-works/pi-ai"
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy"
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy"
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy"
import { Channel, invoke } from "@tauri-apps/api/core"
import { AI_DESIGN_DIRECTIONS, SUBAGENT_GUIDE, SUBAGENT_RULES, aiDesignSystemPrompt, contextText, type AiDesignIntensity, type AiDesignProject } from "./ai-design-prompt.ts"
import { AiSkinImages, base64 } from "./ai-skin-images.ts"
import { AiSkinWorkspace, type AiSkinDraftChange } from "./ai-skin-workspace.ts"
import type { ModelProtocol } from "./model-providers.ts"

type AiDesignConfiguration = {
  provider: string
  protocol: ModelProtocol
  apiUrl: string
  model: string
  apiKey: string
}

type AiDesignResult = {
  changes: AiSkinDraftChange[]
  response: string
  toolCalls: number
  conversation: AiDesignConversation
  variants?: AiDesignVariant[]
}

type AiDesignVariant = {
  id: string
  title: string
  changes: AiSkinDraftChange[]
  response: string
  toolCalls: number
  conversation: AiDesignConversation
}

export type AiDesignConversation = AgentMessage[]

type AiDesignAttachments = { images: ImageContent[]; text: string }

const ATTACHMENT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])
const ATTACHMENT_IMAGE_BYTES = 8 * 1024 * 1024
const ATTACHMENT_TEXT_CHARS = 60_000

/** Turns pasted/dropped files into model input: images as image parts, UTF-8 text files inlined into the prompt. */
export async function aiDesignAttachments(files: readonly File[]): Promise<AiDesignAttachments> {
  const images: ImageContent[] = []
  const texts: string[] = []
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (ATTACHMENT_IMAGE_TYPES.has(file.type)) {
      if (bytes.length > ATTACHMENT_IMAGE_BYTES) throw new Error(`图片过大（超过 8MB）：${file.name}`)
      images.push({ type: "image", data: base64(bytes), mimeType: file.type })
      continue
    }
    let text: string
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      throw new Error(`暂不支持该附件，请附加图片或文本文件：${file.name}`)
    }
    if (text.includes("\0")) throw new Error(`暂不支持该附件，请附加图片或文本文件：${file.name}`)
    const clipped = text.length > ATTACHMENT_TEXT_CHARS ? `${text.slice(0, ATTACHMENT_TEXT_CHARS)}\n…（已截断）` : text
    texts.push(`附件「${contextText(file.name, 120)}」：\n\`\`\`\n${clipped}\n\`\`\``)
  }
  return { images, text: texts.join("\n\n") }
}

type StatusKind = "thinking" | "reading" | "editing" | "done" | "error"
type ModelHttpEvent =
  | { type: "headers"; status: number; headers: Array<[string, string]> }
  | { type: "chunk"; body: number[] }
  | { type: "end" }

function jsonResult(details: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  }
}

function normalizedUrl(value: string): string {
  return value.trim().replace(/\/+$/, "")
}

function modelApi(protocol: ModelProtocol): Api {
  if (protocol === "anthropic") return "anthropic-messages"
  if (protocol === "google") return "google-generative-ai"
  if (protocol === "openai-responses") return "openai-responses"
  return "openai-completions"
}

function apiStreams(protocol: ModelProtocol): ProviderStreams {
  if (protocol === "anthropic") return anthropicMessagesApi()
  if (protocol === "google") return googleGenerativeAIApi()
  if (protocol === "openai-responses") return openAIResponsesApi()
  return openAICompletionsApi()
}

function configuredModel(config: AiDesignConfiguration, thinkingLevel: ThinkingLevel): Model<Api> {
  const api = modelApi(config.protocol)
  return {
    id: config.model.trim(),
    name: config.model.trim(),
    api,
    provider: "keyskin",
    baseUrl: normalizedUrl(config.apiUrl),
    // The user picks the effort; "off" sends no reasoning parameters at all.
    reasoning: thinkingLevel !== "off",
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    // DeepSeek-style APIs count reasoning inside max_tokens; 8K truncates a long think before any tool call.
    maxTokens: thinkingLevel === "off" ? 8_192 : 32_768,
  }
}

function toolsFor(workspace: AiSkinWorkspace, images: AiSkinImages, imageModel?: AiDesignConfiguration): AgentTool[] {
  const readFileSchema = Type.Object({
    path: Type.String({ description: "系统提示中已授权的项目相对路径" }),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 40_000 })),
  })
  const readFile: AgentTool<typeof readFileSchema> = {
    name: "read_project_file",
    label: "读取皮肤配置",
    description: "分页读取一个已授权配置文件，单次最多返回 40000 字符。",
    parameters: readFileSchema,
    executionMode: "sequential",
    execute: async (_id, { path, offset, limit }) => {
      return jsonResult(workspace.readFile(path, offset, limit))
    },
  }

  const readIniSectionsSchema = Type.Object({
    path: Type.String({ description: "已授权的 INI/CSS 配置路径" }),
    sections: Type.Array(Type.String(), { minItems: 1, maxItems: 40, description: "配置节名称，例如 STYLE72" }),
  })
  const readIniSections: AgentTool<typeof readIniSectionsSchema> = {
    name: "read_ini_sections",
    label: "读取配置节",
    description: "按名称读取 INI/CSS 配置节的全部键值，返回不存在的节名列表。",
    parameters: readIniSectionsSchema,
    executionMode: "sequential",
    execute: async (_id, { path, sections }) => {
      return jsonResult({ path, ...workspace.readIniSections(path, sections) })
    },
  }

  const setIniValueSchema = Type.Object({
    path: Type.String({ description: "已授权的 INI/CSS 配置路径" }),
    section: Type.String({ description: "已有配置节名称；全局配置用空字符串" }),
    key: Type.String({ description: "配置键名称" }),
    value: Type.String({ description: "新的单行配置值" }),
  })
  const setIniValue: AgentTool<typeof setIniValueSchema> = {
    name: "set_ini_value",
    label: "设置皮肤配置值",
    description: "在已有 INI 配置节中新增键或修改键值；不能创建配置节或文件。",
    parameters: setIniValueSchema,
    executionMode: "sequential",
    execute: async (_id, { path, section, key, value }) => {
      return jsonResult({ status: workspace.setIniValue(path, section, key, value), path, section, key })
    },
  }

  const removeIniValueSchema = Type.Object({
    path: Type.String({ description: "已授权的 INI/CSS 配置路径" }),
    section: Type.String({ description: "已有配置节名称；全局配置用空字符串" }),
    key: Type.String({ description: "要删除的配置键名称" }),
  })
  const removeIniValue: AgentTool<typeof removeIniValueSchema> = {
    name: "remove_ini_value",
    label: "删除皮肤配置值",
    description: "删除已有 INI 配置键；仅在用户明确要求删除该属性时使用，不能删除节或文件。",
    parameters: removeIniValueSchema,
    executionMode: "sequential",
    execute: async (_id, { path, section, key }) => {
      return jsonResult({ removed: workspace.removeIniValue(path, section, key), path, section, key })
    },
  }

  const addIniSectionSchema = Type.Object({
    path: Type.String({ description: "已授权的 INI/CSS 配置路径" }),
    section: Type.String({ description: "新配置节名称，例如 KEY15 或 STYLE300" }),
    entries: Type.Array(Type.Object({ key: Type.String(), value: Type.String() }), { maxItems: 80, description: "按顺序写入的键值" }),
  })
  const addIniSection: AgentTool<typeof addIniSectionSchema> = {
    name: "add_ini_section",
    label: "新增配置节",
    description: "在 INI/CSS 末尾新增一个配置节（新按键 KEYn、新样式 STYLEn 等）。KEY 节会自动连续编号并同步 [PANEL] KEY_NUM，STYLE 节会同步 STYLE_NUM；返回实际节名。",
    parameters: addIniSectionSchema,
    executionMode: "sequential",
    execute: async (_id, { path, section, entries }) => {
      return jsonResult({ section: workspace.addIniSection(path, section, entries), path })
    },
  }

  const removeIniSectionsSchema = Type.Object({
    path: Type.String({ description: "已授权的 INI/CSS 配置路径" }),
    sections: Type.Array(Type.String(), { minItems: 1, maxItems: 80 }),
  })
  const removeIniSections: AgentTool<typeof removeIniSectionsSchema> = {
    name: "remove_ini_sections",
    label: "删除配置节",
    description: "删除已有配置节（例如重排布局时去掉多余按键）。KEY 节删除后会重新连续编号并同步 KEY_NUM，返回 旧节名→新节名 映射。",
    parameters: removeIniSectionsSchema,
    executionMode: "sequential",
    execute: async (_id, { path, sections }) => {
      return jsonResult({ renamed: workspace.removeIniSections(path, sections), path })
    },
  }

  const readJsonPathsSchema = Type.Object({
    path: Type.String({ description: "已授权的 JSON 配置路径" }),
    paths: Type.Array(Type.String(), { minItems: 1, maxItems: 40, description: "用 / 分隔的键路径，例如 keys/3 或 ss_1/118；空字符串表示整个文件" }),
  })
  const readJsonPaths: AgentTool<typeof readJsonPathsSchema> = {
    name: "read_json_paths",
    label: "读取 JSON 路径",
    description: "按路径读取 JSON 配置中的若干值，返回不存在的路径列表。",
    parameters: readJsonPathsSchema,
    executionMode: "sequential",
    execute: async (_id, { path, paths }) => {
      return jsonResult({ path, ...workspace.readJsonPaths(path, paths) })
    },
  }

  const setJsonValueSchema = Type.Object({
    path: Type.String({ description: "已授权的 JSON 配置路径" }),
    pointer: Type.String({ minLength: 1, description: "用 / 分隔的键路径，例如 ss_1/118/s_1/c_normal" }),
    valueJson: Type.String({ maxLength: 50_000, description: "新值的 JSON 文本，例如 \"FF2080FF\"、42 或 [[0,0],[10,10]]" }),
  })
  const setJsonValue: AgentTool<typeof setJsonValueSchema> = {
    name: "set_json_value",
    label: "设置 JSON 值",
    description: "替换 JSON 配置中一个已有路径的值，或给已有对象新增成员；不能新增数组元素或文件。",
    parameters: setJsonValueSchema,
    executionMode: "sequential",
    execute: async (_id, { path, pointer, valueJson }) => {
      return jsonResult({ status: workspace.setJsonValue(path, pointer, valueJson), path, pointer })
    },
  }

  const replaceProjectTextSchema = Type.Object({
    path: Type.String({ description: "已授权的 JSON 配置路径" }),
    oldText: Type.String({ minLength: 1, maxLength: 50_000 }),
    newText: Type.String({ maxLength: 50_000 }),
    expectedOccurrences: Type.Integer({ minimum: 1, maximum: 20 }),
  })
  const replaceProjectText: AgentTool<typeof replaceProjectTextSchema> = {
    name: "replace_project_text",
    label: "精确修改 JSON",
    description: "只对已授权 JSON 配置做精确小片段替换。替换后必须仍是有效 JSON，不能重写整个文件。",
    parameters: replaceProjectTextSchema,
    executionMode: "sequential",
    execute: async (_id, { path, oldText, newText, expectedOccurrences }) => {
      const file = workspace.listFiles().find((entry) => entry.path === path)
      if (file?.syntax !== "json") throw new Error("精确文本替换只允许用于 JSON 配置")
      return jsonResult({
        replacements: workspace.replaceText(path, oldText, newText, expectedOccurrences),
        path,
      })
    },
  }

  const tools: AgentTool[] = [readFile, readIniSections, setIniValue, removeIniValue, addIniSection, removeIniSections, readJsonPaths, setJsonValue, replaceProjectText]
  if (!images.paths().length) return tools

  const imagePath = Type.String({ description: "已授权的 PNG 路径" })
  const slice = Type.Optional(Type.Integer({ minimum: 0, description: "切片序号（.til 中 IMGn 的 n）；省略表示整张图" }))
  const viewImageSchema = Type.Object({ path: imagePath, slice })
  const viewImage: AgentTool<typeof viewImageSchema> = {
    name: "view_image",
    label: "查看图片",
    description: "查看 PNG 或其中一个切片：返回尺寸、切片列表、平均色和缩略图。",
    parameters: viewImageSchema,
    executionMode: "sequential",
    execute: async (_id, { path, slice }) => {
      const { info, png } = await images.view(path, slice)
      return { content: [{ type: "text" as const, text: JSON.stringify(info) }, { type: "image" as const, data: png, mimeType: "image/png" }], details: info }
    },
  }

  const recolorImageSchema = Type.Object({
    path: imagePath,
    slice,
    color: Type.String({ description: "目标颜色 RRGGBB" }),
    preserveNeutral: Type.Optional(Type.Boolean({ description: "默认 true：保留灰、白、黑像素（图标、文字、阴影）" })),
  })
  const recolorImage: AgentTool<typeof recolorImageSchema> = {
    name: "recolor_image",
    label: "图片改色",
    description: "把整张 PNG 或一个切片改成目标颜色，保留明暗、光泽和透明度。",
    parameters: recolorImageSchema,
    executionMode: "sequential",
    execute: async (_id, { path, slice, color, preserveNeutral }) => {
      const pixels = await images.recolor(path, color, slice, preserveNeutral ?? true)
      return jsonResult({ path, slice, color, recoloredPixels: pixels, note: pixels ? undefined : "没有可着色的彩色像素；如需改灰白图请设 preserveNeutral=false" })
    },
  }
  if (!imageModel) return [...tools, viewImage, recolorImage]

  const generateImageSchema = Type.Object({
    path: imagePath,
    slice,
    prompt: Type.String({ minLength: 1, maxLength: 2_000, description: "画面描述（英文效果更好），说明主体、配色、质感，以及纯色或透明背景" }),
    keepShape: Type.Optional(Type.Boolean({ description: "默认 true：按原图透明轮廓裁剪（保持圆角按键形状）" })),
  })
  const generateImage: AgentTool<typeof generateImageSchema> = {
    name: "generate_image",
    label: "生成图片",
    description: "调用图片生成模型绘制新图，缩放填入整张 PNG 或一个切片。",
    parameters: generateImageSchema,
    executionMode: "sequential",
    execute: async (_id, { path, slice, prompt, keepShape }, signal) => {
      const reference = imageModel.protocol === "google" ? (await images.view(path, slice)).png : undefined
      const picture = await requestImage(imageModel, prompt, reference, signal)
      await images.paint(path, picture, slice, keepShape ?? true)
      return jsonResult({ path, slice, painted: true })
    },
  }
  return [...tools, viewImage, recolorImage, generateImage]
}

function decodeBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
}

async function responseJson(response: Response): Promise<any> {
  const text = await response.text()
  if (!response.ok) throw new Error(`图片模型返回 ${response.status}：${text.slice(0, 300)}`)
  return JSON.parse(text)
}

/** Calls an OpenAI-compatible images endpoint or Gemini generateContent; runs under nativeModelFetch. */
async function requestImage(config: AiDesignConfiguration, prompt: string, reference: string | undefined, signal?: AbortSignal): Promise<Uint8Array> {
  const base = normalizedUrl(config.apiUrl)
  if (config.provider === "minimax-image") {
    const body = await responseJson(await fetch(`${base}/image_generation`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey.trim()}` },
      body: JSON.stringify({ model: config.model.trim(), prompt, aspect_ratio: "1:1", response_format: "base64", n: 1 }),
      signal,
    }))
    if (body?.base_resp?.status_code) throw new Error(`图片模型返回错误：${body.base_resp.status_msg ?? body.base_resp.status_code}`)
    const data = body?.data?.image_base64?.[0]
    if (typeof data !== "string") throw new Error("图片模型没有返回图片")
    return decodeBase64(data)
  }
  if (config.protocol === "google") {
    const parts: unknown[] = [{ text: prompt }]
    if (reference) parts.push({ inlineData: { mimeType: "image/png", data: reference } })
    const body = await responseJson(await fetch(`${base}/models/${encodeURIComponent(config.model.trim())}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey.trim() },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
      signal,
    }))
    const data = body?.candidates?.[0]?.content?.parts?.find((part: any) => part?.inlineData?.data)?.inlineData?.data
    if (typeof data !== "string") throw new Error("图片模型没有返回图片")
    return decodeBase64(data)
  }
  const model = config.model.trim()
  const body = await responseJson(await fetch(`${base}/images/generations`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey.trim()}` },
    // gpt-image models always return base64 and reject response_format.
    body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024", ...(/gpt-image/i.test(model) ? {} : { response_format: "b64_json" }) }),
    signal,
  }))
  const item = body?.data?.[0]
  if (typeof item?.b64_json === "string") return decodeBase64(item.b64_json)
  // The native proxy only reaches saved API hosts, so CDN links (e.g. CogView) cannot be downloaded.
  if (typeof item?.url === "string") throw new Error("该图片模型只返回图片链接，暂不支持；请换用能返回 b64_json 的模型")
  throw new Error("图片模型没有返回图片")
}

const TOOL_LABELS: Record<string, string> = {
  read_project_file: "读取当前面板配置",
  read_ini_sections: "读取样式配置节",
  set_ini_value: "写入 INI 样式草稿",
  remove_ini_value: "写入删除属性草稿",
  add_ini_section: "新增配置节草稿",
  remove_ini_sections: "删除配置节草稿",
  read_json_paths: "读取 JSON 配置",
  set_json_value: "写入 JSON 配置草稿",
  replace_project_text: "写入 JSON 精确替换草稿",
  dispatch_subagents: "派发子代理并行处理",
  view_image: "查看图片",
  recolor_image: "图片改色草稿",
  generate_image: "生成图片草稿",
}
const EDIT_TOOLS = new Set(["set_ini_value", "remove_ini_value", "add_ini_section", "remove_ini_sections", "set_json_value", "replace_project_text", "recolor_image", "generate_image"])

function eventStatus(event: AgentEvent): { kind: StatusKind; text: string } | undefined {
  if (event.type === "agent_start") return { kind: "thinking", text: "AI 正在分析当前皮肤…" }
  if (event.type === "tool_execution_start") {
    const path = typeof event.args?.path === "string" ? ` · ${event.args.path}` : ""
    return { kind: EDIT_TOOLS.has(event.toolName) ? "editing" : "reading", text: `AI ${TOOL_LABELS[event.toolName] ?? "处理项目"}${path}…` }
  }
  // A successful tool end only repeats its start step; failures are worth a row.
  if (event.type === "tool_execution_end" && event.isError) {
    return { kind: EDIT_TOOLS.has(event.toolName) ? "editing" : "reading", text: `AI 操作失败：${TOOL_LABELS[event.toolName] ?? event.toolName}` }
  }
  if (event.type === "agent_end") return { kind: "done", text: "AI 已完成分析，正在校验修改…" }
  return undefined
}

function subagentTool(
  run: (tasks: Array<{ title: string; instructions: string }>, signal?: AbortSignal) => Promise<unknown>,
): AgentTool {
  const schema = Type.Object({
    tasks: Type.Array(Type.Object({
      title: Type.String({ description: "子任务的简短标题" }),
      instructions: Type.String({ description: "完整、自包含的子任务说明：负责的文件与配置节、具体修改和目标效果" }),
    }), { minItems: 1, maxItems: 4 }),
  })
  const tool: AgentTool<typeof schema> = {
    name: "dispatch_subagents",
    label: "派发子代理",
    description: "把互不重叠的子任务并行派发给子代理，子代理拥有与你相同的读写工具并共享草稿；返回每个子任务的汇报。",
    parameters: schema,
    executionMode: "sequential",
    execute: async (_id, { tasks }, signal) => jsonResult({ results: await run(tasks, signal) }),
  }
  return tool as unknown as AgentTool
}

function finalResponse(agent: Agent): string {
  const message = [...agent.state.messages].reverse().find((entry) => entry.role === "assistant")
  if (!message || message.role !== "assistant") return ""
  const text = message.content.flatMap((content) => content.type === "text" ? [content.text] : []).join("\n").trim()
  if (text || message.stopReason !== "length") return text
  return "模型输出达到长度上限（多半是思考过长），本轮没有完成修改。请调低思考强度或拆小需求后重试。"
}

function recentConversation(messages: readonly AgentMessage[]): AgentMessage[] {
  const conversational = messages.flatMap<AgentMessage>((message) => {
    if (message.role === "user") return [message]
    if (message.role !== "assistant" || message.stopReason === "toolUse") return []
    const content = message.content.filter((part) => part.type === "text")
    return content.length ? [{ ...message, content }] : []
  })
  return conversational.slice(-6)
}

async function nativeModelFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input)
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init.headers).forEach((value, name) => headers.set(name, value))
  if (init.body != null && typeof init.body !== "string") throw new Error("模型请求体格式不受支持")
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined)
  signal?.throwIfAborted()
  return new Promise<Response>((resolve, reject) => {
    let stream: ReadableStreamDefaultController<Uint8Array>
    let finished = false
    const finish = (error?: unknown) => {
      if (finished) return
      finished = true
      signal?.removeEventListener("abort", abort)
      if (error) { stream.error(error); reject(error) }
      else stream.close()
    }
    const abort = () => finish(new DOMException("AI 设计已取消", "AbortError"))
    const body = new ReadableStream<Uint8Array>({
      start(controller) { stream = controller },
      cancel() { finished = true; signal?.removeEventListener("abort", abort) },
    })
    const events = new Channel<ModelHttpEvent>()
    events.onmessage = (event) => {
      if (finished) return
      if (event.type === "headers") {
        resolve(new Response([204, 205, 304].includes(event.status) ? null : body, { status: event.status, headers: event.headers }))
      } else if (event.type === "chunk") stream.enqueue(new Uint8Array(event.body))
      else finish()
    }
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) { abort(); return }
    void invoke("model_http_request", {
      request: { url, method: init.method ?? (input instanceof Request ? input.method : "POST"), headers: [...headers], body: init.body ?? null },
      events,
    }).catch((error) => finish(new Error(String(error))))
  })
}

type AiDesignOptions = {
  history?: readonly AgentMessage[]
  variantCount?: number
  intensity?: AiDesignIntensity
  thinkingLevel?: ThinkingLevel
  /** Saved image-generation model; without it the AI can only view and recolour images. */
  imageModel?: AiDesignConfiguration
  /** Files the user pasted or dropped into the composer. */
  attachments?: AiDesignAttachments
  signal?: AbortSignal
  onStatus?: (kind: StatusKind, text: string) => void
  onTextDelta?: (delta: string) => void | Promise<void>
  onThinking?: (text: string) => void | Promise<void>
}

export async function runAiSkinDesign(
  config: AiDesignConfiguration,
  project: AiDesignProject,
  prompt: string,
  options: AiDesignOptions = {},
): Promise<AiDesignResult> {
  if (options.signal?.aborted) throw new DOMException("AI 设计已取消", "AbortError")
  if (!normalizedUrl(config.apiUrl)) throw new Error("请先配置模型 API 地址")
  if (!config.model.trim()) throw new Error("请先配置模型名称")
  if (!config.apiKey.trim()) throw new Error("请先配置模型 API 密钥")
  if (!project.files.length) throw new Error("当前皮肤没有可供 AI 编辑的配置文件")

  const webviewFetch = globalThis.fetch
  // one AI run is allowed at a time; replace fetch only for that run so every provider avoids WebView CORS.
  globalThis.fetch = nativeModelFetch
  try {
    const variantCount = Math.max(1, Math.min(AI_DESIGN_DIRECTIONS.length, Math.trunc(options.variantCount ?? 1)))
    if (variantCount === 1) return await runDesignAgent(config, project, prompt, options)
    // Directions are independent drafts, so they run side by side.
    const settled = await Promise.allSettled(AI_DESIGN_DIRECTIONS.slice(0, variantCount).map(async ({ id, title, brief }, index): Promise<AiDesignVariant> => {
      const result = await runDesignAgent(config, project, `${prompt.trim()}\n\n请制作第 ${index + 1} 个独立方案「${title}」：${brief}。和其他方案拉开明显差异；只修改当前授权范围，保留用户明确要求保留的布局和动作。`, {
        ...options,
        intensity: "bold",
        history: [],
        onTextDelta: undefined,
        onThinking: undefined,
        onStatus: (kind, text) => options.onStatus?.(kind, `方案 ${index + 1} · ${text}`),
      })
      return { id, title, changes: result.changes, response: result.response, toolCalls: result.toolCalls, conversation: result.conversation }
    }))
    if (options.signal?.aborted) throw new DOMException("AI 设计已取消", "AbortError")
    // One failed direction should not throw away the others.
    const variants = settled.flatMap((outcome, index) => {
      if (outcome.status === "fulfilled") return [outcome.value]
      options.onStatus?.("error", `方案 ${index + 1} 未完成：${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`)
      return []
    })
    if (!variants.length) throw (settled[0] as PromiseRejectedResult).reason
    return { changes: [], response: "", toolCalls: variants.reduce((sum, variant) => sum + variant.toolCalls, 0), conversation: [], variants }
  } finally {
    globalThis.fetch = webviewFetch
  }
}

async function runDesignAgent(
  config: AiDesignConfiguration,
  project: AiDesignProject,
  prompt: string,
  options: AiDesignOptions,
): Promise<AiDesignResult> {
  const workspace = new AiSkinWorkspace(project.files)
  const thinkingLevel = options.thinkingLevel ?? "off"
  const model = configuredModel(config, thinkingLevel)
  const api = apiStreams(config.protocol)
  const models = createModels()
  models.setProvider(createProvider({
    id: model.provider,
    name: "KeySkin configured provider",
    baseUrl: model.baseUrl,
    auth: { apiKey: envApiKeyAuth("API key", []) },
    models: [model],
    api,
  }))

  const imageAssets = new AiSkinImages(project.images ?? [])
  const tools = toolsFor(workspace, imageAssets, options.imageModel)
  let toolCalls = 0
  const createAgent = (systemPrompt: string, agentTools: AgentTool[], messages: AgentMessage[]) => {
    const allowedTools = new Set(agentTools.map((tool) => tool.name))
    return new Agent({
      initialState: { systemPrompt, model, thinkingLevel, tools: agentTools, messages },
      streamFn: models.streamSimple.bind(models),
      getApiKey: () => config.apiKey.trim(),
      toolExecution: "sequential",
      beforeToolCall: async ({ toolCall }) => {
        toolCalls += 1
        if (!allowedTools.has(toolCall.name)) return { block: true, reason: "该工具未获皮肤编辑器授权", terminate: true }
        return undefined
      },
      maxRetryDelayMs: 10_000,
    })
  }
  const baseSystemPrompt = aiDesignSystemPrompt(project, Boolean(options.imageModel), options.intensity ?? "balanced")
  const images = [...(project.preview ? [project.preview] : []), ...(options.attachments?.images ?? [])]
  const subagents = subagentTool(async (tasks, signal) => Promise.all(tasks.map(async (task, index) => {
    // Subagents share this run's workspace, so their edits land in the same draft.
    const child = createAgent(`${baseSystemPrompt}\n\n${SUBAGENT_RULES}`, tools, [])
    const label = `子任务 ${index + 1}「${contextText(task.title, 24)}」`
    const unsubscribeChild = child.subscribe((event) => {
      const status = eventStatus(event)
      if (status && status.kind !== "done") options.onStatus?.(status.kind, `${label} · ${status.text.replace(/^AI\s*/, "")}`)
    })
    const abortChild = () => child.abort()
    signal?.addEventListener("abort", abortChild, { once: true })
    try {
      await child.prompt(`子任务：${task.title}\n\n${task.instructions}`, images.length ? images : undefined)
      return { title: task.title, error: child.state.errorMessage || undefined, report: finalResponse(child) }
    } finally {
      signal?.removeEventListener("abort", abortChild)
      unsubscribeChild()
    }
  })))
  const agent = createAgent(`${baseSystemPrompt}\n\n${SUBAGENT_GUIDE}`, [...tools, subagents], [...(options.history ?? [])])
  let thinking = ""
  const unsubscribe = agent.subscribe(async (event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") {
      thinking += event.assistantMessageEvent.delta
      await options.onThinking?.(thinking)
    }
    const status = eventStatus(event)
    if (status) options.onStatus?.(status.kind, status.text)
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      await options.onTextDelta?.(event.assistantMessageEvent.delta)
    }
  })
  const abort = () => agent.abort()
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener("abort", abort, { once: true })
  try {
    const referenceCount = options.attachments?.images.length ?? 0
    const referenceNote = referenceCount ? `用户附带了 ${referenceCount} 张参考图片${project.preview ? "（排在当前画布预览图之后）" : ""}。` : ""
    const text = [prompt.trim(), referenceNote, options.attachments?.text].filter(Boolean).join("\n\n")
    await agent.prompt(text, images.length ? images : undefined)
    if (options.signal?.aborted) throw new DOMException("AI 设计已取消", "AbortError")
    if (agent.state.errorMessage) throw new Error(agent.state.errorMessage)
    return {
      changes: [...workspace.changes(), ...imageAssets.changes()],
      response: finalResponse(agent),
      toolCalls,
      conversation: recentConversation(agent.state.messages),
    }
  } finally {
    options.signal?.removeEventListener("abort", abort)
    unsubscribe()
  }
}
