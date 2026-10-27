import "@fontsource-variable/jetbrains-mono"
import "./tokens.css"
import "./components.css"
import "./style.css"
import "./device-preview.css"
import "./inspector.css"
import "./bda-animation.css"
import "./style-library.css"
import "./design-workbench.css"
import "./ai-design-panel.css"
import "./project-chooser.css"
import { wireCanvasAndInspector } from "./app/wiring/canvas-and-inspector"
import { wireFilesAndSettings } from "./app/wiring/files-and-settings"
import { wireEditingControls } from "./app/wiring/editing-controls"
import { wireResourcesAndStartup } from "./app/wiring/resources-and-startup"

// 启动：顺序即原 main.ts 顶层语句的执行顺序，不要调换。
wireCanvasAndInspector()
wireFilesAndSettings()
wireEditingControls()
wireResourcesAndStartup()
