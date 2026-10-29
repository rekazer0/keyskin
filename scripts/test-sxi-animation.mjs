// 手心 (.sxi) 动画检查器：打开一份带全部 9 类动画的皮肤，从列表选中每一个动画，像用户一样读写分组字段、
// 组合轨道与浮动物体；检查 skin.json（及其导出的 anim.ini）、撤销重做、改动标记与重置、筛选、只读模式，
// 以及新建 / 复制 / 删除，并确认没有页面错误。
import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { sxiAnimationFixture } from "../tests/helpers/sxi-animation-fixture.mjs"
import { SkinArchive } from "../src/skin.ts"
import { sxiBaiduFiles } from "../src/palm/sxi-to-baidu.ts"

const fixture = sxiAnimationFixture()
const server = await createServer({ root: new URL("..", import.meta.url).pathname, logLevel: "error", server: { port: 41835, strictPort: false, host: "127.0.0.1", hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
page.on("dialog", (dialog) => dialog.accept())

const baseURL = `http://127.0.0.1:${server.httpServer.address().port}/`
const animationPath = "skin.json/default/s_info/ss_2"
const fields = page.locator("#document-fields")

async function open(readonly = false) {
  await page.goto(baseURL)
  await page.locator("#browser-open").setInputFiles({ name: "animation.sxi", mimeType: "application/octet-stream", buffer: fixture })
  await page.waitForFunction(() => !document.querySelector("#open").disabled)
  const close = page.locator("#file-operation-dialog[open] #file-operation-close")
  if (await close.isVisible().catch(() => false)) await close.click()
  if (!readonly) await page.getByRole("button", { name: "编辑模式", exact: true }).click()
  await page.evaluate(async (path) => {
    const { selectFile } = await import("/src/app/navigation.ts")
    selectFile(path)
  }, animationPath)
  await page.waitForFunction(() => document.querySelectorAll("#document-fields [data-animation-id]").length === 10)
  // 检查器在渲染末尾拍一次基线（改动标记/重置依赖它），等它完成后再操作。
  await page.waitForTimeout(400)
}

/** 在列表里选中一个动画；只有选中的动画会展开参数。 */
async function show(id) {
  const option = fields.locator(`[data-animation-id="${id}"]`)
  if (await option.getAttribute("aria-selected") !== "true") await option.click()
  await page.waitForFunction((id) => document.querySelector(`#document-fields [data-animation-id="${id}"]`)?.getAttribute("aria-selected") === "true"
    && document.querySelector('#document-fields [data-inspector-group-label="预览"] .document-section-code')?.textContent.startsWith(`动画 ${id} ·`), id)
}
const section = (label) => fields.locator(`:scope > section[data-inspector-group-label="${label}"]`)
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const captionOf = (label) => page.locator(".document-field-caption").filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) })
const row = (label) => fields.locator(".document-property-field").filter({ has: captionOf(label) })
// 有自然范围的数值行左边是滑块，右边才是数值输入框。
const input = (label) => row(label).locator('input:not([type="range"])').first()
const pressed = (label) => row(label).locator(".ui-segmented button[aria-pressed='true']")
const captions = () => fields.locator(".document-field-caption").allTextContents()
const read = () => page.evaluate(async () => {
  const { appState } = await import("/src/app/state.ts")
  return { skin: JSON.parse(appState.archive.getText("skin.json")) }
})
/** The anim.ini the edited skin.json exports as to Baidu. */
const exportedAnim = async () => sxiBaiduFiles((await read()).skin).get("light/skin/res/anim.ini")
const animation = async (id) => (await read()).skin.default.s_info.ss_2[String(id)]
const change = async (locator, value) => {
  await locator.fill(value)
  await locator.press("Enter")
}
const waitFor = (id, field, expected) => page.waitForFunction(async ({ id, field, expected }) => {
  const { appState } = await import("/src/app/state.ts")
  const wrap = JSON.parse(appState.archive.getText("skin.json")).default.s_info.ss_2[id]
  const parts = field.split(".")
  let value = wrap
  for (const part of parts) value = value?.[part]
  return JSON.stringify(value) === JSON.stringify(expected)
}, { id, field, expected })
const reset = async () => {
  await page.locator(".inspector-reset").click()
  await page.waitForTimeout(100)
}

try {
  await open()
  const original = (await read()).skin.default.s_info.ss_2

  // 入口、对象头与列表
  assert.deepEqual(await page.locator(`.sidebar-overview button[data-path="${animationPath}"] .nav-label`).allTextContents(), ["动效设计", "粒子设计"])
  assert.equal(await page.locator("#selected-key").textContent(), "动画与动效")
  assert.match(await page.locator("#selected-key-context").textContent(), /skin\.json · s_info\.ss_2/)
  // 行里第一行是名称，第二行是类型、引用次数两个标签和时间摘要。
  assert.deepEqual(await fields.locator("[data-animation-id] strong").allTextContents(), [
    "动画 100", "动画 101", "动画 102", "动画 103", "动画 104", "动画 105", "动画 106", "动画 107", "动画 108", "动画 109",
  ])
  assert.deepEqual(await fields.locator("[data-animation-id] .ui-list-item-meta > .ui-badge:first-child").allTextContents(), [
    "缩放", "位移", "组合动画", "帧序列", "粒子发射", "路径跟踪", "碰撞物理", "液体与浮动物", "底部嘉年华", "太空兔",
  ])
  assert.equal(await fields.locator('[data-animation-id="100"] small').textContent(), "320 ms · 往返")
  assert.equal(await fields.locator('[data-animation-id="100"] [data-uses]').textContent(), "2", "被一个样式和一个组合使用")
  assert.deepEqual(await page.locator("#mobile-inspector-groups button").allTextContents(), ["动画", "预览", "引用", "变化", "时间与循环", "变换中心"])

  // 每类动画的字段都按手心自己的名字出现
  await show("100")
  assert.match(await section("预览").locator(".ui-animation-time").textContent(), /320 ms/)
  assert.match(await section("引用").textContent(), /样式 9001按下时播放/)
  assert.match(await section("引用").textContent(), /动画 102作为组合动画的一部分播放/)
  assert.ok((await captions()).includes("变化属性"))
  assert.ok((await captions()).includes("起始缩放（%）"))
  assert.equal(await pressed("变化属性").textContent(), "缩放")
  assert.equal(await input("持续时间").inputValue(), "160")
  assert.equal(await row("位移单位").count(), 0, "位移单位只属于位移")

  await show("101")
  assert.match(await section("引用").textContent(), /动画 102作为组合动画的一部分播放/)
  assert.match(await section("变化").textContent(), /切换单位只保留数值/)
  assert.equal(await pressed("位移单位").textContent(), "像素")
  assert.ok((await captions()).includes("起始位移（px）"))

  await show("102")
  assert.match(await section("引用").textContent(), /样式 9001显示时播放/)
  assert.equal(await fields.locator(".animation-combo-item").count(), 2)
  assert.equal(await fields.locator(".animation-combo-item .ui-list-item-text").first().textContent(), "动画 100缩放 · 320 ms")
  assert.equal(await pressed("组合方式").textContent(), "同时")
  assert.equal(await section("预览").locator(".ui-animation-lane").count(), 2, "组合的每个子动画在时间轴上一行")

  await show("103")
  assert.equal(await row("帧修改方式").locator("select").inputValue(), "1")
  assert.equal(await input("图片序列").inputValue(), "press.webp")
  assert.equal(await input("三段播放速率").inputValue(), "0.5,1,1.5")
  assert.match(await section("预览").locator(".ui-animation-time").textContent(), /1500 ms/)

  await show("104")
  assert.deepEqual(await page.locator("#mobile-inspector-groups button").allTextContents(), ["动画", "预览", "引用", "发射", "运动", "外观", "时间与循环"])
  assert.ok((await captions()).includes("发射区域位置"))
  assert.equal(await input("粒子总数").inputValue(), "12")
  // 粒子图片是样式卡片（每张图一张卡，标签旁有「+ 添加」），值仍是样式编号列表。
  assert.equal(await fields.locator('input[aria-label="粒子图片"]').first().inputValue(), "7,8")
  assert.equal(await row("粒子图片添加").locator(".style-reference-row").count(), 2)

  await show("105")
  assert.equal(await row("路径模式").locator("select").inputValue(), "3")
  // LEVEL 缺失时手心按上层处理，检查器不能显示成下层。
  assert.equal(await row("显示层级").locator("select").inputValue(), "1")
  assert.equal(await input("空闲恢复间隔").inputValue(), "500")
  assert.match(await section("预览").textContent(), /暂不支持桌面预览/, "特殊动效明确说明，不用示意动画代替")

  await show("106")
  assert.equal(await input("碰撞区域位置").inputValue(), "1")
  assert.equal(await row("碰撞区域尺寸").locator("input").nth(1).inputValue(), "40")
  assert.equal(await input("重力").inputValue(), "980")

  await show("107")
  assert.equal(await input("液体颜色").getAttribute("type"), "color")
  assert.equal(await fields.locator(".animation-floater").count(), 1)
  assert.equal(await section("浮动物体").locator(".document-section-code").textContent(), "1 个")

  await show("108")
  assert.equal(await input("循环帧模板").inputValue(), "element%d_loop.webp")
  assert.equal(await input("物件数量").inputValue(), "7")
  assert.equal(await input("跳跃时长").inputValue(), "620")

  await show("109")
  assert.equal(await input("背景图片").inputValue(), "rabbit_background.png")
  assert.equal(await input("掉落物模板").inputValue(), "falling_element_%d.png")
  assert.equal(await input("掉落时长").inputValue(), "1000")

  // 数值编辑：写回 skin.json、进入撤销栈，并出现改动标记；皮肤包里不生成 anim.ini
  await show("100")
  await change(input("持续时间"), "320")
  await waitFor("100", "a1.duration", 320)
  assert.match(await exportedAnim(), /\[ANIM100\][\s\S]*DURATION=320/)
  assert.equal(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.archive.getBytes("light/skin/res/anim.ini")), undefined)
  assert.equal(await page.locator(".inspector-changes").textContent(), "已改 1")
  assert.ok(await section("时间与循环").locator("h3[data-modified]").count())
  await page.evaluate(async () => { const history = await import("/src/app/edit-history.ts"); history.undo() })
  await waitFor("100", "a1.duration", 160)
  await page.evaluate(async () => { const history = await import("/src/app/edit-history.ts"); history.redo() })
  await waitFor("100", "a1.duration", 320)
  assert.equal(await fields.locator('[data-animation-id="100"]').getAttribute("aria-selected"), "true", "撤销重做后仍是同一个动画")

  // 变化属性切换：from/to 在标量、比例点、像素点三种写法间互斥转换
  await row("变化属性").getByRole("button", { name: "透明度", exact: true }).click()
  await waitFor("100", "a1.b.t", 0)
  let a1 = (await animation(100)).a1
  assert.deepEqual([a1.from, a1.to], [255, 0])
  assert.equal(a1.from_p, undefined, "scalar type drops the percent points")
  assert.match(await exportedAnim(), /\[ANIM100\][\s\S]*FROM=255[\s\S]*TO=0/)
  await row("变化属性").getByRole("button", { name: "位移", exact: true }).click()
  await waitFor("100", "a1.b.t", 2)
  a1 = (await animation(100)).a1
  assert.deepEqual([a1.from_p, a1.to_p], [[0, 0], [0, 0]])
  assert.equal(a1.from, undefined, "point type drops the scalar values")
  // 重置：时长、类型与起止值的写法一起回到打开时
  await reset()
  await waitFor("100", "a1", original["100"].a1)

  // 位移单位：比例 ↔ 像素；单位切换并编辑后重置不残留另一套起止值
  await show("101")
  await row("位移单位").getByRole("button", { name: "比例", exact: true }).click()
  await waitFor("101", "a1.from_p", [0, 0])
  assert.equal((await animation(101)).a1.from_px, undefined)
  await change(row("起始比例").locator("input").first(), "12")
  await waitFor("101", "a1.from_p", [12, 0])
  await row("位移单位").getByRole("button", { name: "像素", exact: true }).click()
  await waitFor("101", "a1.from_px", [12, 0])
  assert.equal((await animation(101)).a1.from_p, undefined)
  await row("自动往返").locator("input").check()
  await waitFor("101", "a1.b.back", true)
  assert.match(await exportedAnim(), /\[ANIM101\][\s\S]*REPEAT_MODE=1/)
  await reset()
  await waitFor("101", "a1", original["101"].a1)

  // 成对数值、颜色、枚举
  await show("103")
  await change(row("画面偏移").locator("input").first(), "4")
  await waitFor("103", "af2.pos", [4, 3])
  assert.match(await exportedAnim(), /\[ANIM103\][\s\S]*OFFSET=4,3/)
  // 三段速率的错误输入不能进入皮肤；修正后可写回。
  await change(input("三段播放速率"), "1,2")
  assert.deepEqual((await animation(103)).af2.psr, [0.5, 1, 1.5])
  assert.equal(await input("三段播放速率").evaluate((field) => field.validity.valid), false)
  await change(input("三段播放速率"), "1,2,3")
  await waitFor("103", "af2.psr", [1, 2, 3])
  await show("105")
  await row("显示层级").locator("select").selectOption("0")
  await waitFor("105", "a10.l", 0)

  // 每类动效至少改一项，并验证矩形尺寸、负数和未知字段不会丢失。
  await show("104")
  await change(input("发射速率"), "8")
  await waitFor("104", "a4.rate", 8)
  await show("106")
  await change(row("碰撞区域尺寸").locator("input").nth(0), "60")
  await waitFor("106", "a11.collision_rect", [[1, 2], [60, 40]])
  assert.match(await exportedAnim(), /COLLISION_RECT=1,2,61,42/)
  await show("109")
  await change(input("掉落起点偏移"), "-20")
  await waitFor("109", "a14.fallStartOffsetPx", -20)

  // Shift 连续调值合并为一步撤销，复用检查器通用数值手势。
  await show("108")
  await change(input("跳跃时长"), "800")
  await waitFor("108", "a13.jumpDurationMs", 800)
  const historySize = () => page.evaluate(async () => (await import('/src/app/state.ts')).appState.undoStack.length)
  const beforeGesture = await historySize()
  await input("跳跃时长").focus()
  await input("跳跃时长").press("Shift+ArrowUp")
  await input("跳跃时长").press("Shift+ArrowUp")
  await input("跳跃时长").press("Tab")
  await waitFor("108", "a13.jumpDurationMs", 820)
  assert.equal(await historySize(), beforeGesture + 1)
  await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
  await waitFor("108", "a13.jumpDurationMs", 800)

  // 组合轨道：改播放方式、追加/上移/移除子动画；候选不能引用自身；重置恢复整个列表
  await show("102")
  const comboOptions = await fields.getByLabel("添加子动画", { exact: true }).locator("option").allTextContents()
  assert.ok(!comboOptions.includes("动画 102"), "a combination must not be able to add itself")
  await row("组合方式").getByRole("button", { name: "顺序", exact: true }).click()
  await waitFor("102", "a3.a_method", "sequential")
  assert.deepEqual((await animation(102)).a3.method, { sequential: {} })
  await fields.getByLabel("添加子动画", { exact: true }).selectOption("109")
  await waitFor("102", "a3.animations", [100, 101, 109])
  await fields.getByRole("button", { name: "上移动画 109", exact: true }).click()
  await waitFor("102", "a3.animations", [100, 109, 101])
  await fields.getByRole("button", { name: "移除动画 100", exact: true }).click()
  await waitFor("102", "a3.animations", [109, 101])
  await reset()
  await waitFor("102", "a3", original["102"].a3)

  // 浮动物体：改颜色、加一个、改文件名、删掉新的和原有的，重置后全部回来
  await show("107")
  await change(page.locator('input[aria-label="液体颜色色值"]'), "#FF8800")
  await waitFor("107", "a12.surface_color", "#FF8800")
  await fields.getByRole("button", { name: "添加浮动物体", exact: true }).click()
  await waitFor("107", "a12.floaters.1.file", "")
  const secondFloater = fields.locator(".animation-floater").nth(1)
  assert.equal(await secondFloater.locator("h4").textContent(), "物体 2")
  await change(secondFloater.locator(".document-property-field").filter({ has: captionOf("图片文件") }).locator("input"), "snow.png")
  await waitFor("107", "a12.floaters.1.file", "snow.png")
  assert.equal((await animation(107)).a12.floaters[1].ride, undefined)
  await fields.getByRole("button", { name: "删除物体 2", exact: true }).click()
  await fields.getByRole("button", { name: "删除物体 1", exact: true }).click()
  await waitFor("107", "a12.floaters", [])

  // 保存原生 SXI 后重新打开，所有编辑值及未暴露的字段必须原样保留。
  const saved = await page.evaluate(async () => Array.from((await import('/src/app/state.ts')).appState.archive.toBytes('sxi')))
  const reopened = SkinArchive.open(new Uint8Array(saved), 'sxi')
  assert.deepEqual(JSON.parse(reopened.getText('skin.json')), (await read()).skin)

  assert.ok(await page.locator(".inspector-reset").isVisible())
  await reset()
  await waitFor("107", "a12", original["107"].a12)
  assert.equal(await page.locator(".inspector-reset").isHidden(), true)

  // 删除缺省键后按有效默认值显示，打开检查器本身不能物化这些键。
  await page.evaluate(async () => {
    const { editSxi } = await import('/src/app/sxi-fields.ts')
    editSxi((skin) => {
      const table = skin.default.s_info.ss_2
      delete table['104'].a4.b.clear
      delete table['107'].a12.tilt_enabled
      delete table['107'].a12.floaters[0].flip
    })
  })
  assert.equal(await row('响应倾斜').locator('input').isChecked(), true)
  assert.equal(await row('允许翻转').locator('input').isChecked(), true)
  await show("104")
  assert.equal(await row('结束后移除').locator('input').isChecked(), true)
  assert.equal((await animation(107)).a12.tilt_enabled, undefined)
  assert.equal((await animation(104)).a4.b.clear, undefined)

  // 筛选：标签文字、分组名与 skin.json 键都能命中；未命中的分组收起，动画列表始终留着可以换对象
  await show("107")
  const filter = page.locator("#inspector-filter")
  await page.locator(".inspector-filter-open").click()
  await filter.fill("颜色")
  await page.waitForFunction(() => document.querySelector('#document-fields [data-inspector-group-label="传感器"]')?.hasAttribute("data-filter-miss"))
  assert.equal(await section("液体外观").getAttribute("data-filter-miss"), null)
  assert.equal(await section("动画").getAttribute("data-filter-miss"), null, "列表不参与筛选")
  await filter.fill("波浪物理")
  await page.waitForFunction(() => document.querySelector('#document-fields [data-inspector-group-label="液体外观"]')?.hasAttribute("data-filter-miss"))
  assert.equal(await section("波浪物理").getAttribute("data-filter-miss"), null)
  await filter.fill("back")
  await page.waitForFunction(() => !document.querySelector('#document-fields [data-inspector-group-label="时间与循环"]')?.hasAttribute("data-filter-miss"))
  await filter.fill("psr")
  await show("103")
  // 等新对象的分组渲染出来并应用筛选（旧对象没有「帧资源」，不能只看它没有 data-filter-miss）。
  await page.waitForFunction(() => {
    const frames = document.querySelector('#document-fields [data-inspector-group-label="帧资源"]')
    return frames && !frames.hasAttribute("data-filter-miss")
      && document.querySelector('#document-fields [data-inspector-group-label="位置与层级"]')?.hasAttribute("data-filter-miss")
  })
  assert.equal(await section("位置与层级").getAttribute("data-filter-miss"), "", "换对象后筛选仍然生效")
  await filter.press("Escape")
  await filter.press("Escape")

  // 只读（交互预览）：字段禁用，编辑按钮不可用，重置不出现；列表与播放仍可用
  await open(true)
  assert.equal(await page.locator("#selected-key").textContent(), "动画与动效")
  await show("102")
  assert.equal(await row("组合方式").locator("button").first().isDisabled(), true)
  assert.equal(await fields.getByLabel("新建动画", { exact: true }).isDisabled(), true)
  await show("107")
  assert.equal(await fields.getByRole("button", { name: "添加浮动物体", exact: true }).isDisabled(), true)
  assert.equal(await fields.getByRole("button", { name: "删除物体 1", exact: true }).isDisabled(), true)
  await show("100")
  assert.equal(await input("持续时间").isDisabled(), true)
  assert.equal(await row("变化属性").locator("button").first().isDisabled(), true)
  assert.equal(await page.locator(".inspector-reset").isHidden(), true)
  await page.waitForFunction(() => !document.querySelector('#document-fields .ui-animation-transport button')?.disabled)
  // 点击只读数值统一引导到编辑模式；窄屏属性面板不横向溢出。
  await row('持续时间').scrollIntoViewIfNeeded()
  const readonlyField = await input('持续时间').boundingBox()
  await page.mouse.click(readonlyField.x + readonlyField.width / 2, readonlyField.y + readonlyField.height / 2)
  await page.locator('#edit-mode-dialog[open]').waitFor()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(async () => (await import('/src/app/mobile-layout.ts')).setMobilePane('inspector'))
  assert.equal(await row('持续时间').isVisible(), true)
  assert.equal(await fields.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true)

  // 空表也能直接创建全部九类动画；新建的动画直接选中；复制不覆盖原编号，删除可撤销，已引用的不能删。
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.evaluate(async () => (await import('/src/app/mobile-layout.ts')).selectChoice(document.querySelector('#mode'), 'edit'))
  await show("100")
  assert.equal(await page.getByRole('button', { name: '删除动画 100', exact: true }).isDisabled(), true)
  await page.evaluate(async () => (await import('/src/app/sxi-fields.ts')).editSxi((skin) => { skin.default.s_info.ss_2 = {} }))
  assert.equal(await fields.locator('[data-animation-id]').count(), 0)
  assert.match(await fields.locator('.ui-listbox').textContent(), /还没有动画/)
  for (const [index, kind] of ['a1', 'a3', 'af2', 'a4', 'a10', 'a11', 'a12', 'a13', 'a14'].entries()) {
    await page.getByLabel('新建动画', { exact: true }).selectOption(kind)
    assert.ok((await animation(index + 1))[kind], `${kind} 创建后应直接进入可视化编辑`)
    assert.equal(await fields.locator(`[data-animation-id="${index + 1}"]`).getAttribute('aria-selected'), 'true', '新建后选中它')
  }
  await show("3")
  await row('作用区域').locator('select').selectOption('2')
  assert.equal((await animation(3)).af2.r, 2, '首次选择未设置的数值枚举不能写成字符串')
  await show("1")
  await page.getByRole('button', { name: '复制动画 1', exact: true }).click()
  assert.equal((await animation(10)).id, 'ANIM10')
  assert.deepEqual((await animation(10)).a1, (await animation(1)).a1)
  await page.getByRole('button', { name: '删除动画 10', exact: true }).click()
  assert.equal(await animation(10), undefined)
  await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
  assert.equal((await animation(10)).id, 'ANIM10')

  // 键盘：方向键在列表里换动画，焦点留在列表
  await fields.locator('[data-animation-id][aria-selected="true"]').focus()
  await page.keyboard.press('Home')
  await page.waitForFunction(() => document.activeElement?.dataset.animationId === "1")
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => document.activeElement?.dataset.animationId === "2" && document.activeElement.getAttribute('aria-selected') === 'true')

  assert.deepEqual(errors, [])
  console.log("SXI 动画检查器：列表选择、9 类动画可视化编辑、组合轨道、浮动物体、改动标记/重置、筛选、只读、新建/复制/删除与撤销重做均通过")
} catch (error) {
  await page.screenshot({ path: `${process.env.PI_SCRATCH_DIR ?? "."}/bdi-sxi-animation-failure.png` }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await server.close()
}
