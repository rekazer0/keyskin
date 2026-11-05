# 轻拟 BDS / BDI 字体与九键缺失排查

## 本轮结果

字体回退已在 ADB 设备复现，但尚未找到经设备验证有效的字体修复，不能宣称解决。

本轮仅保留 `src/skin.ts` 的 BDS→BDI 空 POS_TYPE 规范化和对应回归测试。字体预览相关实验改动已完整撤回到本轮开始时的内容，保留工作区原有修改。

复测产物：`artifacts/qingni-offset-test.bdi`。这是空偏移兼容性复测包，不是已经验证字体修复成功的正式包。

## 已确认事实

- 附件 BDS 两个主题都含 W5.ttf，各 3,923,860 字节，GLOBAL FONT_PATH=W5.ttf，与 default.css 同目录。
- 字体内部名称为 DFPShaoNvW5-GB / 华康少女文字W5(P)，PostScript 名称 DFPShaoNvW5。浏览器实际字形样张与系统字体明显不同。
- V6 教程印刷页 163、218：全局字体放在 res，以 GLOBAL FONT_PATH 引用；样式级 FONT_PATH 仅 iOS 支持。
- ADB 连接到 Genymotion Android 15，127.0.0.1:6555，并非 iPhone 实机。百度输入法 13.3.16.2 / 1177，已安装 APK SHA-256 为 cffe202cc2b7fdf0c45c0f8d1d69586e126791d0d9d358c373f0c336a12cb9bd。
- APK DEX：CssLoader.t 的 GLOBAL FONT_PATH 分支把 CSS 资源目录与字段值拼接。Android StyleParam 不解析样式级 FONT_NAME / FONT_PATH。
- SkinRenderCallback.C 实际选择字体时先检查默认字体覆盖开关，再检查全局用户自选字体，之后才读取 RootCssLoader.k 并调用 Typeface.createFromFile。
- 覆盖开关存储键为 fontSpKeys_keyword_font_default_select，代码缺省 false；当前设备私有 preference 无读取权限，不能把缺省值视为设备实值。
- 设备字体选择页显示系统字体已启用；未找到可直接读取上述开关的界面状态。没有取得 W5 加载成功或失败日志。

## 九键缺失的兼容性线索

附件浅色 py_9.ini 的 KEY4–KEY12 均为 POS_TYPE= 空值；深色仅 KEY4 为空。这与用户截图浅色九键全缺、深色只缺左上键的分布吻合。

转换入口现在把明确写出的空 POS_TYPE 槽位转为 0（居中），包括多前景中的空槽。已有非空偏移、未写 POS_TYPE 的键、SHOW 输入码容器和按键动作不变；不修改源 BDS。同步与异步转换均覆盖。

这仍是需要 iPhone 导入确认的兼容性修正；本轮没有 iOS 运行环境，未证明它已消除截图中的缺键。

## ADB 实验与边界

成功导入方式：先 push 至 /sdcard/Android/data/com.baidu.input/files/Download/，再通过 com.baidu.input/.ImeUpdateActivity + ACTION_VIEW 打开，确认安装并点 Apply。公共 Download 的裸 file URI 被 Android 存储权限拒绝，不是皮肤格式损坏。

原包成功应用后九键布局完整，但字母仍为默认字体。以下独立测试均未取得自定义字体生效的结果：样式级 FONT_PATH、方向目录字体副本、FONT_PATH 提前并统一 CRLF、应用外部可读字体路径、根 res 字体与最小 CSS、单主题封装。用 TEST9、ROOT、SINGLE 文本标记确认测试包确实应用，而非仅观察旧包。SkinType=0 测试未取得可用键盘结果，不采用该改法。

外部字体路径和重复字体仅用于 scratch 测试，未写入项目导出逻辑。未清除应用数据、未 root、未安装调试 APK、未改原始附件。最后重新导入并应用原始 BDS；设备下载目录仍保留测试包。设置流程遇到用户体验计划邀请时选择了拒绝。

## 检查

- npm run typecheck：通过。
- 最终 npm test：506/506 通过（含设计规范）。
- node scripts/test-native-preview.mjs：通过。
- 包转换 / 字体专项：23/23 通过。
- git diff --check（本轮生产与测试文件）：通过。
- 生成复测包后重新读取：两主题 KEY4 POS_TYPE=0，两份字体字节数保持不变，源归档 changed.size=0。
- 未运行完整 test:e2e；未改界面交互或 CSS，未运行 test:ui。

## 剩余阻塞

1. 字体：需要能观察客户端私有字体状态或实际字体加载调用的环境，才能区分覆盖开关、根 CSS 字体传递与字体加载失败；现有 shell 不可读取私有目录，run-as 不可用，无 su。
2. BDI：需在 iPhone 百度输入法导入复测包，确认空 POS_TYPE 修正是否消除缺键，并独立验证字体。

## 后续（2026-11-05）

MuMu 模拟器 + 百度输入法 13.3.18.31 反编译确认：W5.ttf 确实被加载进内存，但每次初始化键盘 `StyleParam.x(FontUtils.k())` 都把画笔重置为系统字体或 `keymap.ttf`，`[STYLE*] FONT_NAME` 完全忽略。同一皮肤里用图片（`letter.til`）的数字面板显示正常，文字样式的拼音九键显示默认字体。

处理：BDS 导入 / 选择字体时把按键前景的 `SHOW` 文字烘焙成图片（`src/font-bake.ts`，图集 `keyskin_font.png/.til`），原字段以 `BAKED_*` 保留以便重烘与还原；画布预览对 BDS 不再套用 GLOBAL 字体。烘焙后的皮肤尚未在真机复测。
