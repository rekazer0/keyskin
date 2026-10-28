import {
  createElement, type IconNode, KeyRound, Component, SquareDashed, Ellipsis,
  LayoutGrid, Palette, Type, Zap, Images, PanelTop, Clapperboard, Volume2,
  MousePointer2, Move, Copy, ArrowLeftRight, Trash2, ChevronDown, ChevronRight,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, CircleDot, Music, Play, Info,
  AlignStartVertical, AlignEndVertical, AlignStartHorizontal, AlignEndHorizontal,
  ArrowUpDown, FoldHorizontal, FoldVertical, Layers, SquareStack, Ruler,
  Search, Plus, X, Upload, Download, ImageDown, ChevronLeft, ChevronUp,
  SquarePlus, CopyPlus, FileText, List, Keyboard, Image, Settings, PenLine, Asterisk,
  AppWindow, MessageSquare, Grid3x3, PenTool, PenOff, PencilLine, Brush, CaseLower, CaseUpper,
  ALargeSmall, ArrowBigUp, ArrowBigUpDash, Phone, Mail, Globe, Link, Calculator, Binary, Hash,
  Percent, Quote, AtSign, Ampersand, MessageSquareQuote, MessageSquareMore, Signature, Rows3,
  ListOrdered, ListChecks, CircleHelp, Mic, Film, WandSparkles, ToggleRight, Sticker, AudioLines,
  Sigma, Pi, Omega, Slash, Parentheses, Braces, DollarSign, Hand, ScanLine, Spline, ListTree,
  ListFilter, Smile, Laugh, SmilePlus, LayoutTemplate, PanelBottom, SquareDashedBottom,
  LayoutDashboard, Columns3, Table2, Box, Folder, File,
  HardDrive, Smartphone, Crosshair, Moon, Sun, RectangleHorizontal, RectangleVertical, Scissors, ClipboardPaste,
  Undo2, Redo2, RotateCw, Share, Menu, Eye, EyeOff, Wifi, Signal, BatteryFull, Lightbulb, SlidersHorizontal,
  Paperclip, Sparkles, VolumeX, Check, ChevronsUpDown, CodeXml, FileDown, Minus, Scan, Paintbrush,
  CircleAlert, FolderInput, Grid2x2, Maximize, Pointer, Timer, Frame, LayoutPanelTop, FlaskConical, History,
  Shirt, Pause, Blend, Scaling, ListVideo, Route, Orbit, Waves, PartyPopper, Rabbit, Repeat, Snail,
  SkipBack, Rotate3d,
} from "lucide"

// Exact Lucide names from 属性检查器.pen, read through Pen MCP.
const icons: Record<string, IconNode> = {
  "key-round": KeyRound, component: Component, "square-dashed": SquareDashed,
  ellipsis: Ellipsis, "layout-grid": LayoutGrid, palette: Palette, type: Type,
  zap: Zap, images: Images, "panel-top": PanelTop, clapperboard: Clapperboard,
  "volume-2": Volume2, "mouse-pointer-2": MousePointer2, move: Move, copy: Copy,
  "arrow-left-right": ArrowLeftRight, "trash-2": Trash2, "chevron-down": ChevronDown,
  "chevron-right": ChevronRight, "chevron-left": ChevronLeft, "chevron-up": ChevronUp,
  "arrow-up": ArrowUp, "arrow-down": ArrowDown, "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight, "circle-dot": CircleDot, music: Music, play: Play, pause: Pause,
  info: Info, "align-start-vertical": AlignStartVertical,
  "align-end-vertical": AlignEndVertical, "align-start-horizontal": AlignStartHorizontal,
  "align-end-horizontal": AlignEndHorizontal, "arrow-up-down": ArrowUpDown,
  "fold-horizontal": FoldHorizontal, "fold-vertical": FoldVertical, layers: Layers,
  "square-stack": SquareStack, ruler: Ruler, search: Search, plus: Plus, x: X,
  upload: Upload, download: Download, "image-down": ImageDown,
  "square-plus": SquarePlus, "copy-plus": CopyPlus, "file-text": FileText, list: List,
  keyboard: Keyboard, image: Image, settings: Settings, "pen-line": PenLine, asterisk: Asterisk,
  "app-window": AppWindow, "message-square": MessageSquare,
  // 概览文件图标：每个文件一个。
  "grid-3x3": Grid3x3, "pen-tool": PenTool, "pen-off": PenOff, "pencil-line": PencilLine, brush: Brush,
  "case-lower": CaseLower, "case-upper": CaseUpper, "a-large-small": ALargeSmall,
  "arrow-big-up": ArrowBigUp, "arrow-big-up-dash": ArrowBigUpDash, phone: Phone, mail: Mail,
  globe: Globe, link: Link, calculator: Calculator, binary: Binary, hash: Hash, percent: Percent,
  quote: Quote, "at-sign": AtSign, ampersand: Ampersand, "message-square-quote": MessageSquareQuote,
  "message-square-more": MessageSquareMore, signature: Signature, "rows-3": Rows3,
  "list-ordered": ListOrdered, "list-checks": ListChecks, "circle-help": CircleHelp, mic: Mic,
  film: Film, "wand-sparkles": WandSparkles, "toggle-right": ToggleRight, sticker: Sticker,
  "audio-lines": AudioLines, sigma: Sigma, pi: Pi, omega: Omega, slash: Slash,
  parentheses: Parentheses, braces: Braces, "dollar-sign": DollarSign, hand: Hand,
  "scan-line": ScanLine, spline: Spline, "list-tree": ListTree, "list-filter": ListFilter,
  smile: Smile, laugh: Laugh, "smile-plus": SmilePlus, "layout-template": LayoutTemplate,
  "panel-bottom": PanelBottom, "square-dashed-bottom": SquareDashedBottom,
  "layout-dashboard": LayoutDashboard, "columns-3": Columns3, "table-2": Table2, box: Box,
  // 源文件树
  folder: Folder, file: File, "flask-conical": FlaskConical, history: History,
  // 工具栏、菜单与状态
  "hard-drive": HardDrive, smartphone: Smartphone, crosshair: Crosshair, moon: Moon, sun: Sun,
  "rectangle-horizontal": RectangleHorizontal, "rectangle-vertical": RectangleVertical, scissors: Scissors,
  "clipboard-paste": ClipboardPaste, "undo-2": Undo2, "redo-2": Redo2, "rotate-cw": RotateCw, share: Share,
  menu: Menu, eye: Eye, "eye-off": EyeOff, wifi: Wifi, signal: Signal, "battery-full": BatteryFull,
  lightbulb: Lightbulb, "sliders-horizontal": SlidersHorizontal, paperclip: Paperclip, sparkles: Sparkles,
  "volume-x": VolumeX, check: Check, "chevrons-up-down": ChevronsUpDown, "code-xml": CodeXml,
  "file-down": FileDown, minus: Minus, scan: Scan, paintbrush: Paintbrush,
  "circle-alert": CircleAlert, "folder-input": FolderInput, "grid-2x2": Grid2x2, maximize: Maximize,
  pointer: Pointer, timer: Timer, frame: Frame, "layout-panel-top": LayoutPanelTop,
  // 手心内置工具栏（皮肤没有工具栏图标时画布代画）
  shirt: Shirt,
  // 动画：每种变化一个图标，播放器的回到开头、循环与慢放
  blend: Blend, scaling: Scaling, "list-video": ListVideo, route: Route, orbit: Orbit, waves: Waves,
  "party-popper": PartyPopper, rabbit: Rabbit, "rotate-3d": Rotate3d, repeat: Repeat, snail: Snail,
  "skip-back": SkipBack,
}

export function createIcon(name: string, size = 14): SVGElement {
  const node = icons[name]
  if (!node) throw new Error(`Unknown icon: ${name}`)
  const svg = createElement(node, { width: size, height: size, "stroke-width": 1.5, "aria-hidden": "true", class: "inspector-icon ui-icon" })
  svg.dataset.penIcon = name
  return svg
}

export function groupIcon(label: string): SVGElement {
  const name = label === "布局" ? "frame"
    : label === "预览" ? "play"
    : /时间|循环/.test(label) ? "timer"
    : label === "引用" ? "link"
    : label === "组合" ? "layers"
    : label === "变化" ? "spline"
    : label === "变换中心" ? "crosshair"
    : label === "运动" ? "move"
    : label === "发射" ? "sparkles"
    : /资源|图片/.test(label) ? "images"
    : /动画|动效|粒子/.test(label) ? "clapperboard"
    : /声音|音效/.test(label) ? "volume-2"
    : /气泡/.test(label) ? "message-square"
    : /候选栏|提示栏/.test(label) ? "panel-top"
    : /面板|布局|输入区|扩展区域/.test(label) ? "layout-grid"
    : /列表/.test(label) ? "list"
    : /基本信息|全局/.test(label) ? "info"
    : /样式|外观|颜色|皮肤/.test(label) ? "palette"
    : /文字|字体|内容/.test(label) ? "type"
    : /动作|手势|按键/.test(label) ? "zap" : "panel-top"
  return createIcon(name, 16)
}

/**
 * 旧代码里的平台符号名（SF Symbols 风格）→ Lucide 名。只用于迁移期间解析遗留名称，
 * 新代码直接写 Lucide 名（DESIGN.md §5）。
 */
const SYMBOL_ALIASES: Record<string, string> = {
  magnifyingglass: "search", xmark: "x", trash: "trash-2", "arrow.up": "upload", "arrow.down": "download",
  "arrow.right": "arrow-right", "chevron.left": "chevron-left", "chevron.up": "chevron-up",
  "chevron.down": "chevron-down", "chevron.right": "chevron-right", "chevron.up.chevron.down": "chevrons-up-down",
  cursorarrow: "mouse-pointer-2", "arrow.up.and.down.and.arrow.left.and.right": "move",
  "arrow.left.and.right": "arrow-left-right", "arrow.left.arrow.right": "arrow-left-right",
  "arrow.up.and.down": "arrow-up-down", "doc.on.doc": "copy", "doc.text": "file-text", doc: "file",
  "square.grid.2x2": "layout-grid", "rectangle.3.group": "layout-grid", "plus.rectangle": "square-plus",
  "plus.square.on.square": "copy-plus", "photo.badge.arrow.down": "image-down",
  "align.horizontal.left": "align-start-vertical", "align.horizontal.right": "align-end-vertical",
  "align.vertical.top": "align-start-horizontal", "align.vertical.bottom": "align-end-horizontal",
  "arrow.left.and.right.righttriangle.left.righttriangle.right": "fold-horizontal",
  "arrow.up.and.down.righttriangle.up.righttriangle.down": "fold-vertical",
  "square.2.layers.3d": "square-stack", paintbrush: "paintbrush", paintpalette: "palette",
  "rectangle.and.hand.point": "zap", "text.bubble": "message-square", sparkles: "sparkles",
  "info.circle": "info", photo: "images", "list.bullet": "list", "speaker.wave.2": "volume-2",
  "speaker.slash": "volume-x", "music.note": "music", "play.fill": "play", gearshape: "settings",
  pencil: "pen-line", app: "app-window", externaldrive: "hard-drive", internaldrive: "hard-drive",
  "square.and.arrow.down": "download", "square.and.arrow.down.badge.new": "file-down",
  "square.and.arrow.up": "share", "iphone.gen3.badge.checkmark": "smartphone",
  "arrow.uturn.backward": "undo-2", "arrow.uturn.forward": "redo-2", "arrow.uturn.left": "undo-2",
  "arrow.uturn.right": "redo-2", "arrow.clockwise": "rotate-cw", "line.3.horizontal": "menu",
  "sun.max": "sun", "slider.horizontal.3": "sliders-horizontal", "rectangle.portrait": "rectangle-vertical",
  "rectangle.landscape": "rectangle-horizontal", "rectangle.dashed": "square-dashed", checkmark: "check",
  cellularbars: "signal", "battery.100": "battery-full", "code.xml": "code-xml", "eye.slash": "eye-off",
}

/** 解析图标名：Lucide 名原样返回，旧平台符号名与 lucide- 前缀名转成 Lucide 名。 */
function iconName(name: string): string {
  const plain = name.replace(/^lucide-/, "")
  return icons[plain] ? plain : SYMBOL_ALIASES[name] ?? "file"
}

/** 带 .system-symbol 外壳的图标（沿用原有尺寸规则）。 */
export function symbolSpan(name: string, size = 16): HTMLSpanElement {
  const span = document.createElement("span")
  span.className = "system-symbol"
  span.setAttribute("aria-hidden", "true")
  span.append(createIcon(iconName(name), size))
  return span
}

/** 需要 HTML 字符串的地方（如 deep-chat 的配置）用这个，图标仍来自同一张注册表。 */
export function iconMarkup(name: string, size = 14, strokeWidth = 1.5): string {
  const svg = createIcon(name, size)
  svg.setAttribute("stroke-width", String(strokeWidth))
  return svg.outerHTML
}

/**
 * HTML 里不写 <svg>：需要图标的元素标上 data-icon="lucide 名"（可选 data-icon-size），
 * 启动时由这里统一插入，作为元素的第一个子节点。
 */
export function hydrateIcons(root: ParentNode = document): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-icon]"))) {
    if (el.querySelector(":scope > .ui-icon")) continue
    el.prepend(createIcon(iconName(el.dataset.icon ?? ""), Number(el.dataset.iconSize) || 14))
  }
}
