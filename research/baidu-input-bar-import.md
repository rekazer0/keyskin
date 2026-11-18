# 拼音栏首次导入与 Android 浮窗

2026-10-19，样本：一份 BDI、一份 BDS，以及 `baiduinput_AndroidPhone_1000e.apk`。

## 原生导入的根因

使用 `npm run tauri dev` 当前构建的二进制和 `127.0.0.1:1420` 前端，在原生文件对话框导入 BDI。
首次画布没有蓝色输入行，打开 Web Inspector 改变窗口尺寸后才出现。
再次调用实际 `loadNativePath()`，立即读取到：

```json
{"height":"","rect":0}
```

`refreshPreview()` 中 `updatePanelTools()` → `fitCanvasPreview()` 先设置画布的
`--candidate-input-height`；随后 `applyDeviceKeyboardGeometry()` 的无手机设备分支清除
`deviceGeometryProperties`，其中也包含这个变量。浏览器的后续 ResizeObserver 时机可能掩盖问题。

修正：清理手机几何变量后立即重新执行画布尺寸计算，避免依赖后续输入或窗口 resize。
回归断言在同一个 JS 调用中 `refreshPreview()` 后直接读取输入行高度，不能等待下一次 resize 才检查。

## APK 对 Android 白条的解释

使用 JADX 1.5.3 重新反编译用户提供的 APK。全包输出有 84 处反编译错误；
对 `com.baidu.input.ime.InputBarView` 单独开启 `--show-bad-code`，检查下列实际分支：

- `draw(Canvas)`：输入串为空时调用 `setPopRootViewVisibility(8)` 并提前返回；无输入时不绘制浮窗。
- `m(Canvas, String)`：文字宽度加两个 `ImeBaseGlobal.L` inset 和 6dp 起点；超过可用宽度时裁切。
- `m(...)`：背景色 `l` 为 0 时使用 StyleParam 图片，否则直接填色。
- `InputParam.m(...)`：BACK_STYLE / FORE_STYLE 独立解析。

BDS 样本的 `[INPUT] BACK_STYLE=127`，STYLE127 为 `NM_COLOR=f3f6fa`，
因此把空的 Android 浮窗强制铺满会生成一条多余的浅色矩形。撤回该强制显示和强制全宽改动；
iOS 的常驻输入行仍独立显示，Android 输入浮窗在输入后出现、随文字宽度变化。

Android APK 不作为 iOS 空输入行的证据；BDI 的蓝色行参考用户给出的 iPhone 官方截图及皮肤 SCAND 切片。

## 完成验证

- 原生 QA 使用当前 `tauri dev` 的二进制副本（临时标准 app 包，仅供控制工具定位）及同一个 1420 开发前端；用户原有开发进程保留。
- 通过原生文件对话框直接导入 BDI，默认 S 状态且未输入时蓝色整行可见；42% 缩放仍完整显示。
- 原生导入用户 BDS，默认状态下没有多余的浅色 INPUT 浮窗。
- WebKit BDI / BDA、Chromium 用户 BDS 的专项测试通过，包含立即刷新后的高度、输入、清空和设备切换。
- 单元与设计规范 221/221。完整 E2E 其他脚本通过；用户流程第一次因页面恢复成“未打开皮肤”而超时（同时有其他源码热更新），单独重跑 22/22，包含 75 款真实皮肤。
