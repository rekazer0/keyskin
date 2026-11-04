export type ModelProtocol = "anthropic" | "openai-chat" | "openai-responses" | "openai-codex" | "google"

interface ModelProviderPreset {
  id: string
  label: string
  protocol: ModelProtocol
  apiUrl: string
  model: string
  /** Signs in with an account in the browser instead of an API key (see src-tauri/src/model_oauth.rs). */
  subscription?: true
}

export const MODEL_PROVIDER_PRESETS: readonly ModelProviderPreset[] = [
  { id: "claude-subscription", label: "Claude 订阅 (Pro/Max)", protocol: "anthropic", apiUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5", subscription: true },
  { id: "chatgpt-subscription", label: "ChatGPT 订阅 (Plus/Pro)", protocol: "openai-codex", apiUrl: "https://chatgpt.com/backend-api", model: "gpt-5.5", subscription: true },
  { id: "anthropic", label: "Anthropic", protocol: "anthropic", apiUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5" },
  { id: "anthropic-compatible", label: "Anthropic 兼容格式", protocol: "anthropic", apiUrl: "", model: "" },
  { id: "openai", label: "OpenAI", protocol: "openai-chat", apiUrl: "https://api.openai.com/v1", model: "gpt-5" },
  { id: "openai-compatible", label: "OpenAI 兼容格式", protocol: "openai-chat", apiUrl: "", model: "" },
  { id: "openai-responses", label: "OpenAI Responses 格式", protocol: "openai-responses", apiUrl: "https://api.openai.com/v1", model: "gpt-5" },
  { id: "xai-subscription", label: "xAI 订阅 (Grok)", protocol: "openai-chat", apiUrl: "https://api.x.ai/v1", model: "grok-4" },
  { id: "deepseek", label: "DeepSeek", protocol: "openai-chat", apiUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "google", label: "Google", protocol: "google", apiUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-pro" },
  { id: "kimi-api", label: "Kimi API", protocol: "openai-chat", apiUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { id: "kimi-coding-plan", label: "Kimi Coding Plan", protocol: "anthropic", apiUrl: "https://api.kimi.com/coding/v1", model: "kimi-for-coding" },
  { id: "opencode-go", label: "OpenCode Go (OpenAI 协议)", protocol: "openai-chat", apiUrl: "https://opencode.ai/zen/v1", model: "" },
  { id: "zhipu-ai", label: "智谱 AI", protocol: "openai-chat", apiUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.5" },
  { id: "zhipu-coding-plan", label: "智谱 Coding Plan", protocol: "openai-chat", apiUrl: "https://open.bigmodel.cn/api/coding/paas/v4", model: "glm-4.5" },
  { id: "zhipu-coding-plan-team", label: "智谱 Coding Plan 团队版", protocol: "openai-chat", apiUrl: "https://open.bigmodel.cn/api/coding/paas/v4", model: "glm-4.5" },
  { id: "volcengine-agent-plan", label: "火山方舟 Agent Plan", protocol: "openai-chat", apiUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "" },
  { id: "volcengine-coding-plan", label: "火山方舟 Coding Plan", protocol: "openai-chat", apiUrl: "https://ark.cn-beijing.volces.com/api/coding/v3", model: "" },
  { id: "volcengine-api", label: "火山引擎 API", protocol: "openai-chat", apiUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "" },
  { id: "minimax", label: "MiniMax (API & 编程包)", protocol: "openai-chat", apiUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M2" },
  { id: "qwen", label: "通义千问", protocol: "openai-chat", apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3-coder-plus" },
]

export function modelProviderPreset(id: string): ModelProviderPreset {
  return MODEL_PROVIDER_PRESETS.find((provider) => provider.id === id) ?? MODEL_PROVIDER_PRESETS.find((provider) => provider.id === "openai")!
}

/**
 * Image-generation services. "openai-chat" here means the OpenAI-compatible /images/generations
 * endpoint; MiniMax and Google use their own endpoints, chosen by preset id in ai-design.ts.
 * The ChatGPT subscription shares its id with the chat preset, so one sign-in serves both.
 */
export const IMAGE_MODEL_PRESETS: readonly ModelProviderPreset[] = [
  { id: "chatgpt-subscription", label: "ChatGPT 订阅 (Plus/Pro)", protocol: "openai-codex", apiUrl: "https://chatgpt.com/backend-api", model: "gpt-image-2.5", subscription: true },
  { id: "openai-image", label: "OpenAI", protocol: "openai-chat", apiUrl: "https://api.openai.com/v1", model: "gpt-image-1" },
  { id: "volcengine-image", label: "火山方舟 Seedream", protocol: "openai-chat", apiUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seedream-4-0-250828" },
  { id: "google-image", label: "Google Gemini", protocol: "google", apiUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash-image" },
  { id: "minimax-image", label: "MiniMax", protocol: "openai-chat", apiUrl: "https://api.minimaxi.com/v1", model: "image-01" },
  { id: "openai-compatible-image", label: "OpenAI 兼容格式", protocol: "openai-chat", apiUrl: "", model: "" },
]

export function imageModelPreset(id: string): ModelProviderPreset | undefined {
  return IMAGE_MODEL_PRESETS.find((provider) => provider.id === id)
}
