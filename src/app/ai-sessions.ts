import type { AiChatSnapshot } from "../ai-chat"
import type { AiDesignConversation } from "../ai-design"
import { bindListboxKeys } from "../dom-element"
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
  const session: AiSession = { id: crypto.randomUUID(), title: "新会话", conversation: [], status: "", state: "idle" }
  appState.aiSessions.unshift(session)
  appState.aiSessionId = session.id
}

function renderSessions(): void {
  aiSessionList.replaceChildren(...appState.aiSessions.map((session) => {
    const item = document.createElement("button")
    item.type = "button"
    item.className = "ui-list-item"
    item.dataset.session = session.id
    item.setAttribute("role", "option")
    item.setAttribute("aria-selected", String(session.id === appState.aiSessionId))
    item.tabIndex = session.id === appState.aiSessionId ? 0 : -1
    const title = document.createElement("span")
    title.className = "ui-list-item-text"
    const text = document.createElement("strong")
    text.textContent = session.title
    title.append(text)
    item.append(title)
    item.title = session.title
    item.addEventListener("click", () => selectSession(session.id))
    return item
  }))
  syncAiSessionControls()
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
  aiSessionList.querySelectorAll<HTMLButtonElement>("button").forEach((item) => { item.disabled = disabled })
}

export function wireAiSessions(): void {
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
