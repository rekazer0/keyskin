import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { $ } from "./dom"

/** Windows 去掉了系统标题栏，由标题栏右侧的自绘按钮接管最小化、最大化和关闭。 */
export function wireWindowControls(): void {
  if (!document.documentElement.classList.contains("windows")) return
  const appWindow = getCurrentWindow()
  const maximize = $<HTMLButtonElement>("#window-maximize")
  const syncMaximized = async () => {
    const maximized = await appWindow.isMaximized()
    maximize.dataset.maximized = String(maximized)
    maximize.title = maximize.ariaLabel = maximized ? "向下还原" : "最大化"
  }
  void syncMaximized()
  void appWindow.onResized(() => void syncMaximized())

  // 系统按钮悬停约半秒弹出贴靠布局；自绘按钮收不到这个系统行为，改由 Rust 端模拟 Win+Z。
  let snapTimer = 0
  maximize.addEventListener("pointerenter", () => {
    snapTimer = window.setTimeout(() => {
      if (document.hasFocus()) void invoke("show_snap_layouts")
    }, 500)
  })
  maximize.addEventListener("pointerleave", () => window.clearTimeout(snapTimer))
  maximize.addEventListener("click", () => {
    window.clearTimeout(snapTimer)
    void appWindow.toggleMaximize()
  })
  $("#window-minimize").addEventListener("click", () => void appWindow.minimize())
  // close() 会走 onCloseRequested，未保存提示照常生效。
  $("#window-close").addEventListener("click", () => void appWindow.close())
}
