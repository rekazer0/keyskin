import { invoke, Channel } from "@tauri-apps/api/core"
import { adbShareButton, settingsAdbNav, settingsAdbPanel, settingsDialog, adbExecutable, adbSerial, adbHost, adbPort, adbPairPort, adbPairCode, adbPairButton, adbPairStatus, adbDirectory, adbPackage, adbActivity, adbPreviewActivity, adbTestButton, adbTestStatus } from "./dom"
import { documentName } from "./dom"
import { exportName, skinFileName } from "../export"
import { isTauri } from "./canvas-interaction"
import { appState } from "./state"
import { exportArchive } from "./archive-io"
import { runFileOperation, updateFileOperationProgress } from "./file-operations"

/** Windows/macOS only: web and mobile clients must not expose native process execution. */
export function wireAdbShare(): void {
  const supported = isTauri() && /Windows NT|Macintosh/.test(navigator.userAgent)
    && !/Android|iPhone|iPad|iPod/.test(navigator.userAgent)
    && !(/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  adbShareButton.hidden = !supported
  settingsAdbNav.hidden = !supported
  settingsAdbPanel.toggleAttribute("data-platform-hidden", !supported)
  const controls = [adbExecutable, adbSerial, adbDirectory, adbPackage, adbActivity, adbPreviewActivity, adbHost, adbPort, adbPairPort]
  const defaults = ["adb", "", "", "com.baidu.input", ".ImeUpdateActivity", ".ImeSkinTryActivity", "", "", ""]
  const settings = () => ({
    executable: adbExecutable.value.trim() || defaults[0],
    serial: adbSerial.value.trim(),
    directory: adbDirectory.value.trim(),
    package: adbPackage.value.trim() || defaults[3],
    activity: adbActivity.value.trim(),
    previewActivity: adbPreviewActivity.value.trim(),
    host: adbHost.value.trim(),
    port: adbPort.value.trim(),
  })
  for (const [index, control] of controls.entries()) {
    control.value = localStorage.getItem(control.id) ?? defaults[index]
    control.addEventListener("change", () => localStorage.setItem(control.id, control.value.trim()))
    control.addEventListener("input", () => {
      adbTestStatus.textContent = "参数已更改，请重新测试连接"
      adbPairStatus.textContent = "参数已更改；已配对设备无需重复配对，可直接测试连接"
    })
  }
  // 无 id 的一次性字段不参与设置草稿或持久化。
  settingsDialog.addEventListener("close", () => { adbPairCode.value = "" })
  if (!supported) return
  const busy = (value: boolean) => {
    adbTestButton.disabled = value
    adbPairButton.disabled = value
  }
  adbPairButton.addEventListener("click", async () => {
    if (adbPairButton.disabled) return
    const code = adbPairCode.value.trim()
    adbPairCode.value = ""
    if (!/^\d{6}$/.test(code)) {
      adbPairStatus.textContent = "请填写手机无线调试页面显示的六位配对码"
      return
    }
    const config = settings()
    const pairPort = adbPairPort.value.trim()
    const unchanged = () => JSON.stringify(config) === JSON.stringify(settings()) && pairPort === adbPairPort.value.trim()
    busy(true)
    adbPairStatus.textContent = "正在配对设备…"
    try {
      await invoke("pair_adb_device", { settings: config, pairPort, code })
      if (unchanged()) adbPairStatus.textContent = "配对成功，请填写无线调试主页的连接端口，再测试连接"
    } catch (error) {
      if (unchanged()) adbPairStatus.textContent = `配对失败：${(error instanceof Error ? error.message : String(error)).replaceAll(code, "[已隐藏]")}`
    } finally {
      busy(false)
    }
  })
  adbTestButton.addEventListener("click", async () => {
    if (adbTestButton.disabled) return
    const tested = settings()
    busy(true)
    adbTestStatus.textContent = "正在检查 ADB、设备授权和输入法…"
    try {
      const serial = await invoke<string>("test_adb_connection", { settings: tested })
      if (JSON.stringify(tested) === JSON.stringify(settings())) adbTestStatus.textContent = `连接成功：${serial}，已安装 ${tested.package}`
    } catch (error) {
      if (JSON.stringify(tested) === JSON.stringify(settings())) adbTestStatus.textContent = `连接失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      busy(false)
    }
  })
  adbShareButton.addEventListener("click", () => void runFileOperation("分享到 ADB", async () => {
    if (!appState.archive) return false
    const format = appState.archive.format === "bda" ? "bda" : "bds"
    const config = settings()
    const exportedName = exportName(documentName.textContent?.trim() || "未命名皮肤", format)
    const name = skinFileName(exportedName.slice(0, -(format.length + 1)), format)
    const result = await exportArchive(format, format === "bda" ? "android" : undefined)
    if (!result) return false
    const progress = new Channel<string>()
    progress.onmessage = (detail) => updateFileOperationProgress(94, detail)
    updateFileOperationProgress(92, "正在通过 ADB 推送皮肤…")
    await invoke<string>("share_skin_adb", { settings: config, name, format, data: result.bytes, progress })
    return true
  }))
}
