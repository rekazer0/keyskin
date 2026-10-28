// 设计规范的强制执行（规则见 DESIGN.md）。每条规则按文件统计违规，任何违规都直接失败。
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import postcss from "postcss"

const root = new URL("..", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")
const list = (dir, ext) => readdirSync(new URL(dir, root)).filter((name) => name.endsWith(ext)).map((name) => `${dir}${name}`)
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))

const cssFiles = list("src/", ".css")
// 设备模拟按真机还原，数值规则不适用（DESIGN.md §1）
const scaledCss = (files) => Object.fromEntries(Object.entries(files).filter(([file]) => file !== "src/device-preview.css"))
const tsFiles = [...list("src/", ".ts"), ...list("src/app/", ".ts"), ...list("src/app/wiring/", ".ts"), ...list("src/ssf/", ".ts"), ...list("src/palm/", ".ts")]
const htmlFiles = list("", ".html")
const css = Object.fromEntries(cssFiles.map((f) => [f, stripComments(read(f))]))
const ts = Object.fromEntries(tsFiles.map((f) => [f, read(f)]))
const html = Object.fromEntries(htmlFiles.map((f) => [f, read(f)]))
const TOKENS = "src/tokens.css"
const ICONS = "src/icons.ts"
// 设备模拟（真机外框与画布背景选项）必须与真机一致，是唯一允许写色值的文件（DESIGN.md §1）
const DEVICE = "src/device-preview.css"

/** Declarations of the given properties: [property, value] pairs. */
function declarations(text, property) {
  return [...text.matchAll(new RegExp(`(?:^|[;{\\s])(${property})\\s*:\\s*([^;{}]+)`, "g"))].map((m) => [m[1], m[2].trim()])
}
const count = (text, pattern) => (text.match(pattern) ?? []).length
const SPACING_SCALE = new Set(["0", "1", "2", "4", "6", "8", "12", "16", "20", "24", "32", "40", "48"])
const onScale = (n) => SPACING_SCALE.has(n) || (Number(n) > 48 && Number(n) % 8 === 0)

/** rule → (file → count). Each rule says what DESIGN.md section it enforces. */
const rules = {
  // §1 颜色：只能引用 tokens.css 中的颜色 token
  "css-color-literal": () => perFile(css, (text, file) => file === TOKENS || file === DEVICE ? 0
    : count(text.replace(/var\([^)]*\)/g, ""), /(?<![\w-])#[0-9a-fA-F]{3,8}(?![\w-])|\b(?:rgba?|hsla?)\(|(?<![-\w])(?:white|black)(?![-\w])/g)),
  // §2 字号：只能用 --font-size-*
  "css-font-size-literal": () => perFile(scaledCss(css), (text, file) => file === TOKENS ? 0
    : declarations(text, "font-size").filter(([, v]) => !/^(var\(--font-size-[a-z]+\)|var\(--source-font-size(, var\(--font-size-[a-z]+\))?\)|inherit|1em|100%|0)(\s*!important)?$/.test(v)).length),
  // §2 font 简写里的字号同样只能用 token
  "css-font-shorthand-literal": () => perFile(scaledCss(css), (text) =>
    declarations(text, "font").filter(([, v]) => /\d*\.?\d+px/.test(v.replace(/var\([^)]*\)/g, ""))).length),
  // §2 字重：400 / 500 / 600
  "css-font-weight-off-scale": () => perFile(scaledCss(css), (text) =>
    declarations(text, "font-weight").filter(([, v]) => !/^(400|500|600|inherit|normal|var\(--font-weight-[a-z]+\))(\s*!important)?$/.test(v)).length),
  // §3 圆角：只能用 --radius-*（0 与 50% 除外）
  "css-radius-literal": () => perFile(scaledCss(css), (text, file) => file === TOKENS ? 0
    : declarations(text, "border(?:-[a-z]+)*-radius").filter(([, v]) => /\d*\.?\d+(px|rem|em)/.test(v.replace(/var\([^)]*\)/g, ""))).length),
  // §4 间距：4px 网格
  "css-spacing-off-scale": () => perFile(scaledCss(css), (text) =>
    declarations(text, "(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)*")
      .flatMap(([, v]) => [...v.replace(/var\([^)]*\)/g, "").matchAll(/-?(\d*\.?\d+)px/g)].map((m) => m[1]))
      .filter((n) => !onScale(n)).length),
  // §6 动效：时长与曲线只能用 --duration-* / --ease-*
  "css-motion-literal": () => perFile(scaledCss(css), (text, file) => file === TOKENS ? 0
    : declarations(text, "(?:transition|animation)(?:-[a-z]+)*")
      // 循环播放的加载 / 提示动画（infinite）不受过渡时长档位限制
      .filter(([p, v]) => !/-(name|property|fill-mode|iteration-count|direction|play-state)$/.test(p) && !/infinite/.test(v)
        && /\d*\.?\d+m?s\b|cubic-bezier|\bease(-in|-out|-in-out)?\b|\blinear\b/.test(v.replace(/var\([^)]*\)/g, ""))).length),
  // §8 层叠：禁止 !important
  "css-important": () => perFile(css, (text) => count(text, /!important/g)),
  // §8 token 只在 tokens.css 定义；组件私有变量以 --_ 开头
  "css-token-outside-tokens": () => perFile(css, (text, file) => file === TOKENS ? 0 : count(text, /(?:^|[;{\s])--(?!_)[a-z][\w-]*\s*:/g)),
  // §8 同一个选择器只在一个文件里定义
  "css-cross-file-selector": () => {
    const owners = new Map()
    for (const file of cssFiles) {
      postcss.parse(read(file)).walkRules((rule) => {
        if (rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name)) return
        for (const selector of rule.selectors) {
          const key = selector.replace(/\s+/g, " ")
          if (!owners.has(key)) owners.set(key, new Set())
          owners.get(key).add(file)
        }
      })
    }
    const out = {}
    for (const files of owners.values()) if (files.size > 1) for (const file of [...files].slice(1)) out[file] = (out[file] ?? 0) + 1
    return out
  },
  // §5 图标：只从 src/icons.ts 取 Lucide 图标
  "icon-outside-registry": () => ({
    ...perFile(ts, (text, file) => file === ICONS ? 0 : count(text, /from\s+["']lucide["']|<svg\b/g)),
    ...perFile(html, (text) => count(text, /<svg\b/g)),
  }),
  // §8 HTML 不写内联样式
  "html-inline-style": () => perFile(html, (text) => count(text, /\sstyle="/g)),
  // §9 代码：单个 TS 文件不超过 800 行（超出部分计数）
  "ts-file-too-long": () => perFile(ts, (text) => Math.max(0, text.split("\n").length - 800)),
}

function perFile(files, measure) {
  const out = {}
  for (const [file, text] of Object.entries(files)) {
    const n = measure(text, file)
    if (n) out[file] = n
  }
  return out
}

for (const [name, measure] of Object.entries(rules)) {
  test(`design system: ${name}`, () => {
    assert.deepEqual(measure(), {}, `违反 DESIGN.md「${name}」：改用规范 token / 组件 / 图标注册表，不要加例外。`)
  })
}

test("design system: every CSS file is loaded somewhere", () => {
  const loaders = [...Object.values(ts), ...Object.values(html), ...Object.values(css)].join("\n")
  const orphans = cssFiles.filter((file) => !loaders.includes(file.replace("src/", "")))
  assert.deepEqual(orphans, [], "未被任何入口引用的 CSS 文件应删除")
})

test("design system: tokens.css is the first stylesheet of every window", () => {
  assert.match(ts["src/main.ts"], /^import "\.\/tokens\.css"$/m)
  const firstImport = ts["src/main.ts"].match(/^import "\.\/[\w-]+\.css"$/m)?.[0]
  assert.equal(firstImport, 'import "./tokens.css"')
  for (const page of ["picker.html", "new-project.html"]) {
    assert.match(html[page].match(/<link rel="stylesheet"[^>]*>/)?.[0] ?? "", /tokens\.css/, `${page} 必须先加载 tokens.css`)
  }
})

test("design system: every var(--x) used in CSS is defined", () => {
  const defined = new Set()
  for (const text of Object.values(css)) for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1])
  // 运行时由 TS 写入的变量（style.setProperty("--x", …) 等）
  for (const text of Object.values(ts)) for (const m of text.matchAll(/["`](--[\w-]+)["`]/g)) defined.add(m[1])
  const missing = new Set()
  for (const [file, text] of Object.entries(css)) {
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) if (!defined.has(m[1]) && !m[2]) missing.add(`${file}: ${m[1]}`)
  }
  assert.deepEqual([...missing], [], "引用了不存在的变量（多半是删掉旧 token 后遗留的引用）")
})

// §7 交互状态
test("design system: hover styles only apply on devices that can hover", () => {
  const offenders = []
  for (const file of cssFiles) postcss.parse(read(file)).walkRules((rule) => {
    if (!rule.selectors.some((s) => s.includes(":hover"))) return
    for (let p = rule.parent; p; p = p.parent) if (p.type === "atrule" && /hover:\s*hover/.test(p.params)) return
    offenders.push(`${file}: ${rule.selector.slice(0, 80)}`)
  })
  assert.deepEqual(offenders, [], ":hover 必须写在 @media (hover: hover) 里")
})

test("design system: every interactive component has the shared focus ring and disabled state", () => {
  const components = read("src/components.css")
  const interactive = [".ui-button", ".ui-icon-button", ".ui-segmented > button", ".ui-switch", ".ui-list-item"]
  const focus = components.match(/:where\(([^)]*)\):focus-visible/)?.[1] ?? ""
  const disabled = components.match(/:where\(([^)]*)\):is\(:disabled/)?.[1] ?? ""
  for (const c of interactive) {
    assert.ok(focus.includes(c), `${c} 缺少统一的焦点样式`)
    if (c !== ".ui-list-item") assert.ok(disabled.includes(c), `${c} 缺少统一的禁用样式`)
  }
})
