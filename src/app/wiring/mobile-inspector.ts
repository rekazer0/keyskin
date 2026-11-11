import { mobileInspectorView, mobileInspectorMore, mobilePropertyBack, mobilePropertySelect, mobilePropertySearch, mobileInspectorGroups, quickInspector, inspectorTabs } from "../dom"
import { inspectorTabButtons, mobilePortraitQuery } from "../canvas-interaction"
import { setMobileInspectorGroup, setMobilePropertyPage } from "../mobile-layout"

export function wireMobileInspector(): void {
  setMobilePropertyPage("home")
  mobilePropertySelect.addEventListener("change", () => setMobileInspectorGroup(mobilePropertySelect.value))
  mobilePropertyBack.addEventListener("click", () => {
    const input = quickInspector.querySelector<HTMLInputElement>("#inspector-filter")!
    input.value = ""
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    setMobilePropertyPage("home")
    const current = mobileInspectorGroups.querySelector<HTMLButtonElement>(`[data-mobile-inspector-group="${quickInspector.dataset.mobileInspectorGroup}"]`)
    current?.focus({ preventScroll: true })
  })
  const filter = quickInspector.querySelector<HTMLButtonElement>(".inspector-filter-open")!
  mobilePropertySearch.addEventListener("click", () => filter.click())
  new MutationObserver(() => mobilePropertySearch.setAttribute("aria-expanded", filter.getAttribute("aria-expanded") ?? "false"))
    .observe(filter, { attributes: true, attributeFilter: ["aria-expanded"] })

  const syncViews = () => {
    for (const option of mobileInspectorView.options) {
      const tab = inspectorTabButtons.find((button) => button.dataset.inspectorTab === option.value)!
      option.disabled = tab.disabled
      option.hidden = tab.hidden
      if (tab.getAttribute("aria-selected") === "true") mobileInspectorView.value = option.value
    }
  }
  new MutationObserver(syncViews).observe(inspectorTabs, { subtree: true, attributes: true, attributeFilter: ["disabled", "hidden", "aria-selected"] })
  syncViews()
  mobileInspectorView.addEventListener("change", () => {
    inspectorTabButtons.find((button) => button.dataset.inspectorTab === mobileInspectorView.value)?.click()
  })

  const actions = document.querySelector<HTMLElement>(".inspector-object-actions")!
  const proxies = Array.from(mobileInspectorMore.querySelectorAll<HTMLButtonElement>("[data-mobile-key-tool]"))
  const targetOf = (proxy: HTMLButtonElement) => actions.querySelector<HTMLButtonElement>(`[data-key-mode="${proxy.dataset.mobileKeyTool}"], [data-key-action="${proxy.dataset.mobileKeyTool}"]`)!
  const syncTools = () => {
    for (const proxy of proxies) {
      const target = targetOf(proxy)
      proxy.disabled = target.disabled
      proxy.hidden = target.hidden
    }
    mobileInspectorMore.hidden = !proxies.some((button) => !button.hidden && !button.disabled)
    if (mobileInspectorMore.hidden) mobileInspectorMore.open = false
  }
  new MutationObserver(syncTools).observe(actions, { subtree: true, attributes: true, attributeFilter: ["disabled", "hidden", "aria-pressed"] })
  syncTools()
  for (const proxy of proxies) proxy.addEventListener("click", () => {
    targetOf(proxy).click()
    mobileInspectorMore.open = false
  })
  mobilePortraitQuery.addEventListener("change", () => {
    mobileInspectorMore.open = false
    setMobileInspectorGroup(quickInspector.dataset.mobileInspectorGroup ?? "", false)
  })
}
