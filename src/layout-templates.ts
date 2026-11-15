import { SkinArchive } from "./skin.ts"
import { conversionLayoutPaths } from "./layout-conversion.ts"
import { MAX_ARCHIVE_BYTES } from "./skin-zip.ts"

export type LayoutTemplate = { id: string; name: string; builtin: boolean }
type StoredTemplate = LayoutTemplate & { format: "bds" | "bdi" | "sxi"; bytes: Uint8Array }
const builtin: LayoutTemplate = { id: "builtin:pinyin18", name: "拼音 18 键", builtin: true }

/** Resolve writes only after the transaction commits, so a failed save is never shown as permanent. */
function templateRequest<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("keyskin-layout-templates", 1)
    open.onupgradeneeded = () => open.result.createObjectStore("templates", { keyPath: "id" })
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const transaction = db.transaction("templates", mode)
      const request = run(transaction.objectStore("templates"))
      transaction.oncomplete = () => { db.close(); resolve(request.result) }
      transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? request.error ?? new Error("无法保存布局模板")) }
    }
  })
}

export async function layoutTemplates(): Promise<LayoutTemplate[]> {
  const stored = await templateRequest<StoredTemplate[]>("readonly", store => store.getAll())
  return [builtin, ...stored.map(({ id, name }) => ({ id, name, builtin: false }))]
}

export async function loadLayoutTemplate(id: string): Promise<SkinArchive> {
  if (id === builtin.id) {
    const response = await fetch("/layout-templates/pinyin18.bds")
    if (!response.ok) throw new Error("无法读取内置 18 键模板")
    return SkinArchive.openAsync(new Uint8Array(await response.arrayBuffer()), "bds")
  }
  const stored = await templateRequest<StoredTemplate | undefined>("readonly", store => store.get(id))
  if (!stored) throw new Error("模板已被删除，请重新选择")
  return SkinArchive.openAsync(stored.bytes, stored.format)
}

export async function saveLayoutTemplate(name: string, bytes: Uint8Array): Promise<LayoutTemplate> {
  const format = name.split(".").pop()?.toLowerCase()
  if (format !== "bds" && format !== "bdi" && format !== "sxi") throw new Error("请上传 BDS、BDI 或 SXI 文件")
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("模板文件超过 64 MB")
  const archive = await SkinArchive.openAsync(bytes, format)
  const paths = conversionLayoutPaths(archive)
  if (!paths.length) throw new Error("模板中没有可用的键盘布局")
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)
  const id = `user:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`
  const template = { id, name: name.replace(/\.(?:bds|bdi|sxi)$/i, ""), builtin: false }
  await templateRequest("readwrite", store => store.put({ ...template, bytes, format } satisfies StoredTemplate))
  // Browsers grant this at their discretion; the database remains available when they decline.
  void navigator.storage?.persist?.().catch(() => {})
  return template
}

export async function deleteLayoutTemplate(id: string): Promise<void> {
  if (!id.startsWith("user:")) throw new Error("内置模板不可删除")
  await templateRequest("readwrite", store => store.delete(id))
}
