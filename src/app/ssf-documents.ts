// Where an open Sogou skin keeps what the editor shows. A Sogou skin has no layouts: the canvas lists
// the boards of Sogou's official skeleton (`<theme>/skin/<orientation>/py_9.ini`, held apart from the
// document and never saved); everything the user sees as source or edits is one of the skin's own files.

import { IniDocument } from "../ini.ts"
import type { SkinArchive } from "../skin.ts"
import { documentPackage } from "../ssf/ssf-convert.ts"
import { ssfKeyBinding, ssfQwerty, type SsfKeyBinding } from "../ssf/ssf-keymap.ts"
import type { SsfPackage, SsfTheme } from "../ssf/ssf-package.ts"
import { orientation, theme } from "./dom"
import { appState } from "./state"

export const SSF_SOUNDS_PATH = "default/sound_android.ini"

let cachedPackage: { archive: unknown; revision: number; pkg?: SsfPackage } | undefined

/** The open Sogou skin as a package; undefined for other formats or a skin missing its main files. */
export function ssfPackage(): SsfPackage | undefined {
  const archive = appState.archive
  if (archive?.format !== "ssf") return
  if (cachedPackage?.archive !== archive || cachedPackage.revision !== archive.revision) {
    let pkg: SsfPackage | undefined
    try {
      pkg = documentPackage(archive)
    } catch {
      pkg = undefined
    }
    cachedPackage = { archive, revision: archive.revision, pkg }
  }
  return cachedPackage.pkg
}

export function ssfTheme(): SsfTheme {
  return theme.value === "dark" ? "dark" : "light"
}

/** Folder (with trailing slash) holding the current look's phoneSkin.ini / keys.ini / anim.ini. */
export function ssfThemeFolder(): string | undefined {
  return ssfPackage()?.folder(ssfTheme())
}

export function ssfSkinPath(): string | undefined {
  const folder = ssfThemeFolder()
  return folder && `${folder}phoneSkin.ini`
}

export function ssfKeysPath(): string | undefined {
  const folder = ssfThemeFolder()
  return folder && `${folder}keys.ini`
}

/** A Sogou file as an INI document; an absent file reads as empty so sections can be added to it. */
export function ssfDocument(path: string): IniDocument {
  return IniDocument.parse(appState.archive?.isText(path) ? appState.archive.getText(path) : "")
}

/** Sogou's official skeleton laid out for the open skin (ssf-preview.ts); undefined for other documents. */
export function ssfSkeleton(): SkinArchive | undefined {
  const skeleton = appState.ssfSkeleton
  return appState.archive?.format === "ssf" && skeleton?.archive === appState.archive ? skeleton.boards : undefined
}

/** A skeleton board of the current look and orientation. */
export function isSsfBoardPath(path: string): boolean {
  const folder = `${theme.value}/skin/${orientation.value}/`
  return Boolean(ssfSkeleton()?.isText(path)) && path.startsWith(folder)
    && /\.ini$/i.test(path) && !/\/gen\.ini$/i.test(path) && !path.slice(folder.length).includes("/")
}

/** A skeleton board as the canvas lays it out. */
export function ssfBoardDocument(path: string): IniDocument | undefined {
  const skeleton = ssfSkeleton()
  return skeleton?.isText(path) ? IniDocument.parse(skeleton.getText(path)) : undefined
}

/** The Sogou classes the selected canvas key is drawn from. */
export function ssfSelectedBindings(): Array<{ section: string; action: string; binding: SsfKeyBinding }> {
  const document = appState.layoutDocument
  if (!document || !isSsfBoardPath(appState.layoutPath)) return []
  const layout = appState.layoutPath.split("/").pop()!
  return appState.selectedKeySections.flatMap((section) => {
    const action = document.get(section, "CENTER")?.trim()
    return action ? [{ section, action, binding: ssfKeyBinding(layout, action, orientation.value === "land", document.get(section, "SSF_SECTION"), document.get(section, "SSF_BG")) }] : []
  })
}

/** 26-key boards read their own `_Qwerty` / `_Latin` classes (the preview decides the same way). */
export function ssfQwertyBoard(path = appState.layoutPath): boolean {
  return ssfQwerty(path)
}

/**
 * The file the source editor shows for a selection: a board's look lives in phoneSkin.ini, so selecting
 * a board (or a key on it) opens that; the skeleton board is not the skin's.
 */
export function sourceEditPath(path = appState.selectedPath): string {
  return isSsfBoardPath(path) ? ssfSkinPath() ?? path : path
}
