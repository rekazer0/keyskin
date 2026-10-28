import { isAndroidTauri, isTauri } from "./canvas-interaction"
import { invoke } from "@tauri-apps/api/core"
import { appState } from "./state"
import { initializeProjectChooser, projectChoice } from "../project-chooser"
import { newProjectForm, newProjectDialog, openButton, documentName } from "./dom"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { prepareDocumentReplacement, updateDirty } from "./edit-history"
import { loadArchive, writeNativePath } from "./archive-io"
import { loadBuiltInProjectTemplate } from "../operations.ts"
import { showStatus, runFileOperation } from "./file-operations"
import { exportName } from "../export.ts"

async function chooseProjectTemplate(): Promise<string | undefined> {
  if (isAndroidTauri()) return chooseAndroidProjectTemplate()
  if (isTauri()) {
    const templateID = await chooseNativeProjectTemplate()
    return templateID === EMBEDDED_PROJECT_FALLBACK
      ? chooseEmbeddedProjectTemplate()
      : templateID
  }
  return chooseEmbeddedProjectTemplate()
}

async function chooseAndroidProjectTemplate(): Promise<string | undefined> {
  try {
    return await invoke<string>("choose_project_template")
  } catch (error) {
    if (String(error).includes("project template selection cancelled")) return undefined
    throw error
  }
}

function chooseEmbeddedProjectTemplate(): Promise<string | undefined> {
  if (!appState.projectChooserInitialized) {
    initializeProjectChooser(newProjectForm)
    newProjectForm.addEventListener("project-import", () => newProjectDialog.close("import"))
    appState.projectChooserInitialized = true
  }
  newProjectDialog.returnValue = ""
  newProjectDialog.showModal()
  return new Promise((resolve) => {
    newProjectDialog.addEventListener(
      "close",
      () => {
        appState.newProjectOptions = projectChoice(newProjectForm)
        const templateID = appState.newProjectOptions.templateID
        if (newProjectDialog.returnValue === "import") { resolve("__import__"); return }
        resolve(
          newProjectDialog.returnValue === "create" && typeof templateID === "string"
            ? templateID
            : undefined,
        )
      },
      { once: true },
    )
  })
}

const EMBEDDED_PROJECT_FALLBACK = "__embedded-project-fallback__"

export function finishNativeProjectChoice(templateID?: string): void {
  if (!appState.resolveNativeProjectChoice) return
  const resolve = appState.resolveNativeProjectChoice
  appState.resolveNativeProjectChoice = undefined
  appState.nativeProjectChoice = undefined
  resolve(templateID)
}

async function chooseNativeProjectTemplate(): Promise<string | undefined> {
  if (appState.nativeProjectChoice) {
    void WebviewWindow.getByLabel("new-project").then((window) => window?.setFocus())
    return appState.nativeProjectChoice
  }

  // Remove a window left behind by a previous reload before installing the new
  // resolver. Its close event must not be allowed to cancel the next request.
  const existing = await WebviewWindow.getByLabel("new-project")
  if (existing) await existing.close().catch(() => undefined)

  const choice = new Promise<string | undefined>((resolve) => {
    appState.resolveNativeProjectChoice = resolve
  })
  appState.nativeProjectChoice = choice
  appState.nativeProjectWindowReady = false

  try {
    const projectWindow = new WebviewWindow("new-project", {
      url: "new-project.html",
      title: "新建项目",
      width: 920,
      height: 660,
      minWidth: 400,
      minHeight: 420,
      center: true,
      decorations: true,
      resizable: true,
      focus: true,
      visible: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: false,
      preventOverflow: { width: 24, height: 24 },
      parent: navigator.userAgent.includes("Macintosh") ? undefined : "main",
    })
    void projectWindow.once("tauri://destroyed", () => {
      finishNativeProjectChoice(appState.nativeProjectWindowReady ? undefined : EMBEDDED_PROJECT_FALLBACK)
    })
    void projectWindow.once("tauri://error", () => finishNativeProjectChoice(EMBEDDED_PROJECT_FALLBACK))
  } catch {
    finishNativeProjectChoice(EMBEDDED_PROJECT_FALLBACK)
  }

  return choice
}

export async function newDocument(templateID: string): Promise<boolean> {
  if (!(await prepareDocumentReplacement())) return false
  await loadArchive(await loadBuiltInProjectTemplate(templateID), "", true)
  return true
}

export async function startNewDocument(): Promise<void> {
  if (appState.fileOperationRunning) return
  appState.newProjectOptions = undefined
  const templateID = await chooseProjectTemplate()
  if (templateID === "__import__") { openButton.click(); return }
  if (!templateID) {
    showStatus("新建皮肤已取消。")
    return
  }
  await runFileOperation("新建皮肤", async () => {
    if (!(await newDocument(templateID))) return false
    const options = appState.newProjectOptions
    if (appState.archive && options?.name) documentName.textContent = exportName(options.name, appState.archive.format)
    if (appState.archive && options?.savePath) {
      const bytes = await appState.archive.toBytesAsync(appState.archive.format)
      await writeNativePath(options.savePath, bytes)
      appState.currentPath = options.savePath
      // An Android content:// URI names no file, so the name typed in the dialog stays.
      if (!options.savePath.startsWith("content://")) documentName.textContent = options.savePath.split(/[\\/]/).pop() || documentName.textContent
      appState.archive.markSaved(bytes, appState.archive.format)
      appState.unsavedNew = false
      updateDirty()
    }
    return true
  })
}
