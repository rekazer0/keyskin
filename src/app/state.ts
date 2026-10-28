// 编辑器的全部可变状态（原 main.ts 顶层 let）。各模块通过 appState.x 读写。
import { SkinArchive } from "../skin.ts"
import { type UnwatchFn } from "@tauri-apps/plugin-fs"
import { IniDocument } from "../ini.ts"
import { type Change } from "../history.ts"
import { type AiDraft } from "./types"
import { type ModelConfiguration } from "../model-settings.ts"
import { type AiDesignConversation } from "../ai-design.ts"
import { type AiChatController } from "../ai-chat.ts"
import { type LayoutImageTarget } from "../layout-image.ts"
import { type LayoutImageConfig } from "./types"
import { type TextVisual, type Visual } from "../atlas.ts"
import { type InputBarMetrics } from "../candidate-style.ts"
import { DEFAULT_PANEL_WIDTH } from "../keyboard.ts"
import { type TileSlice } from "../tiles.ts"
import { type TilePoint } from "../tiles.ts"
import { type StyleImagePickerTarget } from "./types"
import { type NativeImagePickerPayload } from "./types"
import { type SourceTransfer } from "./types"
import { type BdaAppearanceStyleGroup } from "../bda.ts"
import { type BdaTileUsage } from "./types"
import { type TileRect } from "../tiles.ts"
import { createAtlasWorkspace } from "../atlas-workspace"
import { type VisualResolver } from "../atlas.ts"
import { type SourceEditorValueRange } from "../lazy-source-editor.ts"
import { type ProjectChoice } from "../project-chooser"
import { type WindowMaterialKind } from "./types"
import { type SsfTemplates } from "../ssf/ssf-convert.ts"
import { type JsonObject } from "../palm/sxi-ini.ts"
import { type SsfPackage } from "../ssf/ssf-package.ts"
export const appState = {
  fileOperationProgressVisible: false,
  simulatedComposition: "",
  lastSimulationLanguage: undefined as "zh" | "en" | undefined,
  archive: undefined as SkinArchive | undefined,
  bdaBase: undefined as SkinArchive | undefined,
  ssfTemplates: undefined as SsfTemplates | undefined,
  /** The SSF document and the resolution / looks its skeleton overlay was laid out for. */
  ssfPreviewKey: undefined as { archive: SkinArchive; key: string } | undefined,
  /** The open `.sxi` document's parsed skin.json, for the archive revision it was read at. */
  palmSkin: undefined as { archive: SkinArchive; revision: number; skin: JsonObject } | undefined,
  /** The open SSF document's own files as a package, for the archive revision it was read at. */
  ssfPackage: undefined as { archive: SkinArchive; revision: number; pkg: SsfPackage } | undefined,
  currentPath: "",
  sourceWorkspacePath: "",
  sourceWorkspacePrefix: "",
  sourceWorkspacePendingArchive: undefined as SkinArchive | undefined,
  stopSourceWatch: undefined as UnwatchFn | undefined,
  sourceAutosaveTimer: undefined as number | undefined,
  sourceAutosaveQueue: Promise.resolve(),
  sourceWriteSnapshotTimer: undefined as number | undefined,
  sourceWatchTimer: undefined as number | undefined,
  selectedPath: "",
  selectedDocument: undefined as IniDocument | undefined,
  layoutPath: "",
  layoutDocument: undefined as IniDocument | undefined,
  selectedKeySections: [] as string[],
  selectedToolbarSections: [] as string[],
  selectedCandidate: false,
  /** Which text the 文字 group edits for the candidate bar or whole layout (候选字、首选、输入码……). */
  textStyleTarget: "",
  /** Which text layers of the selected BDA keys the 文字 fields edit: the main text or the hints after it. */
  bdaTextLayer: "label" as "label" | "hint",
  unsavedNew: false,
  assetURL: "",
  assetReturnPath: "",
  inspectorTab: "properties" as "properties" | "source" | "ai",
  sourceFindVisible: false,
  sourceSearchIndex: -1,
  sourceInputHighlightTimer: undefined as number | undefined,
  sourceInputRefreshPending: false,
  sourceSearchTimer: undefined as number | undefined,
  sourceHistoryHighlight: undefined as readonly [number, number] | undefined,
  undoStack: [] as Change[],
  redoStack: [] as Change[],
  aiDesignConversationTarget: undefined as SkinArchive | undefined,
  aiDesignDraft: undefined as AiDraft | undefined,
  /** Draft changes written into the archive so the canvas shows them; kept out of undo history until accepted. */
  aiDraftPreview: undefined as { target: SkinArchive; changes: Change[] } | undefined,
  aiDesignBusy: false,
  savedModels: [] as ModelConfiguration[],
  savedImageModel: undefined as ModelConfiguration | undefined,
  // ponytail: keep three exchanges in memory; persist sessions only if cross-restart chat is needed.
  aiDesignConversation: [] as AiDesignConversation,
  aiChatController: undefined as AiChatController | undefined,
  aiChatInitialization: undefined as Promise<AiChatController> | undefined,
  layoutImageBytes: undefined as Uint8Array | undefined,
  layoutImageWidth: 0,
  layoutImageHeight: 0,
  layoutImageTarget: undefined as LayoutImageTarget | undefined,
  layoutImageConfig: "none" as LayoutImageConfig,
  layoutImageObjectURL: "",
  layoutImageHighlight: false,
  layoutImageApplying: false,
  fileOperationRunning: false,
  firstCandidateTextVisual: undefined as TextVisual | undefined,
  candidateTextWidth: DEFAULT_PANEL_WIDTH,
  /** The input code bar's metrics and `[INPUT] BACK_STYLE`; its width follows the typed code. */
  candidateInputBar: undefined as { metrics: InputBarMetrics; candidateWidth: number; visual?: Visual } | undefined,
  canvasLogicalSize: undefined as {
  width: number
  height: number
  panelHeight: number
  /** PANEL.SIZE height; panelHeight also covers keys placed below it. */
  layoutPanelHeight: number
  panelVisibleHeight: number
} | undefined,
  pickerPath: "",
  pickerSlices: [] as TileSlice[],
  pickerTarget: undefined as StyleImagePickerTarget | undefined,
  resourcePickerSelect: undefined as ((resourceID: string) => void) | undefined,
  nativeImagePickerPayload: undefined as NativeImagePickerPayload | undefined,
  // 切片窗口下次创建时的起始视图（列表优先用于「样式还没有图片」等入口）。
  pickerRequestedView: "image" as "image" | "list" | "styles",
  // 网页端选择窗口的 iframe 已加载完、可以直接收数据（弹窗关闭时清空）。
  pickerFrameReady: false,
  selectedFileButton: undefined as HTMLElement | undefined,
  sourceTransfer: undefined as SourceTransfer | undefined,
  sidebarView: "overview" as "overview" | "source",
  guidesVisible: false,
  previewReturnName: "py_9.ini",
  resourceConfigActive: false,
  resourceInspectorMode: "image" as "image" | "style" | "sound",
  animationDesignMode: "all" as "all" | "motion" | "particle",
  /** The animation shown per `path|mode` in the animation inspector (animation-resource.ts). */
  selectedAnimations: {} as Record<string, string>,
  selectedStyleID: "",
  selectedSoundID: "",
  selectedBdaStyleGroup: "imageStyles" as BdaAppearanceStyleGroup,
  styleReturnPath: "",
  styleReturnSelection: [] as string[],
  styleReturnCandidate: false,
  styleReturnScrollTop: 0,
  styleReturnInspectorGroup: "",
  bdaSliceReturn: undefined as { path: string; styleID: string } | undefined,
  selectedResourcePath: "",
  resourceURLs: [] as string[],
  tilePath: "",
  tileDocument: IniDocument.parse(""),
  slices: [] as TileSlice[],
  bdaTileUsages: [] as BdaTileUsage[],
  selectedTileIndex: undefined as number | undefined,
  drawingTile: false,
  tileDragStart: undefined as TilePoint | undefined,
  tileDraft: undefined as TileRect | undefined,
  tileMode: "select" as "select" | "move",
  keyMode: "select" as "select" | "move",
  movingTile: undefined as TileSlice | undefined,
  moveStart: undefined as TilePoint | undefined,
  atlasWorkspace: undefined as ReturnType<typeof createAtlasWorkspace> | undefined,
  tileResizeCorner: undefined as number | undefined,
  tileDragOriginal: undefined as TileSlice | undefined,
  moveSource: undefined as TileRect | undefined,
  copiedTile: undefined as TileSlice | undefined,
  pendingPointerCoordinates: undefined as {
  event: Pick<PointerEvent, "clientX" | "clientY" | "pointerType">
  target: HTMLElement
  canvas: HTMLCanvasElement
  geometry?: { target: DOMRect; wrap: DOMRect; wrapWidth: number; wrapHeight: number }
} | undefined,
  pointerCoordinatesFrame: 0,
  pointerOverlayGeometry: undefined as { left: number; top: number; width: number; height: number } | undefined,
  // Rebuilding the inspector costs 10–30ms in WebKit; run it after the canvas has
  // painted the new selection so a key click shows up on the very next frame.
  selectionInspectorSyncPending: false,
  activeKeyboardGeometry: undefined as {
  panelWidth: number
  panelHeight: number
  candidateHeight: number
  candidateInputHeight: number
} | undefined,
  keySoundAudio: undefined as HTMLAudioElement | undefined,
  keySoundURL: "",
  keySoundPath: "",
  keySoundContext: undefined as AudioContext | undefined,
  keySoundSource: undefined as AudioBufferSourceNode | undefined,
  /**
  * 分类轨当前分组。属性面板每次重绘都会重建分区元素，DOM 上的高亮无法跨重绘留住，
  * 所以记住一个稳定的分组标识：文档分区用分区代码，其余分组用分组标签。
  */
  inspectorGroupKey: "",
  singlePageInspectorContext: "",
  mobileSplitBeforeCollapse: Number(localStorage.getItem("mobile-workspace-split")) || 50,
  mobileSwipeStart: undefined as { pointerId: number; x: number; y: number } | undefined,
  cachedVisualResolver: undefined as { key: readonly unknown[]; resolver: VisualResolver } | undefined,
  cachedSkinStates: undefined as { key: readonly unknown[]; byLayout: Map<string, number[]> } | undefined,
  // 切换布局时在点击处理中途读取尺寸会强制整页重排；改由 ResizeObserver 回调（布局已就绪）缓存。
  // canvas-wrap 的 padding 只随媒体查询变化，而媒体查询变化必然伴随尺寸变化，缓存不会过期。
  canvasWrapInnerSize: undefined as { width: number; height: number } | undefined,
  fitCanvasDebounce: undefined as ReturnType<typeof setTimeout> | undefined,
  canvasFitFrozen: false,
  previewZoom: 1,
  previewPanLocked: true,
  previewPanX: 0,
  previewPanY: 0,
  previewPanStart: undefined as { pointerId: number; x: number; y: number; panX: number; panY: number } | undefined,
  previewPanCandidate: undefined as { pointerId: number; x: number; y: number; panX: number; panY: number } | undefined,
  pendingPreviewPan: undefined as { x: number; y: number } | undefined,
  previewPanGeometry: undefined as { target: DOMRect; wrap: DOMRect; wrapWidth: number; wrapHeight: number } | undefined,
  // 点击画布外的空白区域（棋盘格背景）同样取消选中，回到面板配置；拖动平移不算点击。
  canvasWrapClickStart: undefined as { x: number; y: number } | undefined,
  currentFileOperation: "",
  atlasDrawFrame: 0,
  sourceColorPickerTarget: undefined as SourceEditorValueRange | undefined,
  sourceStyleProxyTarget: undefined as SourceEditorValueRange | undefined,
  stylePickerTarget: undefined as HTMLInputElement | undefined,
  styleLibraryHighlighted: false,
  styleLibrarySelected: undefined as { styleID?: string; imagePath?: string } | undefined,
  // 样式库内新增：复用「新增样式」对话框，创建后直接应用到当前引用并进入编辑。
  newStyleApplyTarget: undefined as HTMLInputElement | undefined,
  // Thumbnails redraw a frame later so they don't share a task with the inspector rebuild.
  stylePreviewsPending: false,
  particlePreviewSection: "",
  pickerSelectedIndex: undefined as number | undefined,
  mobileOverviewGroup: "",
  newProjectOptions: undefined as ProjectChoice | undefined,
  projectChooserInitialized: false,
  nativeProjectChoice: undefined as Promise<string | undefined> | undefined,
  resolveNativeProjectChoice: undefined as ((templateID: string | undefined) => void) | undefined,
  nativeProjectWindowReady: false,
  recentPreviewRunning: false,
  // 使用教程进行中时的停止函数
  stopOnboarding: undefined as (() => void) | undefined,
  // 持久缩略图缓存：重启后不必再读整包解 demo 图。按路径存，条目随最近列表裁剪（最多 9 个）。
  recentThumbDb: undefined as Promise<IDBDatabase> | undefined,
  windowMaterialKind: "glass" as WindowMaterialKind,
  windowDragPointerDown: false,
  windowDragMaterialDisabled: false,
  windowDragMaterialTransition: undefined as Promise<unknown> | undefined,
  canvasDragDepth: 0,
  // 投放区：拖入 PNG 与点击选择等价；同时拦掉浏览器直接打开文件的默认行为。
  layoutImageDragDepth: 0,
  // Resource image actions
  selectedResourceGalleryPath: "",}
