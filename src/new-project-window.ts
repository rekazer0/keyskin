import { initializeProjectChooser, projectChoice } from "./project-chooser"
import { emitTo } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"

const form = document.querySelector<HTMLFormElement>("#new-project-window-form")!
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel")!
const isTauri = "__TAURI_INTERNALS__" in window
const appWindow = isTauri ? getCurrentWindow() : undefined
initializeProjectChooser(form)
form.addEventListener("project-import", () => void finish("__import__"))
let finished = false
let resultSent = false
const errorMessage = document.querySelector<HTMLElement>("#project-error")!

const themePreference = localStorage.getItem("app-theme")
const resolvedTheme = themePreference === "light" || themePreference === "dark"
  ? themePreference
  : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
document.documentElement.dataset.appTheme = resolvedTheme
document.documentElement.style.colorScheme = resolvedTheme
if (appWindow) void appWindow.setTheme(themePreference === "light" || themePreference === "dark" ? themePreference : null)

async function finish(templateID?: string): Promise<void> {
  if (finished) return
  const choice = projectChoice(form)
  finished = true
  errorMessage.hidden = true
  const controls = form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")
  controls.forEach((control) => { control.disabled = true })
  try {
    if (!appWindow) throw new Error("请在桌面应用中使用新建皮肤功能。")
    if (!resultSent) {
      if (templateID) await emitTo("main", "new-project-select", { ...choice, templateID })
      else await emitTo("main", "new-project-cancel")
      resultSent = true
    }
    // close() re-enters onCloseRequested; destroy the completed chooser directly.
    await appWindow.destroy()
  } catch (error) {
    finished = false
    controls.forEach((control) => { control.disabled = false })
    errorMessage.textContent = resultSent
      ? "窗口未能关闭，请点击取消重试。"
      : `操作未完成，请重试。${String(error)}`
    errorMessage.hidden = false
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault()
  const templateID = new FormData(form).get("project-template")
  if (typeof templateID === "string") void finish(templateID)
})

cancelButton.addEventListener("click", () => void finish())
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.defaultPrevented) void finish()
})
if (appWindow) {
  void appWindow.onCloseRequested(async (event) => {
    event.preventDefault()
    await finish()
  })
  void emitTo("main", "new-project-ready")
}
