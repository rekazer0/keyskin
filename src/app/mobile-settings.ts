import { element } from "../dom-element"
import { createIcon } from "../icons"
import { $, settingsWorkspace } from "./dom"
import { ask } from "./ask"
import { nativeSettings } from "./preferences"
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
    return button
  }
  const open = (page: string) => settingsWorkspace.querySelector<HTMLButtonElement>(`[data-settings-page="${page}"]`)!.click()
  const appearance = group("外观", "paintbrush")
  for (const id of ["#app-theme", "#interface-accent", "#window-material-opacity", "#settings-layout-guides"]) move(id, appearance)
  link(appearance, "更多外观设置", () => open("appearance"))
  const editing = group("编辑", "sliders-horizontal")
  for (const id of ["#default-device", "#editor-coordinate-snap", "#reduce-interface-motion"]) move(id, editing)
  link(editing, "预览与画布", () => open("canvas"))
  link(editing, "源代码", () => open("source"))
  if (!$("#settings-adb-nav").hidden) link(editing, "ADB 预览", () => open("adb"))
  link(editing, "AI 模型", () => $(".mobile-model-link").click())
  const data = group("数据", "hard-drive")
  const storage = element("div", "ui-list-item")
  const storageLabel = element("span", "ui-list-item-text")
  storageLabel.append(Object.assign(element("strong"), { textContent: "本地存储用量" }), Object.assign(element("small"), { textContent: "本站占用的存储空间（估算）" }))
  const size = Object.assign(element("small"), { textContent: "由浏览器管理" })
  storage.append(storageLabel, size)
  data.append(storage)
  if (nativeSettings) {
    link(data, "文件", () => open("files"))
    const clear = $("#recent-clear")
    const action = link(data, "清除记录", async () => {
      const result = await ask({ title: "清除最近打开记录？", detail: "只移除记录，不删除皮肤文件。此操作不可撤销。", deletion: true,
        actions: [{ value: "cancel", label: "取消" }, { value: "clear", label: "清除记录", variant: "danger" }],
      })
      if (result === "clear") clear.click()
    })
    const syncClear = () => { action.hidden = clear.hidden }
    new MutationObserver(syncClear).observe(clear, { attributes: true, attributeFilter: ["hidden"] })
    syncClear()
  }
  const about = group("关于", "info")
  link(about, "版本", () => open("about"), $("#about-update").dataset.currentVersion)
  const project = Object.assign(element("a", "ui-list-item"), { href: "https://github.com/rekazer0/keyskin", target: "_blank", rel: "noreferrer" })
  project.append(Object.assign(element("span"), { textContent: "项目主页（GitHub）" }), createIcon("arrow-up-right"))
  about.append(project)
  link(about, "帮助与反馈", () => open("about"))
  link(about, $("#about-disclaimer-title").textContent!, () => {
    open("about")
    $("#about-disclaimer-title").scrollIntoView({ block: "start" })
  })
  const footer = element("p", "ui-field-note mobile-settings-note")
  footer.textContent = `键设 KeySkin ${$("#about-update").dataset.currentVersion}`
  overview.append(footer)
  $(".settings-layout").prepend(overview)
  const subtitle = Object.assign(element("p", "ui-field-note mobile-settings-subtitle"), { textContent: "键设 KeySkin · 键盘皮肤编辑器" })
  $("#settings-title").after(subtitle)
  const sync = () => {
    const index = !settingsWorkspace.hidden && mobilePortraitQuery.matches && settingsWorkspace.dataset.mobileSettings === "index"
    for (const { row, placeholder, host } of [...placements].reverse()) {
      if (index && row.parentElement !== host) host.prepend(row)
      else if (!index && row.previousSibling !== placeholder) placeholder.after(row)
    }
  }
  new MutationObserver(sync).observe(settingsWorkspace, { attributes: true, attributeFilter: ["hidden", "data-mobile-settings"] })
  mobilePortraitQuery.addEventListener("change", sync)
  settingsWorkspace.addEventListener("settings-enter", () => {
    void navigator.storage?.estimate().then(estimate => {
      if (estimate.usage !== undefined) size.textContent = `${(estimate.usage / 1024 / 1024).toFixed(1)} MB`
    }).catch(() => {})
  })
}
