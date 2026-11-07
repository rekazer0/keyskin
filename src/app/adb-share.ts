import { invoke, Channel } from "@tauri-apps/api/core"
import { adbShareButton, settingsAdbNav, settingsAdbPanel, settingsDialog, adbExecutable, adbSerial, adbHost, adbPort, adbPairPort, adbPairCode, adbPairButton, adbPairStatus, adbDirectory, adbPackage, adbActivity, adbTestButton, adbTestStatus } from "./dom"
import { documentName } from "./dom"
import { exportName, skinFileName } from "../export"
import { isTauri } from "./canvas-interaction"
import { appState } from "./state"
import { exportArchive } from "./archive-io"
import { runFileOperation, showFileOperationProgress, updateFileOperationProgress } from "./file-operations"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { IniDocument } from "../ini.ts"
import { withDirectoryEntries } from "../skin-zip.ts"
import { loadBuiltInProjectTemplate } from "../operations.ts"

/** 手机端输入法决定能安装的皮肤格式；包名前缀与 Rust 端 SkinTarget 一致。 */
type AdbTarget = "baidu" | "sogou" | "shouxin" | "custom"

function adbTarget(packageName: string): AdbTarget {
  if (packageName.startsWith("com.baidu.input")) return "baidu"
  if (packageName.startsWith("com.sohu.inputmethod.sogou")) return "sogou"
  if (packageName.startsWith("com.xinshuru.inputmethod")) return "shouxin"
  return "custom"
}

function prepareSogouShare(bytes: Uint8Array): { bytes: Uint8Array; name: string } {
  const files = unzipSync(bytes)
  const theme = files["phoneTheme.ini"]
  if (!theme) throw new Error("搜狗皮肤缺少 phoneTheme.ini，无法分享到手机")
  const id = `keyskin-${Date.now().toString(36)}`
  const metadata = IniDocument.parse(strFromU8(theme))
  metadata.set("General", "skin_id", id)
  metadata.set("General", "local_skin_id", id)
  metadata.set("General", "local_ugc", "true")
  // 运营皮肤标记会让搜狗把本地皮肤当成云端皮肤，详情页打不开也就无法启用。
  metadata.remove("General", "operational_skin")
  const skinType = Number(metadata.get("General", "skin_type"))
  if (Number.isInteger(skinType) && (skinType & 2048) !== 0) {
    metadata.set("General", "skin_type", String(skinType & ~2048))
  }
  files["phoneTheme.ini"] = strToU8(metadata.toString())
  return { bytes: zipSync(Object.fromEntries(withDirectoryEntries(Object.entries(files))), { level: 6 }), name: `${id}.ssf` }
}

/**
 * 手心 Android 4.4.2 的导入校验要求根级 skin.ini / skin.proto / preview.png，但渲染仍读取 SXI 自己的
 * skin.json 与 light、dark 资源。保留导出包内容，只补上校验文件，皮肤外观才是用户当前编辑的皮肤。
 */
async function prepareShouXinShare(bytes: Uint8Array): Promise<Uint8Array> {
  const source = unzipSync(bytes)
  const template = unzipSync(await loadBuiltInProjectTemplate("palm-harmony"))
  const proto = template["light/res/skin.proto"]
  const preview = source["preview.png"] ?? source["light/preview.png"] ?? source["dark/preview.png"] ?? template["preview.png"]
  if (!source["skin.json"] || !proto || !preview) throw new Error("手心皮肤缺少 skin.json 或模板资源，无法分享到手机")
  const files: Record<string, Uint8Array> = { ...source }
  files["skin.proto"] = proto
  files["preview.png"] = preview
  files["preview_small.png"] = preview
  let skinName = "KeySkin"
  try {
    const info = JSON.parse(strFromU8(source["info.json"] ?? new Uint8Array()))
    if (typeof info.name === "string" && info.name.trim()) skinName = info.name.trim()
  } catch {
    // info.json is optional for import; the Android package still gets a valid name.
  }
  const id = `keyskin-${Date.now().toString(36)}`
  const safeName = `${skinName} ${id}`.replace(/[\r\n]/g, " ").slice(0, 80)
  files["skin.ini"] = strToU8([
    "[skin]",
    `name = ${safeName}`,
    "author = KeySkin",
    "email =",
    "major_version = 1",
    "minor_version = 1",
    `build = ${id}`,
    "",
  ].join("\n"))
  return zipSync(Object.fromEntries(withDirectoryEntries(Object.entries(files))), { level: 6 })
}

/** Windows/macOS only: web and mobile clients must not expose native process execution. */
export function wireAdbShare(): void {
  const supported = isTauri() && /Windows NT|Macintosh/.test(navigator.userAgent)
    && !/Android|iPhone|iPad|iPod/.test(navigator.userAgent)
    && !(/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  adbShareButton.hidden = !supported
  settingsAdbNav.hidden = !supported
  settingsAdbPanel.toggleAttribute("data-platform-hidden", !supported)
  const controls = [adbExecutable, adbSerial, adbDirectory, adbPackage, adbActivity, adbHost, adbPort, adbPairPort]
  // 导入入口留空时由 Rust 按目标输入法填默认值。
  const defaults = ["adb", "", "", "com.baidu.input", "", "", "", ""]
  const settings = () => ({
    executable: adbExecutable.value.trim() || defaults[0],
    serial: adbSerial.value.trim(),
    directory: adbDirectory.value.trim(),
    package: adbPackage.value.trim() || defaults[3],
    activity: adbActivity.value.trim(),
    host: adbHost.value.trim(),
    port: adbPort.value.trim(),
  })
  const shareSettings = (format: string) => {
    const config = settings()
    const target = format === "ssf" ? "sogou" : format === "sxi" ? "shouxin" : "baidu"
    const configured = adbTarget(config.package)
    if (configured === target) return config
    return {
      ...config,
      directory: "",
      package: target === "sogou" ? "com.sohu.inputmethod.sogou" : target === "shouxin" ? "com.xinshuru.inputmethod" : defaults[3],
      activity: "",
    }
  }
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
  adbShareButton.addEventListener("click", () => {
    // 导出在本机完成、推送在设备上完成：导出期间点取消就不再开始推送。
    let cancelRequested = false
    void runFileOperation("分享到 ADB", async () => {
      if (!appState.archive) return false
      showFileOperationProgress()
      const format = appState.archive.format === "bdi" ? "bds" : appState.archive.format
      const config = shareSettings(format)
      const exportedName = exportName(documentName.textContent?.trim() || "未命名皮肤", format)
      let name = skinFileName(exportedName.slice(0, -(format.length + 1)), format)
      const result = await exportArchive(format, format === "bda" ? "android" : undefined)
      if (!result || cancelRequested) return false
      let bytes = result.bytes
      if (format === "ssf") {
        const prepared = prepareSogouShare(bytes)
        bytes = prepared.bytes
        name = prepared.name
      } else if (format === "sxi") {
        bytes = await prepareShouXinShare(bytes)
      }
      if (cancelRequested) return false
      const progress = new Channel<string>()
      progress.onmessage = (detail) => updateFileOperationProgress(94, detail)
      updateFileOperationProgress(92, "正在通过 ADB 推送皮肤…")
      await invoke<string>("share_skin_adb", { settings: config, name, format, data: bytes, progress })
      return true
    }, async () => {
      cancelRequested = true
      await invoke("cancel_adb_share")
    })
  })
}
