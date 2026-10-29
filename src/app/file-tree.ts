import { appState } from "./state"
import { isBdaVirtualTextPath, isBdaAppearancePartPath, bdaAppearanceStylePath, bdaBasePath } from "./bda-documents"
import { symbolSpan } from "../icons"
import { layout, files, theme, orientation, documentName } from "./dom"
import { selectFile, overviewGroupState, currentNavigationMode } from "./navigation"
import { isSsfBoardPath, ssfThemeFolder, SSF_SOUNDS_PATH } from "./ssf-documents"
import { mobilePortraitQuery, sourceThumbnail } from "./canvas-interaction"
import { setMobilePane } from "./mobile-layout"
import { palmBoardLabel } from "../palm/palm-labels.ts"
import { boardFileName } from "../palm/sxi-layout.ts"
import { asObject } from "../palm/sxi-ini.ts"
import { SXI_SKIN_PATH, sxiFragment, sxiFragmentPath } from "../palm/sxi-json.ts"
import { openPalmSkin, palmBoardTypes, palmOrientation, palmTheme, PALM_SHARED_BOARD, sxiBoardAddress, sxiPointer } from "./sxi-documents"
import { bdaAppearancePath, bdaConfigPaths } from "../bda.ts"
import { decodeBdaAppearance } from "../bda-decode.ts"
import { toolbarConfigPath, styleConfigPath, legacyAnimationConfigPath } from "./config-context"
import { firstExistingPath } from "../resources.ts"
import { updateSourceFileActions, setSourceDropTarget, sourceDropFolder, commitSourceUploads, ensureSourcePathRendered, setSidebarView } from "./source-files"
import { isSoundPath, soundMimeType } from "../sounds.ts"
import { pickableImagePaths } from "./image-pickers"
import { isEditing } from "./edit-history"
import { runFileOperation } from "./file-operations"
import { askToCreateAnimationConfig, canCreateAnimationConfig } from "./animation-resource"

function addNavButton(
  parent: HTMLElement,
  label: string,
  path: string,
  className: string,
  icon?: string,
  navMode = className === "nav-resource" ? "resource" : "document",
  meta = path.split("/").pop() ?? path,
): HTMLButtonElement | undefined {
  // 没有动画配置时仍列出动效设计 / 粒子设计，点击时询问是否自动创建。
  const missingAnimation = !path && (navMode === "motion" || navMode === "particle")
  if (!missingAnimation && !appState.archive?.names().includes(path) && !isBdaVirtualTextPath(path) && !isBdaAppearancePartPath(path) && !isSsfBoardPath(path) && !sxiPointer(path)) return undefined
  const button = document.createElement("button")
  button.className = `nav-item ${className}`
  button.dataset.path = path
  button.dataset.navMode = navMode
  const navigationSystemSymbols: Record<string, string> = {
    "nav-overview": "info.circle",
    "nav-layout": "keyboard",
    "nav-component": "square.grid.2x2",
    "nav-style": "paintpalette",
    "nav-resource": "photo",
  }
  // 概览与检查器分类轨共用同一套 Lucide 图标（16px、1.5 描边），平台符号只作兜底。
  const symbolName = icon ?? navigationSystemSymbols[className] ?? "doc"
  button.append(symbolSpan(symbolName))
  const labelNode = document.createElement("span")
  labelNode.className = "nav-label"
  labelNode.textContent = label
  button.append(labelNode)
  // 概览卡片统一为两行内容：标题 + 文件名。英文布局也保留 en_*.ini，
  // 所有卡片的文字块高度才会完全一致。
  const metaNode = document.createElement("span")
  metaNode.className = "nav-meta"
  metaNode.textContent = meta || path.split("/").pop() || ""
  button.append(metaNode)
  button.title = `${label} · ${metaNode.textContent}`
  button.addEventListener("click", () => {
    if (missingAnimation) return askToCreateAnimationConfig(navMode === "particle")
    if (path.endsWith("py_9.ini") || path.endsWith("py_26.ini")) {
      layout.value = path.endsWith("_9.ini") ? "py_9.ini" : "py_26.ini"
      appState.previewReturnName = path.split("/").pop() ?? layout.value
    }
    selectFile(path, "overview", navMode === "resource" ? "image" : navMode === "style" ? "style" : navMode === "sound" ? "sound" : navMode === "motion" || navMode === "particle" ? navMode : "document")
    if (mobilePortraitQuery.matches) setMobilePane("inspector")
  })
  parent.append(button)
  if (appState.sidebarView === "overview" && path === appState.selectedPath && navMode === currentNavigationMode()) {
    button.classList.add("selected")
    appState.selectedFileButton = button
  }
  return button
}

// 效果预览图的 blob URL 只留一份，文件树重建时同一张图复用，换图时释放旧的。
let skinPreview: { bytes: Uint8Array; url: string } | undefined
function skinPreviewURL(bytes: Uint8Array): string {
  if (skinPreview?.bytes !== bytes) {
    if (skinPreview) URL.revokeObjectURL(skinPreview.url)
    skinPreview = { bytes, url: URL.createObjectURL(new Blob([bytes as BlobPart])) }
  }
  return skinPreview.url
}

type NavEntry = {
  group: string
  label: string
  path: string
  className: string
  icon: string
  navMode?: string
  meta?: string
}

const iniTypes: Record<string, Omit<NavEntry, "path">> = {
  "bh.ini": { group: "键盘布局", label: "笔画键盘", className: "nav-layout", icon: "brush" },
  "def_9.ini": { group: "键盘布局", label: "五笔 9 键", className: "nav-layout", icon: "pen-line" },
  "def_26.ini": { group: "键盘布局", label: "五笔 26 键", className: "nav-layout", icon: "pen-tool" },
  "def_26_new.ini": { group: "键盘布局", label: "五笔 26 键", className: "nav-layout", icon: "pen-off" },
  "py_9.ini": { group: "键盘布局", label: "拼音 9 键", className: "nav-layout", icon: "grid-3x3" },
  "py_26.ini": { group: "键盘布局", label: "拼音 26 键", className: "nav-layout", icon: "keyboard" },
  "en_9.ini": { group: "键盘布局", label: "英文 9 键", className: "nav-layout", icon: "case-lower" },
  "en_9s.ini": { group: "键盘布局", label: "英文 9 键 Shift", className: "nav-layout", icon: "arrow-big-up" },
  "en_26.ini": { group: "键盘布局", label: "英文 26 键", className: "nav-layout", icon: "a-large-small" },
  "en_26s.ini": { group: "键盘布局", label: "英文 26 键 Shift", className: "nav-layout", icon: "arrow-big-up-dash" },
  "en_26_new.ini": { group: "键盘布局", label: "英文 26 键", className: "nav-layout", icon: "type" },
  "en_26s_new.ini": { group: "键盘布局", label: "英文 26 键 Shift", className: "nav-layout", icon: "case-upper" },
  "num_9.ini": { group: "数字与符号", label: "数字键盘", className: "nav-component", icon: "calculator" },
  "num_26.ini": { group: "数字与符号", label: "26 键数字键盘", className: "nav-component", icon: "binary" },
  "num2.ini": { group: "数字与符号", label: "数字键盘 2", className: "nav-component", icon: "hash" },
  "symbol.ini": { group: "数字与符号", label: "符号面板", className: "nav-component", icon: "asterisk" },
  "sym_26_cn.ini": { group: "数字与符号", label: "中文 26 键符号", className: "nav-component", icon: "quote" },
  "sym_26_en.ini": { group: "数字与符号", label: "英文 26 键符号", className: "nav-component", icon: "at-sign" },
  "hw_grid.ini": { group: "手写与选择", label: "手写面板", className: "nav-component", icon: "signature" },
  "hw_full.ini": { group: "手写与选择", label: "全屏手写", className: "nav-component", icon: "pencil-line" },
  "sel_ch.ini": { group: "手写与选择", label: "中文选择栏", className: "nav-component", icon: "rows-3" },
  "sel_en.ini": { group: "手写与选择", label: "英文选择栏", className: "nav-component", icon: "list" },
  "voice.ini": { group: "键盘组件", label: "语音键盘", className: "nav-component", icon: "mic" },
  "dial.ini": { group: "键盘布局", label: "拨号键盘", className: "nav-layout", icon: "phone" },
  "email.ini": { group: "键盘布局", label: "邮箱键盘", className: "nav-layout", icon: "mail" },
  "net.ini": { group: "键盘布局", label: "网址键盘", className: "nav-layout", icon: "globe" },
  "net_shifts.ini": { group: "键盘布局", label: "网址键盘大写", className: "nav-layout", icon: "link" },
  "sel_ch_h.ini": { group: "手写与选择", label: "中文选择栏（加高）", className: "nav-component", icon: "list-ordered" },
  "sel_en_h.ini": { group: "手写与选择", label: "英文选择栏（加高）", className: "nav-component", icon: "list-checks" },
  "sym_26_cn_h.ini": { group: "数字与符号", label: "中文 26 键符号（加高）", className: "nav-component", icon: "message-square-quote" },
  "sym_26_en_h.ini": { group: "数字与符号", label: "英文 26 键符号（加高）", className: "nav-component", icon: "ampersand" },
  "symbol_h.ini": { group: "数字与符号", label: "符号面板（加高）", className: "nav-component", icon: "percent" },
  "help.ini": { group: "手写与选择", label: "帮助面板", className: "nav-component", icon: "circle-help" },
  "logo.ini": { group: "键盘组件", label: "输入法标识", className: "nav-component", icon: "app-window" },
  "gen.ini": { group: "资源配置", label: "通用配置", className: "nav-style", icon: "settings" },
}

/** Overview name of a keyboard layout file (`py_9.ini` → 拼音 9 键). */
export function layoutLabel(name: string): string {
  return iniTypes[name]?.label ?? name.replace(/\.ini$/i, "").replaceAll("_", " ")
}

/** A Palm theme and orientation's boards, candidate bars and bubbles, listed from skin.json like the Baidu layouts they correspond to. */
function palmOverviewEntries(): NavEntry[] {
  const layout = [palmTheme(), `${palmOrientation()}_layout`]
  const skin = openPalmSkin()
  const parts = (kind: string) => Object.keys(asObject(skin ? sxiFragment(skin, [...layout, kind]) : undefined) ?? {})
  const rank = (type: string) => ({ "py_9.ini": 0, "py_26.ini": 1, "bh.ini": 3 } as Record<string, number>)[boardFileName(type)] ?? 2
  const boards = [...parts("b").includes(PALM_SHARED_BOARD) ? [PALM_SHARED_BOARD] : [], ...palmBoardTypes()]
    .sort((a, b) => rank(a) - rank(b) || boardFileName(a).localeCompare(boardFileName(b)))
  const hints = parts("h")
  return [
    ...boards.map((type) => {
      const info = iniTypes[boardFileName(type)] ?? { group: "扩展布局", className: "nav-layout", icon: "" }
      return { ...info, label: palmBoardLabel(type), path: sxiBoardAddress(type) }
    }),
    ...parts("c").map((name, _, all) => ({ group: "键盘组件", label: all.length > 1 ? `候选栏与工具栏 · ${name}` : "候选栏与工具栏", path: sxiFragmentPath([...layout, "c", name]), className: "nav-component", icon: "panel-top" })),
    ...hints.map((name) => {
      // Like Baidu's hint1.pop / hint2.pop: `hint2` is the long-press bubble.
      const long = name === "hint2"
      const kind = long ? "长按气泡" : "按键气泡"
      const label = hints.filter((other) => (other === "hint2") === long).length > 1 ? `${kind} · ${name}` : kind
      return { group: "键盘组件", label, path: sxiFragmentPath([...layout, "h", name]), className: "nav-component", icon: long ? "message-square-more" : "message-square" }
    }),
  ]
}

export function renderFiles(): void {
  // 重建文件树前记住展开的文件夹，上传、删除、撤销后树不会整体收起。
  const openFolders = Array.from(files.querySelectorAll<HTMLDetailsElement>("details.raw-folder[open]"))
    .map((folder) => folder.dataset.folderPath ?? "")
    .filter(Boolean)
  files.replaceChildren()
  appState.selectedFileButton = undefined
  document.documentElement.dataset.archiveFormat = appState.archive?.format ?? ""
  if (!appState.archive) return

  const overview = document.createElement("div")
  overview.className = "sidebar-overview"
  files.append(overview)

  const mobileGroups = document.createElement("nav")
  mobileGroups.className = "mobile-overview-groups"
  mobileGroups.setAttribute("aria-label", "布局分组")
  overview.append(mobileGroups)
  const skinCard = document.createElement("div")
  skinCard.className = "skin-card"

  const setMobileOverviewGroup = (title: string): void => {
    appState.mobileOverviewGroup = title
    for (const button of Array.from(mobileGroups.querySelectorAll<HTMLButtonElement>("button"))) {
      const active = button.dataset.overviewGroup === title
      button.classList.toggle("active", active)
      button.setAttribute("aria-pressed", String(active))
    }
    for (const group of Array.from(overview.querySelectorAll<HTMLDetailsElement>(".nav-group"))) {
      const active = group.dataset.overviewGroup === title
      group.classList.toggle("mobile-overview-active", active)
      // The phone rail replaces the disclosure summary, so a closed group would render empty.
      if (active && mobilePortraitQuery.matches) group.open = true
    }
  }

  const section = (title: string, count = 0): HTMLElement => {
    const disclosure = document.createElement("details")
    disclosure.className = "nav-group"
    disclosure.dataset.overviewGroup = title
    disclosure.open = overviewGroupState.get(title) ?? ["皮肤", "资源配置", "键盘布局"].includes(title)
    disclosure.addEventListener("toggle", () => overviewGroupState.set(title, disclosure.open))
    const summary = document.createElement("summary")
    summary.className = "nav-section"
    const marker = document.createElement("span")
    marker.className = "source-disclosure"
    const label = document.createElement("span")
    label.className = "nav-label"
    label.textContent = title
    const countNode = document.createElement("span")
    countNode.className = "nav-section-count"
    countNode.textContent = String(count)
    summary.append(marker, label, countNode)
    const body = document.createElement("div")
    body.className = "nav-group-body"
    disclosure.append(summary, body)
    overview.append(disclosure)
    const mobileButton = document.createElement("button")
    mobileButton.type = "button"
    mobileButton.textContent = title
    mobileButton.dataset.overviewGroup = title
    mobileButton.addEventListener("click", () => setMobileOverviewGroup(title))
    mobileGroups.append(mobileButton)
    return body
  }

  const entries: NavEntry[] = []
  const bdaConfigGroups = [
    ["lightAnimation", "轻量动画", "轻量动画", "wand-sparkles"],
    ["sound", "按键音效", "声音配置", "volume-2"],
    ["switch", "开关配置", "开关配置", "toggle-right"],
    ["sticker", "贴纸配置", "贴纸配置", "sticker"],
    ["scene", "场景配置", "场景配置", "layers"],
  ] as const
  const overviewPath = appState.archive.format === "sxi" ? sxiFragmentPath(["info"])
    : appState.archive.names().includes(`${theme.value}/skin/Info.txt`) ? `${theme.value}/skin/Info.txt`
    : "Info.txt"
  entries.push({
    group: appState.archive.format === "bda" ? "皮肤信息" : "皮肤",
    label: "皮肤信息",
    path: overviewPath,
    className: "nav-overview",
    icon: "info",
  })
  // BDA 的 demo 在主题目录下，其他格式放在包根，手心 .sxi 用包根的 preview.png；条目只在文件存在时才显示。
  const demoPath = ["preview.png", `${theme.value}/skin/demo.png`].find((path) => appState.archive?.names().includes(path)) ?? "demo.png"
  entries.push({ group: appState.archive.format === "bda" ? "皮肤信息" : "皮肤", label: "效果预览", path: demoPath, className: "nav-overview", icon: "image" })

  if (appState.archive.format === "ssf") {
    const folder = ssfThemeFolder()
    const images = pickableImagePaths()
    const preview = ["square_preview.png", "candidate_preview.png"].find((path) => appState.archive?.getBytes(path))
    entries.push(
      { group: "皮肤", label: "皮肤信息", path: "phoneTheme.ini", className: "nav-overview", icon: "info" },
      ...preview ? [{ group: "皮肤", label: "效果预览", path: preview, className: "nav-overview", icon: "image" }] : [],
      { group: "皮肤", label: "外观切换", path: "time.ini", className: "nav-overview", icon: "sun" },
      { group: "资源配置", label: "按键样式", path: `${folder}phoneSkin.ini`, className: "nav-style", icon: "palette" },
      { group: "资源配置", label: "按键前景", path: `${folder}keys.ini`, className: "nav-style", icon: "layers" },
      { group: "资源配置", label: "按键动画", path: `${folder}anim.ini`, className: "nav-style", icon: "wand-sparkles" },
      { group: "资源配置", label: "按键音效", path: SSF_SOUNDS_PATH, className: "nav-resource", icon: "volume-2", navMode: "document" },
      ...images.length ? [{ group: "资源配置", label: "图片资源", path: images[0], className: "nav-resource", icon: "images", navMode: "resource", meta: `${images.length} 张图片` }] : [],
      { group: "资源配置", label: "音频资源", path: SSF_SOUNDS_PATH, className: "nav-resource", icon: "audio-lines", navMode: "sound" },
      { group: "资源配置", label: "运营配置", path: "op.ini", className: "nav-style", icon: "sparkles" },
    )
    // 搜狗手机输入法的全部键盘（取自官方安装包），按它的叫法列出；键位来自官方骨架，外观来自 phoneSkin.ini。
    const boards = [
      ["键盘布局", "py_9", "拼音九键", "grid-3x3"],
      ["键盘布局", "py_26", "拼音全键", "keyboard"],
      ["键盘布局", "py_14", "拼音 14 键", "columns-3"],
      ["键盘布局", "py_9_big_enter", "拼音九键大回车", "layout-dashboard"],
      ["键盘布局", "big_9", "拼音九键大按键", "grid-2x2"],
      ["键盘布局", "py_9_double_input", "双拼九键", "table-2"],
      ["键盘布局", "py_9_big_enter_double_input", "双拼九键大回车", "layout-panel-top"],
      ["键盘布局", "py_26_double_input", "双拼全键", "layout-template"],
      ["键盘布局", "def_26", "五笔", "pen-tool"],
      ["键盘布局", "bh", "笔画", "brush"],
      ["键盘布局", "bh_big_enter", "笔画大回车", "paintbrush"],
      ["键盘布局", "cantonese_9", "粤语九键", "message-square"],
      ["键盘布局", "cantonese_9_big_enter", "粤语九键大回车", "message-square-more"],
      ["键盘布局", "cantonese_26", "粤语全键", "message-square-quote"],
      ["键盘布局", "en_9", "英文九键", "case-lower"],
      ["键盘布局", "en_9_multi", "英文九键多击", "case-upper"],
      ["键盘布局", "en_26", "英文全键", "a-large-small"],
      ["键盘布局", "en_26_digits", "英文全键带数字行", "rows-3"],
      ["键盘布局", "en_26_pro", "英文专业版", "globe"],
      ["键盘布局", "en_26_pro_digits", "英文专业版带数字行", "list-ordered"],
      ["数字与符号", "num_9", "数字九键", "calculator"],
      ["数字与符号", "num_26_1", "数字全键", "binary"],
      ["数字与符号", "foreign_digit", "外文数字", "hash"],
      ["数字与符号", "en_digit", "英文数字", "sigma"],
      ["数字与符号", "en_symbol", "英文符号", "ampersand"],
      ["手写与语音", "handwriting", "半屏手写", "signature"],
      ["手写与语音", "handwriting_full", "全屏手写", "hand"],
      ["手写与语音", "handwriting_grid", "手写格子", "scan-line"],
      ["手写与语音", "handwriting_frosted_glass", "手写毛玻璃", "spline"],
      ["手写与语音", "handwriting_ink_printing", "手写水墨", "pen-line"],
      ["手写与语音", "voice", "语音", "mic"],
    ]
    for (const [group, name, label, icon] of boards) {
      entries.push({ group, label, path: `${theme.value}/skin/${orientation.value}/${name}.ini`, className: "nav-layout", icon, meta: "phoneSkin.ini" })
    }
  }
  const configPrefix = `${theme.value}/skin/${orientation.value}/`
  const appearancePath = bdaAppearancePath(appState.archive, theme.value, orientation.value)
  const appearanceBytes = appearancePath && appState.archive.getBytes(appearancePath)
  const appearance = appearanceBytes ? decodeBdaAppearance(appearanceBytes) : undefined
  if (appState.archive.format === "bda" && appearance) {
    for (const panelName of appearance.panels.keys()) {
      const name = `${panelName}.ini`
      const info = iniTypes[name] ?? {
        group: "面板样式",
        label: panelName.replaceAll("_", " "),
        className: "nav-layout",
        icon: "",
      }
      entries.push({
        ...info,
        group: "面板样式",
        path: `${configPrefix}${name}`,
        meta: panelName,
      })
    }
    entries.push({
      group: "资源配置",
      label: "样式配置",
      path: bdaAppearanceStylePath(appState.selectedBdaStyleGroup),
      className: "nav-style",
      icon: "palette",
      navMode: "style",
      meta: "appearanceConfig",
    })
    entries.push({
      group: "资源配置",
      label: "图片资源",
      path: appearancePath!,
      className: "nav-resource",
      icon: "images",
      navMode: "resource",
    })
    entries.push({
      group: "资源配置",
      label: "声音资源",
      path: appearancePath!,
      className: "nav-resource",
      icon: "audio-lines",
      navMode: "sound",
    })
  }
  const legacyAnimationPath = ["sxi", "bdi", "bds"].includes(appState.archive.format) ? legacyAnimationConfigPath() : undefined
  const layoutPaths = ["bda", "ssf", "sxi"].includes(appState.archive.format) ? [] : appState.archive.names()
  for (const path of layoutPaths.sort()) {
    if (!path.startsWith(configPrefix) || path.slice(configPrefix.length).includes("/") || !/\.ini$/i.test(path)) continue
    const name = path.split("/").pop() ?? path
    if (path === legacyAnimationPath) continue
    const info = iniTypes[name] ?? {
      group: "扩展布局",
      label: name.replace(/\.ini$/i, "").replaceAll("_", " "),
      className: "nav-layout",
      icon: "",
    }
    entries.push({
      ...info,
      group: info.group,
      path,
    })
  }

  if (appState.archive.format === "sxi") entries.push(...palmOverviewEntries())
  const candidatePath = appState.archive.format === "bda" || appState.archive.format === "sxi" ? undefined : toolbarConfigPath()
  if (candidatePath) {
    entries.push({ group: "键盘组件", label: "候选栏与工具栏", path: candidatePath, className: "nav-component", icon: "panel-top" })
  }
  const hintPath = firstExistingPath(appState.archive.names(), `${theme.value}/skin/${orientation.value}`, ["hint1.pop", "hint.pop"])
  if (hintPath) entries.push({ group: "键盘组件", label: "按键气泡", path: hintPath, className: "nav-component", icon: "message-square" })
  const longHintPath = firstExistingPath(appState.archive.names(), `${theme.value}/skin/${orientation.value}`, ["hint2.pop"])
  if (longHintPath) entries.push({ group: "键盘组件", label: "长按气泡", path: longHintPath, className: "nav-component", icon: "message-square-more" })
  const stylePath = appearancePath ?? (appState.archive.format === "bda" ? undefined : styleConfigPath())
  if (stylePath && appState.archive.format !== "bda") {
    entries.push({
      group: "资源配置",
      label: "图片资源",
      path: stylePath,
      className: "nav-resource",
      icon: "images",
      navMode: "resource",
    })
    entries.push({ group: "资源配置", label: "样式配置", path: stylePath, className: "nav-style", icon: "palette", navMode: "style" })
    entries.push({ group: "资源配置", label: "按键音效", path: stylePath, className: "nav-resource", icon: "volume-2", navMode: "sound" })
  }
  // 动画资源（手心 skin.json、百度 anim.ini、BDA animationConfig）分「动效设计」与「粒子设计」两个入口，
  // 指向同一个文件，只筛选展示，不改变资源路径和编号。
  const animationPaths = legacyAnimationPath ? [legacyAnimationPath]
    : appState.archive.format === "bda" ? bdaConfigPaths(appState.archive, theme.value, orientation.value, "animation") : []
  for (const path of animationPaths) {
    const suffix = animationPaths.length > 1 ? ` · ${path.split("/").pop()}` : ""
    entries.push(
      { group: "资源配置", label: `动效设计${suffix}`, path, className: "nav-style", icon: "film", navMode: "motion" },
      { group: "资源配置", label: `粒子设计${suffix}`, path, className: "nav-style", icon: "wand-sparkles", navMode: "particle" },
    )
  }
  if (!animationPaths.length && canCreateAnimationConfig()) {
    entries.push(
      { group: "资源配置", label: "动效设计", path: "", className: "nav-style", icon: "film", navMode: "motion", meta: "未创建" },
      { group: "资源配置", label: "粒子设计", path: "", className: "nav-style", icon: "wand-sparkles", navMode: "particle", meta: "未创建" },
    )
  }
  if (appState.archive.format === "bda") {
    for (const [kind, group, label, icon] of bdaConfigGroups) {
      const paths = bdaConfigPaths(appState.archive, theme.value, orientation.value, kind)
      for (const path of paths) entries.push({
        group,
        label: paths.length > 1 ? `${label} · ${path.split("/").pop()}` : label,
        path,
        className: kind === "sound" ? "nav-resource" : "nav-style",
        icon,
        navMode: kind === "sound" ? "sound" : undefined,
      })
    }
  }
  // A Palm entry's file is skin.json itself.
  for (const entry of entries) if (sxiPointer(entry.path)) entry.meta = SXI_SKIN_PATH
  // 每个文件一个图标：未登记或与前面撞图标的文件按名字归族，取族里还没用过的图标。
  const iconFamilies: [RegExp, string[]][] = [
    [/num|数字/i, ["calculator", "binary", "hash", "sigma", "pi"]],
    [/sym|符号/i, ["asterisk", "percent", "ampersand", "at-sign", "omega", "braces", "slash", "parentheses", "dollar-sign"]],
    [/sel|选择|list/i, ["rows-3", "list", "list-ordered", "list-checks", "list-tree", "list-filter"]],
    [/hw|手写/i, ["signature", "pencil-line", "hand", "spline", "scan-line"]],
    [/emoji|表情/i, ["smile", "laugh", "smile-plus"]],
  ]
  const spareIcons = ["keyboard", "layout-template", "panel-bottom", "square-dashed-bottom", "layout-dashboard", "columns-3", "table-2", "component", "box"]
  const iconOwners = new Map<string, NavEntry>()
  for (const entry of entries) if (entry.icon && !iconOwners.has(entry.icon)) iconOwners.set(entry.icon, entry)
  for (const entry of entries) {
    if (entry.icon && iconOwners.get(entry.icon) === entry) continue
    const name = `${entry.path.split("/").pop()} ${entry.label}`
    const family = iconFamilies.find(([pattern]) => pattern.test(name))?.[1] ?? []
    entry.icon = [...family, ...spareIcons].find((icon) => !iconOwners.has(icon)) ?? (entry.icon || "keyboard")
    iconOwners.set(entry.icon, entry)
  }
  // 皮肤信息与效果预览合成顶部的皮肤卡片：左边预览图，右边皮肤名与作者，点击仍各自打开原来的页面。
  const skinEntries = entries.filter((entry) => entry.className === "nav-overview" && ["皮肤信息", "效果预览"].includes(entry.label))
  for (const entry of skinEntries) {
    const button = addNavButton(skinCard, entry.label, entry.path, entry.className, entry.icon, entry.navMode, entry.meta)
    if (!button) continue
    if (entry.label === "效果预览") {
      button.classList.add("skin-card-preview")
      button.setAttribute("aria-label", "效果预览")
      skinCard.prepend(button)
      const bytes = appState.archive.getBytes(entry.path)
      if (!bytes) continue
      const image = document.createElement("img")
      image.alt = ""
      image.addEventListener("load", () => button.querySelector(".system-symbol")?.replaceWith(image), { once: true })
      image.src = skinPreviewURL(bytes)
      continue
    }
    const name = appState.archive.infoField("Name") || "未命名皮肤"
    const author = appState.archive.infoField("Author")
    button.classList.add("skin-card-info")
    button.querySelector(".nav-label")!.textContent = name
    button.querySelector(".nav-meta")!.textContent = author ? `${author} · 皮肤信息` : "皮肤信息"
    button.title = `皮肤信息 · ${name}`
  }
  const groups = appState.archive.format === "bda"
    ? ["皮肤信息", "资源配置", "面板样式", "按键音效", "轻量动画", "开关配置", "贴纸配置", "场景配置"]
    : ["皮肤", "资源配置", "键盘布局", "数字与符号", "手写与语音", "手写与选择", "键盘组件", "扩展配置", "扩展布局"]
  for (const group of groups) {
    const grouped = entries.filter((entry) => entry.group === group && !skinEntries.includes(entry) && (
      !entry.path && entry.meta === "未创建" || appState.archive?.names().includes(entry.path) || isSsfBoardPath(entry.path) || Boolean(sxiPointer(entry.path)) ||
      appState.archive?.format === "bda" && (isBdaAppearancePartPath(entry.path) || Boolean(appState.bdaBase?.isText(bdaBasePath(entry.path))))
    ))
    if (group === "键盘布局" && appState.archive.format !== "ssf") {
      const layoutRank: Record<string, number> = { "py_9.ini": 0, "py_26.ini": 1, "bh.ini": 3 }
      grouped.sort((a, b) => {
        const aName = a.path.split("/").pop() ?? ""
        const bName = b.path.split("/").pop() ?? ""
        return (layoutRank[aName] ?? 2) - (layoutRank[bName] ?? 2)
      })
    }
    if (appState.archive.format === "bda" && group === "面板样式") {
      const bdaLayoutRank: Record<string, number> = {
        "py_9": 0,
        "py_26": 1,
        "en_26": 2,
        "en_26s": 3,
        "en_9": 4,
        "en_9s": 5,
        "num_9": 6,
        "num_26": 7,
        "symbol": 8,
        "sym_26_cn": 9,
        "sym_26_en": 10,
        "hw_grid": 11,
        "hw_full": 12,
        "bh": 13,
        "sel_ch": 14,
        "sel_en": 15,
        "voice": 16,
      }
      grouped.sort((a, b) => {
        const aName = a.meta ?? ""
        const bName = b.meta ?? ""
        return (bdaLayoutRank[aName] ?? 100) - (bdaLayoutRank[bName] ?? 100) || aName.localeCompare(bName)
      })
    }
    // 皮肤卡片放在它原来所在的分组（「皮肤」/ BDA 的「皮肤信息」）里，分组照常可折叠。
    const card = skinCard.childElementCount && group === skinEntries[0]?.group ? skinCard : undefined
    if (!grouped.length && !card) continue
    const body = section(group, grouped.length + (card?.childElementCount ?? 0))
    if (card) body.append(card)
    for (const entry of grouped) {
      addNavButton(body, entry.label, entry.path, entry.className, entry.icon, entry.navMode, entry.meta)
    }
  }
  const availableMobileGroups = Array.from(mobileGroups.querySelectorAll<HTMLButtonElement>("button"))
  if (!availableMobileGroups.some((button) => button.dataset.overviewGroup === appState.mobileOverviewGroup)) {
    appState.mobileOverviewGroup = availableMobileGroups[0]?.dataset.overviewGroup ?? ""
  }
  setMobileOverviewGroup(appState.mobileOverviewGroup)

  const sourceFiles = document.createElement("div")
  sourceFiles.className = "raw-files"
  sourceFiles.setAttribute("role", "tree")
  sourceFiles.setAttribute("aria-label", "源文件")
  const sourceNameCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare
  type SourceNode = { folders: Map<string, SourceNode>; paths: string[] }
  const root: SourceNode = { folders: new Map(), paths: [] }
  for (const path of appState.archive.names().filter((name) => !name.endsWith("/"))) {
    const parts = path.split("/")
    let node = root
    for (const part of parts.slice(0, -1)) {
      let child = node.folders.get(part)
      if (!child) {
        child = { folders: new Map(), paths: [] }
        node.folders.set(part, child)
      }
      node = child
    }
    node.paths.push(path)
  }
  // 与概览同一套 Lucide 图标（16px、1.5 描边）；图片行先放图标，滚到附近再换成缩略图。
  const sourceSymbol = (name: string) => symbolSpan(name)
  const thumbnailObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const symbol = entry.target as HTMLElement
      thumbnailObserver.unobserve(symbol)
      const bytes = appState.archive?.getBytes(symbol.dataset.thumbnailPath ?? "")
      if (!bytes) continue
      void sourceThumbnail(bytes).then((url) => {
        if (!url) return
        const image = document.createElement("img")
        image.className = "source-thumbnail"
        image.alt = ""
        image.src = url
        symbol.replaceChildren(image)
      })
    }
  }, { rootMargin: "200px 0px" })
  const sourceFileCount = (node: SourceNode): number =>
    node.paths.length + [...node.folders.values()].reduce((total, child) => total + sourceFileCount(child), 0)
  const selectSourceRow = (row: HTMLElement) => {
    appState.selectedFileButton?.classList.remove("selected")
    appState.selectedFileButton = row
    row.classList.add("selected")
    for (const item of sourceFiles.querySelectorAll<HTMLElement>(".source-tree-row")) {
      item.tabIndex = item === row ? 0 : -1
    }
    row.focus()
    updateSourceFileActions()
  }
  const appendNode = (parent: HTMLElement, node: SourceNode, parentPath = "", depth = 0) => {
    for (const [name, child] of [...node.folders].sort(([a], [b]) => sourceNameCompare(a, b))) {
      const names = [name]
      let compactNode = child
      while (compactNode.paths.length === 0 && compactNode.folders.size === 1) {
        const [nestedName, nestedNode] = compactNode.folders.entries().next().value as [string, SourceNode]
        names.push(nestedName)
        compactNode = nestedNode
      }
      const compactName = names.join("/")
      const path = parentPath ? `${parentPath}/${compactName}` : compactName
      const folder = document.createElement("details")
      folder.className = "raw-folder"
      folder.dataset.folderPath = path
      folder.dataset.treeDepth = String(depth)
      const folderSummary = document.createElement("summary")
      folderSummary.className = "source-tree-row source-folder-row"
      folderSummary.dataset.folderPath = path
      folderSummary.setAttribute("role", "treeitem")
      folderSummary.setAttribute("aria-expanded", "false")
      folderSummary.tabIndex = -1
      const disclosure = document.createElement("span")
      disclosure.className = "source-disclosure"
      disclosure.ariaHidden = "true"
      const title = document.createElement("span")
      title.className = "nav-label"
      title.textContent = `${compactName}/`
      const count = document.createElement("span")
      count.className = "nav-meta source-item-count"
      count.textContent = `${sourceFileCount(compactNode)} 项`
      folderSummary.append(disclosure, sourceSymbol("folder"), title, count)
      const children = document.createElement("div")
      children.className = "source-tree-group"
      children.setAttribute("role", "group")
      folder.append(folderSummary, children)
      let populated = false
      const populate = () => {
        if (populated) return
        populated = true
        appendNode(children, compactNode, path, depth + 1)
      }
      disclosure.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        folder.open = !folder.open
      })
      folderSummary.addEventListener("click", (event) => {
        event.preventDefault()
        selectSourceRow(folderSummary)
      })
      folderSummary.addEventListener("dblclick", (event) => {
        event.preventDefault()
        folder.open = !folder.open
      })
      folder.addEventListener("toggle", () => {
        if (folder.open) populate()
        folderSummary.setAttribute("aria-expanded", String(folder.open))
      })
      parent.append(folder)
    }
    for (const path of [...node.paths].sort(sourceNameCompare)) {
      const button = document.createElement("button")
      button.className = "source-tree-row source-file-row"
      button.setAttribute("role", "treeitem")
      button.tabIndex = -1
      const symbolName = appState.archive?.isText(path) || appState.archive?.isBdaConfig(path)
        ? "doc.text"
        : appState.archive?.isImage(path)
          ? "image"
          : "doc"
      const symbol = sourceSymbol(symbolName)
      if (symbolName === "image") {
        symbol.dataset.thumbnailPath = path
        thumbnailObserver.observe(symbol)
      }
      button.append(symbol)
      const label = document.createElement("span")
      label.className = "nav-label"
      label.textContent = path.split("/").pop() ?? path
      button.append(label)
      button.title = path
      button.dataset.path = path
      button.draggable = true
      button.addEventListener("click", () => {
        if (appState.archive?.isText(path) || appState.archive?.isImage(path) || appState.archive?.isBdaConfig(path)) {
          appState.animationDesignMode = "all"
          selectFile(path, "source")
          if (mobilePortraitQuery.matches) setMobilePane("inspector")
        } else selectSourceRow(button)
        updateSourceFileActions()
      })
      button.addEventListener("dragstart", (event) => {
        const bytes = appState.archive?.getBytes(path)
        if (!bytes || !event.dataTransfer) return
        const mime = appState.archive?.isText(path)
          ? "text/plain"
          : appState.archive?.isImage(path)
            ? "image/png"
            : isSoundPath(path)
              ? soundMimeType(path)
              : "application/octet-stream"
        const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime }))
        const filename = path.split("/").pop() ?? "download"
        event.dataTransfer.effectAllowed = "copy"
        event.dataTransfer.setData("DownloadURL", `${mime}:${filename}:${url}`)
        event.dataTransfer.setData("text/uri-list", url)
        button.addEventListener("dragend", () => URL.revokeObjectURL(url), { once: true })
      })
      parent.append(button)
    }
  }
  const rootFolder = document.createElement("details")
  rootFolder.className = "raw-folder source-root-folder"
  rootFolder.open = true
  const rootSummary = document.createElement("summary")
  rootSummary.className = "source-tree-row source-folder-row source-root-row"
  rootSummary.setAttribute("role", "treeitem")
  rootSummary.setAttribute("aria-expanded", "true")
  rootSummary.tabIndex = -1
  const rootDisclosure = document.createElement("span")
  rootDisclosure.className = "source-disclosure"
  rootDisclosure.ariaHidden = "true"
  const rootTitle = document.createElement("span")
  rootTitle.className = "nav-label"
  rootTitle.textContent = documentName.textContent?.trim() || `未命名.${appState.archive.format}`
  const rootCount = document.createElement("span")
  rootCount.className = "nav-meta source-item-count"
  rootCount.textContent = `${sourceFileCount(root)} 项`
  const rootChildren = document.createElement("div")
  rootChildren.className = "source-tree-group source-root-group"
  rootChildren.setAttribute("role", "group")
  rootSummary.append(rootDisclosure, sourceSymbol("doc.text"), rootTitle, rootCount)
  rootFolder.append(rootSummary, rootChildren)
  rootDisclosure.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    rootFolder.open = !rootFolder.open
  })
  rootSummary.addEventListener("click", (event) => {
    event.preventDefault()
    selectSourceRow(rootSummary)
  })
  rootSummary.addEventListener("dblclick", (event) => {
    event.preventDefault()
    rootFolder.open = !rootFolder.open
  })
  rootFolder.addEventListener("toggle", () => {
    rootSummary.setAttribute("aria-expanded", String(rootFolder.open))
  })
  sourceFiles.append(rootFolder)
  appendNode(rootChildren, root)
  sourceFiles.addEventListener("dragover", (event) => {
    if (!appState.archive || !isEditing() || !event.dataTransfer?.types.includes("Files")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setSourceDropTarget(event.target as Element)
  })
  sourceFiles.addEventListener("dragleave", (event) => {
    if (!sourceFiles.contains(event.relatedTarget as Node | null)) setSourceDropTarget()
  })
  sourceFiles.addEventListener("drop", (event) => {
    const folder = sourceDropFolder(event.target as Element)
    setSourceDropTarget()
    if (!appState.archive || !isEditing() || folder === undefined || !event.dataTransfer?.files.length) return
    event.preventDefault()
    const dropped = Array.from(event.dataTransfer.files)
    void runFileOperation("上传文件", async () => commitSourceUploads(
      await Promise.all(dropped.map(async (file) => ({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }))),
      folder,
    ))
  })
  sourceFiles.querySelector<HTMLElement>(".source-tree-row")?.setAttribute("tabindex", "0")
  sourceFiles.addEventListener("keydown", (event) => {
    const current = (event.target as Element | null)?.closest<HTMLElement>(".source-tree-row")
    if (!current) return
    const rows = Array.from(sourceFiles.querySelectorAll<HTMLElement>(".source-tree-row"))
      .filter((row) => row.getClientRects().length > 0)
    const index = rows.indexOf(current)
    let next: HTMLElement | undefined
    switch (event.key) {
      case "ArrowDown":
        next = rows[index + 1]
        break
      case "ArrowUp":
        next = rows[index - 1]
        break
      case "ArrowRight": {
        const folder = current.closest<HTMLDetailsElement>("details.raw-folder")
        if (current.matches("summary") && folder && !folder.open) folder.open = true
        else if (current.matches("summary") && folder?.open) next = rows[index + 1]
        break
      }
      case "ArrowLeft": {
        const folder = current.closest<HTMLDetailsElement>("details.raw-folder")
        if (current.matches("summary") && folder?.open) folder.open = false
        else if (current.matches("summary")) {
          next = folder?.parentElement?.closest<HTMLDetailsElement>("details.raw-folder")?.querySelector<HTMLElement>(":scope > summary") ?? undefined
        } else {
          next = folder?.querySelector<HTMLElement>(":scope > summary") ?? undefined
        }
        break
      }
      case "Enter":
      case " ":
        current.dispatchEvent(new MouseEvent(current.matches("summary") ? "dblclick" : "click", { bubbles: true }))
        break
      default:
        return
    }
    event.preventDefault()
    if (next) selectSourceRow(next)
  })
  files.append(sourceFiles)
  for (const folder of openFolders) ensureSourcePathRendered(`${folder}/`)
  setSidebarView(appState.sidebarView)
}
