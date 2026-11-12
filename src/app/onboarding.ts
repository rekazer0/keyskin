import { canvasWrap, mode, toolbarMenus } from "./dom"
import { appState } from "./state"
import { mobileShellQuery } from "./mobile-media"
import { setMobileTab } from "./mobile-shell"
import { runTour, type TourStep } from "../tour.ts"
import { shortcutLabel } from "../dom-element"

const ONBOARDING_KEY = "onboarding-tour-v1"

const hasSkin = () => Boolean(appState.archive) && !canvasWrap.classList.contains("empty")
const closeMenus = () => { for (const menu of toolbarMenus) menu.open = false }

/** 首次打开的使用教程：电脑（宽屏）与手机的界面不同，按启动时的布局选一套说明。 */
function onboardingSteps(compact: boolean): TourStep[] {
  const menu = toolbarMenus[0]
  const menuSelector = ".pen-file-menu"
  const welcome = !hasSkin()
  const steps: TourStep[] = [
    {
      title: "欢迎使用键设",
      body: compact
        ? "键设可以直接在手机上编辑百度、搜狗、手心输入法皮肤。接下来花一分钟，跟着提示完成一次：新建皮肤 → 预览 → 修改按键 → 导出。点右上角 × 可随时退出。"
        : "键设是百度、搜狗、手心输入法皮肤的可视化编辑器。接下来花一分钟，跟着提示完成一次：新建皮肤 → 预览 → 修改按键 → 保存导出。按 Esc 或点右上角 × 可随时退出。",
    },
  ]
  if (welcome) steps.push(
    {
      target: ["#welcome-recent-open"],
      title: "打开已有皮肤",
      body: compact
        ? "已经有皮肤文件（.bdi / .bds / .bda / .ssf / .sxi）时点这里导入；也可以在其他应用里把皮肤文件分享给键设。"
        : "已经有皮肤文件（.bdi / .bds / .bda / .ssf / .sxi）时点这里导入，也可以直接把文件拖进窗口。打开过的皮肤会列在「最近打开」里。",
      when: () => !hasSkin(),
    },
    {
      target: ['.template-card[data-template="default-android"]'],
      title: "从模板新建皮肤",
      body: "第一次使用建议从模板开始：模板保留了官方的基础布局和资源，改起来不容易出错。",
      action: { hint: compact ? "轻点高亮的「百度 BDA 默认」模板" : "点击高亮的「百度 BDA 默认」模板", done: hasSkin },
    },
  )
  steps.push(
    {
      target: [".canvas-wrap"],
      title: "画布：实时预览",
      enter: compact ? () => setMobileTab("canvas") : undefined,
      body: compact
        ? "下半屏是键盘的实际效果。「交互预览」模式下轻点按键会模拟打字，双指可以缩放画布。"
        : "这里显示键盘的实际效果。「交互预览」模式下点击按键会模拟打字；滚轮或右下角的按钮可以缩放画布。",
      when: hasSkin,
    },
    {
      target: compact ? [".mobile-canvas-tools"] : [".preview-toolbar"],
      title: "预览选项",
      body: compact
        ? "画布右下角的按钮里是方向、外观、设备与画布、辅助线和全局预览；皮肤里的每种组合都可以分别编辑。"
        : "依次是辅助线、皮肤状态、预览设备（各款手机或纯画布）、竖屏 / 横屏、浅色 / 深色。皮肤里的每种组合都可以分别编辑。",
      when: hasSkin,
    },
    {
      target: compact ? ['[data-mobile-choice="mode"]'] : ['[data-mode-choice="edit"]'],
      title: "切换到编辑模式",
      body: "打开皮肤后默认处于「交互预览」，配置只读。切换到「编辑模式」后才能选中、拖动和修改按键。",
      action: { hint: compact ? "轻点右上角的「交互预览」按钮，切换到编辑模式" : "点击右上角的「编辑模式」", done: () => mode.value === "edit" },
      when: hasSkin,
    },
    {
      target: [".canvas-wrap"],
      title: "选中一个按键",
      enter: compact ? () => setMobileTab("canvas") : undefined,
      body: compact
        ? "编辑模式是上下分屏：上方实时预览，下方是属性。轻点按键即可选中，改完立刻在画布上看到效果。"
        : `编辑模式下单击按键即可选中，拖动可以移动位置；${shortcutLabel("单击")}可以多选。`,
      action: { hint: compact ? "轻点画布上任意一个按键" : "点击画布上任意一个按键", done: () => appState.selectedKeySections.length > 0 },
      when: () => hasSkin() && mode.value === "edit",
    },
    {
      target: ["section.source"],
      title: "属性检查器",
      enter: compact ? () => setMobileTab("canvas") : undefined,
      body: compact
        ? "画布下方就是选中按键的属性：位置、尺寸、样式、文字和手势，改动立即显示在上方画布上，点顶部的撤销按钮可以撤回。右侧分类栏可快速跳到对应分组；需要更大编辑区时点底部「属性」。"
        : `在这里修改选中对象的位置、尺寸、样式、文字和手势，改动立即显示在画布上，可随时撤销（${shortcutLabel("Z")}）。右侧分类栏点击即可跳到对应分组，放大镜可以筛选属性。`,
      when: hasSkin,
    },
    compact
      ? {
          target: [".ui-tabbar"],
          title: "三个主页面",
          body: "底部三个标签是「画布」「属性」「文件」。画布页上方预览、下方属性，拖中间的分割线可以调高度；「属性」是整页检查器，「文件」里可以换到 9 键、26 键、符号等面板。",
          when: hasSkin,
        }
      : {
          target: ["aside.sidebar"],
          title: "概览与源文件",
          body: "「概览」列出皮肤信息、资源和全部键盘面板（9 键、26 键、符号……），点击即可切换要编辑的面板；「源文件」用来查看和管理皮肤包里的所有文件。",
          when: hasSkin,
        },
    {
      target: [".titlebar-preferences"],
      title: "设置",
      body: "外观主题、强调色、默认预览设备、画布背景等偏好都在这里调整。",
      when: () => !compact,
    },
    {
      target: [`${menuSelector} > summary`],
      title: "保存与导出",
      body: "新建、打开、保存和导出皮肤都在左上角的菜单里。",
      action: { hint: compact ? "轻点左上角的菜单按钮" : "点击左上角的菜单按钮", done: () => Boolean(menu?.open) },
    },
    {
      target: [`${menuSelector}[open] .ui-menu`],
      title: "导出给输入法",
      body: compact
        ? "改好后先「保存皮肤」，再按要使用的输入法选择导出格式；「分享皮肤」可以把皮肤直接发给输入法安装。「设置」和「使用教程」也在这个菜单里。"
        : "改好后先「保存皮肤」，再按要使用的输入法选择导出格式：百度 iOS / Android、新版 BDA、手心或搜狗。",
      when: () => Boolean(menu?.open),
      leave: closeMenus,
    },
    {
      target: compact ? [".ui-tabbar"] : undefined,
      title: "准备就绪",
      body: "以上就是基本流程。想再看一遍时，打开左上角菜单里的「使用教程」。祝你做出满意的皮肤！",
    },
  )
  return steps
}

function markOnboardingSeen(): void {
  try { localStorage.setItem(ONBOARDING_KEY, "done") } catch {}
}

export function startOnboarding(): void {
  appState.stopOnboarding?.()
  closeMenus()
  appState.stopOnboarding = runTour(onboardingSteps(mobileShellQuery.matches), {
    busy: () => appState.fileOperationRunning || Boolean(document.querySelector("dialog[open]")),
    onEnd: () => {
      appState.stopOnboarding = undefined
      markOnboardingSeen()
    },
  })
}

/** 软件首次打开时自动开始教程；看完或跳过后不再出现。 */
export function startOnboardingOnFirstLaunch(): void {
  try { if (localStorage.getItem(ONBOARDING_KEY)) return } catch { return }
  startOnboarding()
}
