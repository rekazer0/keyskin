// 来源：每个 IR 节点来自哪个格式、哪个文件、哪个字段。
//
// 用于保存时保留未建模的内容，以及降级报告里指出具体来源。
export type ProvenanceEntry = {
  path: string
  field?: string
}

export type Provenance = {
  format: string
  nodes: ReadonlyMap<string, ProvenanceEntry>
}
