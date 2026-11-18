# 搜狗 SSF 文件树：官方 APK 核对与修复

2026-10-18。范围为 SSF 概览重复引用 `phoneSkin.ini` 导致的文件树 E2E 失败；不改超长拼音尾部裁切。

## 官方来源与复现

- [搜狗输入法手机版下载页](https://shouji.sogou.com/index.php)的“最新版本下载”。
- [官方下载链接](https://apkdl.sogouimecdn.com/wapdl/android/apk/SogouInput_20.17.0_android_sweb.apk?frm=new_pcjs_index)。文件名版本为 20.17.0。
- APK SHA-256：`3eb2612040fd7daefb7e92b9de5c1a715b03f272b644e0664948742df1c7a416`。
- JADX 1.5.6：`jadx --no-res -j 4 -d decompiled SogouInput_20.17.0_android_sweb.apk`。

处理了 25,406 个类，JADX 最终报告 184 个反编译错误，退出码 3；不能把整包当作无损 Java 源码。以下涉及的路径拼接、文件类型分派方法可以阅读，另外直接读取 APK 内的 INI 交叉核对。APK 和批量反编译文件不提交仓库。

## 类、方法与格式证据

`com.sogou.theme.parse.constants.d.E()` 返回当前皮肤的配置路径：

```java
public static String E() {
    return com.sogou.theme.api.a.f().c() + "phoneSkin.ini";
}
```

`com.sogou.theme.install.checker.c.d()` 根据安装根目录与外观子目录定位该配置。`com.sogou.theme.parse.frame.a.h(String)` 按路径读取、缓存 INI，再针对 `phoneSkin.ini`、`colors.ini`、`images_config.ini` 等类型调用不同的处理方法。

`com.sogou.theme.parse.constants.d.x(...)` 构造分辨率对应的 `layout/images_config.ini` 路径；`d.y(...)` 构造 `layout/image_list.ini` 路径。APK 的 `assets/theme/theme_default/1080/layout/` 中确实存在这两个文件：前者把 `bg_png` 等资源名映射到 PNG，后者让背景等样式引用这些资源名。`res/black/phoneSkin.ini` 等外观配置也独立存在。

这些证据用于核对搜狗配置与图片资源的关系。Android 输入法没有本编辑器的文件树，不能从 APK 推导一个官方编辑器的分组界面。

## 编辑器根因和改动

`src/app/file-tree.ts` 的 SSF 分支给“按键样式”和“图片资源”都设置了 `${folder}phoneSkin.ini`。前者打开配置，后者打开图片工作区，因此同一路径出现两个按钮，原有 E2E 的唯一性断言得到 `2 !== 1`。

“按键样式”继续指向当前外观的 `phoneSkin.ini`；“图片资源”复用 `pickableImagePaths()`，指向当前外观可用的第一张真实图片，副标题显示图库数量。没有可用图片就不生成图库入口。图片工作区、资源选择和返回布局均沿用现有逻辑。源文件树与预览布局过滤不变，不写入转换生成的百度文件。

回归用例保留原有的 `phoneSkin.ini` 唯一性断言，并新增图库真实路径、浏览与返回、配置入口仍可打开的检查。原用例在横屏检查所有 `light/` 路径为零，也会误伤合法的浅色横屏键盘；现改为竖屏路径为零，横屏键盘非空且每个路径均属于 `light/skin/land/`。

## 验证

- 修复前：搜狗文件树专项流程复现 `2 !== 1`。
- 修复后：专项流程通过，覆盖图库返回、横竖屏、配置编辑、撤销重做、保存和单外观包。
- `npm run typecheck` 通过；`npm test` 201/201 通过。
- `npm run test:ui` 与本次修改前的 34 个界面快照对比，0 处变化。
- `npm run test:e2e` 全部 14 个脚本通过；综合用户流程 22/22，其中真实皮肤打开、渲染与检查为 75/75。
- 额外在浏览器验证 8 个真实 SSF 样本。按包内实际支持的外观遍历横竖屏，共 30 组；检查配置入口唯一、图库真实路径及数量、浏览返回、分组数量与源文件无修改。另用其中的单外观样本验证，切换不存在的深色外观不会产生虚假入口。
- 无图片的双外观边界样本再验证 4 组：无图库入口，配置与键盘入口可用，原始文件不变。
- `npm run build`、`git diff --check` 通过。未运行 Android 真机安装测试。
