# 搜狗 SSF 画布修复依据

输入包：`SogouInput_20.17.0_android_sweb.apk`（20.17.0）。APK 的 SHA-256 与提取路径保存在 `public/sogou-template.bds` 内的 `sogou-source.json`。

## 工具栏与符号列

- “好柿花生”没有 `logo.png`，其带底座的 S 图标实际是 `ime_function_multimedia.png`。APK 的 `1080/layout/cands.ini` 保留 `IME_Function_Multimedia` 槽位；预览在缺少独立 logo 时使用皮肤的这个资源，同时保留独立 logo 的优先级。
- 同一官方配置把 `CandidateCodeView.TEXT_STYLE` 指向 `TextStyle_Text`。`TextStyle_Popup_Code` 属于气泡文字，不应用于常驻符号列。
- 官方 `layout/template.ini` 中 `TextStyle_Text.TEXT_SIZE=0.039`，字体为 `DROIDSANSFALLBACK.ttf`。“好柿花生”提供了自定义同名字体，必须加载包内字体，不能只取文字颜色。
- 列表的背景和单元格背景分别由 `BG_IMAGE`、`BG_IMAGES` 控制，骨架须同时保留两个引用。

## 布局变体

- `port/py_9_double_input.ini` 通过 `REAL_KEY` 使用 `Key_Space_py9_DP` 与 `Key_PunctPY_DP`。它们仍应映射为空格、首键功能，不能根据 `CODES=32/0x31` 当普通字符绘制。
- 反编译的 `com.sogou.theme.parse.parseimpl.r`、`f0` 确认 `REAL_KEY` 选择实际按键定义，槽位只覆盖尺寸与位置。
- `port/big_9.ini` 的第一行只包含 ABC、DEF、退格；`FirstCandidateContainer` 使用左上区域，符号列从第二行开始。这是官方大九键的结构，不应凭普通九键截图补一个按键。
- 大回车的双行高度来自 `py_9_big_enter_double_input.ini` 中 `Key_Enter.H=0.48602`；普通九键回车素材在该区域内的伸展属于皮肤素材适配边界。

## 前景区域

- 反编译的 `com.sogou.theme.parse.parseimpl.a` 把 `FG_RECT` 交给 `parse.utils.f.m`。
- `f.m` 按顺序写入 Android `RectF.left/top/right/bottom`。
- `data.foreground.c.X` 把这个矩形传给前景绘制；`ViewMeasureUtil.f` 用 `left * width`、`top * height`、`right * width`、`bottom * height` 计算边界，并在边界内保持原图比例。
- 因此 `FG_RECT=0.25,0.1,0.75,0.9` 的宽高比例为 `0.5,0.8`。读取、百度转搜狗的输出、属性字段方向标签与 AI 编辑说明须使用同一含义。

## 回归入口

```sh
node scripts/extract-sogou-template.mjs /path/to/SogouInput.apk
npm run typecheck
npm test
npm run test:e2e
SSF_SKIN_PATH=/path/to/好柿花生.ssf node scripts/test-ssf-preview.mjs
npm run test:ui
```

测试覆盖图标正常/按下资源、列表字体与颜色、双拼功能键身份、前景四边坐标和等比绘制、全部侧栏布局的横竖屏/明暗组合，以及预览不修改 SSF 源文件。

## 导出后重新打开的验证（2026-10-19）

`好柿花生-1.bdi` 的工具栏空白、灰色背景和底行错位来自导出使用另一套百度骨架。BDI/BDS 现与 SSF 画布共用搜狗骨架及分辨率映射，并在打包时移除只供编辑器绑定的 `SSF_*` 字段。BDA 保留其独立格式几何。

严格像素对比另发现九宫格共享画布的边界采样会随历史最大尺寸改变。缓冲画布现始终在右侧和底部保留透明采样边距，保持复用且不逐键缩放缓冲区。

```sh
SSF_SKIN_PATH=/Users/kaze/Downloads/好柿花生.ssf \
SSF_CONVERSION_INPUT=/Users/kaze/Downloads/好柿花生-1.bdi \
SSF_CONVERSION_SHOTS=artifacts/ssf-export-fidelity-2026-10-19 \
node scripts/test-ssf-conversion.mjs
```

测试实际通过菜单导出、下载并重开文件，检查九键、全键、双拼九键大回车、大九键的明暗外观及横竖屏。真实皮肤与合成皮肤各有 32 个 BDI/BDS 视图的键位、工具栏和完整画布 RGBA 像素完全一致，未设置差异容差。

最终检查：类型检查、构建、220/220 单元及规范测试、完整端到端脚本通过；用户流程 22/22，含 75 个真实皮肤。旧 UI 存档基线有 3602 处既有差异，临时采集当前 HEAD 作为本次修改前对照后，34 个场景的结构、位置和计算样式无新增差异；未覆盖旧基线。

验证范围为浏览器编辑器。BDA 只验证导出重开及键位存在；未安装到手机输入法，也未重新打包桌面安装程序。

## SSF 拉伸与设备像素（2026-11-13）

`兽｜花奏风和.ssf` 的九键删除键布局与 `9del.png` 同为 183×160，皮肤分辨率为 1080。连接的安卓设备屏幕宽度为 2160，当前皮肤配置为 `9del.png,81,82,1,159`。若直接按布局尺寸绘制九宫格，中间的 1px 拉伸带仍是 1px，调整边界看不出变化。

搜狗 `com.sogou.theme.utils.e` 将原图与四个边界构造为 `NinePatchDrawable`，固定边保留图片像素尺寸。预览因此先按设备物理像素绘制九宫格，再映射回布局坐标；弹窗小预览与主键盘共用该规则。

已读取设备当前配置、原图和实时截屏，核对删除键中间窄带拉宽的变形。定向单测覆盖素材与布局同尺寸、设备比例为 2 的情况；`SSF_SKIN_PATH=/path/to/兽｜花奏风和.ssf node scripts/test-ssf-image-editor.mjs` 覆盖真实素材拖动、主画布与弹窗同步及松开后的像素一致性。该比对确认图片拉伸规则，不代表不同键盘高度设置下整键像素完全一致。
