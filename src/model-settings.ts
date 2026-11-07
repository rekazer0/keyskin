import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai"
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models"
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models"
import { invoke } from "@tauri-apps/api/core"
import { bindMenuKeys } from "./dom-element"
import { IMAGE_MODEL_PRESETS, MODEL_PROVIDER_PRESETS, imageModelPreset, modelProviderPreset, type ModelProtocol } from "./model-providers"

export interface ModelConfiguration {
  provider: string
  protocol: ModelProtocol
  apiUrl: string
  model: string
  apiKey: string
  /** "image" marks the single image-generation model used by AI design. */
  kind?: "image"
  thinkingLevels?: ModelThinkingLevel[]
}

interface ModelConfigurationState {
  configurations?: ModelConfiguration[]
  path: string
}

type Status = "idle" | "busy" | "success" | "error"

const LEGACY_KEYS = ["model-provider", "model-api-url", "model-name", "model-api-key"]

export function modelConfigurationKey(configuration: ModelConfiguration): string {
  return `${configuration.provider}\n${configuration.apiUrl}\n${configuration.model}`
}

/** One service account in the editor; it is stored as one flat ModelConfiguration per enabled model. */
interface ModelProvider {
  provider: string
  protocol: ModelProtocol
  apiUrl: string
  apiKey: string
  models: string[]
}

function presetProvider(id = "openai"): ModelProvider {
  const preset = modelProviderPreset(id)
  return { provider: preset.id, protocol: preset.protocol, apiUrl: preset.apiUrl, apiKey: "", models: preset.model ? [preset.model] : [] }
}

/** Models a subscription account can use: pi-ai's catalog without dated snapshots. */
function subscriptionModels(provider: string): Model<Api>[] {
  const catalog = provider === "claude-subscription" ? ANTHROPIC_MODELS : provider === "chatgpt-subscription" ? OPENAI_CODEX_MODELS : {}
  return (Object.values(catalog) as Model<Api>[]).filter((model) => !/-\d{8}$/.test(model.id))
}

/** PKCE pair and state for a subscription sign-in; the native side never sees anything weaker. */
async function pkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const encode = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = encode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge, state: encode(crypto.getRandomValues(new Uint8Array(16))) }
}

export function modelHost(url: string): string {
  try { return new URL(url).host } catch { return url }
}

/** Groups saved entries that share a service, endpoint and key, keeping first-seen order. */
export function groupModelConfigurations(models: ModelConfiguration[]): ModelProvider[] {
  const groups = new Map<string, ModelProvider>()
  for (const { model, ...service } of models) {
    const key = `${service.provider}\n${service.apiUrl}\n${service.apiKey}`
    const group = groups.get(key) ?? { ...service, models: [] }
    groups.set(key, group)
    if (model && !group.models.includes(model)) group.models.push(model)
  }
  return [...groups.values()]
}

export function flattenModelProviders(providers: ModelProvider[]): ModelConfiguration[] {
  return providers.flatMap(({ models, ...service }) => models.map((model) => ({ ...service, model })))
}

/** What still keeps one provider from being saved, for its row in the list. */
function providerProblem(provider: ModelProvider, accounts: ReadonlyMap<string, string>): string | undefined {
  if (modelProviderPreset(provider.provider).subscription) {
    if (!accounts.has(provider.provider)) return "未登录"
  } else {
    if (!provider.apiUrl) return "缺少 API 地址"
    if (!provider.apiKey) return "缺少 API 密钥"
  }
  if (!provider.models.length) return "未选择模型"
}

/**
 * Returns the first problem in a provider list, so the editor can select the offending entry.
 * `accounts` holds the signed-in subscriptions; those need no API key.
 */
export function validateModelProviders(providers: ModelProvider[], accounts: ReadonlyMap<string, string> = new Map()): { index: number; message: string } | undefined {
  const seen = new Set<string>()
  for (const [index, provider] of providers.entries()) {
    const preset = modelProviderPreset(provider.provider)
    if (preset.subscription && !accounts.has(provider.provider)) return { index, message: `请先登录 ${preset.label}` }
    if (!provider.apiUrl) return { index, message: "请填写 API 地址" }
    if (!/^https?:\/\/[^/]/i.test(provider.apiUrl)) return { index, message: "API 地址必须以 http:// 或 https:// 开头" }
    if (!preset.subscription && !provider.apiKey) return { index, message: "请填写 API 密钥" }
    if (!provider.models.length) return { index, message: "请至少选择一个模型" }
    for (const model of flattenModelProviders([provider])) {
      const key = modelConfigurationKey(model)
      if (seen.has(key)) return { index, message: `模型 ${model.model} 已在相同服务商和地址下存在` }
      seen.add(key)
    }
  }
}

/** Keeps the image models of a /models listing, which also carries the service's chat models. */
export function imageModelIds(models: readonly string[]): string[] {
  return models.filter((model) => /image|dall-e|imagen|seedream|seededit|cogview|flux|wanx|kolors|diffusion/i.test(model))
}

/** `accounts` holds the signed-in subscriptions, as for validateModelProviders. */
export function validateImageModel(image: ModelConfiguration | undefined, accounts: ReadonlyMap<string, string> = new Map()): string | undefined {
  if (!image) return
  const preset = imageModelPreset(image.provider)
  if (preset?.subscription && !accounts.has(image.provider)) return `请先登录 ${preset.label} 后再用于生图`
  if (!/^https?:\/\/[^/]/i.test(image.apiUrl)) return "生图模型的 API 地址必须以 http:// 或 https:// 开头"
  if (!preset?.subscription && !image.apiKey) return "请填写生图模型的 API 密钥"
  if (!image.model) return "请填写生图模型名称"
}

/**
 * The settings dialog edits an in-memory copy of the provider list; only the dialog's Save writes it to disk,
 * so switching, adding and deleting entries are all undone by Cancel.
 */
export function initializeModelSettings(section: HTMLElement, options: {
  desktop: boolean
  icon(name: string): HTMLElement
  onSaved(models: ModelConfiguration[]): void
}) {
  const $ = <T extends HTMLElement>(id: string) => section.querySelector<T>(`#${id}`)!
  const profiles = $<HTMLUListElement>("model-profiles")
  const editor = $<HTMLElement>("model-editor")
  const provider = $<HTMLSelectElement>("model-provider")
  const apiUrl = $<HTMLInputElement>("model-api-url")
  const apiKey = $<HTMLInputElement>("model-api-key")
  const choices = $<HTMLUListElement>("model-choices")
  const name = $<HTMLInputElement>("model-name")
  const addModel = $<HTMLButtonElement>("model-name-add")
  const choiceCount = $<HTMLElement>("model-choices-count")
  const toggleKey = $<HTMLButtonElement>("toggle-model-api-key")
  const toggleImageKey = $<HTMLButtonElement>("toggle-image-model-api-key")
  const refresh = $<HTMLButtonElement>("refresh-model-list")
  const test = $<HTMLButtonElement>("test-model-connection")
  const statusText = $<HTMLElement>("model-configuration-status")
  const pathText = $<HTMLElement>("model-configuration-path")
  const summary = document.querySelector<HTMLElement>('[data-settings-summary="model"]')
  const imageProvider = $<HTMLSelectElement>("image-model-provider")
  const imageFields = $<HTMLElement>("image-model-fields")
  const imageApiUrl = $<HTMLInputElement>("image-model-api-url")
  const imageApiKey = $<HTMLInputElement>("image-model-api-key")
  const imageName = $<HTMLInputElement>("image-model-name")
  const addMenu = $<HTMLDetailsElement>("model-profile-add")
  const accountRow = $<HTMLElement>("model-account-row")
  const accountText = $<HTMLElement>("model-account-text")
  const accountAction = $<HTMLButtonElement>("model-account-action")
  const keyRows = [provider, apiUrl, apiKey].map((input) => input.closest<HTMLElement>(".settings-row")!)
  const imageAccountRow = $<HTMLElement>("image-model-account-row")
  const imageAccountText = $<HTMLElement>("image-model-account-text")
  const imageAccountAction = $<HTMLButtonElement>("image-model-account-action")
  const imageRefresh = $<HTMLButtonElement>("refresh-image-model-list")
  const imageOptions = $<HTMLDataListElement>("image-model-options")
  const imageStatus = $<HTMLElement>("image-model-status")
  const imageKeyRows = [imageApiUrl, imageApiKey].map((input) => input.closest<HTMLElement>(".settings-row")!)

  let saved: ModelConfiguration[] = []
  let draft: ModelProvider[] = []
  let imageDraft: ModelConfiguration | undefined
  let active = -1
  // Models fetched from the open provider's API; offered as choices but not saved.
  let fetched: string[] = []
  // Image models returned by the selected service.
  let imageFetched: string[] = []
  let loadError = ""
  // Signed-in subscriptions (provider id → email). Signing in and out apply at once, like any account.
  const accounts = new Map<string, string>()
  let signingIn = ""

  const services = MODEL_PROVIDER_PRESETS.filter((preset) => !preset.subscription)
  provider.replaceChildren(...services.map((preset) => new Option(preset.label, preset.id)))
  const menuItem = (icon: string) => (preset: (typeof MODEL_PROVIDER_PRESETS)[number]) => {
    const item = document.createElement("button")
    item.type = "button"
    item.className = "ui-list-item"
    item.setAttribute("role", "menuitem")
    const label = document.createElement("span")
    label.textContent = preset.label
    item.append(options.icon(icon), label)
    item.addEventListener("click", () => addProfile(preset.id))
    return item
  }
  const separator = document.createElement("hr")
  separator.className = "ui-menu-separator"
  addMenu.querySelector(".ui-menu")!.replaceChildren(
    ...MODEL_PROVIDER_PRESETS.filter((preset) => preset.subscription).map(menuItem("user-round")),
    separator,
    ...services.map(menuItem("plug")),
  )
  bindMenuKeys(addMenu)
  addMenu.addEventListener("click", (event) => {
    if ((event.target as Element).closest("button")) addMenu.open = false
  })
  document.addEventListener("pointerdown", (event) => {
    if (addMenu.open && !addMenu.contains(event.target as Node)) addMenu.open = false
  })
  imageProvider.replaceChildren(new Option("不使用", ""), ...IMAGE_MODEL_PRESETS.map((preset) => new Option(preset.label, preset.id)))

  const clone = <T extends object>(items: T[]) => structuredClone(items)
  const notify = () => section.dispatchEvent(new Event("change", { bubbles: true }))
  const setStatus = (message: string, state: Status = "idle") => {
    statusText.textContent = message
    statusText.dataset.state = state
  }
  const setBusy = (busy: boolean) => {
    refresh.disabled = busy
    test.disabled = busy
  }
  const current = () => draft[active]

  function iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "ui-icon-button"
    button.title = label
    button.setAttribute("aria-label", label)
    button.append(options.icon(icon))
    button.addEventListener("click", onClick)
    return button
  }

  function renderProfiles(): void {
    profiles.replaceChildren(...draft.map((group, index) => {
      const label = modelProviderPreset(group.provider).label
      const problem = providerProblem(group, accounts)
      const item = document.createElement("li")
      const select = document.createElement("button")
      select.type = "button"
      select.className = "model-profile"
      select.setAttribute("aria-pressed", String(index === active))
      const text = document.createElement("span")
      text.className = "model-profile-text"
      const title = document.createElement("strong")
      title.textContent = label
      const detail = document.createElement("small")
      const where = modelProviderPreset(group.provider).subscription ? accounts.get(group.provider) : modelHost(group.apiUrl)
      detail.textContent = problem ?? [group.models.join("、"), where].filter(Boolean).join(" · ")
      if (problem) detail.dataset.problem = ""
      text.append(title, detail)
      select.append(text)
      if (index === 0) {
        const badge = document.createElement("span")
        badge.className = "ui-badge"
        badge.textContent = "默认"
        select.append(badge)
      }
      select.addEventListener("click", () => selectProfile(index))
      item.append(select)
      if (index > 0) item.append(iconButton("arrow-up", `将 ${label} 设为默认`, () => makeDefault(index)))
      item.append(iconButton("trash", `删除 ${label}`, () => removeProfile(index)))
      return item
    }))
    if (!draft.length) {
      const empty = document.createElement("li")
      empty.className = "ui-empty"
      empty.textContent = "还没有服务商"
      profiles.append(empty)
    }
    const count = draft.reduce((total, group) => total + group.models.length, 0)
    if (summary) summary.textContent = count ? `${count} 个` : "未配置"
  }

  function renderChoices(): void {
    const group = current()
    if (!group) return
    const all = choiceModels(group)
    const query = name.value.trim().toLowerCase()
    // Chosen models stay on top so a long fetched list never hides what is in use.
    const shown = all
      .filter((model) => !query || model.toLowerCase().includes(query))
      .sort((left, right) => Number(group.models.includes(right)) - Number(group.models.includes(left)))
    choices.replaceChildren(...shown.map((model) => {
      const item = document.createElement("li")
      const label = document.createElement("label")
      const box = document.createElement("input")
      box.type = "checkbox"
      box.checked = group.models.includes(model)
      box.addEventListener("change", () => {
        group.models = box.checked ? [...group.models, model] : group.models.filter((item) => item !== model)
        renderProfiles()
        renderChoiceCount(group)
        notify()
      })
      const text = document.createElement("span")
      text.textContent = model
      label.append(box, text)
      item.append(label)
      return item
    }))
    if (!shown.length) {
      const empty = document.createElement("li")
      empty.className = "ui-empty"
      empty.textContent = query
        ? `没有匹配“${name.value.trim()}”的模型，按回车或点 + 添加它`
        : "点击“获取列表”读取服务商的模型，或在上方输入模型 ID 添加"
      choices.append(empty)
    }
    renderChoiceCount(group)
  }

  /** Everything the open provider can offer: its chosen models, the fetched list and the preset default. */
  function choiceModels(group: ModelProvider): string[] {
    const preset = modelProviderPreset(group.provider).model
    // pi-ai's catalog only stands in until the account's own list has been fetched.
    const catalog = fetched.length ? [] : subscriptionModels(group.provider).map((model) => model.id)
    return [...new Set([...group.models, ...fetched, ...(preset ? [preset] : []), ...catalog])]
  }

  function renderChoiceCount(group: ModelProvider): void {
    choiceCount.textContent = `已选 ${group.models.length} / ${choiceModels(group).length}`
  }

  function renderEditor(): void {
    const group = current()
    editor.hidden = test.hidden = !group
    if (!group) return
    const subscription = Boolean(modelProviderPreset(group.provider).subscription)
    // A subscription signs in instead of taking an address and key; listing its models is the connection test.
    for (const row of keyRows) row.hidden = subscription
    accountRow.hidden = !subscription
    test.hidden = subscription
    renderAccount()
    provider.value = modelProviderPreset(group.provider).id
    apiUrl.value = group.apiUrl
    apiKey.value = group.apiKey
    name.value = ""
    renderChoices()
  }

  /** The chat editor and the image model share one sign-in per subscription, so both rows follow it. */
  function renderAccount(): void {
    for (const [id, text, action] of [[current()?.provider, accountText, accountAction], [imageDraft?.provider, imageAccountText, imageAccountAction]] as const) {
      const email = accounts.get(id ?? "")
      const busy = signingIn === id
      text.textContent = busy ? "等待浏览器中完成授权…" : email === undefined ? "未登录" : email ? `已登录 · ${email}` : "已登录"
      text.title = text.textContent
      action.textContent = busy ? "取消" : email === undefined ? "登录" : "退出登录"
      if (!busy && email === undefined) action.dataset.variant = "primary"
      else delete action.dataset.variant
    }
  }

  async function login(id: string): Promise<void> {
    const label = modelProviderPreset(id).label
    if (!options.desktop) {
      setStatus("请在桌面应用中登录账号", "error")
      return
    }
    signingIn = id
    renderAccount()
    setStatus(`已在浏览器中打开 ${label} 授权页面，完成后回到这里`, "busy")
    try {
      const account = await invoke<{ email: string }>("model_oauth_login", { provider: id, ...await pkce() })
      accounts.set(id, account.email)
      setStatus(`已登录 ${label}，勾选模型后保存`, "success")
      if (current()?.provider === id) fetchSubscriptionModels()
      if (imageDraft?.provider === id) void fetchImageModels()
    } catch (error) {
      // A newer sign-in replaced this one; its own status stays.
      const cancelled = String(error) === "已取消登录"
      if (signingIn === id) setStatus(cancelled ? "" : `登录失败：${String(error)}`, cancelled ? "idle" : "error")
    } finally {
      if (signingIn === id) signingIn = ""
      renderProfiles()
      renderAccount()
    }
  }

  async function logout(id: string): Promise<void> {
    try {
      await invoke("model_oauth_logout", { provider: id })
      accounts.delete(id)
      setStatus(`已退出 ${modelProviderPreset(id).label}`)
    } catch (error) {
      setStatus(`退出登录失败：${String(error)}`, "error")
    }
    renderProfiles()
    renderAccount()
  }

  function toggleAccount(id: string | undefined): void {
    if (!id) return
    if (signingIn === id) void invoke("model_oauth_cancel")
    else if (accounts.has(id)) void logout(id)
    else void login(id)
  }
  accountAction.addEventListener("click", () => toggleAccount(current()?.provider))
  imageAccountAction.addEventListener("click", () => toggleAccount(imageDraft?.provider))

  function setImageStatus(message: string, state: Status = "idle"): void {
    imageStatus.textContent = message
    imageStatus.dataset.state = state
    imageStatus.hidden = !message
  }

  /**
   * Lists the image service's models. A signed-in subscription does this quietly on its own;
   * an API service does it from 获取列表 (`report`), which says how it went.
   */
  async function fetchImageModels(report = false): Promise<void> {
    const image = imageDraft
    if (!image) return
    if (!options.desktop) {
      if (report) setImageStatus("请在桌面应用中连接模型服务", "error")
      return
    }
    if (imageModelPreset(image.provider)?.subscription && !accounts.has(image.provider)) {
      if (report) setImageStatus("请先登录账号后获取模型列表", "error")
      return
    }
    if (report) setImageStatus("正在从 API 获取模型…", "busy")
    imageRefresh.disabled = true
    try {
      const models = imageModelIds(await invoke<string[]>("fetch_model_list", { configuration: { ...image, model: "" } }))
      if (imageDraft !== image) return
      imageFetched = models
      renderImage()
      setImageStatus(models.length ? `已获取 ${models.length} 个生图模型` : "官方接口未返回生图模型，请手动输入模型 ID", models.length ? "success" : "idle")
    } catch (error) {
      if (imageDraft === image) setImageStatus(`获取模型失败：${String(error)}`, "error")
    } finally {
      if (imageDraft === image) imageRefresh.disabled = false
    }
  }
  imageRefresh.addEventListener("click", () => void fetchImageModels(true))

  function renderImage(): void {
    imageRefresh.disabled = false
    imageProvider.value = imageDraft?.provider ?? ""
    imageFields.hidden = !imageDraft
    imageApiUrl.value = imageDraft?.apiUrl ?? ""
    imageApiKey.value = imageDraft?.apiKey ?? ""
    imageName.value = imageDraft?.model ?? ""
    // A subscription uses the signed-in account and picks from image models only.
    const subscription = Boolean(imageDraft && imageModelPreset(imageDraft.provider)?.subscription)
    for (const row of imageKeyRows) row.hidden = subscription
    imageAccountRow.hidden = !subscription
    imageOptions.replaceChildren(...imageFetched.map((model) => new Option(model)))
    renderAccount()
  }

  function render(): void {
    renderProfiles()
    renderEditor()
    renderImage()
  }

  const chatModels = (models: ModelConfiguration[]) => models.filter((model) => model.kind !== "image")
  const savedImage = () => saved.find((model) => model.kind === "image")
  const allModels = () => [...flattenModelProviders(draft), ...(imageDraft ? [imageDraft] : [])]

  function selectProfile(index: number): void {
    const changed = index !== active
    if (changed) fetched = []
    active = index
    render()
    setStatus("")
    if (changed) fetchSubscriptionModels()
  }

  /** A signed-in subscription shows what the account offers today, not a list frozen at build time. */
  function fetchSubscriptionModels(): void {
    const group = current()
    if (group && modelProviderPreset(group.provider).subscription && accounts.has(group.provider)) void fetchModels()
  }

  /** Adds a service from the menu; a subscription already in the list is selected rather than repeated. */
  function addProfile(id: string): void {
    const preset = modelProviderPreset(id)
    const existing = preset.subscription ? draft.findIndex((group) => group.provider === id) : -1
    if (existing < 0) {
      draft.push(presetProvider(id))
      notify()
    }
    selectProfile(existing < 0 ? draft.length - 1 : existing)
    if (preset.subscription) {
      if (!accounts.has(id)) void login(id)
      return
    }
    // Compatible-format presets have no address yet; the rest only need a key.
    const first = preset.apiUrl ? apiKey : apiUrl
    first.focus()
    setStatus("填写 API 密钥并勾选模型后保存")
  }

  function makeDefault(index: number): void {
    const [group] = draft.splice(index, 1)
    draft.unshift(group)
    active = active === index ? 0 : active < index ? active + 1 : active
    render()
    setStatus(`${modelProviderPreset(group.provider).label} 已设为默认，保存后生效`)
    notify()
  }

  function removeProfile(index: number): void {
    draft.splice(index, 1)
    if (index === active) fetched = []
    active = Math.min(active > index ? active - 1 : active, draft.length - 1)
    render()
    setStatus("已删除，保存后生效")
    notify()
  }

  function updateCurrent(patch: Partial<ModelProvider>): void {
    const group = current()
    if (!group) return
    Object.assign(group, patch)
    renderProfiles()
  }

  function addCustomModel(): void {
    const group = current()
    const model = name.value.trim()
    if (!group || !model) return
    if (!group.models.includes(model)) group.models.push(model)
    name.value = ""
    renderProfiles()
    renderChoices()
    setStatus(`已添加 ${model}`)
    notify()
  }

  provider.addEventListener("change", () => {
    const group = current()
    if (!group) return
    const previous = modelProviderPreset(group.provider)
    const next = modelProviderPreset(provider.value)
    // Only replace values the user has not customised.
    if (!group.apiUrl || group.apiUrl === previous.apiUrl) apiUrl.value = next.apiUrl
    const untouched = !group.models.length || (group.models.length === 1 && group.models[0] === previous.model)
    fetched = []
    updateCurrent({
      provider: next.id,
      protocol: next.protocol,
      apiUrl: apiUrl.value.trim(),
      models: untouched ? (next.model ? [next.model] : []) : group.models,
    })
    renderChoices()
  })
  imageProvider.addEventListener("change", () => {
    const next = imageModelPreset(imageProvider.value)
    const previous = imageDraft && imageModelPreset(imageDraft.provider)
    // Keep a typed key when switching services; replace only untouched preset values.
    // A subscription takes its own address and default model, and never an API key.
    const keep = (value: string | undefined, preset: string | undefined) => !next?.subscription && value && value !== preset
    imageDraft = next && {
      provider: next.id,
      protocol: next.protocol,
      apiUrl: keep(imageDraft?.apiUrl, previous?.apiUrl) ? imageDraft!.apiUrl : next.apiUrl,
      model: keep(imageDraft?.model, previous?.model) ? imageDraft!.model : next.model,
      apiKey: next.subscription ? "" : imageDraft?.apiKey ?? "",
      kind: "image",
    }
    imageFetched = []
    setImageStatus("")
    renderImage()
    notify()
    // Signed in for chat already: nothing more to do. Otherwise sign in right here.
    if (next?.subscription) void (accounts.has(next.id) ? fetchImageModels() : login(next.id))
  })
  for (const [input, field] of [[imageApiUrl, "apiUrl"], [imageApiKey, "apiKey"], [imageName, "model"]] as const) {
    input.addEventListener("input", () => {
      if (imageDraft) imageDraft[field] = input.value.trim()
      notify()
    })
  }
  apiUrl.addEventListener("input", () => updateCurrent({ apiUrl: apiUrl.value.trim() }))
  apiKey.addEventListener("input", () => updateCurrent({ apiKey: apiKey.value.trim() }))
  addModel.addEventListener("click", addCustomModel)
  name.addEventListener("input", renderChoices)
  name.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    addCustomModel()
  })

  function syncKeyToggle(toggle: HTMLButtonElement, input: HTMLInputElement): void {
    const revealed = input.type === "text"
    toggle.title = revealed ? "隐藏 API 密钥" : "显示 API 密钥"
    toggle.setAttribute("aria-label", toggle.title)
    toggle.setAttribute("aria-pressed", String(revealed))
    toggle.replaceChildren(options.icon(revealed ? "eye.slash" : "eye"))
  }
  for (const [toggle, input] of [[toggleKey, apiKey], [toggleImageKey, imageApiKey]] as const) {
    toggle.addEventListener("click", () => {
      input.type = input.type === "password" ? "text" : "password"
      syncKeyToggle(toggle, input)
    })
  }

  async function request<T>(pending: string, failure: string, command: string, model: string): Promise<T | undefined> {
    const group = current()
    if (!group) return
    if (!options.desktop) {
      setStatus("请在桌面应用中连接模型服务")
      return
    }
    const { models: _models, ...service } = group
    setBusy(true)
    setStatus(pending, "busy")
    try {
      return await invoke<T>(command, { configuration: { ...service, model } })
    } catch (error) {
      setStatus(`${failure}：${String(error)}`, "error")
    } finally {
      setBusy(false)
    }
  }

  async function fetchModels(): Promise<void> {
    const group = current()
    const models = await request<string[]>("正在从 API 获取模型…", "获取模型失败", "fetch_model_list", "")
    // The list belongs to the row it was asked for; the user may have moved on meanwhile.
    if (!models || current() !== group) return
    fetched = models
    name.value = ""
    renderChoices()
    setStatus(models.length ? `已获取 ${models.length} 个模型，勾选要使用的模型` : "服务商没有返回模型，请手动输入模型 ID", models.length ? "success" : "idle")
  }
  refresh.addEventListener("click", () => void fetchModels())
  test.addEventListener("click", () => {
    const model = current()?.models[0]
    if (!model) {
      setStatus("请先选择一个模型", "error")
      return
    }
    void request<{ message: string }>(`正在使用 ${model} 测试连接…`, "连接失败", "test_model_connection", model).then((result) => {
      if (result) setStatus(result.message, "success")
    })
  })

  async function persist(models: ModelConfiguration[]): Promise<void> {
    const state = await invoke<ModelConfigurationState>("save_model_configuration", { configurations: models })
    for (const key of LEGACY_KEYS) localStorage.removeItem(key)
    saved = clone(models)
    pathText.textContent = pathText.title = state.path
    options.onSaved(clone(saved))
  }

  async function load(): Promise<void> {
    render()
    if (!options.desktop) {
      setStatus("模型服务仅在桌面应用中可用")
      return
    }
    try {
      try {
        for (const account of await invoke<{ provider: string; email: string }[]>("model_oauth_accounts")) accounts.set(account.provider, account.email)
      } catch (error) {
        setStatus(`读取登录状态失败：${String(error)}`, "error")
      }
      const state = await invoke<ModelConfigurationState>("load_model_configuration")
      pathText.textContent = pathText.title = state.path
      saved = state.configurations ?? []
      if (!saved.length) {
        const legacy = LEGACY_KEYS.map((key) => localStorage.getItem(key))
        if (legacy.some(Boolean)) {
          const [legacyProvider, legacyApiUrl, legacyModel, legacyApiKey] = legacy
          const preset = presetProvider(legacyProvider ?? "openai")
          const migrated = { ...preset, apiUrl: legacyApiUrl || preset.apiUrl, models: legacyModel ? [legacyModel] : preset.models, apiKey: legacyApiKey ?? "" }
          if (!validateModelProviders([migrated])) {
            await persist(flattenModelProviders([migrated]))
            setStatus("旧配置已迁移到本机配置文件", "success")
          }
        }
      }
      draft = groupModelConfigurations(chatModels(saved))
      imageDraft = structuredClone(savedImage())
      active = draft.length ? 0 : -1
      render()
      options.onSaved(clone(saved))
      if (statusText.dataset.state !== "success") setStatus(saved.length ? "" : "尚未配置模型")
    } catch (error) {
      loadError = `读取配置失败：${String(error)}`
      setStatus(loadError, "error")
    }
  }

  void load()
  return {
    begin(): void {
      draft = groupModelConfigurations(chatModels(saved))
      imageDraft = structuredClone(savedImage())
      apiKey.type = imageApiKey.type = "password"
      syncKeyToggle(toggleKey, apiKey)
      syncKeyToggle(toggleImageKey, imageApiKey)
      active = Math.min(Math.max(active, 0), draft.length - 1)
      fetched = []
      imageFetched = []
      setImageStatus("")
      render()
      setStatus(loadError, loadError ? "error" : "idle")
      fetchSubscriptionModels()
      void fetchImageModels()
    },
    cancel(): void {
      this.begin()
    },
    dirty(): boolean {
      // Compare normalized forms: grouping may reorder or merge saved entries.
      const savedNormalized = [...flattenModelProviders(groupModelConfigurations(chatModels(saved))), ...(savedImage() ? [savedImage()] : [])]
      return JSON.stringify(allModels()) !== JSON.stringify(savedNormalized)
    },
    async save(): Promise<void> {
      if (!options.desktop) throw new Error("请在桌面应用中保存模型配置")
      // Never overwrite a config file we could not read.
      if (loadError) throw new Error(loadError)
      const problem = validateModelProviders(draft, accounts)
      if (problem) {
        selectProfile(problem.index)
        setStatus(problem.message, "error")
        throw new Error(`AI 模型 · ${problem.message}`)
      }
      const imageProblem = validateImageModel(imageDraft, accounts)
      if (imageProblem) {
        setStatus(imageProblem, "error")
        throw new Error(`AI 模型 · ${imageProblem}`)
      }
      setStatus("正在保存配置…", "busy")
      try {
        await persist(allModels())
        setStatus("配置已保存到本机", "success")
      } catch (error) {
        setStatus(`保存失败：${String(error)}`, "error")
        throw error
      }
    },
  }
}
