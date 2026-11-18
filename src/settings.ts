import './settings.css'
import { bindListboxKeys, element } from './dom-element'
import { createSettingsDraft } from './settings-draft'

type Control = HTMLInputElement | HTMLSelectElement

/** Live preferences reuse the editor's existing change handlers; cancel replays the opening values. */
export function initializeSettings(workspace: HTMLElement, setGuides: (enabled: boolean) => void, modelEditing: { begin(): void; cancel(): void; dirty(): boolean; save(): Promise<void> }, onSaved: () => void) {
  const input = (id: string) => workspace.querySelector<Control>(`#${id}`)!
  const root = document.documentElement
  const density = input('interface-density')
  const accent = input('interface-accent')
  const soften = input('dark-canvas-soften') as HTMLInputElement
  const safe = input('safe-area-guides') as HTMLInputElement
  const guides = input('settings-layout-guides') as HTMLInputElement
  const sectionScrollbar = input('source-section-scrollbar') as HTMLInputElement
  const read = (control: Control) => control instanceof HTMLInputElement && control.type === 'checkbox' ? String(control.checked) : control.value
  const write = (control: Control, value: string) => {
    if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = value === 'true'
    else control.value = value
  }
  const reduceMotion = input('reduce-interface-motion') as HTMLInputElement
  reduceMotion.checked = localStorage.getItem(reduceMotion.id) === 'true'
  const preferences = [density, accent, soften, safe, guides, sectionScrollbar, reduceMotion]
  const defaultAccent = '#3a6df0'
  density.value = localStorage.getItem(density.id) === 'compact' ? 'compact' : 'standard'
  const savedAccent = localStorage.getItem(accent.id)
  accent.value = savedAccent && /^#[0-9a-f]{6}$/i.test(savedAccent) ? savedAccent : defaultAccent
  sectionScrollbar.checked = localStorage.getItem(sectionScrollbar.id) !== 'false'
  soften.checked = localStorage.getItem(soften.id) !== 'false'
  safe.checked = localStorage.getItem(safe.id) === 'true'
  guides.checked = localStorage.getItem(guides.id) === 'true'
  const apply = () => {
    root.dataset.reducedMotion = String(reduceMotion.checked)
    root.dataset.sourceSectionScrollbar = String(sectionScrollbar.checked)
    root.dataset.interfaceDensity = density.value
    // 默认强调色交还给主题，深色模式才能用它自己的提亮蓝
    if (accent.value.toLowerCase() === defaultAccent) for (const name of ['--accent', '--accent-soft']) root.style.removeProperty(name)
    else {
      root.style.setProperty('--accent', accent.value)
      root.style.setProperty('--accent-soft', `color-mix(in srgb, ${accent.value} 14%, var(--panel))`)
    }
    root.dataset.darkCanvasSoften = String(soften.checked)
    root.dataset.safeAreaGuides = String(safe.checked)
    workspace.querySelector('output#interface-accent-value')!.textContent = accent.value.toUpperCase()
  }
  for (const control of preferences) control.addEventListener('change', () => {
    localStorage.setItem(control.id, read(control))
    apply()
    if (control === guides) setGuides(guides.checked)
  })
  accent.addEventListener('input', apply)
  apply()
  setGuides(guides.checked)
  const theme = workspace.querySelector<HTMLSelectElement>('#interface-theme')!
  const themeList = workspace.querySelector<HTMLElement>('#settings-theme-list')!
  for (const option of theme.options) {
    const card = element('button', 'ui-project-card')
    card.type = 'button'
    card.dataset.variant = 'theme'
    card.dataset.settingChoice = theme.id
    card.dataset.value = option.value
    card.setAttribute('role', 'option')
    const image = element('img')
    image.alt = ''
    image.src = `${import.meta.env.BASE_URL}theme-previews/${option.value}.webp`
    image.draggable = false
    card.append(image, option.text)
    themeList.append(card)
  }
  bindListboxKeys(themeList, option => {
    option.click()
    option.focus()
  })
  new ResizeObserver(() => {
    const card = themeList.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!card || !themeList.clientWidth) return
    const inset = (themeList.firstElementChild as HTMLElement).offsetLeft
    themeList.scrollLeft = Math.min(card.offsetLeft - inset, Math.max(themeList.scrollLeft,
      card.offsetLeft + card.offsetWidth + inset - themeList.clientWidth))
  }).observe(themeList)
  const sync = () => {
    for (const button of workspace.querySelectorAll<HTMLButtonElement>('[data-setting-choice]')) {
      const control = input(button.dataset.settingChoice!)
      const mode = button.dataset.settingChoice === 'app-theme' && control.disabled
        ? theme.selectedOptions[0]?.dataset.colorScheme
        : control.value
      const selected = mode === button.dataset.value
      if (control === theme) {
        button.setAttribute('aria-selected', String(selected))
        button.tabIndex = selected ? 0 : -1
      } else button.setAttribute('aria-pressed', String(selected))
    }
  }
  for (const button of workspace.querySelectorAll<HTMLButtonElement>('[data-setting-choice]')) button.addEventListener('click', () => {
    const control = input(button.dataset.settingChoice!)
    control.value = button.dataset.value!
    control.dispatchEvent(new Event('change', { bubbles: true }))
  })
  // Directory actions retain their explicit, immediate semantics; the model page keeps its own draft.
  const controls = [...workspace.querySelectorAll<Control>('input[id], select[id]')].filter(control => !/^(source-directory|model-|image-model-)/.test(control.id))
  const storageKeys = [...controls.map(control => control.id), 'window-glass-opacity', 'window-acrylic-opacity']
  let values = new Map<Control, string>()
  const draft = createSettingsDraft(localStorage, storageKeys)
  let reverting = false
  let saving = false
  const state = workspace.querySelector<HTMLElement>('#settings-save-state')!
  const dirty = () => modelEditing.dirty() || controls.some(control => values.has(control) && read(control) !== values.get(control))
  const status = () => {
    state.dataset.dirty = String(dirty())
    workspace.querySelector('#settings-dirty-label')!.textContent = dirty() ? '有未保存的更改' : '所有更改已保存'
    const last = localStorage.getItem('settings-saved-at')
    workspace.querySelector('#settings-saved-at')!.textContent = last ? `上次保存 ${new Date(last).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''
    sync()
  }
  const begin = () => {
    values = new Map(controls.map(control => [control, read(control)]))
    draft.begin()
    modelEditing.begin()
    status()
  }
  const exit = () => {
    workspace.hidden = true
    workspace.dispatchEvent(new Event("settings-exit"))
  }
  const cancel = () => {
    if (saving || workspace.hidden) return
    reverting = true
    for (const [control, value] of values) {
      if (read(control) === value) continue
      write(control, value)
      control.dispatchEvent(new Event('input', { bubbles: true }))
      control.dispatchEvent(new Event('change', { bubbles: true }))
    }
    draft.cancel()
    modelEditing.cancel()
    reverting = false
    apply()
    sync()
    draft.cancel()
    exit()
  }
  workspace.querySelector('#settings-cancel')!.addEventListener('click', cancel)
  const capture = (event: Event) => {
    const control = event.target
    if (!workspace.hidden && !saving && !reverting && (control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
      if (event.type === 'input' && control.id === 'window-material-opacity' || event.type === 'change' && control.id !== 'window-material-opacity' || event.type === 'focusout' && control.id === 'source-font-size') {
        draft.capture(control.id === 'window-material-opacity' ? ['window-glass-opacity', 'window-acrylic-opacity'] : [control.id])
      }
    }
    status()
  }
  workspace.addEventListener('input', capture)
  workspace.addEventListener('change', capture)
  workspace.addEventListener('focusout', capture)
  workspace.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); workspace.querySelector<HTMLButtonElement>('#settings-save')!.click() })
  workspace.querySelector('#settings-save')!.addEventListener('click', () => void (async () => {
    if (saving) return
    if (!workspace.querySelector('form')!.reportValidity()) return
    saving = true
    const button = workspace.querySelector<HTMLButtonElement>('#settings-save')!
    button.disabled = true
    try {
      if (modelEditing.dirty()) await modelEditing.save()
      draft.commit()
      // Flush inputs such as a color picker or number field before committing.
      for (const control of controls) if (read(control) !== values.get(control)) control.dispatchEvent(new Event('change', { bubbles: true }))
      onSaved()
      localStorage.setItem('settings-saved-at', new Date().toISOString())
      begin()
      exit()
    } catch (error) {
      workspace.querySelector('#settings-dirty-label')!.textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      saving = false
      button.disabled = false
    }
  })())
  sync()
  return { begin, cancel, dirty, isSaving: () => saving }
}
