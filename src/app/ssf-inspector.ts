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
import { isSsfBoardPath, ssfDocument, ssfKeysPath, ssfPackage, ssfQwertyBoard, ssfSelectedBindings, ssfSkinPath, SSF_SOUNDS_PATH } from "./ssf-documents"
import { appState } from "./state"
import { layoutLabel } from "./file-tree"

import { toolbarIconSection } from "./toolbar-icon-inspector"

type Group = { label: string; blocks: SsfBlock[]; code?: string; key?: string }

const IMAGE_KEYS = ["NORMAL", "PRESSED"]
const FG_STYLE_KEYS = ["LABEL_STYLE", "LABEL_POSITION", "LABEL_VISIBLE", "LABEL_ORIENTATION", "LABEL_HORIZONTAL_OFFSET", "MINOR_LABEL_STYLE", "MINOR_LABEL_POSITION", "MINOR_LABEL_VISIBLE", "MINOR_LABEL_HORIZONTAL_OFFSET", "ICON_RECT"]
const KEY_KEYS = ["LABEL", "MINOR_LABEL", "L_KEY", "TYPE"]
const VIEW_KEYS = ["BG_STYLE", "BG_COLOR", "MARGINS", "PADDINGS"]

/** Known model fields stay available when their INI values are absent. */
function supportedFields(path: string, section: string): string[] {
  if (path === "phoneTheme.ini") return section === "General" ? ["skin_name", "skin_author", "skin_contact", "skin_tip", "skin_version", "skin_version_self", "skin_id", "skin_type", "supports-screens", "preview_square", "preview_comp"] : []
  if (path === SSF_SOUNDS_PATH) return ["sound"]
  if (/^Anim_Style(?:_|$)/.test(section)) return ["BG_ANIM", "FG_ANIM", "SET_PRESSED", "DECO_ANIM", "DECO_ANIM_NUMBER"]
  if (/^TextStyle(?:_|$)/.test(section)) return TEXT_KEYS
  if (/^PopupBG(?:_|$)/.test(section)) return ["BG_IMAGE"]
  const document = ssfDocument(path)
  const namedBy = (keys: string[]) => document.entries().some((entry) => keys.includes(entry.key) && firstValue(entry.value) === section)
  if (/^FGStyle(?:_|$)/.test(section) || namedBy(["FG_STYLE"])) return FG_STYLE_KEYS
  if (/^(?:KeyBg_|SMA_|Foground_)/.test(section) || namedBy(["BG_IMAGE", "BG_IMAGES", "FG_IMAGES"])) return IMAGE_KEYS
  if (/^Key_/.test(section)) return /(?:^|\/)keys\.ini$/i.test(path) ? ["FG_IMAGES", "FG_RECT", "ANIM_STYLE"] : [...KEY_KEYS, "BG_IMAGES", "FG_STYLE", "ICON", "ICON_PRESSED"]
  if (section === "RootView") return [...VIEW_KEYS, "BG_IMAGE", "BG_FUNCTION_COLOR"]
  if (/^(?:CandidateView|CandidateCodeView|CandidateGridViewContainer|CloudView|ComposingView)/.test(section)) return [...VIEW_KEYS, "TEXT_STYLE", "TEXT_HIGHLIGHT_STYLE"]
  if (section === "General") return ["ICON_COLOR", "HIGH_LIGHT_ICON_COLOR", "POPUP_BG_COLOR", "POPUP_OFFSET_VERTICAL"]
  return []
}

function renderGroup(label: string, blocks: SsfBlock[], code?: string): Group | undefined {
  const shown = blocks.map((block) => {
    const expected = [...new Set([...block.expect ?? [], ...supportedFields(block.path, block.section).filter((key) => !block.only || block.only.includes(key))])]
      .filter((key) => !block.omit?.includes(key))
    return expected.length ? { ...block, expect: expected } : block
  }).filter((block) => block.template || block.expect || ssfDocument(block.path).sections().includes(block.section))
  return shown.length ? { label, blocks: shown, code } : undefined
}

function backgroundGroup(skinPath: string, skin: IniDocument, binding: SsfKeyBinding): Group | undefined {
  const background = ssfBackground(skin, binding)
  if (!background) {
    const owner = ownSection(skin, binding)
    const add = ssfButton("添加背景图", "square-plus", () => openImageResourceChooser((resourceID) => {
      const file = /\.\w+$/.test(resourceID) ? resourceID : `${resourceID}.png`
      editSsfFile(skinPath, (document) => {
        const images = firstValue(document.get(owner, "BG_IMAGES")) ?? freeSectionName(document, `SMA_${owner}`)
        setSsfValue(document, images, "NORMAL", file)
        setSsfValue(document, owner, "BG_IMAGES", images)
      })
    }))
    return renderGroup("背景", [{
      path: skinPath,
      section: owner,
      title: "背景",
      only: [], template: [], actions: [add],
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
    note: `共享：影响所有使用 ${background.images} 的按键`,
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
      { path: keysPath, section: foreground.owner, title: "前景位置", omit: ["FG_IMAGES", "ANIM_STYLE"], expect: ["FG_RECT"] },
    )
  } else if (foreground) {
    blocks.push({ path: skinPath, section: foreground.owner, title: "图标", only: ["ICON", "ICON_PRESSED"], expect: ["ICON", "ICON_PRESSED"] })
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
    blocks.push({ path: skinPath, section: owner, title: "前景", actions: [add], only: [], template: [] })
  }
  // FG_STYLE places the icon and labels inside the key.
  const owner = binding.sections.find((section) => firstValue(skin.get(section, "FG_STYLE"))) ?? ownSection(skin, binding)
  const fgStyle = firstValue(skin.get(owner, "FG_STYLE"))
  blocks.push({
    path: skinPath, section: fgStyle ?? freeSectionName(skin, `FGStyle_${owner}`), title: "前景布局", expect: FG_STYLE_KEYS,
    create: [{ key: "LABEL_STYLE", value: ssfTextSections(binding, ssfQwertyBoard())[0] }],
    bind: { section: owner, key: "FG_STYLE" },
  })
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
      note: "使用键盘默认文字样式",
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
    note: `共享：影响所有使用 ${style} 的按键`,
    actions: [copy],
  })], style)
}

function animationGroup(keysPath: string, binding: SsfKeyBinding): Group | undefined {
  const keys = ssfDocument(keysPath)
  const owner = binding.sections.find((section) => keys.get(section, "ANIM_STYLE")) ?? ownSection(keys, binding)
  const blocks: SsfBlock[] = [{
    path: keysPath,
    section: owner,
    only: ["ANIM_STYLE"],
    expect: ["ANIM_STYLE"],
  }]
  return renderGroup("动画", blocks)
}

function soundGroup(binding: SsfKeyBinding | undefined): Group | undefined {
  const sounds = ssfDocument(SSF_SOUNDS_PATH)
  const section = ssfSoundSection(sounds, binding)
  if (section) {
    return renderGroup("音效", [{
      path: SSF_SOUNDS_PATH,
      section,
      note: binding && section === "Key" ? "使用默认按键音效" : undefined,
    }], section)
  }
  const owner = binding ? binding.sections.find((name) => !/_Land/.test(name)) ?? binding.sections[0] : "Key"
  return renderGroup("音效", [{
    path: SSF_SOUNDS_PATH,
    section: owner,
    title: "按键音效",
    expect: ["sound"],
    note: binding && sounds.get("Key", "sound") ? `使用默认按键音效 ${sounds.get("Key", "sound")}` : undefined,
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
  blocks[0].expect = KEY_KEYS
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

function imageBlocks(skinPath: string, skin: IniDocument, section: string, key: string, title: string): SsfBlock[] {
  const block = (name: string, extra: Partial<SsfBlock> = {}): SsfBlock => ({ path: skinPath, section: name, ...extra })
  const target = firstValue(skin.get(section, key))
  if (target && !/\.\w+$/.test(target)) return [block(target, { title, reference: { path: skinPath, section, key }, expect: IMAGE_KEYS })]
  if (target) return []
  const add = ssfButton(`添加${title}`, "square-plus", () => openImageResourceChooser((resourceID) => {
    const file = /\.\w+$/.test(resourceID) ? resourceID : `${resourceID}.png`
    editSsfFile(skinPath, (document) => {
      const images = freeSectionName(document, `Bg_${section}`)
      document.appendSection(images, [{ key: "NORMAL", value: file }])
      setSsfValue(document, section, key, images, [{ key: "BG_STYLE", value: "1" }])
    })
  }))
  return [block(section, { title, only: [], template: [], actions: [add] })]
}

function bubbleGroup(path: string, skin: IniDocument): Group | undefined {
  const qwerty = ssfQwertyBoard()
  const existing = (sections: string[]) => sections.find((name) => skin.sections().includes(name)) ?? sections[0]
  const backgrounds = [qwerty ? "PopupBG_Qwerty" : "PopupBG_Phone", "PopupBG"]
  const background = backgrounds.find((name) => firstValue(skin.get(name, "BG_IMAGE"))) ?? existing(backgrounds)
  const foreground = existing([qwerty ? "FGStyle_Popup_Qwerty" : "FGStyle_Phone_Popup", "FGStyle_Popup"])
  const text = existing([qwerty ? "TextStyle_Popup_Qwerty" : "TextStyle_Popup_Phone", "TextStyle_Popup"])
  const minor = existing(["TextStyle_Popup_Phone_Minor", "TextStyle_Popup"])
  return renderGroup("气泡", [
    { path, section: "General", only: ["POPUP_BG_COLOR", "POPUP_OFFSET_VERTICAL"], expect: ["POPUP_BG_COLOR", "POPUP_OFFSET_VERTICAL"] },
    { path, section: background, only: ["BG_IMAGE"], expect: ["BG_IMAGE"] },
    ...imageBlocks(path, skin, background, "BG_IMAGE", "气泡背景"),
    { path, section: foreground, only: FG_STYLE_KEYS.filter((key) => !["ICON_RECT", "LABEL_ORIENTATION"].includes(key)), expect: ["LABEL_POSITION", ...qwerty ? [] : ["MINOR_LABEL_POSITION"]] },
    textBlock(path, firstValue(skin.get(foreground, "LABEL_STYLE")) ?? text),
    ...qwerty || text === minor && !skin.get(foreground, "MINOR_LABEL_STYLE") ? [] : [textBlock(path, firstValue(skin.get(foreground, "MINOR_LABEL_STYLE")) ?? minor)],
  ])
}

/** What every key of the current board shares: backgrounds, candidate bar, default classes, colours. */
function boardGroups(): Group[] {
  const skinPath = ssfSkinPath()
  if (!skinPath) return []
  const skin = ssfDocument(skinPath)
  const qwerty = ssfQwertyBoard()
  const nineKey = appState.layoutDocument?.sections().includes("LIST")
  const block = (section: string, extra: Partial<SsfBlock> = {}): SsfBlock => ({ path: skinPath, section, ...extra })
  const referenced = (section: string, key: string, title: string) => imageBlocks(skinPath, skin, section, key, title)
  const candidate = orientation.value === "land" && skin.sections().includes("CandidateViewLand") ? "CandidateViewLand" : "CandidateView"
  const groups: Array<[string, SsfBlock[]]> = [
    // Sogou skips RootView / CandidateView without BG_STYLE (frame/b0.java), so a new one starts with it.
    ["键盘背景", [block("RootView", { expect: ["BG_STYLE", "BG_IMAGE", "BG_COLOR", "BG_FUNCTION_COLOR"], create: [{ key: "BG_STYLE", value: "1" }] }), ...skin.sections().includes("WALLPAPER") ? [block("WALLPAPER")] : []]],
    ["候选栏", [block(candidate, { omit: /\.\w+$/.test(firstValue(skin.get(candidate, "BG_IMAGE")) ?? "") ? [] : ["BG_IMAGE"], expect: ["BG_STYLE", "BG_COLOR", "MARGINS"], create: [{ key: "BG_STYLE", value: "1" }] }), ...referenced(candidate, "BG_IMAGE", "候选栏背景")]],
    ["候选字", [textBlock(skinPath, "TextStyle_Candidate", CANDIDATE_TEXT_KEYS), textBlock(skinPath, "TextStyle_Candidate_Highlight", ["TEXT_COLOR"])]],
    ["输入码", [block("ComposingView", { expect: ["BG_STYLE", "BG_COLOR"], create: [{ key: "BG_STYLE", value: "2" }] }), textBlock(skinPath, "TextStyle_Composing", CANDIDATE_TEXT_KEYS)]],
    ["按键背景", (qwerty ? ["KeyBg_Default_Latin", "KeyBg_Function_Qwerty", "KeyBg_Space_Qwerty"] : ["KeyBg_Default", "KeyBg_Function", "KeyBg_Space"]).map((section) => block(section, { expect: ["NORMAL", "PRESSED"] }))],
    ["按键文字", [
      textBlock(skinPath, qwerty ? "TextStyle_Qwerty" : "TextStyle_Phone_Label"),
      textBlock(skinPath, qwerty ? "TextStyle_FuncKey_26char" : "TextStyle_FuncKey_T9"),
      textBlock(skinPath, "TextStyle_Space_Label"),
      textBlock(skinPath, "TextStyle"),
      block("General", { only: ["ICON_COLOR", "HIGH_LIGHT_ICON_COLOR"], expect: ["ICON_COLOR", "HIGH_LIGHT_ICON_COLOR"] }),
    ]],
    ...nineKey ? [["符号列", [
      block("CandidateCodeView", { omit: ["BG_IMAGE", "BG_IMAGES"].filter((key) => !/\.\w+$/.test(firstValue(skin.get("CandidateCodeView", key)) ?? "")), create: [{ key: "BG_STYLE", value: "1" }] }),
      ...referenced("CandidateCodeView", "BG_IMAGE", "符号列背景"),
      ...referenced("CandidateCodeView", "BG_IMAGES", "符号列单元格"),
      textBlock(skinPath, firstValue(skin.get("CandidateCodeView", "TEXT_STYLE")) ?? "TextStyle_Text", CANDIDATE_TEXT_KEYS),
      block("TextStyle_Popup_Code"),
    ]] as [string, SsfBlock[]]] : [],
  ]
  return [
    ...groups.map(([label, blocks]) => renderGroup(label, blocks)),
    bubbleGroup(skinPath, skin),
    soundGroup(undefined),
  ].filter((group): group is Group => Boolean(group))
}

/** Every section of a Sogou INI file, one group each. */
function fileGroups(path: string): Group[] {
  const document = ssfDocument(path)
  const sections = [...new Set([...document.sections(), .../phoneSkin\.ini$/i.test(path) ? ["RootView", "CandidateView", "ComposingView", "General"] : []])]
  const references = new Map<string, Array<{ key: string; target: string }>>()
  for (const section of sections) {
    for (const key of ["BG_IMAGE", "BG_IMAGES", "FG_IMAGES"]) {
      const target = firstValue(document.get(section, key))
      if (target && !/\.\w+$/.test(target)) {
        const list = references.get(section) ?? []
        list.push({ key, target })
        references.set(section, list)
      }
    }
  }
  const referencedSections = new Set([...references.values()].flatMap((items) => items.map(({ target }) => target)))
  return sections.flatMap((section) => {
    if (referencedSections.has(section)) return []
    const label = path === "phoneTheme.ini" && section === "General" ? "皮肤信息" : ssfSectionLabel(section)
    const refs = references.get(section) ?? []
    const backgroundMode = section === "ComposingView" ? "2" : /^(?:RootView|CandidateView|CandidateViewLand|CandidateCodeView)$/.test(section) ? "1" : undefined
    const blocks: SsfBlock[] = [{ path, section, omit: refs.map(({ key }) => key), ...(backgroundMode ? { create: [{ key: "BG_STYLE", value: backgroundMode }] } : {}) }]
    for (const { key, target } of refs) blocks.push({ path, section: target, title: ssfSectionLabel(target), expect: IMAGE_KEYS, reference: { path, section, key } })
    if (/^CandidateView/.test(section) && !firstValue(document.get(section, "BG_IMAGE"))) blocks.push(...imageBlocks(path, document, section, "BG_IMAGE", "候选栏背景"))
    if (section === "CandidateCodeView") {
      for (const [key, title] of [["BG_IMAGE", "符号列背景"], ["BG_IMAGES", "符号列单元格"]]) {
        if (!firstValue(document.get(section, key))) blocks.push(...imageBlocks(path, document, section, key, title))
      }
    }
    const group = renderGroup(label, blocks, section)
    return group ? [{ ...group, key: section }] : []
  })
}

/** Inspector header for a board or its selected keys: the board / key class name and the file it lives in. */
export function ssfInspectorTitle(): { name: string; context: string } | undefined {
  const path = appState.selectedPath
  const skinPath = ssfSkinPath()
  if (!skinPath || !isSsfBoardPath(path) || path !== appState.layoutPath) return
  const bindings = ssfSelectedBindings()
  if (appState.selectedCandidate) return { name: "候选栏与工具栏", context: skinPath }
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
      return only.length || block.expect ? [{ path: block.path, section: block.section, title: block.title, only, options: block.options, expect: block.expect, create: block.create, bind: block.bind,
        note: "作用于所有选中按键",
        peers: matches.slice(1).map(({ path, section, create, bind }) => ({ path, section, create, bind })),
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
    groups = appState.selectedCandidate ? boardGroups().filter(({ label }) => ["候选栏", "候选字", "输入码"].includes(label)) : bindings.length > 1 ? commonKeyGroups(bindings.map(({ binding }) => keyGroups(binding))) : bindings.length ? keyGroups(bindings[0].binding) : boardGroups()
  } else if (appState.archive?.isText(path) && /\.ini$/i.test(path)) {
    groups = fileGroups(path)
  }
  container.append(...groups.flatMap(({ label, blocks, code, key }) => {
    const group = renderSsfGroup(label, blocks, code, key)
    return group ? [group] : []
  }))
  if (appState.selectedCandidate || /phoneSkin\.ini$/i.test(path)) container.append(toolbarIconSection())
  container.dataset.path = path
  return groups.length > 0
}
