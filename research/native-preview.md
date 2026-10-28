# 手心 / 搜狗皮肤原生预览

2026-10-21，分支 `feat/sxi-native-preview`。验收标准：预览与皮肤包内的示例图一致。

## 改动

此前两种格式都先转成百度 INI 再交给百度渲染器：手心把 `skin.json` 投影成 `default.css` / `*.til` / `*.ini`，搜狗把 `phoneSkin.ini` 的外观转成百度样式、套在官方骨架上。现在画布完全不经过这一步：

- **手心**：画布的键位、触摸区、动作、状态换层（`fix_a` → `key_fix`）、面板与候选栏尺寸、候选栏图标及其 `keep`、候选字 / 输入码样式、输入码条高度，全部由 `src/palm/palm-board.ts` 从 `skin.json` 读出；样式、切片、图片由 `src/palm/palm-styles.ts` 读出，它同时是手心文档的样式解析器，气泡和检查器里的样式缩略图也直接读 `skin.json`；`src/palm/palm-scene.ts` 绘制。画布不再持有投影出来的布局文档。
- **搜狗**：画布叠加层只剩官方骨架（从 APK 提取的布局与内置图形，按皮肤分辨率缩放，`src/ssf/ssf-skeleton.ts`），不再把皮肤外观转换成百度样式和图片；骨架只随分辨率和外观数量变化，不再每次编辑都重建。`src/ssf/ssf-scene.ts` 直接读 `phoneSkin.ini` / `keys.ini` 绘制，候选字、首选和输入码读 `TextStyle_Candidate(_Highlight)` / `TextStyle_Composing`。
- `src/native-scene.ts`：与格式无关的场景（背景层 + 每个按键的正常 / 按下两组「背景、前景」层），由预览主循环逐键绘制，选中描边照旧；按键动画与气泡见下文。
- 区块名（`KEY<id>`、`LIST:<n>`、`ICON<n>`）与编辑视图一致，选中、检查器和编辑照常工作。

## 按键动画与气泡

`src/native-motion.ts` 是两种格式共用的动画模型：属性轨迹（缩放、位移、旋转、透明度，可带旋转中心、往返、重复）与动画附带的图片（精灵）。场景（`NativeScene.effects`）给出某个按键按下后任一时刻的背景 / 各前景层变换、按键抛出的精灵，以及面板常驻动画；画布按时间采样绘制。按键的气泡（`SceneKey.popup`）画在气泡覆盖层上。

**手心**（`src/palm/palm-motion.ts`，直接读 `skin.json`）：

- 样式 `ss_1[id].s_5` 的 "1" 是按下动画、"3" 是显示动画；按键背景用 `base_ba`，每个前景层用 `base_fa` 对应项（`asi` 兜底），各层分别动画。
- `a1`：`b.t` 0 透明度（0–255）、1 旋转、2 位移（`from_px` 像素，`from_p` 按键尺寸百分比）、3/4 缩放（百分比）；`duration`、`delay`、`style` 缓动、`b.count`（Int64.max 为无限）、`b.back` 往返、`b.clear` 结束后复原、`pp` / `pxp` 旋转中心。
- `a3`：`simultaneous` 同时、`sequential` 依次、`random` 每次按下随机取一个。
- `af2`：动图（WebP 逐帧解码，`d` 为整段时长）铺满面板动画区（面板减去 `a_insets`）宽度、底边对齐，与「超快乐A」示例图中吉祥物的位置一致。面板 `base_pa` 的显示动画常驻循环；按键自己的 `base_pa`（否则面板的）在按下时播放，按下动画占用的组合位置暂时替换同位置的常驻动画（「超快乐A」每个吉祥物由常驻 / 跳起两段动图组成，同一位置）。
- 气泡：`h.<file>` 的 `info` 成对给出类型与图标（0 点按气泡、1 长按候选条、2–5 上下左右滑动），`icon_info` 给尺寸、位置、内边距和样式，`i_cell` 是候选条单元格样式。
- `a4` 粒子及 `a10`–`a14` 特效未绘制（此前经百度引擎时粒子图片同样无法解析）。

**搜狗**（`src/ssf/ssf-motion.ts`，直接读 `anim.ini` / `phoneSkin.ini`，语义取自 APK 的 `com.sogou.theme.data.animation`）：

- 按键用自己分区的 `ANIM_STYLE`，否则用 `Anim_Style_Key`（APK 的默认）；`BG_ANIM` / `FG_ANIM` 动按键背景 / 前景，`DECO_ANIM` 抛出装饰图（`DECO_ANIM_NUMBER` 个随机，-1 全部）；`Animation_*` 的 `DOWN_ANIM_OBJ` 在按下时播放，`ANCHOR` 为变换中心。
- `Anim_*`：`ANIM_SET` + `PLAY_METHOD`（0 同时、1 依次）；`TYPE` 1 位移（`VELOCITY` / `ACCELERATION` / `START_VALUE` 按 `start + v·t + a·t²/2` 计算，否则两条关键帧）、2 缩放、3 旋转、4 透明度；`DURATION`、`START_DELAY`、`INTERPOLATOR`（Android 0 线性 … 8 搜狗自带三次贝塞尔）、`REPEAT_COUNT`（额外次数，-1 无限）、`REPEAT_MODE`（2 往返）；关键帧 `TIME` / `VALUE`，每段用其终点的 `INTERPOLATOR`；绝对值不超过 1 的位移是键盘尺寸的比例。
- 装饰图尺寸：`RATE_KEY_W/H`（按键比例，保持图片比例）、`RATE_W/H`（键盘比例），否则原图尺寸；位置：`POS_X/POS_Y`，有 `POS_ANCHOR` 时为相对按键该锚点的 `NEW_POS_X/Y`；范围值随机取，`RELATETO` 为 1 时按按键尺寸，否则按键盘尺寸；`ALPHA` 为初始透明度。
- 气泡：点按字符键时，在按键上方画 `PopupBG_Phone` / `PopupBG_Qwerty`（否则 `PopupBG`）的背景图，宽高不小于按键；文字按 `FGStyle_Phone_Popup` / `FGStyle_Popup_Qwerty`（否则 `FGStyle_Popup`）的框、`TextStyle_Popup_*` 的颜色和字号，九键显示字母组与数字。前景为图片的按键也弹出文字，与搜狗一致。皮肤未写气泡框时用两款示例皮肤（搜狗皮肤制作工具生成）共同的默认框。骨架里没有气泡的几何数据，气泡底边贴按键顶边是按搜狗的显示方式取的近似。

一次按下会刷新预览并重建场景；重建期间画布继续用已绘制的场景播放动画，动图按文件只解码一次。

## 仍经过百度格式的部分

- 只有导出 BDI/BDS/BDA：导出本身就是转换，仍走原有转换器（`src/palm/sxi-to-baidu.ts`、`src/ssf/ssf-convert.ts`）。

源码目录、源码面板、属性检查器、资源 / 样式 / 切片视图、面板工具和 AI 面板也都直接读写皮肤自己的文件：手心皮肤包里只有它自己的文件，键盘、样式表、动画表、候选栏、气泡按 `skin.json/<主题>/<路径>` 指向 `skin.json` 里的片段，源码面板显示并高亮 `skin.json` 中对应的位置；搜狗的官方骨架是独立的只读包（`appState.ssfSkeleton`），不混进皮肤的文件列表，键盘的源码是皮肤自己的 `phoneSkin.ini`。

## 依据

| 规则 | 依据 |
| --- | --- |
| 手心透明键盘背景下露出 `#D0D3D9` / `#212121` | 鸿蒙模板 `background_port_2.png` 全透明，示例图亮 / 暗两版此处取样 |
| 手心 `f_w` 字重 | 鸿蒙模板文字 300，示例图为细体；百度格式没有此字段 |
| 搜狗拼音键盘字母大写 | 既有 `ssf-look.ts`：拼音布局字母键 `S_FLAG=1`；「拟物」示例图 |
| 九键数字副标签 2–9 | 「拟物」`FGStyle_Phone` 开启 `MINOR_LABEL_VISIBLE` 与示例图 |
| 无 TEXT_SIZE 的标签按框尽量大、默认粗体 | 「拟物」ABC / 2、「森」中英在示例图中的实测尺寸；两张示例图的标签均为粗体 |
| 中英键白字、两框分放 | 「拟物」`FGStyle_Switch_Py9`、`TextStyle_Switch` 与示例图 |
| 皮肤自己的 `LABEL` / `MINOR_LABEL` 替换内置文字 | 「森」`Key_SwitchToEN LABEL=中 MINOR_LABEL=英`，示例图无斜杠 |

上表最后三行的默认 FG_STYLE 对应关系（字母键 `FGStyle_Phone` / `FGStyle_Qwerty`，符号 `FGStyle_SymbolTable_*`，中英 `FGStyle_Switch_Py9` / `FGStyle_SwitchToCh_En9`）以皮肤自身覆盖的同名区块和示例图为准，其余键保留骨架位置。

## 与示例图对照（用户提供的 5 个皮肤 + 内置鸿蒙模板）

一致：键位、按键背景与切图、前景图位置、标签文字 / 颜色 / 字号 / 字重、数字副标签、符号列、候选栏背景、键盘背景。

仍不一致，且无法从皮肤数据得出：

- **键盘高度**：两张搜狗示例图的键盘比官方布局高约 16%，鸿蒙示例图约 17%，是生成示例图的设备 / 用户高度设置。
- **工具栏功能**：手心示例图的工具栏是作者手机上自选的功能（懒人模式、剪贴板等），`skin.json` 标为 toolbar 的是另一组；鸿蒙模板没有工具栏图标，示例图是手心内置图标；搜狗「拟物」示例图用的是旧版搜狗内置线框图标。
- **输入中状态**：「超快乐A」示例图是输入中（S4）截图，分词 / 全键和吉祥物动画来自该状态；画布切到 S4 即可看到 `key_fix` 换层。
- 「Write26 乱序十七」「Write2026 14键」的示例图是系列宣传图（26 键），与这两套皮肤的默认布局不同；切到 26 键后按键与示例图一致。
- 鸿蒙模板示例图的回车「完成」、清空「重输」、符号「符」与 `skin.json` 不同（数据为蓝底「换行」、「清空」、「符号」）。

## 验证

```sh
npm run typecheck
npm test
npm run test:e2e   # 新增 scripts/test-native-preview.mjs（含两种格式的按键动画与气泡）
```

`test-sxi-conversion` 原样通过：手心画布直接读 `skin.json`，导出的 BDI/BDS 走百度 INI，两者预览逐像素一致。`test-ssf-conversion` 的源侧改为直接铺上导出所用的转换结果再截图（画布本身不再持有转换结果），仍要求导出后逐像素还原；搜狗转换的单元测试改为直接调用转换函数。

