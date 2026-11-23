import { isTauri, mobileLayoutQuery } from "./canvas-interaction"
import { appState } from "./state"
import { initializeProjectChooser, projectChoice } from "../project-chooser"
import { bindDialog } from "./ask.ts"
import { closeDialog } from "../motion.ts"
import { newProjectForm, newProjectDialog, openButton, $ } from "./dom"
import { prepareDocumentReplacement } from "./edit-history"
import { loadArchive } from "./archive-io"
import { loadBuiltInProjectTemplate } from "../operations.ts"
import { recordRecentTemplate } from "./recent-files"
import { showStatus, runFileOperation } from "./file-operations"

function chooseProjectTemplate(): Promise<string | undefined> {
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

export async function newDocument(templateID: string): Promise<boolean> {
  if (!(await prepareDocumentReplacement("open"))) return false
  await loadArchive(await loadBuiltInProjectTemplate(templateID), "", true)
  if (isTauri()) {
    appState.currentTemplateId = templateID
    const name = newProjectForm.querySelector(`[data-template="${CSS.escape(templateID)}"] strong`)?.textContent
    recordRecentTemplate(templateID, name || "内置模板")
  }
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
