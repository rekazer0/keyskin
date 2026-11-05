import { element } from "../dom-element.ts"
import { field, type FieldSpec } from "./property-rows"
import { appState } from "./state"

type Choice = Extract<FieldSpec, { kind: "choice" }>["options"][number]

function keyInput(key: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`.key-appearance-fields [data-key-field="${key}"]`)!
}

/** 改隐藏的原输入框：写回与历史沿用按键字段的原入口（updateSelectedKey）。 */
function write(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

/**
 * FORE_OFFSET（每层 x,y，用 ; 分隔）与 POS_TYPE（每层引用的 OFFSETn，逗号分隔）按前景层拆开，
 * 挂在前景样式下面：每层一行 X / Y 偏移、一行位置类型，界面上不再出现分号串。
 */
export function renderForeLayerFields(container: HTMLElement): void {
  const fore = keyInput("FORE_STYLE")
  const offset = keyInput("FORE_OFFSET")
  const position = keyInput("POS_TYPE")
  const offsets = offset.value ? offset.value.split(";").map((pair) => pair.split(",").map((part) => part.trim())) : []
  const positions = position.value ? position.value.split(",").map((part) => part.trim()) : []
  const layers = Math.max(fore.value.split(",").filter((token) => token.trim()).length, offsets.length, positions.length)
  // BDA 只有偏移（foreStyleOffsets，只读），没有 OFFSETn 位置类型。
  const bda = appState.archive?.format === "bda"
  const types = bda ? [] : (appState.layoutDocument?.sections() ?? []).flatMap((section) => section.match(/^OFFSET(\d+)$/i)?.[1] ?? [])
  // 缺的层写 0：POS_TYPE 读取时会丢掉空项，空位会让后面的层错位。
  const options: Choice[] = [["0", types.includes("0") ? "偏移 0" : "默认"], ...types.filter((type) => type !== "0").map((type): Choice => [type, `偏移 ${type}`])]
  const blocks = Array.from({ length: layers }, (_, layer) => {
    const block = element("div", "ui-subsection")
    if (layers > 1) block.append(Object.assign(element("h4"), { textContent: `前景 ${layer + 1}` }))
    const name = layers > 1 ? `前景 ${layer + 1} ` : "前景"
    block.append(field({
      key: "FORE_OFFSET", label: "偏移", name: `${name}偏移`, rowKey: ["FORE_OFFSET", layer],
      mixed: offset.placeholder === "混合", editable: !offset.disabled && !bda,
      spec: { kind: "parts", affixes: ["X", "Y"], values: offsets[layer] ?? ["", ""] },
      commit: (values) => {
        const next = Array.from({ length: Math.max(offsets.length, layer + 1) }, (_, index) => index === layer ? values : offsets[index] ?? [])
          .map((pair) => pair.some(Boolean) ? pair.map((part) => part || "0").join(",") : "")
        while (next.at(-1) === "") next.pop()
        write(offset, next.join(";"))
      },
    }))
    if (!bda && types.length) {
      block.append(field({
        key: "POS_TYPE", label: "位置", name: `${name}位置`, rowKey: ["POS_TYPE", layer],
        mixed: position.placeholder === "混合", editable: !position.disabled,
        spec: { kind: "choice", value: positions[layer] ?? "", options, layout: "select", unset: true },
        commit: (value) => {
          const next = Array.from({ length: Math.max(positions.length, layer + 1) }, (_, index) => index === layer ? value : positions[index] || "0")
          write(position, next.map((item) => item || "0").join(","))
        },
      }))
    }
    return block
  })
  container.replaceChildren(...bda && !offset.value && offset.placeholder !== "混合" ? [] : blocks)
}
