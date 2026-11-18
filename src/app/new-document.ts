import { isAndroidTauri, mobileLayoutQuery } from "./canvas-interaction"
import { invoke } from "@tauri-apps/api/core"
import { appState } from "./state"
import { initializeProjectChooser, projectChoice } from "../project-chooser"
import { bindDialog } from "./ask.ts"
import { closeDialog } from "../motion.ts"
import { newProjectForm, newProjectDialog, openButton, $ } from "./dom"
import { prepareDocumentReplacement } from "./edit-history"
import { loadArchive } from "./archive-io"
import { loadBuiltInProjectTemplate } from "../operations.ts"
import { showStatus, runFileOperation } from "./file-operations"

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
        const templateID = projectChoice(newProjectForm)
        if (newProjectDialog.returnValue === "import") { resolve("__import__"); return }
        resolve(newProjectDialog.returnValue === "create" ? templateID : undefined)
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
    newProjectForm.querySelector("h2")!.textContent = mobileLayoutQuery.matches ? "新建皮肤" : "内置模板"
  }
  placeForm()
  mobileLayoutQuery.addEventListener("change", placeForm)
  newProjectForm.addEventListener("project-import", () => {
    if (newProjectDialog.open) void closeDialog(newProjectDialog, "import")
    else openButton.click()
  })
  newProjectForm.addEventListener("submit", event => {
    event.preventDefault()
    if (newProjectDialog.open) void closeDialog(newProjectDialog, "create")
    else void createProject(projectChoice(newProjectForm))
  })
}

async function newDocument(templateID: string): Promise<boolean> {
  if (!(await prepareDocumentReplacement("open"))) return false
  await loadArchive(await loadBuiltInProjectTemplate(templateID), "", true)
  return true
}

export async function startNewDocument(): Promise<void> {
  if (appState.fileOperationRunning) return
  if (!mobileLayoutQuery.matches) {
    $("#recent-files").click()
    newProjectForm.scrollIntoView({ block: "start" })
    newProjectForm.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true })
    return
  }
  const templateID = await chooseProjectTemplate()
  if (templateID === "__import__") { openButton.click(); return }
  if (!templateID) {
    showStatus("新建皮肤已取消")
    return
  }
  await createProject(templateID)
}

async function createProject(templateID: string): Promise<void> {
  if (appState.fileOperationRunning) return
  await runFileOperation("新建皮肤", () => newDocument(templateID))
}
