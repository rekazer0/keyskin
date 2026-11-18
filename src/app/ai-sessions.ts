import type { AiChatSnapshot } from "../ai-chat"
import type { AiDesignConversation } from "../ai-design"
import { bindListboxKeys, element, emptyState } from "../dom-element"
import { createIcon } from "../icons"
import { ask } from "./ask"
import { aiNewSession, aiSessionCreate, aiSessionList, aiSessions, aiSessionsClose, aiDesignPanel, aiDesignStatus } from "./dom"
import { appState } from "./state"
import { ensureAiChat, syncAiDesignControls } from "./ai-panel"

export type AiSession = {
  id: string
  title: string
  conversation: AiDesignConversation
  chat?: AiChatSnapshot
  status: string
  state: string
  createdAt: number
  appliedFiles: number
}

function saveSession(): void {
  const session = appState.aiSessions.find((item) => item.id === appState.aiSessionId)
  if (!session) return
  session.conversation = appState.aiDesignConversation
  session.chat = appState.aiChatController?.snapshot()
  const firstMessage = session.chat?.messages.find((message) => message.role === "user" && message.text)?.text?.replace(/\s+/g, " ").trim()
  if (firstMessage) {
    const summary = firstMessage.split(/[。！？.!?；;]/, 1)[0]?.trim() || firstMessage
    session.title = summary.length > 28 ? `${summary.slice(0, 28).trim()}…` : summary
  }
  session.status = aiDesignStatus.textContent ?? ""
  session.state = aiDesignPanel.dataset.state ?? "idle"
}

function addSession(): void {
  const session: AiSession = { id: crypto.randomUUID(), title: "新会话", conversation: [], status: "", state: "idle", createdAt: Date.now(), appliedFiles: 0 }
  appState.aiSessions.unshift(session)
  appState.aiSessionId = session.id
}

function renderSessions(): void {
  const appliedOnly = aiSessions.querySelector('[data-session-filter="applied"]')?.getAttribute("aria-pressed") === "true"
  aiSessionList.replaceChildren(...appState.aiSessions.filter(session => !appliedOnly || session.appliedFiles > 0).map((session) => {
    const item = document.createElement("button")
    item.type = "button"
    item.className = "ui-list-item"
    item.dataset.session = session.id
    item.setAttribute("role", "option")
    item.setAttribute("aria-label", session.title)
    item.setAttribute("aria-selected", String(session.id === appState.aiSessionId))
    item.tabIndex = session.id === appState.aiSessionId ? 0 : -1
    const title = document.createElement("span")
    title.className = "ui-list-item-text"
    const text = document.createElement("strong")
    text.textContent = session.title
    const meta = element("small")
    meta.textContent = `${new Date(session.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${session.appliedFiles ? `已应用 ${session.appliedFiles} 个文件` : "未应用"}`
    title.append(text, meta)
    item.append(createIcon("message-square", 16), title)
    item.title = session.title
    item.addEventListener("click", () => selectSession(session.id))
    return item
  }))
  if (!aiSessionList.childElementCount) aiSessionList.append(emptyState("history", "暂无已应用的会话"))
  if (!aiSessionList.querySelector('[tabindex="0"]')) aiSessionList.querySelector<HTMLElement>('[role="option"]')?.setAttribute("tabindex", "0")
  syncAiSessionControls()
}

export function recordAiApplication(files: number): void {
  if (!appState.aiSessionId) addSession()
  const session = appState.aiSessions.find(session => session.id === appState.aiSessionId)
  if (session) session.appliedFiles += files
  saveSession()
}

function selectSession(id: string): void {
  if (appState.aiDesignBusy || appState.aiDesignDraft || id === appState.aiSessionId) return
  const session = appState.aiSessions.find((item) => item.id === id)
  if (!session) return
  saveSession()
  appState.aiChatController?.clear()
  appState.aiSessionId = id
  appState.aiDesignConversation = session.conversation
  if (session.chat) appState.aiChatController?.restore(session.chat)
  aiDesignStatus.textContent = session.status
  aiDesignPanel.dataset.state = session.state
  renderSessions()
  syncAiDesignControls()
  aiSessionList.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
}

function closeSessions(): void {
  aiSessions.hidden = true
  aiNewSession.setAttribute("aria-expanded", "false")
  aiNewSession.focus()
}

export function syncAiSessionControls(): void {
  const disabled = appState.aiDesignBusy || Boolean(appState.aiDesignDraft)
  aiSessionCreate.disabled = disabled
  const clear = aiSessions.querySelector<HTMLButtonElement>("[data-session-clear]")
  if (clear) clear.disabled = disabled || appState.aiSessions.length < 2
  aiSessionList.querySelectorAll<HTMLButtonElement>("button").forEach((item) => { item.disabled = disabled })
}

export function wireAiSessions(): void {
  const filters = element("div", "ui-segmented")
  filters.dataset.fill = ""
  filters.setAttribute("aria-label", "历史筛选")
  for (const [value, label] of [["all", "全部"], ["applied", "已应用"]]) {
    const button = Object.assign(element("button"), { type: "button", textContent: label })
    button.dataset.sessionFilter = value
    button.setAttribute("aria-pressed", String(value === "all"))
    button.addEventListener("click", () => {
      for (const item of filters.children) item.setAttribute("aria-pressed", String(item === button))
      renderSessions()
    })
    filters.append(button)
  }
  aiSessionList.before(filters)
  const clear = Object.assign(element("button", "ui-button"), { type: "button", textContent: "清理记录" })
  clear.dataset.variant = "quiet"
  clear.prepend(createIcon("trash-2", 14))
  clear.dataset.sessionClear = ""
  clear.addEventListener("click", () => {
    if (appState.aiDesignBusy || appState.aiDesignDraft) return
    void ask({ title: "清理 AI 历史？", detail: "保留当前会话，其余记录将从本次会话中移除，此操作无法撤销", actions: [
      { value: "cancel", label: "取消" }, { value: "clear", label: "清理记录", variant: "danger" },
    ] }).then(choice => {
      if (choice !== "clear" || appState.aiDesignBusy || appState.aiDesignDraft) return
      appState.aiSessions = appState.aiSessions.filter(session => session.id === appState.aiSessionId)
      renderSessions()
    })
  })
  const footer = element("footer")
  footer.append(clear)
  aiSessionList.after(footer)
  aiNewSession.addEventListener("click", () => {
    if (!aiSessions.hidden) { closeSessions(); return }
    void ensureAiChat().then(() => {
      if (!appState.aiSessionId) addSession()
      saveSession()
      renderSessions()
      aiSessions.hidden = false
      aiNewSession.setAttribute("aria-expanded", "true")
      aiSessionList.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
    }).catch((error) => { aiDesignStatus.textContent = `无法打开会话：${String(error)}` })
  })
  aiSessionsClose.addEventListener("click", closeSessions)
  document.addEventListener("pointerdown", (event) => {
    if (aiSessions.hidden || aiSessions.contains(event.target as Node) || aiNewSession.contains(event.target as Node)) return
    closeSessions()
  })
  aiSessions.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    closeSessions()
  })
  bindListboxKeys(aiSessionList, (item) => selectSession(item.dataset.session!))
  aiSessionCreate.addEventListener("click", () => {
    if (appState.aiDesignBusy || appState.aiDesignDraft) return
    saveSession()
    appState.aiChatController?.clear()
    addSession()
    appState.aiDesignConversation = []
    aiDesignStatus.textContent = ""
    aiDesignPanel.dataset.state = "idle"
    renderSessions()
    syncAiDesignControls()
    closeSessions()
    appState.aiChatController?.focus()
  })
}
