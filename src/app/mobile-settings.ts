import { element, iconButton } from "../dom-element"
import { createIcon } from "../icons"
import { $, settingsDialog } from "./dom"
import { mobilePortraitQuery } from "./canvas-interaction"

/** 设置首页复用原控件，预览、保存和取消仍由 settings 的草稿负责。 */
export function wireMobileSettings(): void {
  const overview = element("div", "mobile-settings-overview")
  const local = element("div", "ui-list-item mobile-settings-account")
  const account = element("span", "ui-list-item-text")
  account.append(Object.assign(element("strong"), { textContent: "本机工作区" }), Object.assign(element("small"), { textContent: "文件与修改仅在本机处理" }))
  local.append(createIcon("shield-check", 20), account)
  overview.append(local)
  const placements: { row: HTMLElement; placeholder: Comment; host: HTMLElement }[] = []
  const group = (title: string, icon: string) => {
    const section = element("section", "mobile-settings-group")
    const heading = element("h3")
    heading.append(createIcon(icon), title)
    const rows = element("div", "mobile-settings-rows")
    section.append(heading, rows)
    overview.append(section)
    return rows
  }
  const move = (id: string, host: HTMLElement) => {
    const row = $(id).closest<HTMLElement>(".settings-row")!
    const placeholder = document.createComment("mobile settings row")
    row.before(placeholder)
    placements.push({ row, placeholder, host })
  }
  const link = (host: HTMLElement, label: string, action: () => void, value = "") => {
    const button = element("button", "ui-list-item")
    button.type = "button"
    button.append(Object.assign(element("span"), { textContent: label }))
    if (value) button.append(Object.assign(element("small"), { textContent: value }))
    button.append(createIcon("chevron-right"))
    button.addEventListener("click", action)
    host.append(button)
  }
  const open = (page: string) => settingsDialog.querySelector<HTMLButtonElement>(`[data-settings-page="${page}"]`)!.click()
  const appearance = group("外观", "paintbrush")
  for (const id of ["#app-theme", "#interface-accent", "#window-material-opacity", "#settings-layout-guides"]) move(id, appearance)
  link(appearance, "更多外观设置", () => open("appearance"))
  const editing = group("编辑", "sliders-horizontal")
  for (const id of ["#default-device", "#editor-coordinate-snap", "#reduce-interface-motion"]) move(id, editing)
  link(editing, "预览与画布", () => open("canvas"))
  link(editing, "源代码", () => open("source"))
  link(editing, "AI 模型", () => $(".mobile-model-link").click())
  const data = group("数据", "hard-drive")
  const storage = element("div", "ui-list-item")
  const storageLabel = element("span", "ui-list-item-text")
  storageLabel.append(Object.assign(element("strong"), { textContent: "本地缓存" }), Object.assign(element("small"), { textContent: "皮肤素材与预览图" }))
  const size = Object.assign(element("small"), { textContent: "由浏览器管理" })
  storage.append(storageLabel, size)
  data.append(storage)
  link(data, "最近打开", () => open("files"))
  link(data, "清空最近打开", () => $("#recent-clear").click())
  const about = group("关于", "info")
  link(about, "版本", () => open("about"), $("#about-update").dataset.currentVersion)
  const license = Object.assign(element("a", "ui-list-item"), { href: "https://github.com/rekazer0/keyskin", target: "_blank", rel: "noreferrer" })
  license.append(Object.assign(element("span"), { textContent: "开源许可" }), createIcon("arrow-up-right"))
  about.append(license)
  link(about, "帮助与反馈", () => open("about"))
  const footer = element("p", "ui-field-note mobile-settings-note")
  footer.textContent = `键设 KeySkin ${$("#about-update").dataset.currentVersion}`
  overview.append(footer)
  $(".settings-layout").prepend(overview)
  const subtitle = Object.assign(element("p", "ui-field-note mobile-settings-subtitle"), { textContent: "键设 KeySkin · 键盘皮肤编辑器" })
  $("#settings-title").after(subtitle)
  const nav = $("#mobile-navigation")
  const navHome = document.createComment("mobile navigation")
  nav.before(navHome)
  const settingsButton = nav.querySelector<HTMLButtonElement>("[data-app-dialog=settings]")!
  const sync = () => {
    const mobile = settingsDialog.open && mobilePortraitQuery.matches
    const index = mobile && settingsDialog.dataset.mobileSettings === "index"
    for (const { row, placeholder, host } of [...placements].reverse()) {
      if (index && row.parentElement !== host) host.prepend(row)
      else if (!index && row.previousSibling !== placeholder) placeholder.after(row)
    }
    if (mobile && nav.parentElement !== settingsDialog.querySelector("form")) settingsDialog.querySelector("form")!.append(nav)
    else if (!mobile && nav.previousSibling !== navHome) navHome.after(nav)
  }
  nav.addEventListener("click", event => {
    if (!settingsDialog.open) return
    const button = (event.target as Element).closest<HTMLButtonElement>("button")
    if (!button) return
    event.stopImmediatePropagation()
    if (button === settingsButton) return
    settingsDialog.addEventListener("close", () => button.click(), { once: true })
    $("#settings-cancel").click()
  }, { capture: true })
  new MutationObserver(sync).observe(settingsDialog, { attributes: true, attributeFilter: ["open", "data-mobile-settings"] })
  mobilePortraitQuery.addEventListener("change", sync)
  settingsDialog.addEventListener("close", sync)
  settingsDialog.addEventListener("toggle", () => {
    if (!settingsDialog.open) return
    void navigator.storage?.estimate().then(estimate => {
      if (estimate.usage !== undefined) size.textContent = `${(estimate.usage / 1024 / 1024).toFixed(1)} MB`
    }).catch(() => {})
  })
  const close = iconButton("x", "关闭设置", () => $("#settings-cancel").click())
  close.classList.add("mobile-settings-close")
  $(".settings-header").append(close)
}
