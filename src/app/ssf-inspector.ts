// The property inspector for a Sogou skin. It shows what the canvas draws in Sogou terms: a key's
// classes (background, foreground, label colour, animation, sound), a board's shared look, or every
// section of a Sogou file. The canvas layout is the preview overlay and is never shown or edited here.

import type { IniDocument } from "../ini.ts"
import type { SsfKeyBinding } from "../ssf/ssf-keymap.ts"
import { ssfSectionLabel } from "../ssf/ssf-labels.ts"
import { firstValue, freeSectionName, ownSection, ssfBackground, ssfForeground, ssfLabelStyle, ssfSoundSection, ssfTextSections } from "../ssf/ssf-parts.ts"
import { orientation } from "./dom"
import { editSsfFile, renderGroup as renderSsfGroup, setSsfValue, ssfButton, ssfEntries, ssfFontImportButton, ssfFontOptions, type SsfBlock } from "./ssf-fields"
import { openImageResourceChooser } from "./resource-inspector"
import { isSsfBoardPath, ssfDocument, ssfKeysPath, ssfPackage, ssfQwertyBoard, ssfSelectedBindings, ssfSkinPath, ssfThemeFolder, SSF_SOUNDS_PATH } from "./ssf-documents"
import { appState } from "./state"
import { layoutLabel } from "./file-tree"

type Group = { label: string; blocks: SsfBlock[]; code?: string; key?: string }

function renderGroup(label: string, blocks: SsfBlock[], code?: string): Group | undefined {
  const shown = blocks.filter((block) => block.template || block.expect || ssfDocument(block.path).sections().includes(block.section))
  return shown.length ? { label, blocks: shown, code } : undefined
}

/** Sound names Sogou can play: the WAV / OGG / MP3 files in default/, without extension. */
function soundOptions(): string[] {
  return [...new Set((appState.archive?.names() ?? []).flatMap((path) => {
    const match = path.match(/^default\/(?:res\/)?([^/]+)\.(?:wav|ogg|mp3)$/i)
    return match ? [match[1]] : []
  }))].sort()
}

function backgroundGroup(skinPath: string, skin: IniDocument, binding: SsfKeyBinding): Group | undefined {
  const background = ssfBackground(skin, binding)
  if (!background) {
    const owner = ownSection(skin, binding)
    return renderGroup("背景", [{
      path: skinPath,
      section: owner,
      title: "未设置背景",
      note: "这个按键没有背景图，也没有可用的共享背景。",
      template: [{ key: "BG_IMAGES", value: freeSectionName(skin, `SMA_${owner}`) }],
    }])
  }
  if (background.owner) {
    return renderGroup("背景", [{
      path: skinPath,
      section: background.images,
      reference: { path: skinPath, section: background.owner, key: "BG_IMAGES" },
    }], background.images)
  }
  // A shared default draws this key: editing it restyles every key of the class, so offer a copy.
  const copy = ssfButton("单独设置", "copy-plus", () => {
    const entries = ssfEntries(skinPath, background.images)
    editSsfFile(skinPath, (document) => {
      const owner = ownSection(document, binding)
      const images = freeSectionName(document, `SMA_${owner}`)
      document.appendSection(images, entries)
      setSsfValue(document, owner, "BG_IMAGES", images)
    })
  })
  return renderGroup("背景", [{
    path: skinPath,
    section: background.images,
    note: `共享背景：修改会影响所有使用 ${background.images} 的按键。`,
    actions: [copy],
  }], background.images)
}

function foregroundGroup(skinPath: string, keysPath: string, skin: IniDocument, binding: SsfKeyBinding): Group | undefined {
  const keys = ssfDocument(keysPath)
  const foreground = ssfForeground(skin, keys, binding)
  const blocks: SsfBlock[] = []
  if (foreground?.kind === "keys") {
    blocks.push(
      { path: keysPath, section: foreground.images, title: "前景图", reference: { path: keysPath, section: foreground.owner, key: "FG_IMAGES" } },
      { path: keysPath, section: foreground.owner, title: "前景位置", omit: ["FG_IMAGES", "ANIM_STYLE"] },
    )
  } else if (foreground) {
    blocks.push({ path: skinPath, section: foreground.owner, title: "图标", only: ["ICON", "ICON_PRESSED"] })
  } else {
    const add = ssfButton("添加前景图", "square-plus", () => openImageResourceChooser((resourceID) => {
      const file = /\.\w+$/.test(resourceID) ? resourceID : `${resourceID}.png`
      editSsfFile(keysPath, (document) => {
        const owner = ownSection(document, binding)
        const images = freeSectionName(document, `Foground_${owner}`)
        document.appendSection(images, [{ key: "NORMAL", value: file }, { key: "PRESSED", value: file }])
        setSsfValue(document, owner, "FG_IMAGES", images)
        setSsfValue(document, owner, "FG_RECT", "0,0,1,1")
      })
    }))
    const owner = ownSection(skin, binding)
    blocks.push({ path: skinPath, section: owner, title: "前景", note: "这个按键没有前景图，显示输入法自带的文字或图标。", actions: [add], only: [], template: [] })
  }
  // FG_STYLE places the icon and labels inside the key.
  const fgStyle = binding.sections.map((section) => firstValue(skin.get(section, "FG_STYLE"))).find(Boolean)
  if (fgStyle) blocks.push({ path: skinPath, section: fgStyle, title: "前景布局" })
  return renderGroup("前景", blocks)
}

// What Sogou's TextStyle parser reads (theme/parse/parseimpl/w0.java); missing keys can be added.
const TEXT_KEYS = ["TEXT_COLOR", "TEXT_COLOR_PRESSED", "TEXT_SIZE", "TYPEFACE", "BOLD"]
const CANDIDATE_TEXT_KEYS = ["TEXT_COLOR", "TEXT_SIZE", "TYPEFACE", "BOLD"]

function textBlock(path: string, section: string, keys = TEXT_KEYS, extra: Partial<SsfBlock> = {}): SsfBlock {
  return {
    path,
    section,
    expect: keys,
    options: { TYPEFACE: ssfFontOptions() },
    ...extra,
    actions: [...extra.actions ?? [], ssfFontImportButton([{ path, section }])],
  }
}

/** Sogou draws a key's text with `FG_STYLE`'s `LABEL_STYLE`; without one the board's default style applies. */
function textGroup(skinPath: string, skin: IniDocument, binding: SsfKeyBinding): Group | undefined {
  const label = ssfLabelStyle(skin, binding)
  const fallbacks = ssfTextSections(binding, ssfQwertyBoard())
  const source = label?.style ?? fallbacks.find((section) => skin.sections().includes(section)) ?? fallbacks[0]
  if (!label?.style) {
    return renderGroup("文字", [textBlock(skinPath, source, TEXT_KEYS, {
      note: label ? `${label.fgStyle} 没有 LABEL_STYLE，使用整个键盘的默认文字样式。` : "这个按键没有 FG_STYLE，使用整个键盘的默认文字样式。",
    })], source)
  }
  const { owner, fgStyle, style } = label
  if (style.startsWith(`TextStyle_${owner}`)) return renderGroup("文字", [textBlock(skinPath, style)], style)
  // A shared style restyles every key using it: copy it and the FG_STYLE that names it for this key alone.
  const copy = ssfButton("单独设置", "copy-plus", () => editSsfFile(skinPath, (document) => {
    const ownStyle = freeSectionName(document, `TextStyle_${owner}`)
    document.appendSection(ownStyle, ssfEntries(skinPath, style))
    const ownFgStyle = freeSectionName(document, `FGStyle_${owner}`)
    document.appendSection(ownFgStyle, [...ssfEntries(skinPath, fgStyle).filter((entry) => entry.key !== "LABEL_STYLE"), { key: "LABEL_STYLE", value: ownStyle }])
    const rest = (document.get(owner, "FG_STYLE") ?? "").split(",").slice(1)
    setSsfValue(document, owner, "FG_STYLE", [ownFgStyle, ...rest].join(","))
  }))
  return renderGroup("文字", [textBlock(skinPath, style, TEXT_KEYS, {
    note: `共享文字样式：修改会影响所有使用 ${style} 的按键。`,
    actions: [copy],
  })], style)
}

function animationGroup(keysPath: string, binding: SsfKeyBinding): Group | undefined {
  const keys = ssfDocument(keysPath)
  const owner = binding.sections.find((section) => keys.get(section, "ANIM_STYLE")) ?? ownSection(keys, binding)
  const style = firstValue(keys.get(owner, "ANIM_STYLE"))
  const animPath = `${ssfThemeFolder()}anim.ini`
  const blocks: SsfBlock[] = [{
    path: keysPath,
    section: owner,
    title: "动画引用",
    omit: ["FG_IMAGES", "FG_RECT"],
    expect: ["ANIM_STYLE"],
    options: { ANIM_STYLE: ssfDocument(animPath).sections() },
    note: style ? undefined : "这个按键没有按键动画。",
  }]
  if (style) blocks.push({ path: animPath, section: style, title: "动画样式" })
  return renderGroup("动画", blocks)
}

function soundGroup(binding: SsfKeyBinding | undefined): Group | undefined {
  const sounds = ssfDocument(SSF_SOUNDS_PATH)
  const section = ssfSoundSection(sounds, binding)
  const options = { sound: soundOptions() }
  if (section) {
    return renderGroup("音效", [{
      path: SSF_SOUNDS_PATH,
      section,
      note: binding && section === "Key" ? "使用默认按键音效。" : undefined,
      options,
    }], section)
  }
  const owner = binding ? binding.sections.find((name) => !/_Land/.test(name)) ?? binding.sections[0] : "Key"
  return renderGroup("音效", [{
    path: SSF_SOUNDS_PATH,
    section: owner,
    title: "按键音效",
    expect: ["sound"],
    options,
    note: binding && sounds.get("Key", "sound") ? `未单独设置，使用默认按键音效 ${sounds.get("Key", "sound")}。` : undefined,
  }])
}

/** Remaining values of the key's own classes (labels, long-press key, type…). */
function keyGroup(skinPath: string, binding: SsfKeyBinding): Group | undefined {
  const handled = ["BG_IMAGES", "ICON", "ICON_PRESSED", "FG_STYLE", "TEXT_COLOR", "TEXT_COLOR_PRESSED"]
  const blocks: SsfBlock[] = binding.sections
    .filter((section) => ssfEntries(skinPath, section).some((entry) => !handled.includes(entry.key)))
    .map((section) => ({ path: skinPath, section, omit: handled }))
  // The key's own labels (parseimpl/a.java LABEL / MINOR_LABEL) can be set even when it has none.
  if (!blocks.length) blocks.push({ path: skinPath, section: ownSection(ssfDocument(skinPath), binding), omit: handled })
  blocks[0].expect = ["LABEL", "MINOR_LABEL"]
  return renderGroup("按键", blocks)
}

function keyGroups(binding: SsfKeyBinding): Group[] {
  const skinPath = ssfSkinPath()
  const keysPath = ssfKeysPath()
  if (!skinPath || !keysPath) return []
  const skin = ssfDocument(skinPath)
  return [
    backgroundGroup(skinPath, skin, binding),
    foregroundGroup(skinPath, keysPath, skin, binding),
    textGroup(skinPath, skin, binding),
    keyGroup(skinPath, binding),
    animationGroup(keysPath, binding),
    soundGroup(binding),
  ].filter((group): group is Group => Boolean(group))
}

/** What every key of the current board shares: backgrounds, candidate bar, default classes, colours. */
function boardGroups(): Group[] {
  const skinPath = ssfSkinPath()
  if (!skinPath) return []
  const skin = ssfDocument(skinPath)
  const qwerty = ssfQwertyBoard()
  const nineKey = appState.layoutDocument?.sections().includes("LIST")
  const block = (section: string, extra: Partial<SsfBlock> = {}): SsfBlock => ({ path: skinPath, section, ...extra })
  const referenced = (section: string, key: string, title: string): SsfBlock[] => {
    const target = firstValue(skin.get(section, key))
    return target && !/\.\w+$/.test(target) ? [block(target, { title, reference: { path: skinPath, section, key } })] : []
  }
  const candidate = orientation.value === "land" && skin.sections().includes("CandidateViewLand") ? "CandidateViewLand" : "CandidateView"
  const groups: Array<[string, SsfBlock[]]> = [
    // Sogou skips RootView / CandidateView without BG_STYLE (frame/b0.java), so a new one starts with it.
    ["键盘背景", [block("RootView", { expect: ["BG_STYLE", "BG_IMAGE", "BG_COLOR", "BG_FUNCTION_COLOR"], create: [{ key: "BG_STYLE", value: "1" }] }), ...skin.sections().includes("WALLPAPER") ? [block("WALLPAPER")] : []]],
    ["候选栏", [block(candidate, { expect: ["BG_STYLE", "BG_IMAGE", "BG_COLOR", "MARGINS"], create: [{ key: "BG_STYLE", value: "1" }] }), ...referenced(candidate, "BG_IMAGE", "候选栏背景")]],
    ["候选字", [textBlock(skinPath, "TextStyle_Candidate", CANDIDATE_TEXT_KEYS), textBlock(skinPath, "TextStyle_Candidate_Highlight", ["TEXT_COLOR"])]],
    ["输入码", [block("ComposingView", { expect: ["BG_STYLE", "BG_COLOR"], create: [{ key: "BG_STYLE", value: "2" }] }), textBlock(skinPath, "TextStyle_Composing", CANDIDATE_TEXT_KEYS)]],
    ["按键背景", (qwerty ? ["KeyBg_Default_Latin", "KeyBg_Function_Qwerty", "KeyBg_Space_Qwerty"] : ["KeyBg_Default", "KeyBg_Function", "KeyBg_Space"]).map((section) => block(section, { expect: ["NORMAL", "PRESSED"] }))],
    ["按键文字", [
      textBlock(skinPath, qwerty ? "TextStyle_Qwerty" : "TextStyle_Phone_Label"),
      textBlock(skinPath, qwerty ? "TextStyle_FuncKey_26char" : "TextStyle_FuncKey_T9"),
      textBlock(skinPath, "TextStyle_Space_Label"),
      textBlock(skinPath, "TextStyle"),
      block("General", { expect: ["ICON_COLOR", "HIGH_LIGHT_ICON_COLOR", "POPUP_BG_COLOR"] }),
    ]],
    ...nineKey ? [["符号列", [
      block("CandidateCodeView"),
      ...referenced("CandidateCodeView", "BG_IMAGE", "符号列背景"),
      ...referenced("CandidateCodeView", "BG_IMAGES", "符号列单元格"),
      textBlock(skinPath, firstValue(skin.get("CandidateCodeView", "TEXT_STYLE")) ?? "TextStyle_Text", CANDIDATE_TEXT_KEYS),
      block("TextStyle_Popup_Code"),
    ]] as [string, SsfBlock[]]] : [],
  ]
  return [
    ...groups.map(([label, blocks]) => renderGroup(label, blocks)),
    soundGroup(undefined),
  ].filter((group): group is Group => Boolean(group))
}

/** Every section of a Sogou INI file, one group each. */
function fileGroups(path: string): Group[] {
  const document = ssfDocument(path)
  return document.sections().flatMap((section) => {
    const label = path === "phoneTheme.ini" && section === "General" ? "皮肤信息" : ssfSectionLabel(section)
    const group = renderGroup(label, [{ path, section }], section)
    return group ? [{ ...group, key: section }] : []
  })
}

/** Inspector header for a board or its selected keys: the board / key class name and the file it lives in. */
export function ssfInspectorTitle(): { name: string; context: string } | undefined {
  const path = appState.selectedPath
  const skinPath = ssfSkinPath()
  if (!skinPath || !isSsfBoardPath(path) || path !== appState.layoutPath) return
  const bindings = ssfSelectedBindings()
  if (!appState.selectedKeySections.length) return { name: layoutLabel(path.split("/").pop()!), context: skinPath }
  const primary = bindings[0]?.binding.sections.find((section) => !/_Land/.test(section)) ?? bindings[0]?.binding.sections[0]
  const name = appState.selectedKeySections.length > 1 ? `已选 ${appState.selectedKeySections.length} 个按键` : primary ? ssfSectionLabel(primary) : "按键"
  return { name, context: bindings.length > 1 ? `${skinPath} · 共同属性` : primary ? `${skinPath.split("/").slice(-2).join("/")} · ${primary}` : skinPath }
}

/** Match blocks by their role in a group, then keep only fields present on every selected key. */
function commonKeyGroups(selections: Group[][]): Group[] {
  return selections[0].flatMap((group) => {
    const peers = selections.map((groups) => groups.find((item) => item.label === group.label))
    if (peers.some((peer) => !peer)) return []
    const blocks = group.blocks.flatMap((block, index) => {
      const matches = peers.map((peer) => peer!.blocks[index])
      if (matches.some((match) => !match || (match.title ?? "") !== (block.title ?? ""))) return []
      const entries = matches.map((match) => ssfEntries(match.path, match.section).filter((entry) => !match.omit?.includes(entry.key) && (!match.only || match.only.includes(entry.key))))
      const only = entries[0].filter((entry) => entries.every((list) => list.some((item) => item.key === entry.key))).map((entry) => entry.key)
      return only.length || block.expect ? [{ path: block.path, section: block.section, title: block.title, only, options: block.options, expect: block.expect, create: block.create,
        note: "修改会作用于所有选中按键；共享样式也会影响其他引用它的按键。",
        peers: matches.slice(1).map(({ path, section }) => ({ path, section })),
      }] : []
    })
    return blocks.length ? [{ label: group.label, blocks }] : []
  })
}

/**
 * Fills `container` for the current Sogou selection and returns whether there was anything to show.
 * Multiple selected keys expose only their common fields and write to every matching class.
 */
export function populateSsfInspector(container: HTMLElement): boolean {
  container.replaceChildren()
  if (!ssfPackage()) return false
  const path = appState.selectedPath
  let groups: Group[] = []
  if (isSsfBoardPath(path) && path === appState.layoutPath) {
    const bindings = ssfSelectedBindings()
    groups = bindings.length > 1 ? commonKeyGroups(bindings.map(({ binding }) => keyGroups(binding))) : bindings.length ? keyGroups(bindings[0].binding) : boardGroups()
  } else if (appState.archive?.isText(path) && /\.ini$/i.test(path)) {
    groups = fileGroups(path)
  }
  container.append(...groups.flatMap(({ label, blocks, code, key }) => {
    const group = renderSsfGroup(label, blocks, code, key)
    return group ? [group] : []
  }))
  container.dataset.path = path
  return groups.length > 0
}
