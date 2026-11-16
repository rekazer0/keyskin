import { isAndroidTauri, mobileLayoutQuery } from "./canvas-interaction"
import { invoke } from "@tauri-apps/api/core"
import { appState } from "./state"
import { initializeProjectChooser, projectChoice } from "../project-chooser"
import { bindDialog } from "./ask.ts"
import { closeDialog } from "../motion.ts"
import { newProjectForm, newProjectDialog, openButton, documentName, $ } from "./dom"
import { prepareDocumentReplacement, updateDirty } from "./edit-history"
import { loadArchive, writeNativePath } from "./archive-io"
import { loadBuiltInProjectTemplate } from "../operations.ts"
import { showStatus, runFileOperation } from "./file-operations"
import { exportName } from "../export.ts"

async function chooseProjectTemplate(): Promise<string | undefined> {
  if (isAndroidTauri()) return chooseAndroidProjectTemplate()
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

export function wireNewProjectChooser(): void {
  initializeProjectChooser(newProjectForm)
  bindDialog(newProjectDialog)
  const host = $("#file-project-chooser")
  const placeForm = () => {
    if (newProjectDialog.open) newProjectDialog.close("cancel")
    const parent = mobileLayoutQuery.matches ? newProjectDialog : host
    parent.append(newProjectForm)
    newProjectForm.querySelector("h2")!.textContent = mobileLayoutQuery.matches ? "新建皮肤" : "新建项目"
    newProjectForm.querySelector<HTMLButtonElement>('button[value="cancel"]')!.type = mobileLayoutQuery.matches ? "submit" : "button"
  }
  placeForm()
  mobileLayoutQuery.addEventListener("change", placeForm)
  newProjectForm.addEventListener("project-import", () => {
    if (newProjectDialog.open) void closeDialog(newProjectDialog, "import")
    else openButton.click()
  })
  newProjectForm.addEventListener("submit", event => {
    if (newProjectDialog.open) return
    event.preventDefault()
    const options = projectChoice(newProjectForm)
    void createProject(options.templateID, options)
  })
}

async function newDocument(templateID: string): Promise<boolean> {
  if (!(await prepareDocumentReplacement())) return false
  await loadArchive(await loadBuiltInProjectTemplate(templateID), "", true)
  return true
}

export async function startNewDocument(): Promise<void> {
  if (appState.fileOperationRunning) return
  if (!mobileLayoutQuery.matches) {
    $("#recent-files").click()
    newProjectForm.scrollIntoView({ block: "start" })
    newProjectForm.querySelector<HTMLInputElement>("input:checked")?.focus({ preventScroll: true })
    return
  }
  appState.newProjectOptions = undefined
  const templateID = await chooseProjectTemplate()
  if (templateID === "__import__") { openButton.click(); return }
  if (!templateID) {
    showStatus("新建皮肤已取消")
    return
  }
  await createProject(templateID, appState.newProjectOptions)
}

async function createProject(templateID: string, options = appState.newProjectOptions): Promise<void> {
  if (appState.fileOperationRunning) return
  await runFileOperation("新建皮肤", async () => {
    if (!(await newDocument(templateID))) return false
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
