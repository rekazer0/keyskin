import "deep-chat"
import type { DeepChat } from "deep-chat"
import { iconMarkup } from "./icons"

export type AiChatRunHooks = {
  signal: AbortSignal
  onTextDelta: (delta: string) => Promise<void>
  onStatus?: (text: string, kind?: StepKind) => Promise<void>
  onThinking?: (text: string) => Promise<void>
}

export type AiChatRunResult = {
  fallback: string
  summary?: string
}

type AiChatRun = (prompt: string, hooks: AiChatRunHooks, files: readonly File[]) => Promise<AiChatRunResult>

export type AiChatSnapshot = {
  messages: ReturnType<DeepChat["getMessages"]>
  input: string
  attachments: File[]
  timelines: { group: number; position: number; node: HTMLElement }[]
}

export type AiChatController = {
  clear: () => void
  focus: () => void
  setEnabled: (enabled: boolean) => void
  setInput: (text: string) => void
  snapshot: () => AiChatSnapshot
  restore: (snapshot: AiChatSnapshot) => void
}

type StepKind = "thinking" | "reading" | "editing" | "done" | "error"

type RunStep = { kind: StepKind; text: string }

type RunState = {
  id: string
  bodyId: string
  startedAt: number
  count: number
  steps: RunStep[]
  reasoning: string
  status: "running" | "done" | "stopped" | "error"
  finishedAt?: number
  timer?: ReturnType<typeof setInterval>
  frame?: number
}

function stepRow(step: RunStep): HTMLLIElement {
  const item = document.createElement("li")
  item.className = "ai-run-step"
  item.dataset.kind = step.kind
  item.innerHTML = `<span class="ai-run-step-icon">${stepIcon(step.kind)}</span>`
  const label = document.createElement("span")
  label.className = "ai-run-step-text"
  label.textContent = step.text
  item.append(label)
  return item
}

/** 1.4px stroke glyphs, matching the inspector's system symbols. */
function stepIcon(kind: StepKind): string {
  const names: Record<StepKind, string> = { thinking: "sparkles", reading: "file-text", editing: "pen-line", done: "check", error: "circle-alert" }
  return iconMarkup(names[kind], 16, 1.4)
}

/** Steps arrive as “AI 读取 project.bds…” (or “方案 1 · AI …”) — the panel already says who is acting. */
function stepText(text: string): string {
  return text.replace(/^((?:方案 \d+ · )?)AI\s*/, "$1").trim()
}

function duration(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
}

function runMarkup(id: string, bodyId: string): string {
  return `<section class="ai-run" id="${id}" aria-label="AI 处理步骤" data-state="running">`
    + `<button class="ai-run-head" type="button" aria-expanded="true" aria-controls="${bodyId}">`
    + `<span class="ai-run-spark" aria-hidden="true">${iconMarkup("sparkles", 14)}</span>`
    + '<span class="ai-run-label">思考中…</span>'
    + '<span class="ai-run-caret" aria-hidden="true">' + iconMarkup("chevron-down", 16) + "</span>"
    + "</button>"
    + `<div class="ai-run-body" id="${bodyId}">`
    + '<ol class="ai-run-steps"></ol>'
    + '<details class="ai-run-think" hidden><summary>思考过程</summary><div class="ai-run-think-text"></div></details>'
    + "</div></section>"
}

function configureAppearance(chat: DeepChat): void {
  // deep-chat's styles are inline or live in its shadow root; custom properties
  // inherit through it, so referencing the design tokens keeps the conversation
  // on the panel's palette and follows theme switches without reconnecting.
  const text = "var(--text)"
  const muted = "var(--tertiary)"
  const secondary = "var(--secondary)"
  const control = "var(--control)"
  const sunken = "var(--material-content)"
  const line = "var(--line)"
  const lineStrong = "var(--line-strong)"
  const accent = "var(--accent)"
  const accentSoft = "var(--accent-soft)"
  const onAccent = "var(--on-accent)"
  const hover = "var(--hover)"
  const ok = "var(--state-ok)"
  const danger = "var(--state-danger)"
  const mono = "var(--font-mono)"
  const radiusLg = "var(--radius-lg)"
  const radiusMd = "var(--radius-md)"
  const radiusSm = "var(--radius-sm)"
  const radiusFull = "var(--radius-full)"
  const fast = "var(--duration-fast) var(--ease-standard)"
  const xs = "var(--font-size-xs)"
  const sm = "var(--font-size-sm)"
  const md = "var(--font-size-md)"
  const lg = "var(--font-size-lg)"

  chat.chatStyle = {
    width: "100%",
    height: "100%",
    border: "0",
    borderRadius: "0",
    backgroundColor: "transparent",
    color: text,
    // An explicit family also stops deep-chat from injecting its Google Fonts
    // stylesheet, which the CSP blocks and the offline desktop app cannot load.
    fontFamily: "var(--font-ui)",
  }
  chat.inputAreaStyle = {
    width: "auto",
    alignSelf: "end",
    margin: "0 16px 16px",
    border: "0",
    backgroundColor: "transparent",
    boxShadow: "none",
  }
  // The box grows with its text and its top edge drags it taller; the bottom band holds the model picker
  // (overlaid from the panel) and the send button.
  chat.textInput = {
    placeholder: { text: "描述想要的风格或改动，例如“换成深海蓝，回车键用亮青色”…", style: { color: muted } },
    characterLimit: 8_000,
    styles: {
      text: { color: text, fontSize: sm, lineHeight: "1.6", padding: "12px 12px 0",
        boxSizing: "border-box", minHeight: "96px", maxHeight: "60vh", overflowY: "auto" },
      container: {
        width: "100%", boxSizing: "border-box", margin: "0", paddingBottom: "40px",
        height: "auto", maxHeight: "none", overflow: "hidden",
        border: `1px solid ${lineStrong}`, borderRadius: radiusLg, backgroundColor: control,
        boxShadow: "var(--shadow-sm)",
      },
      focus: { borderColor: accent, boxShadow: "var(--focus-ring)" },
    },
  }

  // Everything below lives in deep-chat's shadow root, so it is written here
  // rather than in the stylesheets: the panel keeps its structure, the
  // conversation keeps its voice. The reference is a task timeline — steps and
  // reasoning as quiet left-aligned rows, no chat bubbles around prose.
  chat.auxiliaryStyle = `
    #chat-view { grid-template-rows: minmax(0, 1fr) auto; }
    #messages { min-height: 0; }
    .outer-message-container { padding: 0 16px; }
    .outer-message-container + .outer-message-container { margin-top: 8px; }
    /* The run timeline is injected, so it does not inherit messageStyles — it has
       to shed deep-chat's default grey bubble on its own. */
    .ai-run-holder .message-bubble { max-width: 100%; padding: 0; border: 0;
      border-radius: 0; background: transparent; box-shadow: none; color: ${text}; }

    /* --- empty state: sits on the composer, not in the middle of nowhere -- */
    .intro-panel { position: static; flex-direction: column; justify-content: flex-end;
      box-sizing: border-box; width: 100%; height: auto; min-height: 100%; margin: 0; }
    .ai-welcome { display: grid; gap: 8px; box-sizing: border-box; padding: 16px 16px 12px;
      text-align: left; color: ${text}; }
    .ai-welcome h2 { margin: 0; font-size: ${lg}; font-weight: 600; }
    .ai-welcome p { margin: 0 0 4px; color: ${secondary}; font-size: ${xs}; line-height: 1.6; }
    .ai-welcome h3 { margin: 8px 0 0; color: ${muted}; font-size: ${xs}; font-weight: 500; }
    .ai-suggestions { display: grid; gap: 4px; }
    .ai-suggestions[data-layout="grid"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .ai-suggestions[data-layout="chips"] { display: flex; flex-wrap: wrap; gap: 6px; }
    .ai-suggestions[data-layout="chips"] button { width: auto; padding: 4px 12px; border-radius: ${radiusFull}; }
    .ai-suggestions button { display: grid; gap: 2px; width: 100%; min-width: 0; padding: 8px 12px;
      font: inherit; text-align: left; color: ${text}; background: ${sunken};
      border: 1px solid transparent; border-radius: ${radiusMd}; cursor: default;
      transition: background-color ${fast}, border-color ${fast}; }
    .ai-suggestions strong { font-size: ${sm}; font-weight: 500; }
    .ai-suggestions span { overflow: hidden; color: ${muted}; font-size: ${xs};
      text-overflow: ellipsis; white-space: nowrap; }
    @media (hover: hover) {
      .ai-suggestions button:hover { border-color: ${line}; background: ${accentSoft}; }
      .ai-suggestions button:hover strong { color: ${accent}; }
    }
    .ai-suggestions button:active { background: color-mix(in srgb, ${text} 10%, transparent); }
    .ai-suggestions button:focus-visible { outline: 0; box-shadow: var(--focus-ring); }

    /* A pending draft replaces the composer until it is applied or discarded. */
    :host([data-draft]) #input { display: none; }

    /* --- run timeline: “处理中 · 12s · 6 个步骤” ----------------------------- */
    .ai-run { margin: 2px 0 8px; }
    .ai-run-head { display: inline-flex; align-items: center; gap: 8px; max-width: 100%;
      margin: 0; padding: 4px 0; border: 0; background: none; font: inherit;
      color: ${muted}; cursor: default; text-align: left; }
    @media (hover: hover) { .ai-run-head:hover { color: ${secondary}; } }
    .ai-run-head:focus-visible { outline: 0; box-shadow: var(--focus-ring); border-radius: ${radiusSm}; }
    .ai-run-spark { display: grid; place-items: center; width: 16px; height: 16px; color: ${accent}; }
    .ai-run-spark svg { width: 14px; height: 14px; }
    .ai-run-label { font-size: ${sm}; font-variant-numeric: tabular-nums; }
    .ai-run-caret { display: grid; place-items: center; width: 14px; height: 14px;
      transition: transform var(--duration-base) var(--ease-standard); }
    .ai-run-caret svg { width: 14px; height: 14px; }
    .ai-run-head[aria-expanded="false"] .ai-run-caret { transform: rotate(-90deg); }
    .ai-run-head[aria-expanded="false"] + .ai-run-body { display: none; }
    .ai-run-steps { display: grid; gap: 0; margin: 2px 0 0; padding: 0; list-style: none; }
    .ai-run-step { display: grid; grid-template-columns: 16px minmax(0, 1fr); align-items: start;
      gap: 8px; padding: 2px 0; color: ${secondary}; font-size: ${xs}; line-height: 1.6; }
    .ai-run-step-icon { display: grid; place-items: center; width: 16px; height: 16px;
      margin-top: 1px; color: ${muted}; }
    .ai-run-step-icon svg { display: block; width: 14px; height: 14px; }
    .ai-run-step[data-kind="editing"], .ai-run-step[data-kind="editing"] .ai-run-step-icon { color: ${accent}; }
    .ai-run-step[data-kind="done"] .ai-run-step-icon { color: ${ok}; }
    .ai-run-step[data-kind="error"], .ai-run-step[data-kind="error"] .ai-run-step-icon { color: ${danger}; }
    .ai-run[data-state="running"] .ai-run-spark { animation: ai-run-pulse 1.4s ease-in-out infinite; }
    @keyframes ai-run-pulse { 50% { opacity: .35; } }
    .ai-run-step-text { min-width: 0; overflow-wrap: anywhere; }
    .ai-run-think { margin: 4px 0 0; }
    .ai-run-think > summary { padding: 2px 0; color: ${muted}; font-size: ${xs};
      list-style: none; cursor: default; }
    .ai-run-think > summary::-webkit-details-marker { display: none; }
    .ai-run-think > summary::before { content: "▸ "; }
    .ai-run-think[open] > summary::before { content: "▾ "; }
    .ai-run-think > summary:focus-visible { outline: 0; box-shadow: var(--focus-ring); border-radius: ${radiusSm}; }
    .ai-run-think-text { max-height: 240px; margin: 4px 0 0; overflow: auto;
      padding: 0 0 0 12px; border-left: 1px solid ${line};
      color: ${muted}; font-family: ${mono}; font-size: ${xs}; line-height: 1.7;
      white-space: pre-wrap; overflow-wrap: anywhere; }

    /* --- prose: no bubbles, the panel already frames the conversation ------ */
    .message-bubble { max-width: 100%; overflow-wrap: anywhere; text-align: left; }
    .message-bubble > :first-child { margin-top: 0; }
    .message-bubble > :last-child { margin-bottom: 0; }
    .message-bubble p { margin: 0 0 .6em; }
    .message-bubble :is(ul, ol) { margin: .2em 0 .7em; padding-left: 1.35em; }
    .message-bubble li { margin: .15em 0; }
    .message-bubble pre { max-width: 100%; margin: .5em 0; padding: 8px 12px; overflow-x: auto;
      border: 1px solid ${line}; border-radius: ${radiusSm}; background: ${sunken};
      font-family: ${mono}; font-size: ${xs}; line-height: 1.6; }
    .message-bubble code { font-family: ${mono}; font-size: .94em; }
    .message-bubble :not(pre) > code { padding: 1px 4px; border-radius: ${radiusSm};
      background: color-mix(in srgb, ${text} 6%, transparent); }
    .message-bubble a { color: ${accent}; }

    /* The submit glyph is stroke-drawn; deep-chat's own rule fills it and colourises
       it with a filter, which turns the arrow into a grey blob. */
    #submit-icon { width: 14px !important; height: 14px !important; filter: none !important;
      fill: none !important; stroke: currentColor; stroke-width: 1.5; }
    #text-input:focus-visible { outline: none; }
    /* Pasted / dropped attachments sit above the text, inside the composer. */
    #text-input-container { flex-wrap: wrap; transition: border-color ${fast}, box-shadow ${fast}; }
    .ai-attachments { display: flex; flex: 0 0 100%; flex-wrap: wrap; gap: 6px; box-sizing: border-box; padding: 12px 12px 0; }
    .ai-attachments:empty { display: none; }
    .ai-attachment { display: inline-flex; align-items: center; gap: 6px; max-width: 180px; height: 28px;
      padding: 0 4px; border: 1px solid ${line}; border-radius: ${radiusSm}; background: ${sunken};
      color: ${secondary}; font-size: ${xs}; }
    .ai-attachment img { width: 20px; height: 20px; border-radius: ${radiusSm}; object-fit: cover; }
    .ai-attachment-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ai-attachment button { display: grid; place-items: center; width: 20px; height: 20px; padding: 0;
      border: 0; border-radius: ${radiusSm}; background: none; color: ${muted}; font: inherit; cursor: default; }
    @media (hover: hover) { .ai-attachment button:hover { color: ${text}; background: ${hover}; } }
    .ai-attachment button:focus-visible { outline: 0; box-shadow: var(--focus-ring); }
    #text-input-container[data-dropping] { border-color: ${accent} !important; }

    /* Top-edge grip: the composer is anchored to the bottom, so it grows upward. */
    .ai-resize { position: absolute; top: 0; left: 0; right: 0; z-index: 2; height: 12px;
      cursor: ns-resize; touch-action: none; }
    .ai-resize::after { content: ""; position: absolute; top: 4px; left: 50%; width: 32px; height: 3px;
      margin-left: -16px; border-radius: ${radiusFull}; background: ${lineStrong}; opacity: 0;
      transition: opacity ${fast}; }
    #text-input-container:hover .ai-resize::after, .ai-resize:focus-visible::after,
    .ai-resize[data-dragging]::after { opacity: 1; }
    .ai-resize:focus-visible { outline: none; }
    .input-button { display: grid !important; place-items: center; padding: 0 !important; margin: 0 !important; }
    .input-button > svg { width: 14px !important; height: 14px !important; fill: none !important;
      stroke: currentColor !important; filter: none !important; }
    #text-input:empty::before { font-weight: 400; }
    #scroll-button { padding: 8px; border: 1px solid ${line}; border-radius: ${radiusFull};
      background: ${control}; box-shadow: var(--shadow-md); }
    #scroll-button svg { width: 12px; height: 12px; color: ${secondary}; }

    /* Phones get half a screen at best: a two-line composer, suggestions as
       scrolling rows of chips, and no drag grip. */
    @media (max-width: 760px) {
      #text-input { min-height: 44px !important; max-height: 30vh !important; padding-top: 12px !important; }
      #text-input-container { padding-bottom: 36px !important; }
      .ai-resize { display: none; }
      .ai-welcome { gap: 8px; padding: 8px 16px 12px; }
      .ai-welcome p, .ai-welcome h3 { display: none; }
      .ai-welcome h2 { font-size: ${md}; }
      .ai-suggestions, .ai-suggestions[data-layout] { display: flex; flex-wrap: nowrap; gap: 6px; margin: 0 -16px; padding: 0 16px;
        overflow-x: auto; scrollbar-width: none; scroll-padding: 0 16px; }
      .ai-suggestions::-webkit-scrollbar { display: none; }
      .ai-suggestions button, .ai-suggestions[data-layout] button { flex: none; width: auto; padding: 6px 12px;
        border-radius: ${radiusFull}; white-space: nowrap; }
      .ai-suggestions span { display: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      * { scroll-behavior: auto !important; animation: none !important; transition: none !important; }
    }
  `
  chat.messageStyles = {
    default: {
      shared: { bubble: { fontSize: sm, lineHeight: "1.7" } },
      user: {
        bubble: {
          color: text,
          backgroundColor: sunken,
          border: "0",
          borderRadius: radiusLg,
          boxShadow: "none",
          padding: "8px 12px",
          maxWidth: "86%",
        },
      },
      ai: {
        bubble: {
          color: text,
          backgroundColor: "transparent",
          border: "0",
          borderRadius: "0",
          boxShadow: "none",
          padding: "0",
          maxWidth: "100%",
        },
      },
    },
  }
  const button = { borderRadius: radiusMd, boxSizing: "border-box", width: "28px", height: "28px", bottom: "6px", right: "6px", boxShadow: "none" }
  chat.submitButtonStyles = {
    position: "inside-end",
    tooltip: { text: "发送；生成时点击可停止" },
    submit: {
      // A symmetric arrow sits optically centred, unlike the default paper plane.
      svg: { content: iconMarkup("arrow-up", 14) },
      container: {
        default: { ...button, backgroundColor: accent, color: onAccent },
        hover: { backgroundColor: `color-mix(in srgb, ${accent} 88%, ${text})`, transform: "none" },
      },
    },
    disabled: {
      container: { default: { ...button, backgroundColor: sunken, border: `1px solid ${line}`, color: muted, cursor: "not-allowed" } },
    },
    stop: {
      container: { default: { ...button, border: `1px solid ${lineStrong}`, backgroundColor: sunken, color: secondary } },
    },
  }
  chat.focusMode = { smoothScroll: true, streamAutoScroll: true, fade: false }
  chat.scrollButton = { smoothScroll: true }
  chat.errorMessages = { displayServiceErrorMessages: false }
  chat.remarkable = { linkTarget: "_blank", breaks: true, html: false }
}

// min/max-height on the input clamp whatever height the drag asks for.
function resizeGrip(input: HTMLElement): HTMLElement {
  const grip = document.createElement("div")
  grip.className = "ai-resize"
  grip.tabIndex = 0
  grip.setAttribute("role", "separator")
  grip.setAttribute("aria-orientation", "horizontal")
  grip.setAttribute("aria-label", "拖动调整输入框高度")
  grip.onpointerdown = (event) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = input.offsetHeight
    grip.setPointerCapture(event.pointerId)
    grip.dataset.dragging = ""
    grip.onpointermove = (move) => { input.style.height = `${startHeight + startY - move.clientY}px` }
    grip.onpointerup = grip.onpointercancel = () => { grip.onpointermove = null; delete grip.dataset.dragging }
  }
  grip.onkeydown = (event) => {
    const step = event.key === "ArrowUp" ? 24 : event.key === "ArrowDown" ? -24 : 0
    if (!step) return
    event.preventDefault()
    input.style.height = `${input.offsetHeight + step}px`
  }
  return grip
}

export async function connectAiChat(element: HTMLElement, run: AiChatRun): Promise<AiChatController> {
  await customElements.whenDefined("deep-chat")
  const chat = element as DeepChat
  configureAppearance(chat)

  let attachments: File[] = []
  let attachmentStrip: HTMLElement | undefined
  const paintAttachments = () => {
    if (!attachmentStrip) return
    attachmentStrip.querySelectorAll("img").forEach((image) => URL.revokeObjectURL(image.src))
    attachmentStrip.replaceChildren(...attachments.map((file, index) => {
      const chip = document.createElement("span")
      chip.className = "ai-attachment"
      if (file.type.startsWith("image/")) {
        const image = document.createElement("img")
        image.src = URL.createObjectURL(file)
        image.alt = ""
        chip.append(image)
      }
      const name = document.createElement("span")
      name.className = "ai-attachment-name"
      name.textContent = file.name || "粘贴的图片"
      name.title = name.textContent
      const remove = document.createElement("button")
      remove.type = "button"
      remove.textContent = "×"
      remove.setAttribute("aria-label", `移除附件 ${name.textContent}`)
      remove.onclick = () => {
        attachments = attachments.filter((_, other) => other !== index)
        paintAttachments()
      }
      chip.append(name, remove)
      return chip
    }))
  }
  const addAttachments = (files: readonly File[]) => {
    // shortcut: 8 files per message keeps prompts bounded; raise if users need more.
    attachments = [...attachments, ...files].slice(0, 8)
    paintAttachments()
  }

  chat.onComponentRender = () => {
    const input = chat.shadowRoot?.querySelector<HTMLElement>("#text-input")
    input?.setAttribute("aria-label", "描述你想要的皮肤效果")
    const box = chat.shadowRoot?.querySelector<HTMLElement>("#text-input-container")
    if (input && box && !box.querySelector(".ai-resize")) box.prepend(resizeGrip(input))
    if (input && box && !attachmentStrip?.isConnected) {
      attachmentStrip = document.createElement("div")
      attachmentStrip.className = "ai-attachments"
      attachmentStrip.setAttribute("aria-label", "附件")
      input.before(attachmentStrip)
      paintAttachments()
      // Deleting everything can leave a stray <br>; deep-chat then treats the box as empty
      // but :empty fails, so the placeholder never comes back.
      input.addEventListener("input", () => {
        if (input.textContent === "" && input.childNodes.length) input.replaceChildren()
      })
      // Capture phase: deep-chat's own paste handler only keeps plain text.
      input.addEventListener("paste", (event) => {
        const files = [...event.clipboardData?.files ?? []]
        if (!files.length) return
        event.preventDefault()
        event.stopImmediatePropagation()
        addAttachments(files)
      }, true)
      box.addEventListener("dragover", (event) => {
        if (!event.dataTransfer?.types.includes("Files")) return
        event.preventDefault()
        box.dataset.dropping = ""
      })
      box.addEventListener("dragleave", () => delete box.dataset.dropping)
      box.addEventListener("drop", (event) => {
        delete box.dataset.dropping
        const files = [...event.dataTransfer?.files ?? []]
        if (!files.length) return
        event.preventDefault()
        addAttachments(files)
      })
    }
    chat.shadowRoot?.querySelector(".input-button[role=button]")?.setAttribute("aria-label", "发送消息；生成时点击停止")
    const suggestions = [...chat.shadowRoot?.querySelectorAll<HTMLButtonElement>("[data-ai-prompt]") ?? []]
    const presets = new Set(suggestions.map((button) => button.dataset.aiPrompt))
    suggestions.forEach((button) => {
      button.onclick = () => {
        if (!input) return
        // Picking another preset swaps it in; the user's own words are kept and the preset appended.
        const draft = input.innerText.trim()
        input.innerText = presets.has(draft) ? button.dataset.aiPrompt ?? "" : [draft, button.dataset.aiPrompt].filter(Boolean).join("\n")
        input.dispatchEvent(new Event("input", { bubbles: true }))
        chat.focusInput()
        const range = document.createRange()
        range.selectNodeContents(input)
        range.collapse(false)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    })
  }
  chat.requestBodyLimits = { maxMessages: 1, totalMessagesMaxCharLength: 8_000 }
  chat.validateInput = (text) => Boolean(text?.trim()) && (text?.length ?? 0) <= 8_000

  let activeController: AbortController | undefined
  let submitEnabled = true
  let closeActive: (() => void) | undefined
  let generation = 0

  // The timeline is kept as data and re-painted into whatever section deep-chat
  // currently renders; injected nodes do not survive a message-list re-render.
  let timeline: RunState | undefined

  const runNodes = (state: RunState) => {
    const section = chat.shadowRoot?.querySelector<HTMLElement>(`#${state.id}`)
    return {
      section,
      head: section?.querySelector<HTMLButtonElement>(".ai-run-head") ?? null,
      label: section?.querySelector<HTMLElement>(".ai-run-label") ?? null,
      steps: section?.querySelector<HTMLOListElement>(".ai-run-steps") ?? null,
      think: section?.querySelector<HTMLDetailsElement>(".ai-run-think") ?? null,
      thinkText: section?.querySelector<HTMLElement>(".ai-run-think-text") ?? null,
    }
  }

  const runLabel = (state: RunState): string => {
    const prefix = state.status === "running" ? "处理中" : state.status === "stopped" ? "已停止" : state.status === "error" ? "未完成" : "已处理"
    const seconds = Math.max(0, Math.round(((state.finishedAt ?? Date.now()) - state.startedAt) / 1000))
    return `${prefix} · ${duration(seconds)} · ${state.count} 个步骤`
  }

  /**
   * The timeline is our own node, not a deep-chat message: adding it through
   * `addMessage` consumes the loading placeholder deep-chat expects to find
   * last, and it then reports a bogus error whenever a run streams no text.
   * It is appended to the group holding the current turn, so the answer that
   * streams next still lands underneath it.
   */
  const mountRun = (state: RunState): boolean => {
    const messages = chat.shadowRoot?.querySelector<HTMLElement>("#messages")
    if (!messages) return false
    if (messages.querySelector(`#${state.id}`)) return true
    const holder = document.createElement("div")
    holder.className = "ai-run-holder outer-message-container deep-chat-outer-container-role-ai"
      + " deep-chat-top-message deep-chat-bottom-message"
    holder.innerHTML = `<div class="inner-message-container">`
      + `<div class="message-bubble ai-message ai-message-text html-message">`
      + `${runMarkup(state.id, state.bodyId)}</div></div>`
    const groups = [...messages.children].filter((node) =>
      node.id !== "scroll-button" && !node.classList.contains("intro-panel"))
    ;(groups.at(-1) ?? messages).append(holder)
    return Boolean(messages.querySelector(`#${state.id}`))
  }

  const paintRun = (state: RunState): void => {
    if (!mountRun(state)) return
    const nodes = runNodes(state)
    if (!nodes.section || !nodes.head || !nodes.label || !nodes.steps) return
    if (!nodes.head.dataset.bound) {
      nodes.head.dataset.bound = "1"
      const head = nodes.head
      head.addEventListener("click", () => {
        head.setAttribute("aria-expanded", head.getAttribute("aria-expanded") === "true" ? "false" : "true")
      })
    }
    // Steps only ever grow; append the new rows instead of rebuilding the list.
    const painted = nodes.steps.childElementCount
    if (painted > state.steps.length) nodes.steps.replaceChildren(...state.steps.map(stepRow))
    else if (painted < state.steps.length) nodes.steps.append(...state.steps.slice(painted).map(stepRow))
    nodes.label.textContent = runLabel(state)
    if (nodes.think && nodes.thinkText) {
      nodes.think.hidden = state.reasoning === ""
      if (state.reasoning) {
        const atBottom = nodes.thinkText.scrollHeight - nodes.thinkText.scrollTop - nodes.thinkText.clientHeight < 32
        nodes.thinkText.textContent = state.reasoning
        if (nodes.think.open && atBottom) nodes.thinkText.scrollTop = nodes.thinkText.scrollHeight
      }
    }
    nodes.section.dataset.state = state.status
    if (state.status !== "running") nodes.head.setAttribute("aria-expanded", "false")
  }

  const startRun = (id: number): RunState | undefined => {
    const state: RunState = {
      id: `ai-run-${id}`, bodyId: `ai-run-body-${id}`, startedAt: Date.now(),
      count: 0, steps: [], reasoning: "", status: "running",
    }
    if (!mountRun(state)) return undefined
    state.timer = setInterval(() => paintRun(state), 1_000)
    return state
  }

  const finishRun = (status: "done" | "stopped" | "error"): void => {
    if (!timeline) return
    if (timeline.timer !== undefined) clearInterval(timeline.timer)
    timeline.timer = undefined
    timeline.status = status
    timeline.finishedAt = Date.now()
    paintRun(timeline)
  }

  chat.connect = {
    stream: { partialRender: true },
    handler: (body, signals) => {
      const prompt = String(body?.messages?.at(-1)?.text ?? "").trim()
      const files = attachments
      attachments = []
      paintAttachments()
      const controller = new AbortController()
      activeController?.abort()
      closeActive?.()
      // Each turn owns its own timeline; the previous one is already folded away.
      timeline = undefined
      const currentGeneration = ++generation
      activeController = controller
      const isCurrent = () => currentGeneration === generation
      let streamed = false
      let closed = false
      let failed = false

      const openRun = (): RunState | undefined => {
        if (!timeline) timeline = startRun(currentGeneration)
        return timeline
      }

      const close = () => {
        if (closed) return
        closed = true
        if (isCurrent()) finishRun(controller.signal.aborted ? "stopped" : failed ? "error" : "done")
        signals.onClose()
        if (closeActive === close) closeActive = undefined
      }
      closeActive = close

      const appendStep = (kind: StepKind, rawText: string): void => {
        if (!isCurrent() || closed || !rawText.trim()) return
        const state = openRun()
        if (!state) return
        const text = stepText(rawText)
        const last = state.steps.at(-1)
        if (last?.kind === kind && last.text === text) return
        state.steps.push({ kind, text })
        state.count = state.steps.length
        paintRun(state)
      }

      signals.stopClicked.listener = () => controller.abort()
      signals.onOpen()
      if (files.length) appendStep("reading", `附带 ${files.length} 个附件：${files.map((file) => file.name || "粘贴的图片").join("、")}`)

      void run(prompt, {
        signal: controller.signal,
        onStatus: async (text, kind = "thinking") => appendStep(kind, text),
        onThinking: async (text) => {
          if (controller.signal.aborted || !isCurrent() || !text.trim()) return
          const state = openRun()
          if (!state) return
          state.reasoning = text
          // Reasoning streams per token; repainting the whole text each time freezes the window.
          state.frame ??= requestAnimationFrame(() => {
            state.frame = undefined
            paintRun(state)
          })
        },
        onTextDelta: async (delta) => {
          if (controller.signal.aborted || !isCurrent()) return
          streamed = true
          await signals.onResponse({ text: delta })
        },
      }, files).then(async ({ fallback, summary }) => {
        if (currentGeneration !== generation) return
        if (controller.signal.aborted) throw new DOMException("已停止生成", "AbortError")
        if (!streamed && fallback) await signals.onResponse({ text: fallback })
        if (summary) await signals.onResponse({ text: `\n\n${summary}` })
      }).catch(async (error) => {
        if (currentGeneration !== generation) return
        failed = !controller.signal.aborted
        const message = controller.signal.aborted
          ? "AI 设计已取消，没有应用任何修改。"
          : error instanceof Error ? error.message : String(error)
        appendStep("error", message)
        await signals.onResponse({ text: `${streamed ? "\n\n" : ""}${message}` })
      }).finally(() => {
        if (activeController === controller) activeController = undefined
        if (isCurrent()) close()
      })
    },
  }
  return {
    snapshot: () => {
      const groups = [...(chat.shadowRoot?.querySelector("#messages")?.children ?? [])].filter((node) => node.id !== "scroll-button" && !node.classList.contains("intro-panel"))
      return {
        messages: chat.getMessages().map((message) => ({ ...message })),
        input: chat.shadowRoot?.querySelector<HTMLElement>("#text-input")?.innerText ?? "",
        attachments: [...attachments],
        timelines: [...(chat.shadowRoot?.querySelectorAll<HTMLElement>(".ai-run-holder") ?? [])].map((node) => ({
          group: groups.indexOf(node.parentElement!), position: [...node.parentElement!.children].indexOf(node), node,
        })),
      }
    },
    restore: (snapshot) => {
      for (const message of snapshot.messages) chat.addMessage(message)
      const groups = [...(chat.shadowRoot?.querySelector("#messages")?.children ?? [])].filter((node) => node.id !== "scroll-button" && !node.classList.contains("intro-panel"))
      for (const { group, position, node } of snapshot.timelines) groups[group]?.insertBefore(node, groups[group]!.children[position] ?? null)
      attachments = [...snapshot.attachments]
      paintAttachments()
      const input = chat.shadowRoot?.querySelector<HTMLElement>("#text-input")
      if (input) {
        input.innerText = snapshot.input
        input.dispatchEvent(new Event("input", { bubbles: true }))
      }
    },
    clear: () => {
      generation += 1
      activeController?.abort()
      activeController = undefined
      closeActive?.()
      if (timeline?.timer !== undefined) clearInterval(timeline.timer)
      if (timeline?.frame !== undefined) cancelAnimationFrame(timeline.frame)
      timeline = undefined
      attachments = []
      paintAttachments()
      // 时间线是自建节点，deep-chat 不认识它，清空时要自己带走。
      chat.shadowRoot?.querySelectorAll(".ai-run-holder").forEach((holder) => holder.remove())
      // `true` is deep-chat's "reset": it restores the intro panel through its own
      // display() guard, so the welcome comes back after a skin switch. Touching
      // the inline style instead would leave deep-chat's flag stuck at "hidden"
      // and the welcome plate would then stay on top of the next conversation.
      chat.clearMessages(true)
      const input = chat.shadowRoot?.querySelector<HTMLElement>("#text-input")
      if (input) {
        input.innerText = ""
        input.dispatchEvent(new Event("input", { bubbles: true }))
      }
    },
    setInput: (text) => {
      const input = chat.shadowRoot?.querySelector<HTMLElement>("#text-input")
      if (!input || activeController) return
      input.innerText = text.slice(0, 8_000)
      input.dispatchEvent(new Event("input", { bubbles: true }))
      chat.focusInput()
    },
    focus: () => chat.focusInput(),
    setEnabled: (enabled) => {
      // Called on every inspector refresh; only touch deep-chat when the state flips.
      if (enabled === submitEnabled) return
      submitEnabled = enabled
      chat.disableSubmitButton(!enabled)
    },
  }
}
