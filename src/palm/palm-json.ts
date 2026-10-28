export type PalmJSONValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | PalmJSONValue[]
  | { [key: string]: PalmJSONValue }

const CONTROL_ESCAPES: Record<string, string> = {
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
}

// Swift's `Int.max`, produced by `String.toInt()` for the "inf" literal. JavaScript
// numbers cannot represent it, so the model carries this sentinel instead.
export const PALM_INT_MAX = Number.MAX_SAFE_INTEGER
const PALM_INT_MAX_LITERAL = "9223372036854775807"

// Swift's JSONEncoder escapes forward slashes, which the Palm app expects in file URLs.
function encodeString(value: string): string {
  let result = '"'
  for (const character of value) {
    const control = CONTROL_ESCAPES[character]
    if (control) {
      result += control
    } else if (character === '"' || character === "\\" || character === "/") {
      result += `\\${character}`
    } else if (character < " ") {
      result += `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
    } else {
      result += character
    }
  }
  return `${result}"`
}

type PalmDecimal = { negative: boolean; digits: string; exponent: number }

// Splits a decimal string ("-1.25e+3", "0.00012", "1200") into sign, significant
// digits and the scientific exponent, so it can be re-formatted like Foundation does.
function decomposeDecimal(text: string): PalmDecimal {
  let body = text
  let negative = false
  if (body.startsWith("-")) {
    negative = true
    body = body.slice(1)
  }
  let exponent = 0
  const marker = body.search(/[eE]/)
  if (marker >= 0) {
    exponent = Number(body.slice(marker + 1))
    body = body.slice(0, marker)
  }
  const dot = body.indexOf(".")
  const integer = dot >= 0 ? body.slice(0, dot) : body
  const fraction = dot >= 0 ? body.slice(dot + 1) : ""
  const combined = integer + fraction
  const firstSignificant = combined.search(/[1-9]/)
  if (firstSignificant < 0) return { negative, digits: "0", exponent: 0 }
  const digits = combined.slice(firstSignificant).replace(/0+$/, "")
  return { negative, digits, exponent: exponent + integer.length - firstSignificant - 1 }
}

// Mirrors Swift's JSONEncoder scalar formatting: shortest round-trip digits, plain
// notation for decimal exponents in [-4, 15], otherwise `1e+16` / `1e-05` style.
function formatPalmDecimal({ negative, digits, exponent }: PalmDecimal): string {
  const sign = negative ? "-" : ""
  if (exponent >= -4 && exponent <= 15) {
    if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`
    if (digits.length <= exponent + 1) return `${sign}${digits}${"0".repeat(exponent + 1 - digits.length)}`
    return `${sign}${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`
  }
  const mantissa = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`
  const padded = String(Math.abs(exponent)).padStart(2, "0")
  return `${sign}${mantissa}e${exponent < 0 ? "-" : "+"}${padded}`
}

function encodePalmNumber(value: number): string {
  if (value === PALM_INT_MAX) return PALM_INT_MAX_LITERAL
  if (!Number.isFinite(value)) {
    throw new Error(`皮肤数据包含无法编码的数值：${value}`)
  }
  if (value === 0) return Object.is(value, -0) ? "-0" : "0"
  return formatPalmDecimal(decomposeDecimal(value.toExponential()))
}

function encodeScalar(value: PalmJSONValue, indent: string): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === "string") return encodeString(value)
  if (typeof value === "number") return encodePalmNumber(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  if (Array.isArray(value)) {
    const items = value
      .map((item) => encodeScalar(item, `${indent}  `))
      .filter((item): item is string => item !== undefined)
    if (items.length === 0) return `[\n\n${indent}]`
    return `[\n${items.map((item) => `${indent}  ${item}`).join(",\n")}\n${indent}]`
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => {
      const encoded = encodeScalar(value[key], `${indent}  `)
      return encoded === undefined ? undefined : `${indent}  ${encodeString(key)} : ${encoded}`
    })
    .filter((item): item is string => item !== undefined)
  if (entries.length === 0) return `{\n\n${indent}}`
  return `{\n${entries.join(",\n")}\n${indent}}`
}

export function encodePalmJSON(value: PalmJSONValue): string {
  // Sorted keys and two-space indentation match Foundation's `.prettyPrinted, .sortedKeys`.
  return encodeScalar(value, "") ?? "null"
}

export function compactPalmJSON(value: PalmJSONValue): string {
  if (value === null || value === undefined) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") return encodePalmNumber(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  if (Array.isArray(value)) return `[${value.map(compactPalmJSON).join(",")}]`
  const entries = Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${compactPalmJSON(value[key])}`)
  return `{${entries.join(",")}}`
}
