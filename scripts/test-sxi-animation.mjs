// 手心 (.sxi) 动画检查器：打开一份带全部 9 类动画的皮肤，从侧栏进入「动画与动效」，
// 像用户一样读写时间轴、分组字段、组合轨道与浮动物体；检查 skin.json、撤销重做、
// 改动标记与重置、筛选、只读模式，并确认没有页面错误。
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
  await page.waitForFunction(() => document.querySelectorAll("#document-fields > .sxi-animation-section").length === 10)
  // 检查器在渲染末尾拍一次基线（改动标记/重置依赖它），等它完成后再操作。
  await page.waitForTimeout(400)
}

const section = (id) => page.locator("#document-fields > .sxi-animation-section").nth(Number(id) - 100)
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const captionOf = (label) => page.locator(".document-field-caption").filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) })
const row = (id, label) => section(id).locator(".document-property-field").filter({ has: captionOf(label) })
const input = (id, label) => row(id, label).locator("input").first()
const captions = (id) => section(id).locator(".document-field-caption").allTextContents()
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

try {
  await open()
  const original = (await read()).skin.default.s_info.ss_2

  // 入口与对象头
  assert.deepEqual(await page.locator(`.sidebar-overview button[data-path="${animationPath}"] .nav-label`).allTextContents(), ["动效设计", "粒子设计"])
  assert.equal(await page.locator("#selected-key").textContent(), "动画与动效")
  assert.match(await page.locator("#selected-key-context").textContent(), /skin\.json · s_info\.ss_2/)
  const rail = page.locator("#mobile-inspector-groups button")
  assert.deepEqual(await rail.allTextContents(), ["动画 100", "动画 101", "动画 102", "动画 103", "动画 104", "动画 105", "动画 106", "动画 107", "动画 108", "动画 109"])

  // 每类动画的字段都按手心自己的名字出现
  assert.deepEqual(await section(100).locator(".document-section-title").textContent(), "动画 100")
  assert.equal(await section(100).locator(".document-section-code").textContent(), "属性变化")
  assert.match(await section(100).locator(".ui-animation-time").textContent(), /320 ms/)
  assert.match(await section(100).locator(".sxi-animation-references").textContent(), /播放：样式 9001（按下）/)
  assert.match(await section(100).locator(".sxi-animation-references").textContent(), /被 动画 102 组合/)
  assert.match(await section(102).locator(".sxi-animation-references").textContent(), /播放：样式 9001（显示）/)
  assert.ok((await captions(100)).includes("变化属性"))
  assert.ok((await captions(100)).includes("起始缩放（%）"))
  assert.equal(await row(100, "变化属性").locator("select").inputValue(), "3")
  assert.equal(await input(100, "持续时间").inputValue(), "160")

  // 位移单位只属于位移（type 2）；缩放动画不应出现像素写法。
  assert.equal(await section(100).locator(".ui-segmented").count(), 0)
  assert.ok((await captions(101)).includes("位移单位"))
  assert.match(await section(101).textContent(), /切换单位只保留数值/)
  assert.equal(await section(101).locator(".ui-segmented button[aria-pressed='true']").textContent(), "像素")
  assert.ok((await captions(101)).includes("起始位移（px）"))

  assert.equal(await section(102).locator(".sxi-combo-item").count(), 2)
  assert.equal(await section(102).locator(".sxi-combo-item .sxi-combo-name").first().textContent(), "动画 100属性变化 · 160 ms")
  assert.equal(await section(102).locator(".ui-segmented button[aria-pressed='true']").textContent(), "同时")

  assert.equal(await row(103, "帧修改方式").locator("select").inputValue(), "1")
  assert.equal(await input(103, "图片序列").inputValue(), "press.webp")
  assert.equal(await input(103, "三段播放速率").inputValue(), "0.5,1,1.5")
  assert.match(await section(103).locator(".ui-animation-time").textContent(), /500 ms/)

  assert.ok((await captions(104)).includes("发射区域位置"))
  assert.equal(await input(104, "粒子总数").inputValue(), "12")
  assert.equal(await input(104, "粒子图片").inputValue(), "7,8")

  assert.equal(await row(105, "路径模式").locator("select").inputValue(), "3")
  // LEVEL 缺失时手心按上层处理，检查器不能显示成下层。
  assert.equal(await row(105, "显示层级").locator("select").inputValue(), "1")
  assert.equal(await input(105, "空闲恢复间隔").inputValue(), "500")

  assert.equal(await input(106, "碰撞区域位置").first().inputValue(), "1")
  assert.equal(await row(106, "碰撞区域尺寸").locator("input").nth(1).inputValue(), "40")
  assert.equal(await input(106, "重力").inputValue(), "980")

  assert.equal(await input(107, "液体颜色").first().getAttribute("type"), "color")
  assert.equal(await section(107).locator(".sxi-animation-floater").count(), 1)
  assert.match(await section(107).textContent(), /浮动物体（1）/)

  assert.equal(await input(108, "循环帧模板").inputValue(), "element%d_loop.webp")
  assert.equal(await input(108, "物件数量").inputValue(), "7")
  assert.equal(await input(108, "跳跃时长").inputValue(), "620")

  assert.equal(await input(109, "背景图片").inputValue(), "rabbit_background.png")
  assert.equal(await input(109, "掉落物模板").inputValue(), "falling_element_%d.png")
  assert.equal(await input(109, "掉落时长").inputValue(), "1000")

  // 数值编辑：写回 skin.json、进入撤销栈，并出现改动标记；不生成 anim.ini
  await change(input(100, "持续时间"), "320")
  await waitFor("100", "a1.duration", 320)
  let state = await read()
  assert.equal(await page.evaluate(async () => (await import("/src/app/state.ts")).appState.archive.getBytes("light/skin/res/anim.ini")), undefined)
  assert.equal(await page.locator(".inspector-changes").textContent(), "已改 1")
  assert.ok(await section(100).locator("h3[data-modified]").count())
  await page.evaluate(async () => { const history = await import("/src/app/edit-history.ts"); history.undo() })
  await waitFor("100", "a1.duration", 160)
  await page.evaluate(async () => { const history = await import("/src/app/edit-history.ts"); history.redo() })
  await waitFor("100", "a1.duration", 320)

  // 变化属性切换：from/to 在标量、比例点、像素点三种写法间互斥转换
  await row(100, "变化属性").locator("select").selectOption("0")
  await waitFor("100", "a1.b.t", 0)
  let a1 = (await animation(100)).a1
  assert.deepEqual([a1.from, a1.to], [255, 0])
  assert.equal(a1.from_p, undefined, "scalar type drops the percent points")
  assert.match(await exportedAnim(), /\[ANIM100\][\s\S]*FROM=255[\s\S]*TO=0/)
  await row(100, "变化属性").locator("select").selectOption("2")
  await waitFor("100", "a1.b.t", 2)
  a1 = (await animation(100)).a1
  assert.deepEqual([a1.from_p, a1.to_p], [[0, 0], [0, 0]])
  assert.equal(a1.from, undefined, "point type drops the scalar values")

  // 位移单位：比例 ↔ 像素
  await section(101).locator(".ui-segmented button", { hasText: "比例" }).click()
  await waitFor("101", "a1.from_p", [0, 0])
  assert.equal((await animation(101)).a1.from_px, undefined)
  await section(101).locator(".ui-segmented button", { hasText: "像素" }).click()
  await waitFor("101", "a1.from_px", [0, 0])
  assert.equal((await animation(101)).a1.from_p, undefined)

  // 开关、成对数值、颜色
  await row(101, "自动往返").locator("input").uncheck()
  await waitFor("101", "a1.b.back", false)
  assert.doesNotMatch(await exportedAnim(), /\[ANIM101\][\s\S]*REPEAT_MODE=1/)
  await change(row(103, "画面偏移").locator("input").first(), "4")
  await waitFor("103", "af2.pos", [4, 3])
  assert.match(await exportedAnim(), /\[ANIM103\][\s\S]*OFFSET=4,3/)
  await change(page.locator('input[aria-label="液体颜色色值"]'), "#FF8800")
  await waitFor("107", "a12.surface_color", "#FF8800")
  await row(105, "显示层级").locator("select").selectOption("0")
  await waitFor("105", "a10.l", 0)

  // 三段速率的错误输入不能进入皮肤；修正后可写回。
  await change(input(103, "三段播放速率"), "1,2")
  assert.deepEqual((await animation(103)).af2.psr, [0.5, 1, 1.5])
  assert.equal(await input(103, "三段播放速率").evaluate((field) => field.validity.valid), false)
  await change(input(103, "三段播放速率"), "1,2,3")
  await waitFor("103", "af2.psr", [1, 2, 3])

  // 每类动效至少改一项，并验证矩形尺寸、负数和未知字段不会丢失。
  await change(input(104, "发射速率"), "8")
  await waitFor("104", "a4.rate", 8)
  await change(row(106, "碰撞区域尺寸").locator("input").nth(0), "60")
  await waitFor("106", "a11.collision_rect", [[1, 2], [60, 40]])
  assert.match(await exportedAnim(), /COLLISION_RECT=1,2,61,42/)
  await change(input(108, "跳跃时长"), "800")
  await waitFor("108", "a13.jumpDurationMs", 800)
  await change(input(109, "掉落起点偏移"), "-20")
  await waitFor("109", "a14.fallStartOffsetPx", -20)

  // Shift 连续调值合并为一步撤销，复用检查器通用数值手势。
  const historySize = () => page.evaluate(async () => (await import('/src/app/state.ts')).appState.undoStack.length)
  const beforeGesture = await historySize()
  await input(108, "跳跃时长").focus()
  await input(108, "跳跃时长").press("Shift+ArrowUp")
  await input(108, "跳跃时长").press("Shift+ArrowUp")
  await input(108, "跳跃时长").press("Tab")
  await waitFor("108", "a13.jumpDurationMs", 820)
  assert.equal(await historySize(), beforeGesture + 1)
  await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
  await waitFor("108", "a13.jumpDurationMs", 800)

  // 组合轨道：改播放方式、追加/上移/移除子动画；候选不能引用自身
  const comboOptions = await section(102).locator(".sxi-combo-add select option").allTextContents()
  assert.ok(!comboOptions.includes("动画 102"), "a combination must not be able to add itself")
  await section(102).locator(".ui-segmented button", { hasText: "顺序" }).click()
  await waitFor("102", "a3.a_method", "sequential")
  assert.deepEqual((await animation(102)).a3.method, { sequential: {} })
  await section(102).locator(".sxi-combo-add select").selectOption("109")
  await waitFor("102", "a3.animations", [100, 101, 109])
  await section(102).locator("[aria-label='上移动画 109']").click()
  await waitFor("102", "a3.animations", [100, 109, 101])
  await section(102).locator("[aria-label='移除动画 100']").click()
  await waitFor("102", "a3.animations", [109, 101])

  // 浮动物体：加一个、改文件名、删掉
  await section(107).locator(".sxi-animation-add").click()
  await page.waitForFunction(async () => {
    const { appState } = await import("/src/app/state.ts")
    return JSON.parse(appState.archive.getText("skin.json")).default.s_info.ss_2["107"].a12.floaters.length === 2
  })
  const secondFloater = section(107).locator(".sxi-animation-floater").nth(1)
  assert.equal(await secondFloater.locator(".sxi-animation-floater-heading h5").textContent(), "物体 2")
  await change(secondFloater.locator(".document-property-field").filter({ has: captionOf("图片文件") }).locator("input"), "snow.png")
  assert.equal((await animation(107)).a12.floaters[1].ride, undefined)
  await waitFor("107", "a12.floaters.1.file", "snow.png")
  await section(107).locator("[aria-label='删除物体 2']").click()
  await page.waitForFunction(async () => {
    const { appState } = await import("/src/app/state.ts")
    return JSON.parse(appState.archive.getText("skin.json")).default.s_info.ss_2["107"].a12.floaters.length === 1
  })

  // 保存原生 SXI 后重新打开，所有编辑值及未暴露的字段必须原样保留。
  const saved = await page.evaluate(async () => Array.from((await import('/src/app/state.ts')).appState.archive.toBytes('sxi')))
  const reopened = SkinArchive.open(new Uint8Array(saved), 'sxi')
  assert.deepEqual(JSON.parse(reopened.getText('skin.json')), (await read()).skin)

  // 一次恢复全部：值、a1 写法、组合列表与浮动物体都回到打开时的样子
  assert.ok(await page.locator(".inspector-reset").isVisible())
  await page.locator(".inspector-reset").click()
  await page.waitForFunction(async () => {
    const { appState } = await import("/src/app/state.ts")
    const wrap = JSON.parse(appState.archive.getText("skin.json")).default.s_info.ss_2
    return wrap["100"].a1.duration === 160 && wrap["102"].a3.a_method === "simultaneous" &&
      JSON.stringify(wrap["102"].a3.animations) === "[100,101]" && wrap["107"].a12.floaters.length === 1 &&
      wrap["107"].a12.surface_color === "#2FC7FF" && JSON.stringify(wrap["100"].a1.from_p) === "[100,100]" &&
      wrap["105"].a10.l === undefined
  })
  assert.equal(await page.locator(".inspector-reset").isHidden(), true)
  assert.deepEqual((await read()).skin.default.s_info.ss_2, original, '重置必须完整恢复所有动画数据')
  await row(100, '变化属性').locator('select').selectOption('0')
  await waitFor('100', 'a1.b.t', 0)
  await page.locator('.inspector-reset').click()
  assert.deepEqual((await animation(100)).a1, original['100'].a1, '类型切换后直接重置应恢复原始写法')
  await section(101).getByRole('button', { name: '比例', exact: true }).click()
  await change(row(101, '起始比例').locator('input').first(), '12')
  await page.locator('.inspector-reset').click()
  assert.deepEqual((await animation(101)).a1, original['101'].a1, '单位切换并编辑后重置不能残留另一套起止值')

  // 删除原有浮动物体也能恢复，而不只是撤销新增对象。
  await section(107).getByRole('button', { name: '删除物体 1', exact: true }).click()
  await waitFor('107', 'a12.floaters', [])
  await page.locator('.inspector-reset').click()
  await waitFor('107', 'a12.floaters', original['107'].a12.floaters)

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
  assert.equal(await row(104, '结束后移除').locator('input').isChecked(), true)
  assert.equal(await row(107, '响应倾斜').locator('input').isChecked(), true)
  assert.equal(await row(107, '允许翻转').locator('input').isChecked(), true)
  assert.equal((await animation(107)).a12.tilt_enabled, undefined)
  await page.locator('.inspector-reset').click()
  assert.deepEqual((await read()).skin.default.s_info.ss_2, original)

  // 筛选：标签文字、分组名（内层 h4）与 skin.json 键都能命中，未命中的分组整组收起
  const filter = page.locator("#inspector-filter")
  await page.locator(".inspector-filter-open").click()
  await filter.fill("颜色")
  await page.waitForFunction(() => document.querySelectorAll("#document-fields > .sxi-animation-section[data-filter-miss]").length === 9)
  assert.equal(await section(107).getAttribute('data-filter-miss'), null)
  await filter.fill("液体外观")
  await page.waitForFunction(() => document.querySelectorAll("#document-fields > .sxi-animation-section[data-filter-miss]").length === 9)
  assert.equal(await section(107).getAttribute("data-filter-miss"), null)
  await filter.fill("播放控制")
  await page.waitForFunction(() => document.querySelectorAll("#document-fields > .sxi-animation-section[data-filter-miss]").length === 1)
  assert.equal(await section(102).getAttribute("data-filter-miss"), "", "a3 has no playback group")
  await filter.fill("file")
  await page.waitForFunction(() => !document.querySelectorAll('#document-fields > .sxi-animation-section')[3]?.hasAttribute('data-filter-miss'))
  assert.equal(await section(103).getAttribute("data-filter-miss"), null)
  await filter.fill("i_p")
  assert.equal(await section(104).getAttribute("data-filter-miss"), null)
  await filter.press("Escape")
  await filter.press("Escape")

  // 只读（交互预览）：字段禁用，编辑按钮不可用，重置不出现
  await open(true)
  assert.equal(await page.locator("#selected-key").textContent(), "动画与动效")
  assert.equal(await input(100, "持续时间").isDisabled(), true)
  assert.equal(await row(100, "变化属性").locator("select").isDisabled(), true)
  assert.equal(await section(102).locator(".ui-segmented button").first().isDisabled(), true)
  assert.equal(await section(107).locator(".sxi-animation-add").isDisabled(), true)
  assert.equal(await section(107).locator(".sxi-animation-floater .ui-icon-button").isDisabled(), true)
  assert.equal(await page.locator(".inspector-reset").isHidden(), true)
  // 点击只读数值统一引导到编辑模式；窄屏属性面板不横向溢出。
  await row(100, '持续时间').scrollIntoViewIfNeeded()
  const readonlyField = await input(100, '持续时间').boundingBox()
  await page.mouse.click(readonlyField.x + readonlyField.width / 2, readonlyField.y + readonlyField.height / 2)
  await page.locator('#edit-mode-dialog[open]').waitFor()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(async () => (await import('/src/app/mobile-layout.ts')).setMobilePane('inspector'))
  assert.equal(await row(100, '持续时间').isVisible(), true)
  assert.equal(await page.locator('#document-fields').evaluate((fields) => fields.scrollWidth <= fields.clientWidth + 1), true)

  // 空表也能直接创建全部九类动画；复制不覆盖原编号，删除可撤销，已引用的不能删。
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.evaluate(async () => (await import('/src/app/mobile-layout.ts')).selectChoice(document.querySelector('#mode'), 'edit'))
  assert.equal(await page.getByRole('button', { name: '删除动画 100', exact: true }).isDisabled(), true)
  await page.evaluate(async () => (await import('/src/app/sxi-fields.ts')).editSxi((skin) => { skin.default.s_info.ss_2 = {} }))
  assert.equal(await page.locator('#document-fields > .sxi-animation-section').count(), 0)
  assert.equal(await page.getByLabel('添加动画类型', { exact: true }).isEnabled(), true)
  for (const [index, kind] of ['a1', 'a3', 'af2', 'a4', 'a10', 'a11', 'a12', 'a13', 'a14'].entries()) {
    await page.getByLabel('添加动画类型', { exact: true }).selectOption(kind)
    assert.ok((await animation(index + 1))[kind], `${kind} 创建后应直接进入可视化编辑`)
  }
  const newFrames = page.locator('.sxi-animation-section').filter({ has: page.locator('.document-section-title', { hasText: /^动画 3$/ }) })
  await newFrames.getByLabel('作用区域', { exact: true }).selectOption('2')
  assert.equal((await animation(3)).af2.r, 2, '首次选择未设置的数值枚举不能写成字符串')
  await page.getByRole('button', { name: '复制动画 1', exact: true }).click()
  assert.equal((await animation(10)).id, 'ANIM10')
  assert.deepEqual((await animation(10)).a1, (await animation(1)).a1)
  await page.getByRole('button', { name: '删除动画 10', exact: true }).click()
  assert.equal(await animation(10), undefined)
  await page.evaluate(async () => (await import('/src/app/edit-history.ts')).undo())
  assert.equal((await animation(10)).id, 'ANIM10')

  assert.deepEqual(errors, [])
  console.log("SXI 动画检查器：9 类动画全部可视化编辑；时间轴、组合轨道、浮动物体、改动标记/重置、筛选、只读、撤销重做均通过")
} catch (error) {
  await page.screenshot({ path: `${process.env.PI_SCRATCH_DIR}/bdi-sxi-animation-failure.png` }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await server.close()
}
