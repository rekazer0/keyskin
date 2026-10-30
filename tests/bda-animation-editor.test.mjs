// BDA 动画检查器：动效设计 / 粒子设计的列表、选中效果的分组、字段写回、目标绑定与只读状态。
// 编辑器只依赖通用 DOM API，这里用一个最小 DOM 桩在 node:test 里真实渲染并派发事件。
import assert from "node:assert/strict"
import test from "node:test"
import { renderBdaAnimationEditor } from "../src/bda-animation-editor.ts"

class FakeNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase()
    this.children = []
    this.attributes = {}
    this.dataset = {}
    this.listeners = {}
    this.style = {}
    this.className = ""
    this._text = ""
    this.value = ""
    this.type = ""
    this.checked = false
    this.disabled = false
    this.hidden = false
    this.isConnected = true
  }

  set textContent(value) {
    this._text = String(value)
    this.children = []
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent ?? "").join("")
  }

  get firstElementChild() {
    return this.children[0] ?? null
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === "string") this._text += node
      else {
        node.parentElement = this
        this.children.push(node)
      }
    }
  }

  appendChild(node) {
    this.append(node)
    return node
  }

  replaceChildren(...nodes) {
    this.children = []
    this._text = ""
    this.append(...nodes)
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }

  toggleAttribute(name, force) {
    if (force ?? !(name in this.attributes)) this.attributes[name] = ""
    else delete this.attributes[name]
  }

  matches(selector) {
    if (selector.startsWith(".")) return classes(this).includes(selector.slice(1))
    const data = /^\[data-([a-z-]+)\]$/.exec(selector)?.[1]
    return Boolean(data && data.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) in this.dataset)
  }

  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches?.(selector)) return node
    return null
  }

  querySelectorAll(selector) {
    return walk(this).filter((node) => node.matches?.(selector))
  }

  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener)
  }

  dispatch(type, init = {}) {
    for (const listener of this.listeners[type] ?? []) {
      listener({ type, target: this, preventDefault() {}, stopPropagation() {}, ...init })
    }
  }

  getContext() {
    return new Proxy({}, { get: () => () => {} })
  }

  getBoundingClientRect() {
    return { left: 0, width: 100, height: 60 }
  }
}

globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createElementNS: (_namespace, tag) => new FakeNode(tag),
}
globalThis.Option = function Option(text, value) {
  return Object.assign(new FakeNode("option"), { textContent: text, value })
}
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" })
globalThis.requestAnimationFrame = () => 0
globalThis.cancelAnimationFrame = () => {}

function walk(node, output = []) {
  for (const child of node.children ?? []) {
    output.push(child)
    walk(child, output)
  }
  return output
}

const classes = (node) => (node.className ?? "").split(/\s+/).filter(Boolean)
const byClass = (root, name) => walk(root).filter((node) => classes(node).includes(name))
const byTag = (root, tag) => walk(root).filter((node) => node.tagName === tag.toUpperCase())
const firstByTag = (root, tag) => byTag(root, tag)[0]
const inputByLabel = (root, label) => walk(root).find((node) => node.tagName === "INPUT" && node.getAttribute("aria-label") === label)
const selectByLabel = (root, label) => walk(root).find((node) => node.tagName === "SELECT" && node.getAttribute("aria-label") === label)
const buttonByLabel = (root, label) => walk(root).find((node) => node.tagName === "BUTTON" && node.getAttribute("aria-label") === label)
const sections = (container) => container.children.filter((node) => node.tagName === "SECTION")
const sectionLabels = (container) => sections(container).map((node) => node.dataset.inspectorGroupLabel)
const section = (container, label) => sections(container).find((node) => node.dataset.inspectorGroupLabel === label)
const options = (container) => walk(container).filter((node) => node.getAttribute("role") === "option")

function rowByLabel(container, label) {
  return walk(container).find((node) => classes(node).includes("ui-field") && node.children[0]?.textContent === label)
}

function rowValue(container, label) {
  return rowByLabel(container, label)?.children[1]?.textContent
}

function sampleAnimation() {
  const sequence = { name: "seq", frames: [{ resourceID: "a.png", duration: 100 }, { resourceID: "b.png", duration: 120 }] }
  return {
    designWidth: 1080,
    targets: ["KEY_A", "KEY_B"],
    sequences: new Map([["seq", sequence]]),
    bindings: new Map([["KEY_A", "seq"]]),
    targetBindings: new Map([
      ["KEY_A", [
        { kind: "alpha", key: "press", scope: 0, event: 1, isolated: false, condition: "KEY_A" },
        { kind: "image", key: "seq", scope: 2, event: 3, isolated: false },
      ]],
      ["KEY_B", [
        { kind: "frame", key: "f1", scope: 1, event: 7, isolated: true, location: 0, removeOnInteraction: true },
      ]],
    ]),
    effects: new Map([
      ["group:g1", {
        kind: "group", key: "g1", buildMode: 0, repeatCount: 1, repeatMode: 0,
        removeOnFinish: false, delay: 0, items: [{ kind: "alpha", key: "press" }],
      }],
      ["alpha:press", {
        kind: "alpha", key: "press", repeatCount: 2, repeatMode: 1, delay: 100,
        removeOnFinish: false, duration: 300, interpolation: 1,
        from: [[0, 100], [0, 100]], to: [[20, 100], [20, 100]], relative: false,
      }],
      ["scale:pop", {
        kind: "scale", key: "pop", repeatCount: 1, repeatMode: 0, delay: 0,
        removeOnFinish: false, duration: 500, interpolation: 3,
        from: [[50, 100], [50, 100]], to: [[100, 120], [100, 120]], relative: true,
        pivotPx: [10, 20], pivot: [50, 50], interpolationXY: [1, 2],
      }],
      ["shift:slide", {
        kind: "shift", key: "slide", repeatCount: 1, repeatMode: 0, delay: 0,
        removeOnFinish: false, duration: 200, interpolation: 0,
        from: [[0, 10], [0, 20]], to: [[10, 20], [20, 40]], relative: false,
        interpolationXY: [0, 4],
      }],
      ["rotate:spin", {
        kind: "rotate", key: "spin", repeatCount: 1, repeatMode: 0, delay: 0,
        removeOnFinish: true, duration: 250, interpolation: 2,
        from: [[0, 0], [0, 0]], to: [[90, 90], [90, 90]], relative: false,
        pivotPx: [4, 6], pivot: [50, 50],
      }],
      ["frame:f1", {
        kind: "frame", key: "f1", repeatCount: 1, removeOnFinish: true,
        resource: { type: 3, resourceID: "frame.png" }, startRepeatFrame: 1,
      }],
      ["lottie:lo", {
        kind: "lottie", key: "lo", repeatCount: 2, removeOnFinish: false,
        resource: { type: 9, resourceID: "lottie.json" },
      }],
      ["video:vid", {
        kind: "video", key: "vid", repeatCount: 1, removeOnFinish: false,
        resource: { type: 6, resourceID: "clip.mp4" }, startRepeatFrame: 0,
        placeholder: { type: 6, resourceID: "poster.png" },
      }],
      ["image:seq", {
        kind: "image", key: "seq", repeatCount: 3, repeatMode: 1, removeOnFinish: false,
        loopForever: true, startRepeatFrame: 0, sequence,
      }],
      ["emitter:spark", {
        kind: "emitter", key: "spark", repeatCount: 1, repeatMode: 0, removeOnFinish: true,
        duration: 1500, birthRate: 20, totalNumber: 30, emitRegion: [1, 2, 3, 4],
        resources: [{ type: 1, resourceID: "particle.png" }],
        life: [10, 15], rotation: [-45, 45], spin: [0, 90], scale: [50, 150],
        scaleSpeed: [-10, 10], alpha: [100, 100], alphaSpeed: [-5, 5],
        velocity: [0, 200], velocityDirection: [0, 360], acceleration: [0, 50],
        accelerationDirection: [-180, 180], finishAfterPractices: 0,
        keepParticlesOnRemove: 1, mirrorUp: 0, emitterType: 2,
        paths: [{ elements: [{ type: 0, point1: [0, 0] }] }],
      }],
    ]),
  }
}

function render({ animation = sampleAnimation(), mode = "motion", selected, editable = true } = {}) {
  const events = { effects: [], frames: [], designWidth: [], resources: [], selected: [], items: [] }
  const container = new FakeNode("div")
  renderBdaAnimationEditor(container, {
    animation,
    path: "light/skin/port/animationConfig",
    view: {
      mode,
      select: (items) => {
        events.items = items
        return selected ?? items[0]?.id
      },
      onSelect: (id) => events.selected.push(id),
      filter: (items) => ({ items }),
      keyUses: () => [],
    },
    editable,
    onDesignWidth: (value) => events.designWidth.push(value),
    onAnimationFrame: (sequence, frame, property, value) => events.frames.push([sequence, frame, property, value]),
    onAnimationEffect: (key, property, value) => events.effects.push([key, property, value]),
    onPickAnimationResource: (sequence, frame) => events.resources.push([sequence, frame]),
  })
  return { container, events }
}

const change = (node, value) => {
  if (node.type === "checkbox") node.checked = value
  else node.value = String(value)
  node.dispatch("change")
}

test("动效设计列出粒子以外的效果，粒子设计只列粒子；行里是名称、类型、时间与使用次数", () => {
  const motion = render()
  assert.deepEqual(motion.events.items.map((item) => item.id), [
    "group:g1", "alpha:press", "scale:pop", "shift:slide", "rotate:spin", "frame:f1", "image:seq", "lottie:lo", "video:vid",
  ])
  const press = motion.events.items.find((item) => item.id === "alpha:press")
  assert.deepEqual([press.title, press.kind, press.detail, press.uses], ["press", "透明度", "延迟 100 · 300 ms × 2 · 往返", 2])
  assert.equal(motion.events.items.find((item) => item.id === "image:seq").detail, "2 帧 · 循环 · 往返")
  assert.equal(options(motion.container).length, 9)
  assert.equal(options(motion.container)[0].getAttribute("aria-selected"), "true")
  const particle = render({ mode: "particle" })
  assert.deepEqual(particle.events.items.map((item) => item.id), ["emitter:spark"])
  assert.equal(render({ mode: "all" }).events.items.length, 10)
})

test("点击或方向键切换选中效果，选择交给调用方保存", () => {
  const { container, events } = render({ selected: "alpha:press" })
  const list = walk(container).find((node) => node.getAttribute("role") === "listbox")
  list.dispatch("click", { target: options(container)[2] })
  list.dispatch("keydown", { key: "ArrowDown" })
  list.dispatch("keydown", { key: "Home" })
  assert.deepEqual(events.selected, ["scale:pop", "scale:pop", "group:g1"])
})

test("选中的效果按 列表 → 预览 → 引用 → 参数 分组，标题与分类栏标签一致", () => {
  assert.deepEqual(sectionLabels(render({ selected: "alpha:press" }).container), ["动效", "预览", "引用", "变化", "时间与循环"])
  assert.deepEqual(sectionLabels(render({ selected: "scale:pop" }).container), ["动效", "预览", "引用", "变化", "时间与循环", "变换中心"])
  assert.deepEqual(sectionLabels(render({ selected: "group:g1" }).container), ["动效", "预览", "引用", "组合", "时间与循环"])
  assert.deepEqual(sectionLabels(render({ selected: "image:seq" }).container), ["动效", "预览", "引用", "帧序列", "时间与循环"])
  assert.deepEqual(sectionLabels(render({ selected: "video:vid" }).container), ["动效", "预览", "引用", "资源", "时间与循环"])
  const { container } = render({ mode: "particle" })
  assert.deepEqual(sectionLabels(container), ["粒子", "预览", "引用", "发射", "运动", "外观", "时间与循环"])
  for (const node of sections(container)) assert.ok(node.children[0].textContent.startsWith(node.dataset.inspectorGroupLabel))
  assert.equal(byClass(container, "ui-animation-player").length, 1, "预览分组里是播放器")
})

test("字段修改立即通过 onAnimationEffect 写回，属性名与 encoder 一致", () => {
  const alpha = render({ selected: "alpha:press" })
  change(inputByLabel(alpha.container, "重复次数"), 4)
  change(selectByLabel(alpha.container, "重复模式"), 0)
  change(inputByLabel(alpha.container, "结束后移除"), true)
  change(inputByLabel(alpha.container, "起始值（0–255）最小"), 10)
  change(selectByLabel(alpha.container, "插值方式"), 4)
  assert.deepEqual(alpha.events.effects, [
    ["alpha:press", "repeatCount", 4],
    ["alpha:press", "repeatMode", 0],
    ["alpha:press", "removeOnFinish", true],
    ["alpha:press", "fromMin", 10],
    ["alpha:press", "interpolation", 4],
  ])

  const scale = render({ selected: "scale:pop" })
  assert.equal(inputByLabel(scale.container, "中心（像素）Y").value, "20")
  assert.equal(selectByLabel(scale.container, "XY 插值 X").value, "1")
  assert.equal(rowValue(scale.container, "位移方式"), undefined, "缩放没有位移方式")
  change(inputByLabel(scale.container, "中心（像素）X"), 12)
  change(selectByLabel(scale.container, "XY 插值 Y"), 3)
  assert.deepEqual(scale.events.effects, [["scale:pop", "pivotPxX", 12], ["scale:pop", "interpolationXYY", 3]])
  assert.equal(rowValue(render({ selected: "shift:slide" }).container, "位移方式"), "像素")

  const emitter = render({ mode: "particle" })
  change(inputByLabel(emitter.container, "发射区域左"), 11.5)
  change(inputByLabel(emitter.container, "生命周期（ms）最大"), 20)
  change(selectByLabel(emitter.container, "结束时机"), 1)
  assert.deepEqual(emitter.events.effects, [
    ["emitter:spark", "emitRegionLeft", 11.5],
    ["emitter:spark", "lifeMax", 20],
    ["emitter:spark", "finishAfterPractices", 1],
  ])
  // 粒子资源是只读的图片卡片
  assert.match(inputByLabel(emitter.container, "粒子资源").value, /particle\.png/)
  assert.equal(inputByLabel(emitter.container, "粒子资源").disabled, true)
  assert.match(rowValue(emitter.container, "运动路径"), /1 条（只读）/)

  const frame = render({ selected: "frame:f1" })
  change(inputByLabel(frame.container, "资源编号"), "frame2.png")
  const video = render({ selected: "video:vid" })
  change(inputByLabel(video.container, "占位资源"), "poster2.png")
  const image = render({ selected: "image:seq" })
  change(inputByLabel(image.container, "循环播放"), false)
  change(inputByLabel(image.container, "起始帧"), 1)
  assert.deepEqual([...frame.events.effects, ...video.events.effects, ...image.events.effects], [
    ["frame:f1", "resourceID", "frame2.png"],
    ["video:vid", "placeholderID", "poster2.png"],
    ["image:seq", "loopForever", false],
    ["image:seq", "startRepeatFrame", 1],
  ])
})

test("组合列出子效果与时间，增删暂不支持时说明原因", () => {
  const { container, events } = render({ selected: "group:g1" })
  const combo = section(container, "组合")
  assert.match(combo.textContent, /press · 透明度/)
  assert.match(combo.textContent, /暂不支持/)
  change(selectByLabel(combo, "组合方式"), 1)
  assert.deepEqual(events.effects, [["group:g1", "buildMode", 1]])
})

test("引用分组列出触发目标、事件中文名、作用域、条件与独立标记，也列出所在的组合", () => {
  const uses = (selected) => section(render({ selected }).container, "引用").textContent
  assert.match(uses("alpha:press"), /KEY_A · 按键按下前景 · 条件 KEY_A/)
  assert.match(uses("alpha:press"), /组合 g1作为组合的子效果播放/)
  assert.match(uses("image:seq"), /KEY_A · 元素显示前景与背景/)
  assert.match(uses("frame:f1"), /KEY_B · 按键长按背景 · 独立 · 顶部 · 交互后移除/)
  assert.match(uses("lottie:lo"), /还没有样式播放/)
})

test("图片序列帧：图片卡片选资源、资源编号与每帧时长写回", () => {
  const { container, events } = render({ selected: "image:seq" })
  const frames = byClass(container, "bda-animation-frame-card")
  assert.equal(frames.length, 2)
  assert.deepEqual(frames.map((node) => firstByTag(node, "span").textContent), ["第 1 帧", "第 2 帧"])
  buttonByLabel(container, "选择第 1 帧").dispatch("click")
  assert.deepEqual(events.resources, [["seq", 0]])
  change(inputByLabel(frames[1], "第 2 帧"), "b2.png")
  change(inputByLabel(frames[1], "时长（毫秒）"), 240)
  assert.deepEqual(events.frames, [
    ["seq", 1, "resourceID", "b2.png"],
    ["seq", 1, "duration", 240],
  ])
})

test("设计宽度在列表下方，修改写回", () => {
  const { container, events } = render()
  const width = inputByLabel(section(container, "动效"), "设计宽度")
  assert.equal(width.value, "1080")
  change(width, 1242)
  assert.deepEqual(events.designWidth, [1242])
})

test("不可编辑时所有字段禁用，预览播放不需要编辑权限", async () => {
  const { container } = render({ editable: false })
  for (const input of byTag(container, "input").filter((node) => node.type !== "range")) assert.equal(input.disabled, true)
  for (const select of byTag(container, "select")) assert.equal(select.disabled, true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(buttonByLabel(container, "播放预览").disabled, false)
  assert.equal(buttonByLabel(render({ selected: "image:seq", editable: false }).container, "选择第 1 帧").disabled, true)
})

test("没有效果时列表显示空状态，不渲染预览与参数", () => {
  const animation = { targets: [], sequences: new Map(), bindings: new Map(), targetBindings: new Map(), effects: new Map() }
  const { container } = render({ animation })
  assert.deepEqual(sectionLabels(container), ["动效"])
  assert.match(container.textContent, /这份配置里没有动效/)
  assert.equal(rowValue(container, "设计宽度"), "未设置")
})
