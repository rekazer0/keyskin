# SSF 样本：大九键与双拼大回车核对

2026-10-19。只检查截图对应的布局、样式与拉伸；未修改应用代码。检查基于当前工作区（已有未提交修改），没有重新打包桌面程序或在 Android 真机运行。

## 输入与证据

- 本地 SSF 样本，SHA-256：`61faa44356bc06f009e94959e673d58d3edba6fa650b184887e3087791e5d14a`。
- `/Users/kaze/Downloads/SogouInput_20.17.0_android_sweb.apk`，SHA-256：`3eb2612040fd7daefb7e92b9de5c1a715b03f272b644e0664948742df1c7a416`。
- 读取已有 JADX 反编译源码：`/Users/kaze/.codex/worktrees/preview-input-apk/bdi/artifacts/sogou-apk-research/decompiled/sources/`。反编译不是无损源码；以下同时与 APK 内 INI、真实 SSF 交叉核对。
- 原始布局摘取、配置断言结果与浏览器截图：`artifacts/two-layout-check-2026-10-19/`。

## 1. 大九键左上空位

APK 内 `assets/theme/theme_default/1080/port/big_9.ini`：

```ini
[ROW1]
V_OFFSET=0.0078
H_OFFSET=0.3917
KEYS=Key_ABC,Key_DEF,Key_Backspace

[CandidateCodeView]
Y=0.257
H=0.73524

[FirstCandidateContainer]
W=0.3963
H=0.2695
```

首行只有三个按键，符号列从第二行开始。左上是首候选容器所用区域，不是漏解析普通九键的 `Key_PunctPY`。反编译 `com.sohu.inputmethod.sogou.bignine.FirstCandidateContainer` 的构造、`h/i/j` 与 `onDraw` 显示它包含可切换的独立内容组件，不是键盘按键。

当前骨架生成器只生成按键和符号列，没有模拟该容器的候选内容。因此截图的按键结构有官方依据；不能将这一结果扩大为首候选交互已经完整支持。

## 2. 双拼大回车背景纵向变形

APK 的 `port/py_9_big_enter_double_input.ini`：

```ini
[Key_Enter]
H=0.48602
FG_STYLE_H=0.2368
FG_STYLE_W=0.1694
FG_2_STYLE=FGStyle_Enter_Py9_BigEnter
BG_2_IMAGES=KeyEnter_Big
ICON_2=big_enter_png
ICON_2_PRESSED=big_enter_p_png
KEY_ALIAS=Key_Big_Enter
```

`H` 是整块大回车高度；`FG_STYLE_H/W` 是前景样式尺寸，不应拿来缩小背景。当前骨架 `KEY12` 的矩形为 `891,325,183,312`，动作 `F39`，源类 `Key_Enter`。

真实 SSF 的白天、夜间均为：

```ini
[Key_Enter]
BG_IMAGES=SMA_Key9Bg_Enter
ICON=transparent.png
ICON_PRESSED=transparent.png

[SMA_Key9Bg_Enter]
NORMAL=9enter.png,1,182,1,145
PRESSED=9enter_press.png,1,182,1,145
```

原图为 `183 × 146`；`1,182,1,145` 表示横向 `1..182`、纵向 `1..145` 的可伸展区，几乎整张图都可拉伸。文字和装饰已画在背景 PNG 中，不是单独的前景。因此从 146 高度拉到 312 时，装饰一起纵向变形符合这份皮肤的配置。

反编译交叉证据：

- `com.sogou.theme.parse.parseimpl.a.B` 分别解析 `BG_IMAGES`、`BG_2_IMAGES`、`ICON_2`、`FG_STYLE_H/W`。
- `com.sogou.theme.data.key.c.B2` 保存第二背景；`BaseKeyData.f1` 只在第二背景非空且 `Y()` 有效时采用它，否则使用普通背景。
- `com.sogou.theme.data.key.c.s2/r2` 对第二套正常/按下图标也做有效性检查与回退。
- `com.sogou.theme.data.module.f.k` 与 `com.sogou.theme.utils.e.d` 把四个整数按横向两界、纵向两界生成 Android NinePatch，顺序与当前解析一致。

这份 SSF 两套外观都没有 `KeyEnter_Big` 样式或 `BG_2_IMAGES/ICON_2` 配置；当前 APK 基础 `1080/layout/image_list.ini`、`images_config.ini` 也未定义 `KeyEnter_Big/big_enter_png`。没有证据表明应在本截图上选用另一张专用背景。结论是配置与官方回退逻辑支持当前拉伸，并非已证实的解析错误；Android 真机外观尚未对照。

## 独立发现的支持缺口

当前 `scripts/extract-sogou-template.mjs` 与 `src/ssf/ssf-parts.ts` 没有完整传递、选择第二套大回车样式。对实际提供 `BG_2_IMAGES/KeyEnter_Big/ICON_2` 的其他皮肤，这是兼容风险；不能因为本样本回退合理而声称通用大回车支持完整。本次没有修改它，也没有用本样本推导一套未经验证的替换规则。

## 本次验证

- Node 断言通过：官方首行键集合、符号列起点、骨架大回车动作、真实皮肤两外观背景引用、原图尺寸、拉伸坐标、专用背景缺失。
- `SSF_SKIN_PATH=/path/to/sample.ssf node scripts/test-ssf-preview.mjs` 通过：118 次概览布局检查，横竖屏、明暗、工具栏、几何、选择及源文件未修改。
- 浏览器截图复现用户两处外观；不是与官方 Android 运行结果做像素对比。
- 没改 TS/CSS，未执行完整单元、全套 E2E、UI 快照或桌面构建。既有未提交修改和 `sites/` 保留。
