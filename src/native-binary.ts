import { invoke } from "@tauri-apps/api/core"

/** 元数据放请求头，文件保留二进制，避免逐字节序列化为 JSON 数字数组。 */
export function invokeBinary<T>(command: string, data: Uint8Array, args: Record<string, unknown>): Promise<T> {
  const metadata = JSON.stringify(args).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
  return invoke<T>(command, data, { headers: { "x-keyskin-args": metadata } })
}
