import { resolveCandidateRect } from "../candidate-style.ts"
import { textDocument } from "./bda-documents"
import { genConfigPath, toolbarConfigPath } from "./config-context"
import { field, section } from "./property-rows"

/** BDA、SSF 的候选栏几何来自预览模板，不能写进皮肤外观配置。 */
export function nativeCandidateGeometrySection(): HTMLElement {
  const path = toolbarConfigPath()
  const rect = resolveCandidateRect(path ? textDocument(path) : undefined, textDocument(genConfigPath()))
  const hint = "候选栏几何来自当前预览布局模板，仅供查看；此格式不支持保存位置与尺寸"
  return section("布局", [
    field({ key: "VIEW_RECT", label: "位置", hint, spec: { kind: "parts", affixes: ["X", "Y"], values: [String(rect.x), String(rect.y)] }, editable: false }),
    field({ key: "VIEW_RECT", label: "尺寸", hint, spec: { kind: "parts", affixes: ["W", "H"], values: [String(rect.width), String(rect.height)] }, editable: false }),
  ])
}
