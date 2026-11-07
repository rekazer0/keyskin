import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSettingsDraft } from '../src/settings-draft.ts'

test('live changes stay uncommitted, cancel restores missing keys and preserves unrelated work', () => {
  const data = new Map([['app-theme', 'light'], ['recent-files', 'old']])
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
  const draft = createSettingsDraft(storage, ['app-theme', 'interface-accent'])
  draft.begin()
  storage.setItem('app-theme', 'dark')
  storage.setItem('interface-accent', '#00ff00')
  draft.capture(['app-theme', 'interface-accent'])
  assert.equal(storage.getItem('app-theme'), 'light')
  assert.equal(storage.getItem('interface-accent'), null)
  storage.setItem('recent-files', 'new')
  draft.cancel()
  assert.equal(storage.getItem('recent-files'), 'new')
  assert.equal(storage.getItem('interface-accent'), null)
  draft.begin()
  storage.setItem('app-theme', 'dark')
  draft.capture(['app-theme'])
  draft.commit()
  assert.equal(storage.getItem('app-theme'), 'dark')
  draft.begin()
  storage.setItem('app-theme', 'light')
  draft.capture(['app-theme'])
  storage.setItem('app-theme', 'dark')
  draft.capture(['app-theme'])
  draft.commit()
  assert.equal(storage.getItem('app-theme'), 'dark', 'returning to original value must clear the earlier draft')
})

test('every settings category has a unique panel and all existing controls remain reachable', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const dialog = html.slice(html.indexOf('<dialog id="settings-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="settings-dialog"')))
  const ids = [...dialog.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
  assert.equal(new Set(ids).size, ids.length)
  const categoryHeadings = [...dialog.matchAll(/class="settings-nav-heading"[^>]*>([^<]+)</g)].map(match => match[1])
  assert.deepEqual(categoryHeadings, ['界面', '工作流', '设备', '其他'])
  const panels = [...dialog.matchAll(/data-settings-panel="([^"]+)"/g)].map(match => match[1])
  const pages = [...dialog.matchAll(/data-settings-page="([^"]+)"/g)].map(match => match[1])
  assert.deepEqual([...pages].sort(), [...panels].sort())
  assert.ok(!panels.includes('preview'))
  for (const id of ['default-device', 'canvas-background', 'editor-crosshair', 'editor-coordinate-snap', 'source-font-size', 'app-theme', 'settings-save', 'settings-cancel']) assert.ok(ids.includes(id), id)
})
