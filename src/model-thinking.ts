import { getSupportedThinkingLevels, type Api, type Model, type ThinkingLevelMap } from "@earendil-works/pi-ai"
import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models"
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models"
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models"
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models"
import { DEEPSEEK_MODELS } from "@earendil-works/pi-ai/providers/deepseek.models"
import { XAI_MODELS } from "@earendil-works/pi-ai/providers/xai.models"
import { MOONSHOTAI_MODELS } from "@earendil-works/pi-ai/providers/moonshotai.models"
import { MINIMAX_MODELS } from "@earendil-works/pi-ai/providers/minimax.models"
import { MINIMAX_CN_MODELS } from "@earendil-works/pi-ai/providers/minimax-cn.models"
import { KIMI_CODING_MODELS } from "@earendil-works/pi-ai/providers/kimi-coding.models"
import { ZAI_MODELS } from "@earendil-works/pi-ai/providers/zai.models"
import { OPENCODE_GO_MODELS } from "@earendil-works/pi-ai/providers/opencode-go.models"
import { QWEN_TOKEN_PLAN_MODELS } from "@earendil-works/pi-ai/providers/qwen-token-plan.models"
import type { ModelConfiguration } from "./model-settings"

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

/** Official account metadata takes precedence over the bundled provider catalog. */
export function modelThinking(configuration: ModelConfiguration) {
  const catalogs = configuration.provider === "chatgpt-subscription" ? [OPENAI_CODEX_MODELS] :
    [ANTHROPIC_MODELS, OPENAI_MODELS, GOOGLE_MODELS, DEEPSEEK_MODELS, XAI_MODELS, MOONSHOTAI_MODELS, MINIMAX_MODELS, MINIMAX_CN_MODELS, KIMI_CODING_MODELS, ZAI_MODELS, OPENCODE_GO_MODELS, QWEN_TOKEN_PLAN_MODELS]
  const known = catalogs.flatMap((catalog) => Object.values(catalog) as Model<Api>[])
    .find((model) => model.id === configuration.model.trim())
  const supported = configuration.thinkingLevels?.filter((level) => LEVELS.includes(level))
  const catalogLevels = known ? getSupportedThinkingLevels(known) : ["off" as const]
  // Aliases such as minimal → low are one backend effort, so offer its real name once.
  const levels = supported?.length ? LEVELS.filter((level) => supported.includes(level)) : catalogLevels.filter((level) => {
    const mapped = known?.thinkingLevelMap?.[level]
    return !mapped || mapped === level || !catalogLevels.includes(mapped as ThinkingLevel)
  })
  const thinkingLevelMap: ThinkingLevelMap = { ...known?.thinkingLevelMap }
  if (supported?.length) for (const level of LEVELS) thinkingLevelMap[level] = levels.includes(level) ? level === "off" ? "none" : level : null
  return { known, levels, thinkingLevelMap }
}

export function modelThinkingLevel(configuration: ModelConfiguration, requested = "medium"): ThinkingLevel {
  const { levels } = modelThinking(configuration)
  if (levels.includes(requested as ThinkingLevel)) return requested as ThinkingLevel
  if (levels.includes("medium")) return "medium"
  const index = LEVELS.indexOf(requested as ThinkingLevel)
  return levels.find((level) => LEVELS.indexOf(level) >= Math.max(0, index)) ?? levels.at(-1) ?? "off"
}
