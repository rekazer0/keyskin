// 页面里静态存在的 DOM 元素引用（原 main.ts 顶层常量）。动态生成的元素不要放在这里。


export const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!

export const browserThemeColor = $<HTMLMetaElement>("#browser-theme-color")

export const newButton = $("#new") as HTMLButtonElement

export const newProjectDialog = $("#new-project-dialog") as HTMLDialogElement

export const newProjectForm = $("#new-project-form") as HTMLFormElement

export const unsavedDialog = $("#unsaved-dialog") as HTMLDialogElement

export const openButton = $("#open") as HTMLButtonElement

export const saveButton = $("#save") as HTMLButtonElement

export const mobileShareButton = $("#mobile-share") as HTMLButtonElement

export const undoButton = $("#undo") as HTMLButtonElement

export const redoButton = $("#redo") as HTMLButtonElement

export const toolbarMenus = Array.from(document.querySelectorAll<HTMLDetailsElement>(".toolbar-more"))

export const mobileCommandMenu = $(".mobile-command-menu") as HTMLDetailsElement

export const mobileUndoButton = $("#mobile-undo") as HTMLButtonElement

export const mobileRedoButton = $("#mobile-redo") as HTMLButtonElement

export const desktopUndoButton = $("#desktop-undo") as HTMLButtonElement

export const desktopRedoButton = $("#desktop-redo") as HTMLButtonElement

export const appDialogButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-app-dialog]"))

export const settingsDialog = $("#settings-dialog") as HTMLDialogElement

export const settingsModelNav = $("#settings-model-nav") as HTMLButtonElement

export const settingsModelSection = $("#settings-model-section")

export const copyQqGroupButton = $("#copy-qq-group") as HTMLButtonElement

export const aboutUpdate = $("#about-update")

export const checkUpdateButton = $("#check-update") as HTMLButtonElement

export const updateStatus = $("#update-status")

export const downloadUpdate = $("#download-update") as HTMLAnchorElement

export const aboutDiagnostics = $("#about-diagnostics")

export const exportLogsButton = $("#export-logs") as HTMLButtonElement

export const exportLogsStatus = $("#export-logs-status")

export const defaultDevice = $("#default-device") as HTMLSelectElement

export const canvasBackground = $("#canvas-background") as HTMLSelectElement

export const appTheme = $("#app-theme") as HTMLSelectElement

export const sourceFontSize = $("#source-font-size") as HTMLInputElement

export const windowMaterial = $("#window-material") as HTMLInputElement

export const windowMaterialOpacitySetting = $("#window-material-opacity-setting")

export const windowMaterialOpacity = $("#window-material-opacity") as HTMLInputElement

export const windowMaterialOpacityValue = $("#window-material-opacity-value") as HTMLOutputElement

export const sidebarViewVisible = $("#sidebar-view-visible") as HTMLInputElement

export const inspectorTabsVisible = $("#inspector-tabs-visible") as HTMLInputElement

export const overviewMetaVisible = $("#overview-meta-visible") as HTMLInputElement

export const sourceCompletionEnabled = $("#source-completion-enabled") as HTMLInputElement

export const sourceValueHintsEnabled = $("#source-value-hints-enabled") as HTMLInputElement

export const sourceLineExplanationEnabled = $("#source-line-explanation-enabled") as HTMLInputElement

export const mobilePreviewPosition = $("#mobile-preview-position") as HTMLSelectElement

export const hintPreviewEnabled = $("#hint-preview-enabled") as HTMLInputElement

export const editorCrosshair = $("#editor-crosshair") as HTMLInputElement

export const editorCoordinateSnapSetting = $("#editor-coordinate-snap-setting")

export const editorCoordinateSnap = $("#editor-coordinate-snap") as HTMLInputElement

export const settingsStorageSection = $("#settings-storage-section")

export const sourceDirectoryEnabled = $("#source-directory-enabled") as HTMLInputElement

export const sourceDirectory = $("#source-directory") as HTMLInputElement

export const chooseSourceDirectory = $("#choose-source-directory") as HTMLButtonElement

export const resetSourceDirectory = $("#reset-source-directory") as HTMLButtonElement

export const sourceDirectoryStatus = $("#source-directory-status")

export const mobilePaneButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mobile-pane]"))

export const mobileSplitHandle = $("#mobile-split-handle") as HTMLButtonElement

export const sourceColorPicker = $("#source-color-picker") as HTMLInputElement

export const sourceEditor = $("#source-editor")

export const sourceToolbar = $(".source-toolbar")

export const sourceFindToggle = $("#source-find-toggle") as HTMLButtonElement

export const sourceSearch = $("#source-search") as HTMLInputElement

export const sourceSearchCount = $("#source-search-count")

export const sourceSearchPrevious = $("#source-search-previous") as HTMLButtonElement

export const sourceSearchNext = $("#source-search-next") as HTMLButtonElement

export const sourceReplaceToggle = $("#source-replace-toggle") as HTMLButtonElement

export const sourceReplaceRow = $(".source-replace-row")

export const sourceReplacement = $("#source-replacement") as HTMLInputElement

export const sourceReplace = $("#source-replace") as HTMLButtonElement

export const sourceReplaceAll = $("#source-replace-all") as HTMLButtonElement

export const canvasWrap = $(".canvas-wrap")

export const previewCanvas = $("#preview") as HTMLCanvasElement

export const previewPanelViewport = $("#panel-viewport")

export const mainWorkspace = $("main")

export const sidebarPane = $("aside.sidebar")

export const inspectorPane = $("section.source")

export const sourceHeading = $(".source-heading")

export const mobileInspectorSelection = $("#mobile-inspector-selection")

export const asset = $("#asset")

export const assetImage = $("#asset-image") as HTMLImageElement

export const replaceAssetButton = $("#replace-asset") as HTMLButtonElement

export const assetBackButton = $("#asset-back") as HTMLButtonElement

export const files = $("#files")

export const sourceFileToolbar = $("#source-file-toolbar")

export const sourceUploadButton = $("#source-upload") as HTMLButtonElement

export const sourceDownloadButton = $("#source-download") as HTMLButtonElement

export const sourceCopyButton = $("#source-copy") as HTMLButtonElement

export const sourcePasteButton = $("#source-paste") as HTMLButtonElement

export const sourceMoveButton = $("#source-move") as HTMLButtonElement

export const sourceDeleteButton = $("#source-delete") as HTMLButtonElement

export const sourceUploadInput = $("#source-upload-input") as HTMLInputElement

export const sidebarViewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-sidebar-view]"))

export const sidebarViewControl = $(".sidebar-view-control")

export const documentName = $("#document-name")

export const sidebarProjectName = $("#sidebar-project-name")

export const sourceName = $("#source-name")

export const dirty = $("#dirty")

export const eventLog = $("#event-log")

export const fileOperationDialog = $("#file-operation-dialog") as HTMLDialogElement

export const fileOperationTitle = $("#file-operation-title")

export const fileOperationIcon = $("#file-operation-icon")

export const fileOperationDetail = $("#file-operation-detail")

export const fileOperationProgress = $("#file-operation-progress") as HTMLProgressElement

export const fileOperationPercent = $("#file-operation-percent")

export const fileOperationResult = $("#file-operation-result")

export const fileOperationClose = $("#file-operation-close") as HTMLButtonElement

export const panelStatus = $("#panel-status")

export const previewCoordinates = $("#preview-coordinates")

export const previewCoordinateX = $("#preview-coordinate-x")

export const previewCoordinateY = $("#preview-coordinate-y")

export const previewZoomOut = $("#preview-zoom-out") as HTMLButtonElement

export const previewZoomFit = $("#preview-zoom-fit") as HTMLButtonElement

export const previewZoomIn = $("#preview-zoom-in") as HTMLButtonElement
export const layoutOverview = $("#layout-overview")
export const layoutOverviewGrid = $("#layout-overview-grid")
export const layoutOverviewToggle = $("#layout-overview-toggle") as HTMLButtonElement

export const panelScaleButton = $("#panel-scale") as HTMLButtonElement

export const adaptIos26Button = $("#adapt-ios26") as HTMLButtonElement

export const editModeDialog = $("#edit-mode-dialog") as HTMLDialogElement
export const createAnimationDialog = $("#create-animation-dialog") as HTMLDialogElement
export const createAnimationDetail = $("#create-animation-detail")

export const ios26Dialog = $("#ios26-dialog") as HTMLDialogElement

export const ios26Form = $("#ios26-form") as HTMLFormElement

export const panelScaleDialog = $("#panel-scale-dialog") as HTMLDialogElement

export const panelScaleForm = $("#panel-scale-form") as HTMLFormElement

export const panelCopySource = $("#panel-copy-source") as HTMLInputElement

export const panelCopySourceOptions = $("#panel-copy-source-options") as HTMLDataListElement

export const panelCopyTarget = $("#panel-copy-target") as HTMLInputElement

export const panelCopyTargetOptions = $("#panel-copy-target-options") as HTMLDataListElement

export const panelScaleEnabled = $("#panel-scale-enabled") as HTMLInputElement

export const panelScaleOptions = $("#panel-scale-options")

export const panelSourceWidth = $("#panel-source-width") as HTMLInputElement

export const panelSourceHeight = $("#panel-source-height") as HTMLInputElement

export const panelTargetWidth = $("#panel-target-width") as HTMLInputElement

export const panelTargetHeight = $("#panel-target-height") as HTMLInputElement

export const panelScaleSummary = $("#panel-scale-summary")

export const quickInspector = $("#quick-inspector")

export const mobileInspectorGroups = $("#mobile-inspector-groups")

export const selectedKeyName = $("#selected-key")

export const selectedKeyPreview = $("#selected-key-preview")

export const selectedKeyContext = $("#selected-key-context")

export const keyFields = Array.from(document.querySelectorAll<HTMLInputElement>("[data-key-field]"))

export const styleFields = Array.from(document.querySelectorAll<HTMLInputElement>("[data-style-field]"))

export const primaryCssFields = $("#primary-css-fields")

export const fontFileField = $("#font-file-field")
export const fontFileSelect = $("#font-file-select") as HTMLSelectElement
export const fontImportButton = $("#font-import") as HTMLButtonElement
export const fontImportInput = $("#font-import-input") as HTMLInputElement
export const fontRemoveButton = $("#font-remove") as HTMLButtonElement
export const fontNameInput = $('[data-style-field="FONT_NAME"]') as HTMLInputElement
export const skinFontNames = $("#skin-font-names") as HTMLDataListElement

export const skinFields = Array.from(document.querySelectorAll<HTMLInputElement>("[data-skin-field]"))

export const keyboardFieldsGroup = $(".keyboard-fields")

export const toolbarFieldsGroup = $(".toolbar-fields")

export const textStyleGroup = $(".text-style-fields")

export const textStyleTargetSwitch = $("#text-style-targets")

export const textStyleRows = $("#text-style-rows")

export const textStyleNote = $("#text-style-note")

export const toolbarFields = Array.from(document.querySelectorAll<HTMLInputElement>("[data-toolbar-field]"))

export const skinFieldsGroup = $(".skin-fields")

export const documentFieldsGroup = $(".document-fields")

export const documentFields = $("#document-fields")

export const bdaConfigFieldsGroup = $(".bda-config-fields")

export const bdaConfigFields = $("#bda-config-fields")

export const bdaSelectedStyleHeading = $("#bda-selected-style-heading")

export const bdaInspectorStateButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-bda-inspector-state]"))

export const colorPickers = Array.from(document.querySelectorAll<HTMLInputElement>("[data-color-picker-for]"))

export const colorAlphas = Array.from(document.querySelectorAll<HTMLInputElement>("[data-color-alpha-for]"))

export const keyOnlyGroups = Array.from(document.querySelectorAll<HTMLElement>(".key-only"))

export const keyLayoutFieldsGroup = $(".key-layout-fields")

export const keyTypographyFieldsGroup = $(".key-typography-fields")

export const gapFields = Array.from(document.querySelectorAll<HTMLInputElement>("[data-gap-field]"))

export const canvasMultiToolbar = $("#canvas-multi-toolbar") as HTMLElement

export const canvasMultiCount = $("#canvas-multi-count") as HTMLElement

export const keyModeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-key-mode]"))

export const keyActionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-key-action]"))

export const baiduActionCodes = $("#baidu-action-codes") as HTMLDataListElement

export const inspectorTabs = $(".inspector-tabs")


export const aiDesignPanel = $("#ai-design-panel")

export const aiDesignStatus = $("#ai-design-status")

export const aiDesignChat = $("#ai-design-chat")

export const aiDesignModel = $("#ai-design-model") as HTMLSelectElement

export const aiDesignThinking = $("#ai-design-thinking") as HTMLSelectElement

export const aiDesignIntensity = $("#ai-design-intensity") as HTMLSelectElement

export const aiDesignScope = $("#ai-design-scope") as HTMLButtonElement

export const aiContextKey = $("#ai-context-key")

export const aiContextPreview = $("#ai-context-preview")

export const aiDraftPanel = $("#ai-draft-panel") as HTMLElement

export const aiDraftSummary = $("#ai-draft-summary") as HTMLElement

export const aiDraftFiles = $("#ai-draft-files") as HTMLElement

export const aiDraftApply = $("#ai-draft-apply") as HTMLButtonElement

export const aiDraftCancel = $("#ai-draft-cancel") as HTMLButtonElement

export const aiNewSession = $("#ai-new-session") as HTMLButtonElement

export const aiModelSettings = $(".ai-design-settings") as HTMLButtonElement

export const browserOpen = $("#browser-open") as HTMLInputElement

export const imageOpen = $("#image-open") as HTMLInputElement

export const theme = $("#theme") as HTMLSelectElement

export const orientation = $("#orientation") as HTMLSelectElement & { value: "port" | "land" }

export const layout = $("#layout") as HTMLSelectElement

export const mode = $("#mode") as HTMLSelectElement

export const device = $("#device") as HTMLSelectElement

export const deviceControlIcon = $("#device-control .device-control-icon")

export const toggleGuides = $("#toggle-guides") as HTMLButtonElement

export const mobileToggleGuides = document.createElement("button")

export const skinStateControl = $("#skin-state-control")

export const skinState = $("#skin-state") as HTMLSelectElement

export const skinStateValue = $(".skin-state-value")

export const deviceShell = $("#device-shell")

export const workspaceImageFigure = $("#workspace-image-figure")

export const workspaceImage = $("#workspace-image") as HTMLImageElement

export const atlasCanvas = $("#atlas-canvas") as HTMLCanvasElement

export const workspaceImageError = $("#workspace-image-error")

export const resourceInspector = $("#resource-inspector")

export const resourceListView = $("#resource-list-view")

export const resourceListTitle = $("#resource-list-title")

export const resourceDetail = $("#resource-detail")

export const imageResourceDetail = $("#image-resource-detail")

export const styleResourceDetail = $("#style-resource-detail")

export const styleDetailPreviews = $("#style-detail-previews")

export const styleDetailFields = $("#style-detail-fields")

export const styleDetailNormal = $("#style-detail-normal") as HTMLCanvasElement

export const styleDetailHighlighted = $("#style-detail-highlighted") as HTMLCanvasElement

export const styleDetailImageButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-style-image-property]"))

export const resourceBackButton = $("#resource-back") as HTMLButtonElement

export const resourceName = $("#resource-name")

export const resourceMeta = $("#resource-meta")

export const resourceCount = $("#resource-count")

export const resourceSearch = $("#resource-search") as HTMLInputElement

export const resourceCategory = $("#resource-category") as HTMLSelectElement

export const resourceGallery = $("#resource-gallery")

export const resourceUploadButton = $("#resource-upload") as HTMLButtonElement

export const styleAddButton = $("#style-add") as HTMLButtonElement

export const newStyleDialog = $("#new-style-dialog") as HTMLDialogElement

export const newStyleForm = $("#new-style-form") as HTMLFormElement

export const newStyleID = $("#new-style-id") as HTMLInputElement

export const newStyleError = $("#new-style-error")

export const resourceDownloadButton = $("#resource-download") as HTMLButtonElement

export const resourceDeleteButton = $("#resource-delete") as HTMLButtonElement

export const resourceUploadInput = $("#resource-upload-input") as HTMLInputElement

export const replaceLayoutImageButton = $("#replace-layout-image") as HTMLButtonElement

export const layoutImageDialog = $("#layout-image-dialog") as HTMLDialogElement

export const layoutImageForm = $("#layout-image-form") as HTMLFormElement

export const layoutImageFile = $("#layout-image-file") as HTMLButtonElement

export const layoutImagePreview = $("#layout-image-preview") as HTMLImageElement

export const layoutImageFileLabel = $("#layout-image-file-label") as HTMLElement

export const layoutImageSize = $("#layout-image-size") as HTMLElement

export const layoutImageLayout = $("#layout-image-layout") as HTMLElement

export const layoutImageScope = $("#layout-image-scope") as HTMLElement

export const layoutImageError = $("#layout-image-error") as HTMLElement

export const layoutImageApply = $("#layout-image-apply") as HTMLButtonElement

export const layoutImageTargetInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="layout-image-target"]'))

export const layoutImageOpen = $("#layout-image-open") as HTMLInputElement

export const layoutImageConfigFieldset = $("#layout-image-config") as HTMLFieldSetElement

export const layoutImageConfigDesc = $("#layout-image-config-desc") as HTMLElement

export const layoutImageConfigButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-layout-image-config]"))

export const inspectorResizeHandle = $("#inspector-resize-handle") as HTMLDivElement

export const tileInspector = $("#tile-inspector")

export const tileTitle = $("#tile-title")

export const bdaTileUsage = $("#bda-tile-usage") as HTMLSelectElement

export const tileInnerTitle = $("#tile-inner-title")

export const tileSourceFieldsGroup = $("#tile-source-fields")

export const tilePreviewWrap = $("#tile-preview-wrap")

export const tilePreview = $("#tile-preview") as HTMLCanvasElement

export const newTileButton = $("#new-tile") as HTMLButtonElement

export const duplicateTileButton = $("#duplicate-tile") as HTMLButtonElement

export const deleteTileButton = $("#delete-tile") as HTMLButtonElement

export const moveTileButton = $("#move-tile") as HTMLButtonElement

export const tileModeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tile-mode]"))

export const tileSourceFields = Array.from(document.querySelectorAll<HTMLInputElement>("[data-tile-source]"))

export const tileInnerFields = Array.from(document.querySelectorAll<HTMLInputElement>("[data-tile-inner]"))

export const textStyleLabels = Array.from(document.querySelectorAll<HTMLElement>("[data-text-style]"))
export const keyTextLayerSwitch = $("#key-text-layers")

export const simulatedOutput = $("#simulated-output") as HTMLTextAreaElement

export const clearSimulationButton = $("#clear-simulation") as HTMLButtonElement

export const toolbarStrip = $("#toolbar-strip") as HTMLDivElement

export const candidateArea = $("#candidate-area")

export const candidateBackgroundCanvas = $("#candidate-background") as HTMLCanvasElement

export const toolbarCanvas = $("#toolbar-preview") as HTMLCanvasElement

export const candidateComposition = $("#candidate-composition")

export const candidateInput = $("#candidate-input")

export const candidateInputBox = $("#candidate-input-box")

export const candidateInputBackgroundCanvas = $("#candidate-input-background") as HTMLCanvasElement

export const candidateInputText = $("#candidate-input-text")

export const candidateWords = $("#candidate-words")

export const modeChoiceButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mode-choice]"))

export const themeChoiceButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]"))

export const orientationChoiceButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-orientation-choice]"))

export const mobileChoiceButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mobile-choice]"))

export const pickerDialog = $("#picker-dialog") as HTMLDialogElement

export const pickerFrame = $("#picker-frame") as HTMLIFrameElement

// 源码里的样式引用借用一个隐藏输入框接入属性检查器的样式库，选择结果写回源码。
export const sourceStyleProxy = document.createElement("input")

// 只渲染真正滚进视野的卡片：9 张十几 MB 的皮肤不该在启动时全部读一遍。
export const welcomeScroller = document.querySelector<HTMLElement>(".welcome-main")
