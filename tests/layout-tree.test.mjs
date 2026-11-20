// 布局树面板：从 SkinModel.boards 的 LayoutNode 生成可折叠的层级，矩形来自 computeLayout。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { Display, FlexDirection } from "taffy-layout"
import { containerOf } from "../src/skin-model/board.ts"
import { computeLayout } from "../src/skin-model/layout.ts"
import { describeNode } from "../src/skin-model/layout-view.ts"
import { declarations, run } from "./helpers/app-source.mjs"

const PANEL = "src/app/layout-tree-panel.ts"
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

/** 只够面板用的一棵 DOM：children、dataset、attributes 与 querySelectorAll。 */
class FakeElement {
  constructor(tag) {
    this.tagName = tag
    this.children = []
    this.dataset = {}
    this.attributes = {}
    this.listeners = {}
    this.className = ""
    this.textContent = ""
    this.open = false
    this.scrollTop = 0
  }
  append(...nodes) { this.children.push(...nodes) }
  replaceChildren(...nodes) { this.children = [...nodes] }
  get childElementCount() { return this.children.length }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener) }
  querySelectorAll(selector) {
    const found = []
    const visit = (element) => {
      if (selector === "[data-layout-node]" && element.dataset?.layoutNode !== undefined) found.push(element)
      for (const child of element.children ?? []) visit(child)
    }
    visit(this)
    return found
  }
}

const DECLARATIONS = [
  "renderLayoutTree", "renderNode", "groupOf", "keyItem", "contentOf", "rectText",
  "syncSelection", "stateOf", "currentBoard", "ROLE_ICONS", "states",
]

function harness(model, { layoutPath = "light/skin/port/py_26.ini", state = "ready", selected = [] } = {}) {
  const skinModel = { model, current: { state } }
  const calls = []
  const context = run(declarations(...DECLARATIONS), {
    document: { createElement: (tag) => new FakeElement(tag) },
    symbolSpan: () => new FakeElement("span"),
    preview: {
      setSelected: (sections) => calls.push(["set", sections]),
      onSelect: (sections) => calls.push(["select", sections]),
    },
    skinModel, computeLayout, containerOf, describeNode,
  })
  context.appState.layoutPath = layoutPath
  context.appState.selectedKeySections = selected
  return { context, container: new FakeElement("div"), skinModel, calls }
}

/** 根 → row:0 → group:1 → KEY1：三层，正好验证「第一层展开、更深的默认折叠」。 */
function layoutTree() {
  return {
    id: "",
    style: { display: Display.Flex, flexDirection: FlexDirection.Column, size: { width: "100%", height: "100%" } },
    children: [{
      id: "row:0",
      style: { display: Display.Flex, flexDirection: FlexDirection.Row },
      children: [{
        id: "group:1",
        style: { display: Display.Flex, flexDirection: FlexDirection.Row },
        children: [{ id: "KEY1", style: { size: { width: 100, height: 100 } } }],
      }],
    }],
  }
}

function boardOf({ id = "light/skin/port/py_26.ini", kind = "main", layout } = {}) {
  const geometry = layout ?? layoutTree()
  return {
    id, kind, theme: "light", orientation: "port", geometry: { kind: "document" },
    container: { kind: "known", size: { width: 300, height: 100 } },
    layout: geometry,
    keys: [{ id: "KEY1", layoutId: "KEY1", container: { fore: [] } }],
  }
}

test("布局树复用检查器的容器与组件，数据来自 Board.layout", () => {
  const html = read("index.html")
  assert.match(html, /<div id="layout-tree" class="ui-tree" hidden><\/div>/)
  assert.doesNotMatch(html, /<p class="ui-empty">布局树<\/p>/)
  const css = read("src/components.css")
  assert.match(css, /^\.ui-tree \{/m)
  assert.match(css, /\.ui-tree \.nav-group-body \{ padding-left: var\(--space-lg\); \}/)
  const panel = read(PANEL)
  assert.match(panel, /board\.layout/)
  assert.match(panel, /computeLayout\(board\.layout, size\)/)
  assert.match(panel, /containerOf\(board\)/)
  assert.match(panel, /describeNode\(node\)/)
  assert.doesNotMatch(panel, /IniDocument|openSkin|SkinArchive/)
  assert.match(read("src/app/source-panel.ts"), /if \(inLayout\) void renderLayoutTree\(layoutTree\)/)
  assert.match(read("src/app/key-inspector.ts"), /if \(!layoutTree\.hidden\) void renderLayoutTree\(layoutTree\)/)
})

test("布局树按层级生成可折叠分组，按键行带样式摘要与矩形", async () => {
  const board = boardOf()
  const { context, container } = harness({ boards: [board] })
  await context.renderLayoutTree(container)
  assert.equal(container.children.length, 1)
  const root = container.children[0]
  assert.equal(root.tagName, "details")
  assert.equal(root.className, "nav-group")
  assert.equal(root.open, true)
  assert.equal(root.children[0].className, "ui-list-item nav-section")
  const row = root.children[1].children[0]
  assert.equal(row.tagName, "details")
  assert.equal(row.open, true)
  const inner = row.children[1].children[0]
  assert.equal(inner.open, false, "更深的层默认折叠")
  const key = inner.children[1].children[0]
  assert.equal(key.tagName, "button")
  assert.equal(key.className, "ui-list-item nav-item")
  assert.equal(key.dataset.layoutNode, "KEY1")
  assert.equal(key.dataset.layoutSection, "KEY1")
  assert.equal(key.children[1].textContent, "KEY1")
  assert.ok(key.children[2].textContent.includes(describeNode(board.layout.children[0].children[0].children[0])))
  assert.match(key.children[2].textContent, /· \d+,\d+ \d+×\d+$/)
})

test("选中变化只更新 aria-selected，不重建节点", async () => {
  const { context, container } = harness({ boards: [boardOf()] })
  await context.renderLayoutTree(container)
  const root = container.children[0]
  const [key] = container.querySelectorAll("[data-layout-node]")
  assert.equal(key.attributes["aria-selected"], "false")
  context.appState.selectedKeySections = ["KEY1"]
  await context.renderLayoutTree(container)
  assert.equal(container.children[0], root)
  assert.equal(key.attributes["aria-selected"], "true")
})

test("点布局树里的按键与在画布上选中同一条链路", async () => {
  const { context, container, calls } = harness({ boards: [boardOf()] })
  await context.renderLayoutTree(container)
  const [key] = container.querySelectorAll("[data-layout-node]")
  key.listeners.click[0]()
  assert.deepEqual(calls.map(([kind, sections]) => [kind, [...sections]]), [["set", ["KEY1"]], ["select", ["KEY1"]]])
})

test("没有板、加载中、解析失败与空树分别显示 .ui-empty", async () => {
  const cases = [
    [{ boards: [] }, "ready", "这个文件没有布局"],
    [{ boards: [] }, "loading", "正在读取布局…"],
    [{ boards: [] }, "unavailable", "这份皮肤解析失败，布局不可用"],
    [{ boards: [boardOf({ layout: { id: "", style: { display: Display.Flex } } })] }, "ready", "这块板没有布局树"],
  ]
  for (const [model, state, text] of cases) {
    const { context, container } = harness(model, { state })
    await context.renderLayoutTree(container)
    assert.equal(container.children[0].className, "ui-empty")
    assert.equal(container.children[0].textContent, text)
  }
})

test("board.id 与 layoutPath 不同源时按 basename 或主键盘板回退", async () => {
  const ssf = harness({ boards: [boardOf({ id: "py_26@status2" })] }, { layoutPath: "light/skin/port/py_26.ini" })
  await ssf.context.renderLayoutTree(ssf.container)
  assert.equal(ssf.container.querySelectorAll("[data-layout-node]").length, 1)

  const bda = harness({ boards: [boardOf({ id: "light/port/KEYBOARD", kind: "main" })] }, { layoutPath: "light/skin/port/gen.ini" })
  await bda.context.renderLayoutTree(bda.container)
  assert.equal(bda.container.querySelectorAll("[data-layout-node]").length, 1)
})
