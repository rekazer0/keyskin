import { getSupportedThinkingLevels, type Api, type Model, type OpenAICompletionsCompat, type ThinkingLevelMap } from "@earendil-works/pi-ai"
import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models"
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models"
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models"
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models"
import { DEEPSEEK_MODELS } from "@earendil-works/pi-ai/providers/deepseek.models"
import { XAI_MODELS } from "@earendil-works/pi-ai/providers/xai.models"
import { MOONSHOTAI_MODELS } from "@earendil-works/pi-ai/providers/moonshotai.models"
import { MOONSHOTAI_CN_MODELS } from "@earendil-works/pi-ai/providers/moonshotai-cn.models"
import { MINIMAX_MODELS } from "@earendil-works/pi-ai/providers/minimax.models"
import { MINIMAX_CN_MODELS } from "@earendil-works/pi-ai/providers/minimax-cn.models"
import { KIMI_CODING_MODELS } from "@earendil-works/pi-ai/providers/kimi-coding.models"
import { ZAI_MODELS } from "@earendil-works/pi-ai/providers/zai.models"
import { ZAI_CODING_CN_MODELS } from "@earendil-works/pi-ai/providers/zai-coding-cn.models"
import { OPENCODE_MODELS } from "@earendil-works/pi-ai/providers/opencode.models"
import { OPENCODE_GO_MODELS } from "@earendil-works/pi-ai/providers/opencode-go.models"
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models"
import { QWEN_TOKEN_PLAN_MODELS } from "@earendil-works/pi-ai/providers/qwen-token-plan.models"
import { QWEN_TOKEN_PLAN_CN_MODELS } from "@earendil-works/pi-ai/providers/qwen-token-plan-cn.models"
import { MODEL_APIS, MODEL_THINKING_LEVELS as LEVELS } from "./model-providers.ts"
import type { ModelConfiguration } from "./model-settings"

const catalogs: readonly Readonly<Record<string, Model<Api>>>[] = [
  ANTHROPIC_MODELS, OPENAI_MODELS, GOOGLE_MODELS, DEEPSEEK_MODELS, XAI_MODELS, MOONSHOTAI_CN_MODELS,
  MOONSHOTAI_MODELS, MINIMAX_MODELS, MINIMAX_CN_MODELS, KIMI_CODING_MODELS, ZAI_CODING_CN_MODELS,
  ZAI_MODELS, OPENCODE_GO_MODELS, OPENCODE_MODELS, QWEN_TOKEN_PLAN_CN_MODELS, QWEN_TOKEN_PLAN_MODELS, OPENROUTER_MODELS,
]
const catalogById = new Map<string, Model<Api>[]>()
for (const catalog of catalogs) for (const model of Object.values(catalog)) {
  const id = model.id.toLowerCase()
  const matches = catalogById.get(id) ?? []
  matches.push(model)
  catalogById.set(id, matches)
}

function endpoint(url: string): URL | undefined {
  try { return new URL(url) } catch { return undefined }
}

function catalogModel(configuration: ModelConfiguration): Model<Api> | undefined {
  const name = configuration.model.trim().toLowerCase()
  const id = configuration.protocol === "google" ? name.replace(/^models\//, "") : name
  if (configuration.provider === "chatgpt-subscription") return (Object.values(OPENAI_CODEX_MODELS) as Model<Api>[]).find((model) => model.id === id)
  const url = endpoint(configuration.apiUrl)
  const api = MODEL_APIS[configuration.protocol]
  const directDeepSeek = url?.hostname === "api.deepseek.com"
  const flashAlias = id === "deepseek-flash" || (directDeepSeek && /^deepseek-v4-flash(?:-vision-exp)?$/.test(id))
  const matches = catalogById.get(flashAlias ? "deepseek-v4-flash" : id) ?? []
  const sameHost = url ? matches.filter((match) => endpoint(match.baseUrl)?.hostname === url.hostname) : []
  const known = sameHost.find((match) => match.api === api && url?.pathname.startsWith(new URL(match.baseUrl).pathname.replace(/\/$/, "")))
    ?? sameHost.find((match) => match.api === api) ?? sameHost[0]
    ?? matches.find((match) => match.provider === configuration.provider && match.api === api)
    ?? matches.find((match) => match.api === api) ?? matches[0]
  if (known && (flashAlias || (directDeepSeek && id === "deepseek-v4-pro"))) {
    // DeepSeek's current Flash id and API effort list are newer than the bundled catalog.
    return { ...known, thinkingLevelMap: { ...known.thinkingLevelMap, low: "low" } }
  }
  return known
}

/** Official models not yet in pi-ai, where the endpoint defines the wire format. */
function endpointThinking(configuration: ModelConfiguration): { levels: ThinkingLevel[]; compat?: OpenAICompletionsCompat } | undefined {
  const host = endpoint(configuration.apiUrl)?.hostname ?? ""
  const id = configuration.model.trim().toLowerCase()
  if (configuration.protocol === "openai-chat" && host.endsWith(".aliyuncs.com") && (
    /^qwen(?:-(?:plus|flash)(?:-latest)?|3\.[5-7]-(?:plus|flash)|3\.8-(?:max|flash|27b)|4-max)(?:-\d{4}-\d{2}-\d{2})?$/.test(id) ||
    /^qwen3\.7-max(?:-2026-(?:05-20|06-08))?$/.test(id)
  )) {
    return { levels: ["off", "low", "medium", "high"], compat: {
      thinkingFormat: "qwen", supportsReasoningEffort: false, thinkingTokenBudgetField: "thinking_budget",
      supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens",
    } }
  }
  if (configuration.protocol === "openai-chat" && /^ark\.[^.]+\.volces\.com$/.test(host)) {
    if (/^doubao-seed-(?:2-0-(?:pro|lite|mini|code-preview)-\d{6}|2-1-(?:pro|lite|turbo)-\d{6}|evolving|character-\d{6})$/.test(id)) {
      return { levels: ["off", "low", "medium", "high"], compat: { supportsStore: false, supportsDeveloperRole: false } }
    }
    if (/^(?:deepseek-v4-1-flash(?:-economy)?|deepseek-v4-(?:flash|pro)-ga)-\d{6}$/.test(id)) return { levels: ["off", "low", "high", "max"] }
    if (/^(?:glm-5-3-flash|kimi-k3-1-pro)-\d{6}$/.test(id)) return { levels: ["low", "high", "max"] }
    if (/^glm-5-2-\d{6}$/.test(id)) return { levels: ["off", "low", "high", "max"], compat: {
      thinkingFormat: "deepseek", supportsStore: false, supportsDeveloperRole: false,
    } }
  }
}

/** Per-model overrides win over API metadata, then the bundled provider catalog. */
export function modelThinking(configuration: ModelConfiguration) {
  const known = catalogModel(configuration)
  const fallback = endpointThinking(configuration)
  const supported = (configuration.thinkingOverride ?? configuration.thinkingLevels)?.filter((level) => LEVELS.includes(level))
  const detected = fallback?.levels ?? (known ? getSupportedThinkingLevels(known) : ["off" as const])
  const catalogMap = fallback ? undefined : known?.thinkingLevelMap
  // Aliases such as minimal → low are one backend effort, so offer its real name once.
  const levels = supported?.length ? LEVELS.filter((level) => supported.includes(level)) : detected.filter((level) => {
    const mapped = catalogMap?.[level]
    return !mapped || mapped === level || !detected.includes(mapped as ThinkingLevel)
  })
  const thinkingLevelMap: ThinkingLevelMap = { ...catalogMap }
  if (supported?.length || fallback) for (const level of LEVELS) {
    const mapped = configuration.thinkingOverride ? catalogMap?.[level] : undefined
    thinkingLevelMap[level] = levels.includes(level) ? mapped ?? (level === "off" ? "none" : level) : null
  }
  const compat = fallback?.compat ?? (known?.api === MODEL_APIS[configuration.protocol] ? known?.compat : undefined)
  const identified = Boolean(known || fallback || supported?.length)
  const reasoning = levels.some((level) => level !== "off")
    || Boolean(configuration.thinkingOverride?.length && detected.some((level) => level !== "off"))
  return { known, compat, identified, reasoning, levels, thinkingLevelMap }
}

export function modelThinkingLevel(configuration: ModelConfiguration, requested = "medium"): ThinkingLevel {
  const { levels } = modelThinking(configuration)
  if (levels.includes(requested as ThinkingLevel)) return requested as ThinkingLevel
  if (levels.includes("medium")) return "medium"
  const index = LEVELS.indexOf(requested as ThinkingLevel)
  return levels.find((level) => LEVELS.indexOf(level) >= Math.max(0, index)) ?? levels.at(-1) ?? "off"
}
