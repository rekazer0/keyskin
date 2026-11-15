# Figma 移动端实现与视觉验收

设计来源：[Untitled · 01–50 画板](https://www.figma.com/design/3zsU7VI3FUykTYc6N0YoQt/Untitled?node-id=0-1)。验收日期：2026-11-16。

48 个界面均已进入生产编辑器、完整截图并逐页审阅。41、42 为规范板，不作为页面计数。此证据证明界面与交互覆盖，不代表 48 页与 Figma 逐像素一致；保留的真实数据、平台限制和界面编排差异在下表逐项列出。

## 阅读对照图

每图左侧为 Figma，右侧为实现，均按原尺寸排列。Figma 390×844 中的应用区裁为 `(0,44)-(390,810)`，与 390×766 网页可用视口对照；系统状态栏、手势条由系统负责。50 使用 390×700 可用视口，底部留白，不拉伸截图。

可直接打开 [离线全页图册](index.html)，或点击下表图片。原始截图与对照图 SHA-256 记录在 [manifest.json](manifest.json)，真实保存/导出文件的 SHA-256 见 [coverage.json](coverage.json)。

## 逐页证据

| 页面 | 已覆盖的生产界面或检查 | 数据、平台与视觉差异 |
| --- | --- | --- |
| [01 · 首页](comparisons/01.png) | 打开、新建入口；首页布局截图 | 最近项目只显示真实历史；欢迎图为设计资源。 |
| [02 · 新建皮肤](comparisons/02.png) | 真实模板选择页 | 模板缩略图、名称与数量取自项目资源；保留模板导入和新建确认。 |
| [03 · 打开皮肤](comparisons/03.png) | 真实文件选择入口 | 没有真实历史时不展示设计稿的示例最近项目。 |
| [04 · 编辑工作台](comparisons/04.png) | 真实键盘画布与面板属性 | 按实际皮肤逻辑像素、字体和候选内容绘制；不会用设计示意图替代键盘。 |
| [05 · 按键外观](comparisons/05.png) | 正常/按下双预览、共享样式提示 | 资源编号和对象路径为真实数据；更多原字段通过高级样式进入。 |
| [06 · 按键文字](comparisons/06.png) | 文字字段与即时反馈 | 可编辑字段按当前皮肤格式提供。 |
| [07 · 按键动作](comparisons/07.png) | 十字手势格与动作库 | 未设置的动作保留真实空值；底部属性独立滚动。 |
| [08 · 多选与排列](comparisons/08.png) | 多选与排列 | 保留原排列按钮及尺寸/间距字段；控件编排与设计稿简化的分段栏有差异。 |
| [09 · 项目概览](comparisons/09.png) | 项目概览 | 统计、布局、格式为真实文档数据。 |
| [10 · 源文件](comparisons/10.png) | 源文件树 | 展示真实目录；搜索和多选使用原文件树行为。 |
| [11 · 源代码](comparisons/11.png) | 源码视图、返回属性 | 代码和行号来自真实文件，沿用源码编辑器。 |
| [12 · 全部样式](comparisons/12.png) | 全部样式与真实缩略图 | 列表项目、编号和数量随皮肤变化。 |
| [13 · 全部图片](comparisons/13.png) | 全部图片 | 图片资源数量、尺寸和缩略图来自实际档案。 |
| [14 · 图片与切片](comparisons/14.png) | 切片放大与原图坐标映射断言 | 按真实图集和切片绘制，使用适配手机可用区域的显示倍率。 |
| [15 · 音效资源](comparisons/15.png) | 选择音效、真实解码波形 | 时长、采样率和波形取自音频数据。 |
| [16 · 动效设计](comparisons/16.png) | 动效设计与真实键盘采样 | 常用参数进入手机面板；完整轨道仍可展开。 |
| [17 · 粒子设计](comparisons/17.png) | 粒子设计与真实键盘采样 | 参数和资源来自真实动画配置。 |
| [18 · 交互预览](comparisons/18.png) | 试用输入、清除与键盘可见性断言 | 复用真实交互预览输入区。 |
| [19 · 预览选项](comparisons/19.png) | 画布选项与底层状态同步 | 选项按实际渲染能力提供。 |
| [20 · 更多操作](comparisons/20.png) | 更多操作入口 | 所有入口委托原编辑、文件和设置流程。 |
| [21 · 导出格式](comparisons/21.png) | 真实导出格式选择 | 只展示可导出的格式与真实说明。 |
| [22 · 兼容性确认](comparisons/22.png) | BDI→SXI 触发真实兼容警告 | 降级项来自转换器；需确认后继续。 |
| [23 · 导出完成](comparisons/23.png) | 实际下载 BDS 并重开校验 | 使用真实文件名、大小与保存位置说明；SHA-256 见 coverage.json。 |
| [24 · 保存结果](comparisons/24.png) | 实际保存 BDI 并重开校验 | 浏览器无法读取下载目录，明确说明位置由浏览器决定。 |
| [25 · 面板复制](comparisons/25.png) | 真实复制、一步撤销与重做；缩放模式切换断言 | 按设计纵向组织来源、目标、缩放方式和真实分辨率；路径与尺寸取自档案。 |
| [26 · 替换键盘样式](comparisons/26.png) | 手机替换目标与布局跟随选择卡、禁用状态同步断言 | 按设计纵向组织图片、替换位置、布局跟随和范围说明；保留所有实际目标。 |
| [27 · 皮肤信息](comparisons/27.png) | 真实皮肤元数据 | 字段随格式变化，保留原格式可编辑信息。 |
| [28 · 设置](comparisons/28.png) | 移动端设置分类导航 | 网页保留可用分类及模型入口说明。 |
| [29 · 外观设置](comparisons/29.png) | 主题、强调色、密度、减少动态效果 | 保留设置草稿保存/取消；控件分组及底部操作与设计示意不同。 |
| [30 · 预览与画布设置](comparisons/30.png) | 预览与画布设置 | 保留实际预览设备、背景和辅助选项；长列表在正文内滚动。 |
| [31 · 源代码设置](comparisons/31.png) | 源代码设置 | 沿用真实编辑器选项及草稿语义。 |
| [32 · AI 模型设置](comparisons/32.png) | 模型设置入口说明 | 网页无法管理桌面模型配置，不显示虚假的已连接模型。 |
| [33 · 关于与帮助](comparisons/33.png) | 关于与帮助 | 应用版本和链接使用真实产品信息。 |
| [34 · AI 设计](comparisons/34.png) | AI 设计入口说明 | 网页明确桌面能力限制，未验证实际模型调用。 |
| [35 · 未保存保护](comparisons/35.png) | 未保存保护 | 复用真实未保存状态与公共确认窗口。 |
| [36 · 分享皮肤](comparisons/36.png) | 分享格式与平台说明 | 调用可用的系统分享或下载；原生分享面板未做真机验收。 |
| [37 · 导出处理中](comparisons/37.png) | 生产进度窗口 | 使用可控异步写入测试替身维持中间态；进度百分比为组件真实插值。 |
| [38 · 导出失败](comparisons/38.png) | 生产错误分支与重试断言 | 注入不可写错误；验证重试重新打开真实导出流程，错误文案如实展示。 |
| [39 · 动效播放](comparisons/39.png) | 真实动效播放器时间推进 | 截图取样时刻随动画播放变化。 |
| [40 · 深色编辑](comparisons/40.png) | 深色编辑界面 | 语义 token 切换；键盘自身颜色由真实皮肤决定。 |
| [43 · 按下态对比](comparisons/43.png) | 按下态切换 | 只切换预览状态，不写回皮肤文件。 |
| [44 · 字号调整反馈](comparisons/44.png) | 字号调整至 40 并反馈到画布 | 显示的像素效果按真实字体和逻辑分辨率绘制。 |
| [45 · 收起属性面板](comparisons/45.png) | End 收起属性区 | 键盘等价操作覆盖，保留真实画布。 |
| [46 · 展开属性面板](comparisons/46.png) | Home 展开属性区 | 面板分界调整至允许范围的上边界。 |
| [47 · 候选栏与工具栏](comparisons/47.png) | 候选栏与工具栏真实资源 | 由格式自身候选和工具栏结构渲染。 |
| [48 · 中文 9 键](comparisons/48.png) | 中文九键布局 | 加载真实九键配置，不使用示意图。 |
| [49 · 粒子播放](comparisons/49.png) | 真实粒子播放器时间推进 | 26 键布局中播放粒子，截图取样时刻可能变化。 |
| [50 · 手机浏览器编辑](comparisons/50.png) | 390×700 可用视口编辑 | 通过缩小可用 viewport 表示浏览器工具栏占用；不伪造地址栏。 |

## 样式回归审阅

`npm run test:ui` 未重写基线。73 对共同快照中，71 个页面共记录 28023 项元素增删或计算样式变化，明细见 [ui-diff-summary.json](ui-diff-summary.json)。这些记录不是像素差异计数，也不是待修复问题数。

其中 58 张非移动端共同快照已逐屏审阅。桌面仍沿用三栏；检查器字段结构、SSF 字段、进度窗口、设置中减少动态效果控件以及 DOM 路径变化属于有意调整。手机页的字体、颜色、圆角、间距、导航、属性与全屏对话框变化对应本次改版。以下保留 8 组桌面前后图作抽查证据：

- [bds-key](desktop/bds-key.jpg)
- [light-ssf-key](desktop/light-ssf-key.jpg)
- [dark-ssf-key](desktop/dark-ssf-key.jpg)
- [palm-board](desktop/palm-board.jpg)
- [light-sxi-animation-motion](desktop/light-sxi-animation-motion.jpg)
- [light-sxi-animation-particle](desktop/light-sxi-animation-particle.jpg)
- [settings](desktop/settings.jpg)
- [file-operation-error](desktop/file-operation-error.jpg)

最近补查中，百度面板复制改为复用公共批量历史提交，一次撤销删除复制结果、重做恢复相同字节；手机缩放方式及替换目标选择卡与原字段保持同步。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；保留既有 >1000 kB chunk 提醒 |
| `node scripts/test-mobile-figma.mjs` | 48/48 界面覆盖，0 pageerror；BDS/BDI 实际下载重开 |
| `npm run test:ui` | 通过；73 对基线截图，71 个页面存在变化，28023 项 DOM/样式记录；未重存基线 |
| `node scripts/test-mobile-layout.mjs` | 21/21 |
| `node scripts/test-mobile-reconstruction.mjs` | 320 / 393 / 430 px 全部通过 |
| `node scripts/test-mobile-resources.mjs` | 320 / 393 / 430 × 浅深色 × BDS/SXI/BDA 共 18 组通过 |
| `node scripts/test-mobile-visual.mjs` | 186 张，0 浏览器错误 |
| `node scripts/test-mobile-share.mjs` | 两种 iOS activation 路径通过 |
| `node scripts/test-mobile-file-open.mjs` | Android / iPhone / desktop 文件打开通过 |
| `node scripts/test-sound-library.mjs` | 选择、搜索、播放、替换、下载、真实波形、明暗主题与窄屏通过 |
| `node scripts/test-atlas-editing.mjs` | 2/2 图集专项通过 |
| `node scripts/test-image-resource-ui.mjs` | 1440 / 812 图片资源 UI 通过 |
| `node scripts/test-layout-conversion.mjs` | BDI / SXI 模板持久化、导入、删除保护、9→18 键转换、撤销重做通过 |
| `node scripts/test-ssf-inspector.mjs` | SSF 检查器专项通过 |
| `node scripts/test-ssf-popup-conversion.mjs` | 16 个视图、96 个滑动动作通过 |
| `node scripts/test-ssf-conversion.mjs` | 32 个 BDI/BDS 视图键盘严格像素一致；平台原生工具栏参考与 BDA 重开通过 |
| `node scripts/test-adb-share.mjs` | 桌面入口、网络设置、配对、导出、取消等模拟链路通过 |
| `node scripts/test-native-panel-tools.mjs` | Palm 和 Sogou 的复制、缩放、替换、撤销重做与保存重开通过 |
| `Rust binary_ipc tests` | 4/4 |
| `node --test tests/design-system.test.mjs tests/motion-progress.test.mjs tests/layout-conversion.test.mjs tests/ssf-key-actions.test.mjs tests/ssf-inspector.test.mjs tests/picker-window.test.mjs tests/native-panel-tools.test.mjs` | 64/64 |
| `音效转换/播放定向单测` | 26/26 |
| `Tabbit 真实浏览器` | 试用输入与清除、源码返回属性、音效选择及波形；保留结果页，finish 成功且 forcedCleanup=false |

完整机器可读摘要：[validation.json](validation.json)。浏览器实测截图：[音效资源与真实波形](browser/tabbit-sound-resource.png)。

37 使用可控异步操作维持进度中间态，38 注入不可写错误；两者复用生产组件及错误分支。23、24 通过真实按钮生成下载文件，并重新打开文件校验格式和键盘内容。

## 验证边界

- 未进行 iOS/Android 真机系统分享、软键盘与系统文件选择器验收。浏览器专项覆盖模拟视口、安全区、主题与方向变化。
- 未重新打包安装桌面客户端，未做真实 USB/无线 ADB 传输；Rust 单测和浏览器模拟链路已通过。
- 网页不具备桌面模型配置能力，已提供明确说明；未调用真实 AI 服务。
- 实际键盘由皮肤逻辑分辨率、字体、候选、资源和格式规则绘制。模板、目录、资源数量、文件路径与进度信息采用真实数据，和设计示例不同。08、29–31 的部分控件编排保留现有编辑能力，尚不构成严格的逐像素还原。
- 构建成功；现有大于 1000 kB 的 chunk 提醒仍存在。

## 复现

在项目根目录执行 `node scripts/test-mobile-figma.mjs` 生成 `.ui-current/figma-mobile/`。该脚本用真实可编辑 fixture，检测页面水平溢出、对话框边界、浏览器错误，并对关键交互、下载重开和切片坐标执行断言。
样式回归使用 `npm run test:ui`；不要通过重存基线掩盖不符合预期的变化。
