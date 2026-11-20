// 搜狗手机皮肤（SSF）转换器。
//
// 搜狗皮肤只描述"长什么样"，不含按键几何：容器尺寸与键清单来自官方骨架（客户端内置的那份），
// 布局树由键的相邻关系推出。读取时骨架是外部输入，写回时不碰骨架、也不回源包。
import { SkinArchive } from "@/skin.ts"
import { SsfPackage, type SsfTheme } from "@/ssf/ssf-package.ts"
import { skeletonBoardOf } from "@/skin-model/formats/ssf/skeleton.ts"
import { ssfToModel, type SsfLook, type SsfReadHints } from "@/skin-model/formats/ssf/read.ts"
import { ssfFromModel, ssfPackOf, ssfStructureOf } from "@/skin-model/formats/ssf/write.ts"
import { identifySsf, parseSsf } from "@/skin-model/formats/ssf/pipeline.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import type { SkinFormat } from "@/skin-model/format.ts"
import type { Orientation } from "@/skin-model/types.ts"
import { filesOf } from "@/skin-model/pipeline.ts"

export type SsfSource = {
  /** 皮肤包内的全部文件。 */
  files: Map<string, Uint8Array>
  /** 官方骨架：提供容器尺寸与键清单，只读。写回不需要它。 */
  skeleton?: SkinArchive
  theme: SsfTheme
  orientation: Orientation
}

/** 搜狗的时段是「外观在什么时间生效」，不是主题；`theme` 只映射白天/夜间两个身份。 */
function looksOf(pkg: SsfPackage): SsfLook[] {
  const time = pkg.files.has("time.ini") ? pkg.ini("time.ini") : undefined
  const folders = [...new Set([...pkg.files.keys()].flatMap((path) => {
    const match = path.match(new RegExp(`^${pkg.resolution}/([^/]+)/phoneSkin\\.ini$`))
    return match ? [match[1]] : []
  }))]
  // 老包没有时段层：外观直接放在分辨率目录下，等同全天。
  if (!folders.length) return [{ folder: "", name: "day", theme: "light", activation: { kind: "always" } }]
  const listed = time?.get(pkg.resolution, "STATUS_LIST")?.split(",").map((value) => value.trim()).filter((value) => folders.includes(value))
  const statuses = listed?.length ? listed : [...folders].sort()
  const coversNoon = (status: string): boolean => {
    const starts = time?.get(status, "START")?.split(",").map(Number) ?? []
    const ends = time?.get(status, "END")?.split(",").map(Number) ?? []
    return starts.some((start, index) => start <= 12 && 12 <= (ends[index] ?? -1))
  }
  return statuses.map((status) => {
    const starts = time?.get(status, "START")?.split(",").map(Number) ?? []
    const ends = time?.get(status, "END")?.split(",").map(Number) ?? []
    const ranges = starts.flatMap((startHour, index) => {
      const endHour = ends[index]
      return Number.isFinite(startHour) && Number.isFinite(endHour) ? [{ startHour, endHour }] : []
    })
    return {
      folder: status,
      name: status,
      theme: coversNoon(status) ? "light" : "dark",
      activation: ranges.length ? { kind: "time", ranges } : { kind: "always" },
    }
  })
}

/** 打开一个皮肤：包 + 官方骨架。缺骨架时搜狗皮肤没有几何，读不出模型。 */
export function ssfSource(
  files: Map<string, Uint8Array>,
  skeleton: SkinArchive,
  options: Partial<Pick<SsfSource, "theme" | "orientation">> = {},
): SsfSource | undefined {
  try {
    SsfPackage.fromFiles(files)
  } catch {
    return undefined
  }
  return { files, skeleton, theme: options.theme ?? "light", orientation: options.orientation ?? "port" }
}

/** 读取提示：骨架给出容器与键表，包给出分辨率与时段。皮肤本身不参与。 */
export function ssfHintsOf(source: SsfSource): SsfReadHints {
  if (!source.skeleton) throw new Error("读取搜狗皮肤需要官方骨架")
  const pkg = SsfPackage.fromFiles(source.files)
  const board = skeletonBoardOf(source.skeleton, { theme: source.theme, orientation: source.orientation })
  if (!board) throw new Error("搜狗骨架里没有主键盘布局")
  return {
    resolution: Number(pkg.resolution),
    theme: source.theme,
    orientation: source.orientation,
    landscape: source.orientation === "land",
    container: board.container,
    keys: board.keys,
    layout: board.path,
    looks: looksOf(pkg),
  }
}

function capabilities(): ReadonlyMap<Capability, CapabilityLevel> {
  return new Map<Capability, CapabilityLevel>([
    ["board.geometry", "none"],
    ["board.keys", "full"],
    ["board.add-remove", "none"],
    ["key.actions", "full"],
    ["key.states", "full"],
    ["key.touch", "none"],
    ["style.image", "full"],
    ["style.nine-slice", "full"],
    ["style.color", "full"],
    ["style.text", "full"],
    ["style.icon", "full"],
    ["panel.backdrop", "full"],
    // 面板只有外观与像素内边距：形状在样式表里，位置尺寸与内容池都不在包里。
    ["panel.candidate", "partial"],
    ["panel.hint", "partial"],
    ["panel.list", "partial"],
    ["panel.input", "partial"],
    ["panel.toolbar", "partial"],
    // 关键帧曲线能写回；Anim_Style/Animation/Anim_Obj 三层语义未定，原样保留成 opaque。
    ["motion.track", "partial"],
    ["motion.sequence", "partial"],
    ["motion.binding", "partial"],
    ["sound", "full"],
    ["font", "partial"],
  ])
}

export const ssfFormat: SkinFormat<SsfSource> = {
  name: "ssf",
  capabilities: capabilities(),
  derive: { tolerance: 1 },
  open(archive, context) {
    return context.skeleton ? ssfSource(filesOf(archive), context.skeleton) : undefined
  },
  importer(source) {
    const hints = ssfHintsOf(source)
    return {
      identify: identifySsf,
      parse: parseSsf,
      toModel: (documents) => ssfToModel(documents, hints),
    }
  },
  exporter: {
    fromModel: ssfFromModel,
    structure: ssfStructureOf,
    pack: ssfPackOf,
  },
}

