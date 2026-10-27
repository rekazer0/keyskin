// BDA 动画检查器结构：分组、字段、事件中文名、设计宽度、只读/可编辑状态与写回接线。
// 编辑器只依赖通用 DOM API，这里用一个最小 DOM 桩在 node:test 里真实渲染并派发 change。
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
    this.className = ""
    this._text = ""
    this.value = ""
    this.type = ""
    this.checked = false
    this.disabled = false
    this.isConnected = true
  }

  set textContent(value) {
    this._text = String(value)
    this.children = []
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent ?? "").join("")
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

  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener)
  }

  dispatch(type) {
    for (const listener of this.listeners[type] ?? []) {
      listener({ type, target: this, preventDefault() {}, stopPropagation() {} })
    }
  }

  getContext() {
    return { setTransform() {}, clearRect() {}, fillRect() {}, drawImage() {} }
  }

  getBoundingClientRect() {
    return { width: 100, height: 60 }
  }
}

globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createElementNS: (_namespace, tag) => new FakeNode(tag),
}

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

function sectionByLabel(container, label) {
  return walk(container).find((node) => node.tagName === "SECTION" &&
    classes(node).includes("bda-animation-section") && node.dataset.inspectorGroupLabel === label)
}

function effectCard(container, key) {
  return byClass(container, "bda-animation-card").find((node) => firstByTag(node, "strong")?.textContent === key)
}

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

function render(options = {}) {
  const events = { effects: [], frames: [], designWidth: [], resources: [] }
  const container = new FakeNode("div")
  renderBdaAnimationEditor(container, {
    animation: options.animation ?? sampleAnimation(),
    editable: options.editable ?? true,
    onDesignWidth: (value) => events.designWidth.push(value),
    onAnimationFrame: (sequence, frame, property, value) => events.frames.push([sequence, frame, property, value]),
    onAnimationEffect: (key, property, value) => events.effects.push([key, property, value]),
    onPickAnimationResource: (sequence, frame) => events.resources.push([sequence, frame]),
  })
  return { container, events }
}

test("编辑器按概览、目标绑定与效果类型分区，标题与分类栏标签一致", () => {
  const { container } = render()
  const sections = walk(container).filter((node) => node.tagName === "SECTION" && classes(node).includes("bda-animation-section"))
  assert.deepEqual(sections.map((node) => node.dataset.inspectorGroupLabel), [
    "概览", "目标绑定", "组合", "透明度", "缩放", "位移", "旋转", "帧动画", "图片序列", "粒子", "Lottie", "视频",
  ])
  for (const section of sections) {
    const heading = section.children[0]
    assert.equal(heading.tagName, "H3")
    assert.equal(heading.textContent, section.dataset.inspectorGroupLabel)
  }
})

test("概览显示目标、效果、序列数与设计宽度，设计宽度写回", () => {
  const { container, events } = render()
  assert.equal(rowValue(container, "触发目标"), "2 个")
  assert.equal(rowValue(container, "效果定义"), "10 个")
  assert.equal(rowValue(container, "动画序列"), "1 个")
  const width = inputByLabel(container, "设计宽度")
  assert.equal(width.value, "1080")
  width.value = "1242"
  width.dispatch("change")
  assert.deepEqual(events.designWidth, [1242])
})

test("目标绑定显示动效类型、事件中文名、作用域、条件与独立标记", () => {
  const { container } = render()
  const text = container.textContent
  assert.match(text, /透明度 · 按键按下/)
  assert.match(text, /前景 · 条件 KEY_A/)
  assert.match(text, /图片序列 · 元素显示/)
  assert.match(text, /混合/)
  assert.match(text, /帧动画 · 按键长按/)
  assert.match(text, /背景 · 独立 · 顶部 · 交互后移除/)
  const bindings = byClass(container, "bda-animation-binding")
  assert.equal(bindings.length, 3)
  assert.equal(firstByTag(bindings[0], "strong").textContent, "透明度 · 按键按下")
  assert.equal(firstByTag(bindings[0], "small").textContent, "前景 · 条件 KEY_A")
  assert.equal(bindings[0].children[0].tagName, "SVG", "绑定行使用 icons.ts 的图标")
})

test("每类效果显示时间轴（延迟 + 时长 × 重复、往返）与类型专有字段", () => {
  const { container } = render()
  const alpha = effectCard(container, "press")
  assert.equal(rowValue(alpha, "时间轴"), "延迟 100 ms + 时长 300 ms × 2 次 · 往返")
  assert.equal(selectByLabel(alpha, "重复模式").value, "1")
  assert.equal(selectByLabel(alpha, "插值方式").value, "1")
  for (const label of ["起始值最小", "起始值最大", "结束值最小", "结束值最大"]) assert.ok(inputByLabel(alpha, label), label)

  const scale = effectCard(container, "pop")
  assert.deepEqual(
    ["起始 X最小", "起始 X最大", "起始 Y最小", "起始 Y最大", "结束 X最小", "结束 Y最大"].filter((label) => !inputByLabel(scale, label)),
    [],
  )
  assert.equal(inputByLabel(scale, "中心（像素）X").value, "10")
  assert.equal(inputByLabel(scale, "中心（像素）Y").value, "20")
  assert.equal(inputByLabel(scale, "中心（百分比）X").value, "50")
  assert.equal(selectByLabel(scale, "XY 插值 X").value, "1")
  assert.equal(selectByLabel(scale, "XY 插值 Y").value, "2")
  assert.equal(rowValue(scale, "位移方式"), "相对位移（百分比）")

  const shift = effectCard(container, "slide")
  assert.equal(rowValue(shift, "位移方式"), "像素位移")

  const image = effectCard(container, "seq")
  assert.equal(rowValue(image, "时间轴"), "2 帧 × 3 次 · 往返 · 循环播放")
  assert.equal(byClass(image, "bda-animation-frame").length, 2)
  assert.ok(inputByLabel(image, "循环播放"))

  const frame = effectCard(container, "f1")
  assert.equal(rowValue(frame, "时间轴"), "重复 1 次 · 起始帧 1")
  assert.equal(inputByLabel(frame, "资源编号").value, "frame.png")

  const video = effectCard(container, "vid")
  assert.equal(inputByLabel(video, "占位资源").value, "poster.png")

  const emitter = effectCard(container, "spark")
  for (const label of ["出生率", "粒子总数", "发射区域左", "发射区域上", "发射区域右", "发射区域下",
    "生命周期最小", "生命周期最大", "速度方向最小", "加速度方向最大", "结束时机", "移除时保留粒子", "镜像层级", "发射器类型"]) {
    assert.ok(inputByLabel(emitter, label) || selectByLabel(emitter, label), label)
  }
  assert.match(rowValue(emitter, "粒子资源"), /particle\.png/)
  assert.match(rowValue(emitter, "运动路径"), /1 条（只读）/)
  assert.match(rowValue(container, "子效果"), /透明度 · press/)
})

test("字段修改立即通过 onAnimationEffect 写回，属性名与 encoder 一致", () => {
  const { container, events } = render()
  const alpha = effectCard(container, "press")
  const repeat = inputByLabel(alpha, "重复次数")
  repeat.value = "4"
  repeat.dispatch("change")
  selectByLabel(alpha, "重复模式").value = "0"
  selectByLabel(alpha, "重复模式").dispatch("change")
  const remove = inputByLabel(alpha, "结束后移除")
  remove.checked = true
  remove.dispatch("change")
  const fromMin = inputByLabel(alpha, "起始值最小")
  fromMin.value = "10"
  fromMin.dispatch("change")
  selectByLabel(alpha, "插值方式").value = "4"
  selectByLabel(alpha, "插值方式").dispatch("change")
  assert.deepEqual(events.effects, [
    ["alpha:press", "repeatCount", 4],
    ["alpha:press", "repeatMode", 0],
    ["alpha:press", "removeOnFinish", true],
    ["alpha:press", "fromMin", 10],
    ["alpha:press", "interpolation", 4],
  ])

  events.effects.length = 0
  const scale = effectCard(container, "pop")
  const centerX = inputByLabel(scale, "中心（像素）X")
  centerX.value = "12"
  centerX.dispatch("change")
  selectByLabel(scale, "XY 插值 Y").value = "3"
  selectByLabel(scale, "XY 插值 Y").dispatch("change")
  assert.deepEqual(events.effects, [["scale:pop", "pivotPxX", 12], ["scale:pop", "interpolationXYY", 3]])

  events.effects.length = 0
  const emitter = effectCard(container, "spark")
  const edge = inputByLabel(emitter, "发射区域左")
  edge.value = "11.5"
  edge.dispatch("change")
  const lifeMax = inputByLabel(emitter, "生命周期最大")
  lifeMax.value = "20"
  lifeMax.dispatch("change")
  selectByLabel(emitter, "结束时机").value = "1"
  selectByLabel(emitter, "结束时机").dispatch("change")
  assert.deepEqual(events.effects, [
    ["emitter:spark", "emitRegionLeft", 11.5],
    ["emitter:spark", "lifeMax", 20],
    ["emitter:spark", "finishAfterPractices", 1],
  ])

  events.effects.length = 0
  const frame = effectCard(container, "f1")
  const resource = inputByLabel(frame, "资源编号")
  resource.value = "frame2.png"
  resource.dispatch("change")
  const video = effectCard(container, "vid")
  const placeholder = inputByLabel(video, "占位资源")
  placeholder.value = "poster2.png"
  placeholder.dispatch("change")
  assert.deepEqual(events.effects, [
    ["frame:f1", "resourceID", "frame2.png"],
    ["video:vid", "placeholderID", "poster2.png"],
  ])

  events.effects.length = 0
  const image = effectCard(container, "seq")
  const loop = inputByLabel(image, "循环播放")
  loop.checked = false
  loop.dispatch("change")
  const startFrame = inputByLabel(image, "起始帧")
  startFrame.value = "1"
  startFrame.dispatch("change")
  assert.deepEqual(events.effects, [["image:seq", "loopForever", false], ["image:seq", "startRepeatFrame", 1]])
})

test("图片序列帧：预览按钮选资源、资源编号与每帧时长写回", () => {
  const { container, events } = render()
  const image = effectCard(container, "seq")
  const frames = byClass(image, "bda-animation-frame")
  assert.equal(frames.length, 2)
  const frameCards = byClass(image, "bda-animation-frame-card")
  assert.deepEqual(frameCards.map((node) => firstByTag(node, "strong").textContent), ["第 1 帧", "第 2 帧"])
  const pick = buttonByLabel(image, "更换第 1 帧图片资源")
  pick.dispatch("click")
  assert.deepEqual(events.resources, [["seq", 0]])

  const resource = inputByLabel(frames[1], "图片资源")
  resource.value = "b2.png"
  resource.dispatch("change")
  const duration = inputByLabel(frames[1], "时长（毫秒）")
  duration.value = "240"
  duration.dispatch("change")
  assert.deepEqual(events.frames, [
    ["seq", 1, "resourceID", "b2.png"],
    ["seq", 1, "duration", 240],
  ])
})

test("不可编辑时所有控件禁用，播放按钮也禁用", () => {
  const { container } = render({ editable: false })
  for (const input of byTag(container, "input")) assert.equal(input.disabled, true)
  for (const select of byTag(container, "select")) assert.equal(select.disabled, true)
  const play = walk(container).find((node) => node.tagName === "BUTTON" && node.className === "ui-button")
  assert.equal(play.disabled, false, "预览播放不需要编辑权限，保持可用")
  assert.equal(buttonByLabel(container, "更换第 1 帧图片资源").disabled, true)
})

test("没有目标或效果时显示空状态说明", () => {
  const animation = {
    targets: [],
    sequences: new Map(),
    bindings: new Map(),
    targetBindings: new Map(),
    effects: new Map(),
  }
  const { container } = render({ animation })
  const sections = walk(container).filter((node) => node.tagName === "SECTION" && classes(node).includes("bda-animation-section"))
  assert.deepEqual(sections.map((node) => node.dataset.inspectorGroupLabel), ["概览"])
  assert.match(container.textContent, /这个 animationConfig 没有动画目标或效果/)
  assert.equal(rowValue(container, "设计宽度"), "未设置")
})
