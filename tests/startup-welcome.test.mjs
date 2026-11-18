import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { appSource } from "./helpers/app-source.mjs"

const main = appSource()
const previews = readFileSync(new URL("../src/template-preview.ts", import.meta.url), "utf8")

test("startup welcome screen pages desktop and mobile skins and keeps template previews lazy", () => {
  assert.match(main, /const desktopRecentRows = 3/)
  assert.match(main, /const mobileRecentPageSize = 9/)
  assert.match(main, /items\.slice\(start, start \+ recentPageSize\)/)
  assert.match(readFileSync(new URL("../src/project-chooser.ts", import.meta.url), "utf8"), /hydrateTemplateCardPreviews\(body, \{ lazy: true \}\)/)
  assert.match(main, /await waitForPreviewFrame\(\)/)
  assert.match(previews, /new IntersectionObserver/)
  assert.match(previews, /const staticURL = builtInProjectTemplatePreviewURL\(id\)/)
})

test("recent skins reopen from their stored source workspace", () => {
  assert.match(main, /recordRecentFile\(path, documentName\.textContent, workspace\)/)
  assert.match(main, /return await loadSourceWorkspace\(item\.source, item\.path\)/)
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8")
  assert.match(lib, /const SOURCE_LIMIT: usize = 9;/)
})
