// Sogou phone skin → Baidu BDA (protobuf) skin.
//
// Like the BDS writer, the official BDA template supplies panels and key geometry and the Sogou look
// (ssf-look.ts) is painted onto it. BDA styles are shared by many keys, so each painted key gets new
// image styles appended to `appearanceConfig` and its style references repointed; text glyphs get
// recoloured copies of their template text styles. Unknown protobuf fields are kept byte for byte.

import { zipSync } from "fflate"
import { bdaPanelKeyName, type BdaStyleRef } from "../bda.ts"
import { decodeBdaAppearanceUncached } from "../bda-decode.ts"
import { bdaSoundResourceType, encodedField, encodeVarint, join, rawFields, rawString, removeFields, replaceField, updateBdaKeySound } from "../bda-encode.ts"
import { SkinArchive } from "../skin.ts"
import { SsfLook, type LookColors, type LookImage, type LookPair } from "./ssf-look.ts"
import type { SsfPackage, SsfTheme } from "./ssf-package.ts"
import { decodePng, encodePng, isPng, tintImage } from "./ssf-png.ts"
import { ssfPreview, ssfUnsupportedWarnings, type SsfConversion } from "./ssf-to-baidu.ts"

const STYLE_TYPES = { image: 0, color: 1, text: 2 } as const

/**
 * Baidu Android 13.3.18.31 reads a BDA's toolbar icons by name: the Logo and hide buttons from `cand.candKeys`
 * (CAND_F31, CAND_F8) and the F14 container's functions from `cand.menuKeys` (KeymapLoader → CandLoader.k;
 * names from CandIconFunction, paired with each MenuFunction by MenuFunctionConvertor).
 */
const TOOLBAR_CAND_KEYS: Record<string, string> = { CAND_F31: "logo.png", CAND_F8: "close.png" }
const TOOLBAR_MENU_KEYS: Record<string, string> = {
  MENU_EMOJI: "ime_function_expression.png",
  MENU_MODE: "ime_function_switch.png",
  MENU_AUDIO: "ime_function_voice.png",
  MENU_SEARCH: "ime_function_sousou.png",
  MENU_MOVE: "ime_function_textedit.png",
  MENU_PASTE: "ime_function_clipboard.png",
}

/** `KEY_F38_S34` → `F38`, `KEY_Q` → `q`: the action a Baidu INI key would carry in CENTER. */
function bdaKeyAction(name: string): string {
  const action = name.replace(/^KEY_/, "").replace(/_S\d+$/, "")
  return /^[A-Z]$/.test(action) ? action.toLowerCase() : action
}

function styleRef(type: BdaStyleRef["type"], key: number): Uint8Array {
  return join([encodedField(1, 0, encodeVarint(STYLE_TYPES[type])), encodedField(2, 0, encodeVarint(key))])
}

function imageAtom(resourceID: string, image: LookImage): Uint8Array {
  const resource = join([encodedField(1, 0, encodeVarint(0)), encodedField(2, 2, new TextEncoder().encode(resourceID))])
  const stretch = image.stretch
  const rect = stretch && join([
    encodedField(1, 2, join([encodedField(1, 0, encodeVarint(stretch[0])), encodedField(2, 0, encodeVarint(stretch[2]))])),
    encodedField(2, 2, join([encodedField(1, 0, encodeVarint(stretch[1] - stretch[0])), encodedField(2, 0, encodeVarint(stretch[3] - stretch[2]))])),
  ])
  return join([encodedField(1, 2, resource), ...(rect ? [encodedField(2, 2, rect)] : [])])
}

function mapEntry(key: number, value: Uint8Array): Uint8Array {
  return join([encodedField(1, 0, encodeVarint(key)), encodedField(2, 2, value)])
}

/**
 * Next free style keys of a theme. BDA style keys are global across a theme's orientations (the
 * converters merge both into one default.css), so new keys start above every orientation's maximum.
 */
type StyleKeys = { image: number; text: number; color: number }

/** Collects every edit to one appearanceConfig and its theme's `res/` images. */
class AppearanceWriter {
  private bytes: Uint8Array
  private readonly appended: Uint8Array[] = []
  private readonly keys: StyleKeys
  private readonly textStyles: Map<number, Uint8Array>
  private readonly recoloured = new Map<string, number>()
  private readonly resources: ThemeImages

  constructor(bytes: Uint8Array, resources: ThemeImages, keys: StyleKeys) {
    this.bytes = bytes
    this.resources = resources
    this.keys = keys
    this.textStyles = new Map(rawFields(bytes).flatMap((field) => {
      if (field.number !== 2 || !field.bytes) return []
      const entry = rawFields(field.bytes)
      const value = entry.find((item) => item.number === 2)?.bytes
      const key = entry.find((item) => item.number === 1)?.varint ?? 0
      return value ? [[key, value] as const] : []
    }))
  }

  imageStyle(pair: LookPair): Uint8Array {
    const key = this.keys.image++
    const style = join([
      encodedField(1, 2, imageAtom(this.resources.resource(pair.normal), pair.normal)),
      encodedField(2, 2, imageAtom(this.resources.resource(pair.pressed), pair.pressed)),
    ])
    this.appended.push(encodedField(1, 2, mapEntry(key, style)))
    return styleRef("image", key)
  }

  colorStyle(color: string): Uint8Array {
    const key = this.keys.color++
    const style = join([1, 2].map((field) => encodedField(field, 0, encodeVarint(Number.parseInt(color, 16)))))
    this.appended.push(encodedField(3, 2, mapEntry(key, style)))
    return styleRef("color", key)
  }

  /** A copy of a template text style with the Sogou label colours, shared by every key that needs it. */
  recolouredText(key: number, colors: LookColors): Uint8Array | undefined {
    const cacheKey = `${key}:${colors.normal}:${colors.pressed}`
    let copy = this.recoloured.get(cacheKey)
    if (copy === undefined) {
      const original = this.textStyles.get(key)
      if (!original) return
      copy = this.keys.text++
      const style = replaceField(
        replaceField(original, 4, 0, encodeVarint(Number.parseInt(colors.normal, 16))),
        5,
        0,
        encodeVarint(Number.parseInt(colors.pressed, 16)),
      )
      this.appended.push(encodedField(2, 2, mapEntry(copy, style)))
      this.recoloured.set(cacheKey, copy)
    }
    return styleRef("text", copy)
  }

  /** Rewrites each panel (`appearance.panels`, field 4) through `update`. */
  panels(update: (name: string, panel: Uint8Array) => Uint8Array): void {
    this.bytes = join(rawFields(this.bytes).map((field) => {
      const original = this.bytes.slice(field.start, field.end)
      if (field.number !== 4 || !field.bytes) return original
      const entry = rawFields(field.bytes)
      const name = rawString(entry.find((item) => item.number === 1))
      const value = entry.find((item) => item.number === 2)?.bytes
      return value ? encodedField(4, 2, replaceField(field.bytes, 2, 2, update(name, value))) : original
    }))
  }

  result(): Uint8Array {
    return join([this.bytes, ...this.appended])
  }
}

/** PNG resources of one theme: one numeric id per distinct image, next to the template's own. */
class ThemeImages {
  private readonly ids = new Map<string, string>()
  private next: number
  private readonly theme: SsfTheme
  private readonly output: Map<string, Uint8Array>

  constructor(theme: SsfTheme, output: Map<string, Uint8Array>, used: string[]) {
    this.theme = theme
    this.output = output
    this.next = Math.max(90000, ...used.map(Number).filter(Number.isFinite)) + 1
  }

  resource(image: LookImage): string {
    let id = this.ids.get(image.id)
    if (!id) {
      id = String(this.next++)
      this.output.set(`${this.theme}/skin/res/${id}.png`, image.bytes)
      this.ids.set(image.id, id)
    }
    return id
  }
}

function refType(field: { bytes?: Uint8Array }): number {
  return field.bytes ? rawFields(field.bytes).find((item) => item.number === 1)?.varint ?? 0 : -1
}

function refKey(field: { bytes?: Uint8Array }): number {
  return field.bytes ? rawFields(field.bytes).find((item) => item.number === 2)?.varint ?? 0 : -1
}

class BdaThemeConverter {
  private readonly look: SsfLook
  private readonly template: SkinArchive
  private readonly theme: SsfTheme
  private readonly output: Map<string, Uint8Array>
  private readonly images: ThemeImages
  private readonly warnings: string[]
  private readonly tinted = new Map<string, LookImage | undefined>()
  private readonly keys: StyleKeys

  constructor(pkg: SsfPackage, template: SkinArchive, theme: SsfTheme, output: Map<string, Uint8Array>, warnings: string[]) {
    this.look = new SsfLook(pkg, theme, warnings)
    this.template = template
    this.theme = theme
    this.output = output
    this.warnings = warnings
    const appearances = template.names().filter((path) => /^light\/skin\/[^/]+\/appearanceConfig$/.test(path))
      .map((path) => decodeBdaAppearanceUncached(template.getBytes(path)!))
    this.keys = {
      image: Math.max(0, ...appearances.flatMap((appearance) => [...appearance.imageStyles.keys()])) + 1,
      text: Math.max(0, ...appearances.flatMap((appearance) => [...appearance.textStyles.keys()])) + 1,
      color: Math.max(0, ...appearances.flatMap((appearance) => [...appearance.colorStyles.keys()])) + 1,
    }
    const used = template.names().filter((path) => /\/res\/[^/]+\.png$/i.test(path)).map((path) => path.split("/").pop()!.slice(0, -4))
    this.images = new ThemeImages(theme, output, used)
  }

  /** Template image styles used as foreground icons, recoloured whole-file like the BDS glyphs. */
  private recolouredImage(writer: AppearanceWriter, appearance: ReturnType<typeof decodeBdaAppearanceUncached>, key: number, colors: LookColors): Uint8Array | undefined {
    const style = appearance.imageStyles.get(key)
    const tinted = (resourceID: string | undefined, color: string): LookImage | undefined => {
      const id = `template:${resourceID}:${color}`
      if (!this.tinted.has(id)) {
        const bytes = resourceID && this.template.getBytes(`light/skin/res/${resourceID.replace(/\.png$/i, "")}.png`)
        this.tinted.set(id, bytes && isPng(bytes) ? { id, bytes: encodePng(tintImage(decodePng(bytes), color)) } : undefined)
      }
      return this.tinted.get(id)
    }
    const normal = tinted(style?.normalImage?.resource?.resourceID, colors.normal)
    if (!normal) return
    return writer.imageStyle({ normal, pressed: tinted(style?.highlightImage?.resource?.resourceID, colors.pressed) ?? normal })
  }

  private key(writer: AppearanceWriter, appearance: ReturnType<typeof decodeBdaAppearanceUncached>, panel: string, name: string, bytes: Uint8Array, landscape: boolean): Uint8Array {
    const look = this.look.key(panel, bdaKeyAction(name), landscape)
    let key = bytes
    if (look.back) {
      const back = writer.imageStyle(look.back)
      key = replaceField(key, 1, 2, back)
      if (rawFields(key).some((field) => field.number === 4)) key = replaceField(key, 4, 2, back)
    }
    if (look.fore) {
      key = join([removeFields(key, new Set([2, 3])), encodedField(2, 2, writer.imageStyle(look.fore))])
    } else if (look.label) {
      const label = look.label
      key = join(rawFields(key).map((field) => {
        const original = key.slice(field.start, field.end)
        if (field.number !== 2) return original
        const replacement = refType(field) === STYLE_TYPES.text
          ? writer.recolouredText(refKey(field), label)
          : refType(field) === STYLE_TYPES.image ? this.recolouredImage(writer, appearance, refKey(field), label) : undefined
        return replacement ? encodedField(2, 2, replacement) : original
      }))
    }
    return key
  }

  private appearance(path: string, landscape: boolean): Uint8Array {
    const source = this.template.getBytes(path)!
    const appearance = decodeBdaAppearanceUncached(source)
    const writer = new AppearanceWriter(source, this.images, this.keys)
    const { panel, cand, panelColor } = this.look.keyboard()
    const panelRef = panel ? writer.imageStyle({ normal: panel, pressed: panel }) : panelColor ? writer.colorStyle(panelColor) : undefined
    const candRef = cand ? writer.imageStyle({ normal: cand, pressed: cand }) : undefined
    const candidateText = this.look.color("TextStyle_Candidate")
    const candidateColors = candidateText ? { normal: candidateText, pressed: this.look.color("TextStyle_Candidate_Highlight") ?? candidateText } : undefined
    const list = this.look.list()
    const listBack = list.back && writer.imageStyle(list.back)
    const listCell = list.cell && writer.imageStyle(list.cell)
    writer.panels((name, bytes) => join(rawFields(bytes).map((field) => {
      const original = bytes.slice(field.start, field.end)
      if (field.number === 3 && field.bytes) {
        const entry = rawFields(field.bytes)
        const keyName = rawString(entry.find((item) => item.number === 1))
        const value = entry.find((item) => item.number === 2)?.bytes
        return value ? encodedField(3, 2, replaceField(field.bytes, 2, 2, this.key(writer, appearance, name, keyName, value, landscape))) : original
      }
      // The 9-key symbol column (`panel.lists`): background, cells and their text.
      if (field.number === 2 && field.bytes) {
        const value = rawFields(field.bytes).find((item) => item.number === 2)?.bytes
        if (!value) return original
        let listBytes = value
        if (listBack) listBytes = replaceField(listBytes, 1, 2, listBack)
        if (listCell) listBytes = replaceField(listBytes, 2, 2, listCell)
        const fore = rawFields(listBytes).find((item) => item.number === 3)
        const recoloured = list.text && fore && refType(fore) === STYLE_TYPES.text ? writer.recolouredText(refKey(fore), { normal: list.text, pressed: list.text }) : undefined
        if (recoloured) listBytes = replaceField(listBytes, 3, 2, recoloured)
        return encodedField(2, 2, replaceField(field.bytes, 2, 2, listBytes))
      }
      if ((field.number === 7 || field.number === 10) && panelRef) return encodedField(field.number, 2, panelRef)
      if (field.number === 4 && field.bytes) {
        let candBytes = field.bytes
        if (candRef) candBytes = replaceField(candBytes, 1, 2, candRef)
        const fore = rawFields(candBytes).find((item) => item.number === 4)
        const recoloured = candidateColors && fore && refType(fore) === STYLE_TYPES.text ? writer.recolouredText(refKey(fore), candidateColors) : undefined
        if (recoloured) candBytes = replaceField(candBytes, 4, 2, recoloured)
        return encodedField(4, 2, this.toolbarKeys(writer, candBytes))
      }
      return original
    })))
    return writer.result()
  }

  /** Paints the skin's Logo, hide and function icons onto the template's candidate bar keys. */
  private toolbarKeys(writer: AppearanceWriter, cand: Uint8Array): Uint8Array {
    const icon = (file: string) => {
      const pair = this.look.toolbarIcon(file)
      return pair && encodedField(2, 2, writer.imageStyle(pair))
    }
    const menu = Object.entries(TOOLBAR_MENU_KEYS).flatMap(([name, file]) => {
      const fore = icon(file)
      return fore ? [{ name, fore }] : []
    })
    const replaced = new Set(menu.map(({ name }) => name))
    const kept = rawFields(cand).flatMap((field) => {
      const original = cand.slice(field.start, field.end)
      if ((field.number !== 10 && field.number !== 12) || !field.bytes) return [original]
      const entry = rawFields(field.bytes)
      const name = rawString(entry.find((item) => item.number === 1))
      if (field.number === 12) return replaced.has(name) ? [] : [original]
      const value = entry.find((item) => item.number === 2)?.bytes
      const fore = TOOLBAR_CAND_KEYS[name] && icon(TOOLBAR_CAND_KEYS[name])
      if (!value || !fore) return [original]
      return [encodedField(10, 2, replaceField(field.bytes, 2, 2, join([removeFields(value, new Set([2, 3])), fore])))]
    })
    const added = menu.map(({ name, fore }) => encodedField(12, 2, join([encodedField(1, 2, new TextEncoder().encode(name)), encodedField(2, 2, fore)])))
    return join([...kept, ...added])
  }

  /** Default key sound plus per-key sounds that differ from it, in a soundConfig per orientation. */
  private soundConfig(orientation: "port" | "land"): Uint8Array | undefined {
    const fallback = this.look.sound(undefined)
    let config: Uint8Array = new Uint8Array()
    const add = (key: string, sound: { filename: string; bytes: Uint8Array }) => {
      this.output.set(`${this.theme}/skin/res/${sound.filename}`, sound.bytes)
      config = updateBdaKeySound(config, key, { type: bdaSoundResourceType(sound.filename), resourceID: sound.filename })
    }
    try {
      if (fallback) add("default", fallback)
      const appearance = decodeBdaAppearanceUncached(this.template.getBytes(`light/skin/${orientation}/appearanceConfig`)!)
      for (const [panel, value] of appearance.panels) {
        for (const name of value.keys.keys()) {
          const action = bdaKeyAction(name)
          const sound = this.look.sound(this.look.key(panel, action, orientation === "land").binding)
          const key = bdaPanelKeyName(action)
          if (sound && sound.filename !== fallback?.filename && key) add(key, sound)
        }
      }
    } catch (error) {
      this.warnings.push(`按键音未写入 BDA：${error instanceof Error ? error.message : error}`)
      return
    }
    return config.length ? config : undefined
  }

  convert(): void {
    const prefix = "light/skin/"
    for (const path of this.template.names()) {
      if (!path.startsWith(prefix) || path.endsWith("/") || path === `${prefix}Info.txt`) continue
      this.output.set(`${this.theme}/skin/${path.slice(prefix.length)}`, this.template.getBytes(path)!)
    }
    for (const orientation of ["port", "land"] as const) {
      const path = `${prefix}${orientation}/appearanceConfig`
      if (!this.template.getBytes(path)) continue
      this.output.set(`${this.theme}/skin/${orientation}/appearanceConfig`, this.appearance(path, orientation === "land"))
      const sounds = this.soundConfig(orientation)
      if (sounds) this.output.set(`${this.theme}/skin/${orientation}/soundConfig`, sounds)
    }
  }
}

/** Converts a Sogou skin to an Android BDA archive laid out on the official BDA template. */
export function convertSsfToBda(pkg: SsfPackage, template: SkinArchive): SsfConversion {
  if (template.format !== "bda") throw new Error("BDA 转换需要 BDA 模板")
  const warnings = [...pkg.warnings]
  const canonical = new Map<string, Uint8Array>()
  for (const theme of pkg.themes.keys()) new BdaThemeConverter(pkg, template, theme, canonical, warnings).convert()
  warnings.push(...ssfUnsupportedWarnings(pkg))
  if ([...pkg.files.keys()].some((name) => /(^|\/)anim\.ini$/i.test(name))) warnings.push("按键动画（anim.ini）暂不转换为 BDA 动效，已忽略；转为 BDS/BDI 可保留")

  const info = new TextDecoder().decode(template.getBytes("Info.txt") ?? new Uint8Array())
    .split(/\r?\n/).filter((line) => line && !/^(Name|Author|AtomSkinName)=/i.test(line))
  info.unshift(`Name=${pkg.info.name}`)
  if (pkg.info.author) info.push(`Author=${pkg.info.author}`)
  const dual = pkg.themes.size > 1
  if (dual) info.push("AtomSkinName=light,dark")
  const raw: Record<string, Uint8Array> = { "Info.txt": new TextEncoder().encode(`${info.join("\n")}\n`) }
  const preview = ssfPreview(pkg)
  if (preview) raw["demo.png"] = preview
  for (const [path, bytes] of canonical) {
    const themed = path.match(/^(light|dark)\/skin\/(.*)$/)!
    raw[dual ? `${themed[1]}/${themed[2]}` : themed[2]] = bytes
  }
  return { archive: SkinArchive.open(zipSync(raw, { level: 6 }), "bda"), warnings: [...new Set(warnings)] }
}
