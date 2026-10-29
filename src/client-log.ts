import { invoke } from "@tauri-apps/api/core"
import { strToU8, zipSync } from "fflate"

type LogLevel = "info" | "warn" | "error"
type LogDetails = Record<string, string | number | boolean | null | undefined>
type NativeLogFile = { name: string; data: number[] }

const nativeClient = "__TAURI_INTERNALS__" in window
const session = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const queue: string[] = []
let flushPromise: Promise<void> | undefined

function sanitizeDiagnosticText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value)
  return text
    .replace(/content:\/\/\S+/gi, "content://[redacted]")
    .replace(/file:\/\/\S+/gi, "file://[redacted]")
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\\/\s:]+[\\/])+([^\\/\s:]+)/g, "[path]/$1")
    .slice(0, 4_000)
}

function diagnosticError(error: unknown): { message: string; stack?: string } {
  if (!(error instanceof Error)) return { message: sanitizeDiagnosticText(error) }
  return {
    message: sanitizeDiagnosticText(error.message),
    ...(error.stack ? { stack: sanitizeDiagnosticText(error.stack) } : {}),
  }
}

function record(level: LogLevel, event: string, details: LogDetails = {}, error?: unknown): void {
  if (!nativeClient) return
  queue.push(JSON.stringify({
    timestamp: new Date().toISOString(),
    session,
    level,
    event,
    details,
    ...(error === undefined ? {} : { error: diagnosticError(error) }),
  }))
  // cap memory while native logging is unavailable; disk logs remain the source of truth.
  if (queue.length > 1_000) queue.splice(0, queue.length - 1_000)
}

export const clientLog = {
  info: (event: string, details?: LogDetails) => record("info", event, details),
  warn: (event: string, details?: LogDetails, error?: unknown) => record("warn", event, details, error),
  error: (event: string, details?: LogDetails, error?: unknown) => record("error", event, details, error),
}

export async function flushClientLogs(): Promise<void> {
  if (!nativeClient) return
  if (flushPromise) {
    await flushPromise
    return flushClientLogs()
  }
  if (!queue.length) return
  const encoder = new TextEncoder()
  const lines: string[] = []
  let size = 0
  while (queue.length) {
    const nextSize = encoder.encode(queue[0]).byteLength + 1
    if (lines.length && size + nextSize > 200 * 1024) break
    lines.push(queue.shift()!)
    size += nextSize
  }
  const batch = lines.join("\n")
  let flushed = true
  flushPromise = invoke<void>("append_client_log", { lines: batch })
    .catch(() => {
      flushed = false
      queue.unshift(...batch.split("\n"))
    })
    .finally(() => { flushPromise = undefined })
  await flushPromise
  if (flushed && queue.length) return flushClientLogs()
}

export function installClientLogging(version: string): void {
  if (!nativeClient) return
  clientLog.info("session.start", {
    version,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${screen.width}x${screen.height}`,
    hardwareConcurrency: navigator.hardwareConcurrency,
  })
  window.addEventListener("error", (event) => {
    clientLog.error("window.error", { source: event.filename.split("/").pop(), line: event.lineno, column: event.colno }, event.error ?? event.message)
    void flushClientLogs()
  })
  window.addEventListener("unhandledrejection", (event) => {
    clientLog.error("window.unhandledrejection", {}, event.reason)
    void flushClientLogs()
  })
  if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        clientLog.warn("performance.long_task", { durationMs: Math.round(entry.duration), startMs: Math.round(entry.startTime) })
      }
    }).observe({ type: "longtask", buffered: true })
  }
  let heartbeat = performance.now()
  window.setInterval(() => {
    const now = performance.now()
    const delay = now - heartbeat - 1_000
    heartbeat = now
    if (document.visibilityState === "visible" && delay > 250) {
      clientLog.warn("performance.event_loop_stall", { delayMs: Math.round(delay) })
    }
    void flushClientLogs()
  }, 1_000)
  document.addEventListener("visibilitychange", () => {
    clientLog.info("app.visibility", { state: document.visibilityState })
    if (document.visibilityState === "hidden") void flushClientLogs()
  })
}

export async function clientLogZip(): Promise<Uint8Array> {
  clientLog.info("logs.export")
  await flushClientLogs()
  const files = await invoke<NativeLogFile[]>("read_client_logs")
  return zipSync({
    ...Object.fromEntries(files.map((file) => [file.name, new Uint8Array(file.data)])),
    "diagnostics.json": strToU8(JSON.stringify({
      exportedAt: new Date().toISOString(),
      session,
      note: "日志不包含皮肤文件正文；本压缩包用于排查卡顿和解析异常。",
    }, null, 2)),
  }, { level: 6 })
}
